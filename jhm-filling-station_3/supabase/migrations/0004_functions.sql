-- ============================================================================
-- 0004 — Functions and triggers
--
-- The stock-affecting calculations are mirrored here from lib/calc so the
-- database can never drift from the UI. Where a formula appears in both
-- places, docs/calculations.md is the single written reference.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role helpers
--
-- SECURITY DEFINER so that policies on `profiles` cannot recurse into
-- themselves when a policy on another table needs to know the caller's role.
-- ---------------------------------------------------------------------------

create or replace function public.jhm_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
    and p.deleted_at is null
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select public.jhm_role() = 'admin' $$;

create or replace function public.is_md() returns boolean
language sql stable as $$ select public.jhm_role() = 'md' $$;

create or replace function public.is_dispenser() returns boolean
language sql stable as $$ select public.jhm_role() = 'dispenser' $$;

-- Manager or admin: the two roles that may write operational records.
create or replace function public.can_write_ops() returns boolean
language sql stable as $$ select public.jhm_role() in ('manager', 'admin') $$;

-- Anyone who may read money: manager, admin, MD. Never a dispenser.
create or replace function public.can_read_money() returns boolean
language sql stable as $$ select public.jhm_role() in ('manager', 'admin', 'md') $$;

-- ---------------------------------------------------------------------------
-- Time
-- ---------------------------------------------------------------------------

-- A business day runs 06:00 → 06:00 Asia/Dhaka. The night shift spans two
-- calendar dates and belongs to the date it opened on.
-- STABLE, not IMMUTABLE: converting a timestamptz to a named zone depends on
-- the timezone database, which can change under the server.
create or replace function public.business_date(p_at timestamptz default now())
returns date
language sql
stable
as $$
  select case
    when (p_at at time zone 'Asia/Dhaka')::time < time '06:00'
      then ((p_at at time zone 'Asia/Dhaka')::date - 1)
    else (p_at at time zone 'Asia/Dhaka')::date
  end
$$;

-- ---------------------------------------------------------------------------
-- Settings
--
-- Thresholds live in `settings` so the business can change them without a
-- deploy. Every caller passes the documented default as a fallback.
-- ---------------------------------------------------------------------------

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql
stable
as $$
  select coalesce((select (value->>'value')::numeric from public.settings where key = p_key limit 1), p_default)
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calibration: dip ↔ litres
-- ---------------------------------------------------------------------------

-- The chart version in force at a moment in time. A dip always resolves
-- against the version valid on its own timestamp, so re-calibrating a tank
-- never retroactively rewrites a closed shift.
create or replace function public.calibration_version_at(p_tank_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
as $$
  select c.version
  from public.tank_calibration c
  where c.tank_id = p_tank_id
    and public.business_date(p_at) between c.valid_from and c.valid_to
  order by c.version desc
  limit 1
$$;

create or replace function public.tank_final_dip_mm(p_tank_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
as $$
  select m.final_dip_mm
  from public.tank_metadata m
  where m.tank_id = p_tank_id
  order by (public.business_date(p_at) between m.validity_from and m.validity_to) desc,
           m.validity_from desc
  limit 1
$$;

-- Dip in millimetres to litres, against the certified chart.
--   * an integer dip is an exact table lookup
--   * a fractional dip is linearly interpolated between the bracketing rows
--   * a dip outside 1 … final_dip_mm for THAT tank is rejected
create or replace function public.dip_to_litres(
  p_tank_id uuid,
  p_dip_mm  numeric,
  p_at      timestamptz default now()
)
returns numeric
language plpgsql
stable
as $$
declare
  v_version   integer;
  v_final     integer;
  v_code      text;
  v_lo_mm     integer;
  v_hi_mm     integer;
  v_lo        numeric;
  v_hi        numeric;
  v_fraction  numeric;
begin
  select code into v_code from public.tanks where id = p_tank_id;
  if v_code is null then
    raise exception 'Unknown tank %', p_tank_id using errcode = 'foreign_key_violation';
  end if;

  v_version := public.calibration_version_at(p_tank_id, p_at);
  if v_version is null then
    raise exception 'No calibration chart is in force for tank % on %', v_code, public.business_date(p_at)
      using errcode = 'no_data_found';
  end if;

  v_final := public.tank_final_dip_mm(p_tank_id, p_at);
  if v_final is null then
    raise exception 'Tank % has no metadata, so its final dip is unknown', v_code
      using errcode = 'no_data_found';
  end if;

  if p_dip_mm < 1 or p_dip_mm > v_final then
    raise exception 'Dip % mm is outside the certified range 1-% mm for tank %', p_dip_mm, v_final, v_code
      using errcode = 'check_violation';
  end if;

  if p_dip_mm = floor(p_dip_mm) then
    select litres into v_lo
    from public.tank_calibration
    where tank_id = p_tank_id and version = v_version and dip_mm = p_dip_mm::integer;

    if v_lo is null then
      raise exception 'Calibration chart for tank % v% has no row at % mm', v_code, v_version, p_dip_mm
        using errcode = 'no_data_found';
    end if;
    return round(v_lo, 3);
  end if;

  v_lo_mm := floor(p_dip_mm)::integer;
  v_hi_mm := ceil(p_dip_mm)::integer;

  select litres into v_lo from public.tank_calibration
   where tank_id = p_tank_id and version = v_version and dip_mm = v_lo_mm;
  select litres into v_hi from public.tank_calibration
   where tank_id = p_tank_id and version = v_version and dip_mm = v_hi_mm;

  if v_lo is null or v_hi is null then
    raise exception 'Calibration chart for tank % v% cannot bracket % mm', v_code, v_version, p_dip_mm
      using errcode = 'no_data_found';
  end if;

  v_fraction := p_dip_mm - v_lo_mm;
  return round(v_lo + (v_hi - v_lo) * v_fraction, 3);
end;
$$;

-- The inverse lookup, for ullage and delivery previews. Never the source of a
-- stock figure, which always comes from a measured dip.
create or replace function public.litres_to_dip(
  p_tank_id uuid,
  p_litres  numeric,
  p_at      timestamptz default now()
)
returns numeric
language plpgsql
stable
as $$
declare
  v_version integer := public.calibration_version_at(p_tank_id, p_at);
  v_lo_mm integer; v_lo numeric;
  v_hi_mm integer; v_hi numeric;
begin
  if v_version is null then
    raise exception 'No calibration chart is in force for tank % ', p_tank_id using errcode = 'no_data_found';
  end if;

  select dip_mm, litres into v_lo_mm, v_lo
  from public.tank_calibration
  where tank_id = p_tank_id and version = v_version and litres <= p_litres
  order by dip_mm desc limit 1;

  select dip_mm, litres into v_hi_mm, v_hi
  from public.tank_calibration
  where tank_id = p_tank_id and version = v_version and litres >= p_litres
  order by dip_mm asc limit 1;

  if v_lo_mm is null or v_hi_mm is null then
    raise exception '% L is outside the certified range for tank %', p_litres, p_tank_id
      using errcode = 'check_violation';
  end if;

  if v_hi_mm = v_lo_mm or v_hi = v_lo then
    return v_lo_mm;
  end if;

  return round(v_lo_mm + (p_litres - v_lo) / (v_hi - v_lo) * (v_hi_mm - v_lo_mm), 1);
end;
$$;

-- Every dip row stores the litres and the chart version it was resolved
-- against, so a later re-calibration cannot silently restate history.
create or replace function public.set_dip_litres()
returns trigger
language plpgsql
as $$
begin
  new.litres := public.dip_to_litres(new.tank_id, new.dip_mm, coalesce(new.recorded_at, now()));
  new.calibration_version := public.calibration_version_at(new.tank_id, coalesce(new.recorded_at, now()));
  return new;
end;
$$;

drop trigger if exists trg_tank_dips_litres on public.tank_dips;
create trigger trg_tank_dips_litres
  before insert or update of dip_mm, tank_id, recorded_at on public.tank_dips
  for each row execute function public.set_dip_litres();

-- ---------------------------------------------------------------------------
-- Tanker compartments: what arrived is what the dip rod says arrived
-- ---------------------------------------------------------------------------

create or replace function public.set_compartment_receipt()
returns trigger
language plpgsql
as $$
declare
  v_at timestamptz;
begin
  select coalesce(d.arrived_at, now()) into v_at
  from public.tanker_deliveries d where d.id = new.delivery_id;

  new.litres_before := public.dip_to_litres(new.tank_id, new.dip_before_mm, v_at);
  new.litres_after  := public.dip_to_litres(new.tank_id, new.dip_after_mm, v_at);

  if new.litres_after < new.litres_before then
    raise exception 'Compartment %: the dip after a discharge cannot be lower than the dip before it',
      new.compartment_no using errcode = 'check_violation';
  end if;

  new.received_litres := round(new.litres_after - new.litres_before, 3);
  new.shortage_litres := round(new.declared_litres - new.received_litres, 3);
  new.shortage_pct := case
    when new.declared_litres = 0 then null
    else round(new.shortage_litres / new.declared_litres * 100, 4)
  end;
  new.shortage_flagged := coalesce(
    new.shortage_pct > (public.setting_numeric('shortage_tolerance_pct', 0.3)), false);

  return new;
end;
$$;

drop trigger if exists trg_compartment_receipt on public.tanker_compartments;
create trigger trg_compartment_receipt
  before insert or update of dip_before_mm, dip_after_mm, tank_id, declared_litres
  on public.tanker_compartments
  for each row execute function public.set_compartment_receipt();

-- ---------------------------------------------------------------------------
-- Moving weighted average cost per tank
-- ---------------------------------------------------------------------------

create or replace function public.moving_average_cost(
  p_old_stock numeric,
  p_old_cost  numeric,
  p_received  numeric,
  p_depot_rate numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_old_stock, 0) + coalesce(p_received, 0) = 0 then round(p_depot_rate, 4)
    else round(
      (coalesce(p_old_stock, 0) * coalesce(p_old_cost, 0) + coalesce(p_received, 0) * p_depot_rate)
      / (coalesce(p_old_stock, 0) + coalesce(p_received, 0)), 4)
  end
$$;

create or replace function public.tank_avg_cost(p_tank_id uuid, p_at timestamptz default now())
returns numeric
language sql
stable
as $$
  select coalesce((
    select h.avg_cost from public.tank_cost_history h
    where h.tank_id = p_tank_id and h.effective_at <= p_at
    order by h.effective_at desc limit 1
  ), 0)
$$;

-- ---------------------------------------------------------------------------
-- Stock chain: shift N closing is shift N+1 opening, per tank
-- ---------------------------------------------------------------------------

create or replace function public.previous_shift_stock(p_tank_id uuid, p_starts_at timestamptz)
returns public.shift_stock
language sql
stable
as $$
  select ss.*
  from public.shift_stock ss
  join public.shifts s on s.id = ss.shift_id
  where ss.tank_id = p_tank_id
    and s.starts_at < p_starts_at
  order by s.starts_at desc
  limit 1
$$;

create or replace function public.enforce_stock_chain()
returns trigger
language plpgsql
as $$
declare
  v_starts_at timestamptz;
  v_prev public.shift_stock;
begin
  -- recalculate_from() rewrites the chain deliberately and sets this flag.
  if coalesce(current_setting('app.recalculating', true), 'off') = 'on' then
    return new;
  end if;

  select starts_at into v_starts_at from public.shifts where id = new.shift_id;
  v_prev := public.previous_shift_stock(new.tank_id, v_starts_at);

  if v_prev.id is not null and round(v_prev.book_closing, 3) <> round(new.book_opening, 3) then
    raise exception
      'Stock chain break on tank %: opening % L does not match the previous shift closing of % L. '
      'Correct the earlier shift and run recalculate_from().',
      (select code from public.tanks where id = new.tank_id),
      round(new.book_opening, 3), round(v_prev.book_closing, 3)
      using errcode = 'check_violation';
  end if;

  -- book_closing = book_opening + refills − sold
  if round(new.book_closing, 3)
     <> round(new.book_opening + new.refill_litres - new.sold_from_tank, 3) then
    raise exception 'book_closing must equal book_opening + refill_litres - sold_from_tank'
      using errcode = 'check_violation';
  end if;

  if new.physical_closing is not null then
    new.variance_litres := round(new.physical_closing - new.book_closing, 3);
    new.variance_pct := case
      when new.sold_from_tank = 0 then null
      else round(new.variance_litres / new.sold_from_tank * 100, 4)
    end;
    new.variance_flagged := case
      when new.variance_pct is null then new.variance_litres <> 0
      else abs(new.variance_pct) > public.setting_numeric('variance_threshold_pct', 0.5)
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_shift_stock_chain on public.shift_stock;
create trigger trg_shift_stock_chain
  before insert or update on public.shift_stock
  for each row execute function public.enforce_stock_chain();

-- Re-derive the book chain from a shift forward, for every tank. Sales and
-- refills stay as recorded; only the opening and closing book figures move.
-- Run this after any correction to a closed shift.
create or replace function public.recalculate_from(p_shift_id uuid)
returns table (
  out_shift_id       uuid,
  out_tank_id        uuid,
  out_book_opening   numeric,
  out_book_closing   numeric,
  out_variance_litres numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from      timestamptz;
  v_threshold numeric := public.setting_numeric('variance_threshold_pct', 0.5);
  r_tank      record;
  r_row       record;
  v_opening   numeric;
  v_closing   numeric;
  v_variance  numeric;
  v_pct       numeric;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may recalculate the stock chain' using errcode = 'insufficient_privilege';
  end if;

  select starts_at into v_from from public.shifts where id = p_shift_id;
  if v_from is null then
    raise exception 'Unknown shift %', p_shift_id using errcode = 'no_data_found';
  end if;

  -- The chain is being rewritten on purpose, so the guard trigger stands down
  -- for this transaction only.
  perform set_config('app.recalculating', 'on', true);

  for r_tank in
    select t.id from public.tanks t where t.deleted_at is null order by t.code
  loop
    -- Start from the last closing before the edited shift. When the edited
    -- shift is the very first one for this tank, its own opening stands.
    v_opening := (
      select ss.book_closing
      from public.shift_stock ss
      join public.shifts s on s.id = ss.shift_id
      where ss.tank_id = r_tank.id and s.starts_at < v_from
      order by s.starts_at desc
      limit 1
    );

    if v_opening is null then
      v_opening := (
        select ss.book_opening
        from public.shift_stock ss
        join public.shifts s on s.id = ss.shift_id
        where ss.tank_id = r_tank.id and s.starts_at >= v_from
        order by s.starts_at asc
        limit 1
      );
    end if;

    continue when v_opening is null;

    for r_row in
      select ss.id, ss.shift_id, ss.refill_litres, ss.sold_from_tank, ss.physical_closing
      from public.shift_stock ss
      join public.shifts s on s.id = ss.shift_id
      where ss.tank_id = r_tank.id and s.starts_at >= v_from
      order by s.starts_at asc
    loop
      v_closing := round(v_opening + r_row.refill_litres - r_row.sold_from_tank, 3);

      if r_row.physical_closing is null then
        v_variance := null;
        v_pct := null;
      else
        v_variance := round(r_row.physical_closing - v_closing, 3);
        v_pct := case
          when r_row.sold_from_tank = 0 then null
          else round(v_variance / r_row.sold_from_tank * 100, 4)
        end;
      end if;

      update public.shift_stock
      set book_opening     = v_opening,
          book_closing     = v_closing,
          variance_litres  = v_variance,
          variance_pct     = v_pct,
          variance_flagged = case
            when v_variance is null then false
            when v_pct is null then v_variance <> 0
            else abs(v_pct) > v_threshold
          end,
          updated_at = now()
      where id = r_row.id;

      out_shift_id        := r_row.shift_id;
      out_tank_id         := r_tank.id;
      out_book_opening    := v_opening;
      out_book_closing    := v_closing;
      out_variance_litres := v_variance;
      return next;

      v_opening := v_closing;
    end loop;
  end loop;

  perform set_config('app.recalculating', 'off', true);
  return;
end;
$$;

comment on function public.recalculate_from(uuid) is
  'Admin-only. Rewrites book_opening/book_closing for every shift from the '
  'given shift forward, per tank. Called after a shift is reopened or edited.';

-- ---------------------------------------------------------------------------
-- Customer ledger: running balance maintained on write, never on read
-- ---------------------------------------------------------------------------

create or replace function public.set_ledger_running_balance()
returns trigger
language plpgsql
as $$
declare
  v_previous numeric;
begin
  -- Serialise ledger writes for this customer so two concurrent sales cannot
  -- both read the same previous balance.
  perform pg_advisory_xact_lock(hashtext(new.customer_id::text));

  select l.running_balance into v_previous
  from public.customer_ledger l
  where l.customer_id = new.customer_id
  order by l.entry_at desc, l.id desc
  limit 1;

  if v_previous is null then
    select c.opening_balance into v_previous from public.customers c where c.id = new.customer_id;
    v_previous := coalesce(v_previous, 0);
  end if;

  new.running_balance := round(v_previous + coalesce(new.debit, 0) - coalesce(new.credit, 0), 2);
  return new;
end;
$$;

drop trigger if exists trg_ledger_running_balance on public.customer_ledger;
create trigger trg_ledger_running_balance
  before insert on public.customer_ledger
  for each row execute function public.set_ledger_running_balance();

create or replace function public.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select l.running_balance from public.customer_ledger l
      where l.customer_id = p_customer_id
      order by l.entry_at desc, l.id desc limit 1),
    (select c.opening_balance from public.customers c where c.id = p_customer_id),
    0)
$$;

-- A credit sale and a payment both post to the ledger automatically, so the
-- balance can never disagree with the documents behind it.
create or replace function public.post_credit_sale_to_ledger()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null then return new; end if;
  insert into public.customer_ledger
    (customer_id, entry_at, entry_date, entry_type, description, debit, credit, source_table, source_id, created_by)
  values
    (new.customer_id, new.sold_at, public.business_date(new.sold_at), 'sale',
     coalesce(new.challan_no, new.vehicle_no), new.amount, 0, 'credit_sales', new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists trg_credit_sale_ledger on public.credit_sales;
create trigger trg_credit_sale_ledger
  after insert on public.credit_sales
  for each row execute function public.post_credit_sale_to_ledger();

create or replace function public.post_payment_to_ledger()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is not null then return new; end if;
  insert into public.customer_ledger
    (customer_id, entry_at, entry_date, entry_type, description, debit, credit, source_table, source_id, created_by)
  values
    (new.customer_id, new.received_at, public.business_date(new.received_at), 'payment',
     coalesce(new.reference, new.method::text), 0, new.amount, 'payments', new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists trg_payment_ledger on public.payments;
create trigger trg_payment_ledger
  after insert on public.payments
  for each row execute function public.post_payment_to_ledger();

-- ---------------------------------------------------------------------------
-- Lubricant stock, maintained by trigger
-- ---------------------------------------------------------------------------

create or replace function public.apply_lub_transaction()
returns trigger
language plpgsql
as $$
declare
  v_qty numeric;
  v_cost numeric;
begin
  insert into public.lub_stock (sku_id, qty_on_hand, avg_cost)
  values (new.sku_id, 0, 0)
  on conflict (sku_id) do nothing;

  select qty_on_hand, avg_cost into v_qty, v_cost
  from public.lub_stock where sku_id = new.sku_id for update;

  if new.txn_type = 'purchase' then
    update public.lub_stock
    set avg_cost = public.moving_average_cost(v_qty, v_cost, new.qty, new.rate),
        qty_on_hand = round(v_qty + new.qty, 3),
        updated_at = now()
    where sku_id = new.sku_id;

  elsif new.txn_type in ('sale', 'own_use') then
    update public.lub_stock
    set qty_on_hand = round(v_qty - new.qty, 3), updated_at = now()
    where sku_id = new.sku_id;

  elsif new.txn_type = 'adjustment' then
    -- A signed correction: positive adds, negative removes.
    update public.lub_stock
    set qty_on_hand = round(v_qty + new.qty, 3), updated_at = now()
    where sku_id = new.sku_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lub_transaction on public.lub_transactions;
create trigger trg_lub_transaction
  after insert on public.lub_transactions
  for each row execute function public.apply_lub_transaction();

-- ---------------------------------------------------------------------------
-- updated_at on every mutable table
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','settings','tanks','tank_metadata','dispensers','nozzles','shifts',
    'meter_readings','tank_dips','shift_sales','shift_stock','purchase_orders',
    'tanker_deliveries','tanker_compartments','lub_skus','lub_transactions',
    'customers','credit_sales','payments','expense_categories','expenses',
    'cash_reconciliation','bank_transactions'
  ]
  loop
    execute format('drop trigger if exists trg_touch_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on public.%1$I
       for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
