-- ============================================================================
-- 0020 — The cash drawer chains, and own-use costs something
--
-- Phase 4 built the cash reconciliation into the shift close, and it worked,
-- but two of its five inputs were typed by the person being reconciled:
--
--   opening_cash    — typed. The drawer does not reset between shifts, so what
--                     it opens with is what the previous shift counted. Typing
--                     it means a shortage can be carried forward by adjusting
--                     the opening figure, and the trail closes over itself. The
--                     stock chain has been enforced since Phase 4; the cash
--                     chain was not.
--
--   dues_collected  — typed, and not tied to any customer. A manager could
--                     enter ৳10,000 of dues collected, balance the drawer on
--                     it, and no party's ledger would move. That is money
--                     appearing from nowhere. Worse, a collection by bKash was
--                     indistinguishable from one in cash, so money that never
--                     entered the drawer was counted as if it had.
--
-- Both now come from records rather than from the keyboard.
--
-- Third: lub_transactions.txn_type carries a comment saying own_use "books as
-- an expense". Nothing did. Oil went into the station's own lorries, stock
-- dropped, and the cost of it landed nowhere at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- What the drawer opens with
-- ---------------------------------------------------------------------------
create or replace function public.previous_counted_cash(p_shift_id uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select cr.counted_cash
  from public.shifts s
  join public.cash_reconciliation cr on cr.shift_id = s.id
  where s.status = 'closed'
    and s.id <> p_shift_id
    and s.ends_at <= (select s2.starts_at from public.shifts s2 where s2.id = p_shift_id)
  order by s.ends_at desc, s.id desc
  limit 1
$$;

comment on function public.previous_counted_cash(uuid) is
  'The cash counted at the end of the last shift closed before this one. Null '
  'when this is the first shift, which is the only time an opening float may '
  'be typed.';

revoke execute on function public.previous_counted_cash(uuid) from anon, public;
grant execute on function public.previous_counted_cash(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What came in from the parties, in cash, during this shift
--
-- Only cash reaches the drawer. A payment by bKash, bank transfer or cheque
-- reduces what the party owes but adds nothing to count at the end of the
-- night, and adding it to expected cash would manufacture a shortage.
-- ---------------------------------------------------------------------------
create or replace function public.shift_dues_collected(p_shift_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cash', round(coalesce(sum(p.amount) filter (where p.method = 'cash'), 0), 2),
    'non_cash', round(coalesce(sum(p.amount) filter (where p.method <> 'cash'), 0), 2),
    'count', count(*))
  from public.payments p
  where p.shift_id = p_shift_id
    and p.deleted_at is null
$$;

revoke execute on function public.shift_dues_collected(uuid) from anon, public;
grant execute on function public.shift_dues_collected(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Own use: oil out of the shelf and into the station's own lorries
--
-- It is not revenue and it is not free. It leaves at what it cost — the moving
-- average on the shelf at that moment — and books to the Lubricant Own Use
-- expense category.
--
-- ASSUMPTION, still to be confirmed with the business: own use sits in the
-- Pump book, alongside the other running costs of the station, rather than in
-- the Chairman book. Moving it is a one-line change to the seeded category's
-- group, and no recorded transaction has to be touched.
-- ---------------------------------------------------------------------------
create or replace function public.value_lub_transaction()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_stock public.lub_stock;
  v_sku   public.lub_skus;
begin
  select * into v_sku from public.lub_skus where id = new.sku_id;
  if v_sku.id is null or v_sku.deleted_at is not null or not v_sku.is_active then
    raise exception 'That lubricant is not on sale' using errcode = 'check_violation';
  end if;

  if new.qty is null or (new.txn_type <> 'adjustment' and new.qty <= 0) then
    raise exception 'Quantity must be more than zero' using errcode = 'check_violation';
  end if;

  select * into v_stock from public.lub_stock where sku_id = new.sku_id;

  if new.txn_type in ('sale', 'own_use') then
    -- The shelf cannot go below empty. If it appears to, either a purchase was
    -- never entered or the count is wrong, and both want looking at before
    -- another litre leaves.
    if coalesce(v_stock.qty_on_hand, 0) < new.qty then
      raise exception '%', format(
        '%s has %s on the shelf and this would take out %s. Record the purchase '
        'first, or post a stock adjustment.',
        v_sku.name,
        to_char(coalesce(v_stock.qty_on_hand, 0), 'FM999,999.000'),
        to_char(new.qty, 'FM999,999.000'))
        using errcode = 'check_violation';
    end if;
  end if;

  if new.txn_type = 'own_use' then
    -- Valued at what it cost, never at the sale rate: own use is a cost to the
    -- station, and pricing it at retail would invent a margin on oil nobody
    -- paid for.
    new.rate := round(coalesce(v_stock.avg_cost, 0), 2);
    new.amount := round(new.qty * coalesce(v_stock.avg_cost, 0), 2);
  elsif new.txn_type = 'sale' and coalesce(new.amount, 0) = 0 then
    new.rate := coalesce(nullif(new.rate, 0), v_sku.current_sale_rate, 0);
    new.amount := round(new.qty * new.rate, 2);
  elsif new.txn_type = 'purchase' and coalesce(new.amount, 0) = 0 then
    new.rate := coalesce(nullif(new.rate, 0), v_sku.current_purchase_rate, 0);
    new.amount := round(new.qty * new.rate, 2);
  end if;

  return new;
end;
$$;

comment on function public.value_lub_transaction() is
  'Prices a lubricant movement before it is written: own use at the moving '
  'average cost on the shelf, a sale at the SKU rate. Refuses to take more off '
  'the shelf than is on it.';

drop trigger if exists trg_value_lub_transaction on public.lub_transactions;
create trigger trg_value_lub_transaction
  before insert on public.lub_transactions
  for each row execute function public.value_lub_transaction();

-- The stock trigger from 0004 runs after this one and moves the shelf. This
-- second after-trigger books the cost of own use as an expense, so the oil
-- leaves the shelf and lands in the accounts in the same transaction.
create or replace function public.book_own_use_expense()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_category uuid;
  v_station  uuid;
  v_sku      public.lub_skus;
begin
  if new.txn_type <> 'own_use' then
    return new;
  end if;

  select * into v_sku from public.lub_skus where id = new.sku_id;
  v_station := v_sku.station_id;

  select id into v_category
  from public.expense_categories
  where name = 'Lubricant Own Use'
    and (station_id = v_station or v_station is null)
  order by station_id nulls last
  limit 1;

  if v_category is null then
    raise exception '%',
      'There is no Lubricant Own Use expense category, so this issue has '
      'nowhere to book. Add the category before issuing oil to own lorries.'
      using errcode = 'check_violation';
  end if;

  -- Zero-valued own use happens when the shelf has no cost on it yet, usually
  -- because the opening stock was never priced. The movement is still real, so
  -- it is recorded; an expense row of zero taka is not, because it would say
  -- the oil was free.
  if new.amount > 0 then
    insert into public.expenses
      (station_id, shift_id, category_id, amount, description, description_bn,
       paid_by, spent_at, created_by)
    values
      (v_station, new.shift_id, v_category, new.amount,
       format('%s — %s issued to own vehicle%s',
              v_sku.name,
              to_char(new.qty, 'FM999,999.000'),
              coalesce(' ' || nullif(btrim(coalesce(new.vehicle_ref, '')), ''), '')),
       format('%s — নিজস্ব গাড়িতে %s',
              coalesce(v_sku.name_bn, v_sku.name),
              to_char(new.qty, 'FM999,999.000')),
       'cash', new.txn_at, new.created_by);
  end if;

  return new;
end;
$$;

comment on function public.book_own_use_expense() is
  'Books oil issued to the station''s own lorries as an expense at cost. Never '
  'counted as revenue: the column comment on lub_transactions.txn_type says '
  'so, and this is what makes it true.';

drop trigger if exists trg_book_own_use_expense on public.lub_transactions;
create trigger trg_book_own_use_expense
  after insert on public.lub_transactions
  for each row execute function public.book_own_use_expense();

-- ---------------------------------------------------------------------------
-- The close, recomputed with the two derived figures
--
-- Only the cash block changes. Everything above it is the Phase 4 function
-- unchanged, so the tank arithmetic the business has already reconciled
-- against is not touched.
-- ---------------------------------------------------------------------------
create or replace function public.compute_cash_position(p_shift_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_previous   numeric := public.previous_counted_cash(p_shift_id);
  v_typed      numeric := round(coalesce((p_payload#>>'{cash,opening_cash}')::numeric, 0), 2);
  v_opening    numeric;
  v_chained    boolean;
  v_dues       jsonb   := public.shift_dues_collected(p_shift_id);
begin
  v_chained := v_previous is not null;
  v_opening := round(coalesce(v_previous, v_typed), 2);

  return jsonb_build_object(
    'opening_cash', v_opening,
    'opening_source', case when v_chained then 'previous_shift' else 'entered' end,
    'opening_entered', v_typed,
    'dues_collected', (v_dues->>'cash')::numeric,
    'dues_non_cash', (v_dues->>'non_cash')::numeric,
    'dues_payment_count', (v_dues->>'count')::integer);
end;
$$;

revoke execute on function public.compute_cash_position(uuid, jsonb) from anon, public;
grant execute on function public.compute_cash_position(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- compute_shift_close, with the two typed cash inputs replaced by derived ones
--
-- This is the Phase 4 function from 0014 with one block changed. The tank and
-- meter arithmetic above it is untouched on purpose: the business has already
-- reconciled against those figures and this migration is not the place to move
-- them.
-- ---------------------------------------------------------------------------

create or replace function public.compute_shift_close(p_shift_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_shift         public.shifts;
  v_rate          numeric;
  v_minutes       numeric;
  v_reading       jsonb;
  v_lines         jsonb := '[]'::jsonb;
  v_gross         numeric := 0;
  v_test          numeric := 0;
  v_sold_by_tank  jsonb := '{}'::jsonb;

  v_nozzle_id     uuid;
  v_closing       numeric;
  v_line_test     numeric;
  v_opening       numeric;
  v_capacity      numeric;
  v_litres        numeric;
  v_rollover      boolean;
  v_max_possible  numeric;
  v_disp          record;

  v_tank          record;
  v_tanks         jsonb := '[]'::jsonb;
  v_physical      numeric;
  v_book_open     numeric;
  v_refill        numeric;
  v_sold          numeric;
  v_book_close    numeric;
  v_variance      numeric;
  v_variance_pct  numeric;
  v_flagged       boolean;
  v_threshold     numeric := public.setting_numeric('variance_threshold_pct', 0.5);
  v_dip_mm        numeric;

  v_credit        numeric := 0;
  v_lub           numeric := 0;
  v_expenses      numeric := 0;
  v_expenses_cash numeric := 0;
  v_row           jsonb;

  v_sales_amount  numeric;
  v_net           numeric;
  v_total_sales   numeric;
  v_cash_sales    numeric;
  v_opening_cash  numeric;
  v_dues          numeric;
  v_deposits      numeric;
  v_counted       numeric;
  v_expected      numeric;
  v_cash_variance numeric;
  v_tolerance     numeric := public.setting_numeric('cash_variance_tolerance', 0);
  v_position      jsonb;
  v_dues_other    numeric;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null then
    raise exception 'Unknown shift %', p_shift_id using errcode = 'no_data_found';
  end if;

  v_rate := round((p_payload->>'rate_per_litre')::numeric, 2);
  if v_rate is null or v_rate < 0 then
    raise exception 'A selling rate is required to close a shift' using errcode = 'check_violation';
  end if;

  v_minutes := greatest(1, extract(epoch from (v_shift.ends_at - v_shift.starts_at)) / 60);

  -- ---- meters -------------------------------------------------------------
  for v_reading in select * from jsonb_array_elements(coalesce(p_payload->'readings', '[]'::jsonb))
  loop
    v_nozzle_id := (v_reading->>'nozzle_id')::uuid;
    v_closing   := (v_reading->>'closing')::numeric;
    v_line_test := round(coalesce((v_reading->>'test_litres')::numeric, 0), 3);

    select d.id, d.code, d.tank_id, d.meter_digits, d.max_flow_lpm, n.nozzle_no
      into v_disp
    from public.nozzles n
    join public.dispensers d on d.id = n.dispenser_id
    where n.id = v_nozzle_id;

    if v_disp.id is null then
      raise exception 'Unknown nozzle %', v_nozzle_id using errcode = 'no_data_found';
    end if;
    if v_closing is null or v_closing < 0 then
      raise exception 'Machine % has no closing reading', v_disp.code using errcode = 'check_violation';
    end if;

    -- The opening reading is the previous shift's closing for this same
    -- nozzle. Falling back to an 'open' reading recorded during this shift
    -- covers the very first close, before any chain exists.
    select m.reading into v_opening
    from public.meter_readings m
    join public.shifts s on s.id = m.shift_id
    where m.nozzle_id = v_nozzle_id
      and m.reading_type = 'close'
      and m.deleted_at is null
      and s.starts_at < v_shift.starts_at
    order by s.starts_at desc, m.created_at desc
    limit 1;

    if v_opening is null then
      select m.reading into v_opening
      from public.meter_readings m
      where m.nozzle_id = v_nozzle_id
        and m.shift_id = p_shift_id
        and m.reading_type = 'open'
        and m.deleted_at is null
      order by m.created_at desc
      limit 1;
    end if;

    if v_opening is null then
      raise exception
        'Machine % has no opening reading. Record one for this shift, or close the previous shift first.',
        v_disp.code using errcode = 'no_data_found';
    end if;

    -- A totalizer counts for the life of the pump and wraps at its digit
    -- limit. A wrap is rare and is far more often a typo, so it is flagged.
    v_capacity := power(10::numeric, v_disp.meter_digits);
    v_rollover := v_closing < v_opening;
    v_litres := round(
      case when v_rollover then (v_capacity - v_opening) + v_closing else v_closing - v_opening end, 3);

    v_max_possible := round(v_disp.max_flow_lpm * v_minutes, 3);

    if v_line_test > v_litres then
      raise exception 'Machine %: test litres cannot exceed the % L it sold', v_disp.code, v_litres
        using errcode = 'check_violation';
    end if;

    v_gross := v_gross + v_litres;
    v_test  := v_test + v_line_test;

    v_sold_by_tank := jsonb_set(
      v_sold_by_tank,
      array[v_disp.tank_id::text],
      to_jsonb(coalesce((v_sold_by_tank->>v_disp.tank_id::text)::numeric, 0) + (v_litres - v_line_test)),
      true);

    v_lines := v_lines || jsonb_build_object(
      'nozzle_id', v_nozzle_id,
      'dispenser_code', v_disp.code,
      'nozzle_no', v_disp.nozzle_no,
      'tank_id', v_disp.tank_id,
      'opening', v_opening,
      'closing', v_closing,
      'litres', v_litres,
      'test_litres', v_line_test,
      'is_rollover', v_rollover,
      'implausible', v_litres > v_max_possible,
      'max_possible', v_max_possible);
  end loop;

  v_gross := round(v_gross, 3);
  v_test  := round(v_test, 3);
  v_net   := round(v_gross - v_test, 3);
  v_sales_amount := round(v_net * v_rate, 2);

  -- ---- money entered in the wizard ---------------------------------------
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'credit_sales', '[]'::jsonb))
  loop
    v_credit := v_credit + round(coalesce((v_row->>'amount')::numeric, 0), 2);
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'lubricant_sales', '[]'::jsonb))
  loop
    v_lub := v_lub + round(coalesce((v_row->>'amount')::numeric, 0), 2);
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'expenses', '[]'::jsonb))
  loop
    v_expenses := v_expenses + round(coalesce((v_row->>'amount')::numeric, 0), 2);
    if coalesce(v_row->>'paid_by', 'cash') = 'cash' then
      v_expenses_cash := v_expenses_cash + round(coalesce((v_row->>'amount')::numeric, 0), 2);
    end if;
  end loop;

  v_total_sales := round(v_sales_amount + v_lub, 2);
  if v_credit > v_total_sales then
    raise exception 'Credit sales of % cannot exceed total sales of %', v_credit, v_total_sales
      using errcode = 'check_violation';
  end if;
  v_cash_sales := round(v_total_sales - v_credit, 2);

  -- ---- stock, per tank ----------------------------------------------------
  for v_tank in
    select t.id, t.code from public.tanks t
    where t.deleted_at is null and t.status <> 'removed'
    order by t.code
  loop
    v_dip_mm := (
      select (d->>'dip_mm')::numeric
      from jsonb_array_elements(coalesce(p_payload->'dips', '[]'::jsonb)) d
      where (d->>'tank_id')::uuid = v_tank.id
      limit 1);

    if v_dip_mm is null then
      raise exception 'Tank % has no closing dip', v_tank.code using errcode = 'check_violation';
    end if;

    v_physical := public.dip_to_litres(v_tank.id, v_dip_mm, v_shift.ends_at);

    -- The chain: this shift opens where the last one closed.
    select ss.book_closing into v_book_open
    from public.shift_stock ss
    join public.shifts s on s.id = ss.shift_id
    where ss.tank_id = v_tank.id and s.starts_at < v_shift.starts_at
    order by s.starts_at desc
    limit 1;

    if v_book_open is null then
      -- No previous shift: the opening dip taken at the start of this one is
      -- where the book begins.
      select d.litres into v_book_open
      from public.tank_dips d
      where d.tank_id = v_tank.id and d.shift_id = p_shift_id
        and d.dip_type = 'open' and d.deleted_at is null
      order by d.recorded_at desc
      limit 1;
    end if;

    if v_book_open is null then
      raise exception
        'Tank % has no opening stock. Record an opening dip for this shift, or close the previous shift first.',
        v_tank.code using errcode = 'no_data_found';
    end if;

    select coalesce(sum(tc.received_litres), 0) into v_refill
    from public.tanker_compartments tc
    join public.tanker_deliveries td on td.id = tc.delivery_id
    where tc.tank_id = v_tank.id
      and td.deleted_at is null
      and (td.shift_id = p_shift_id
           or (td.shift_id is null and td.arrived_at >= v_shift.starts_at and td.arrived_at < v_shift.ends_at));

    v_sold := round(coalesce((v_sold_by_tank->>v_tank.id::text)::numeric, 0), 3);
    v_book_close := round(v_book_open + v_refill - v_sold, 3);
    v_variance := round(v_physical - v_book_close, 3);
    v_variance_pct := case when v_sold = 0 then null else round(v_variance / v_sold * 100, 4) end;
    v_flagged := case
      when v_variance_pct is null then v_variance <> 0
      else abs(v_variance_pct) > v_threshold
    end;

    v_tanks := v_tanks || jsonb_build_object(
      'tank_id', v_tank.id,
      'tank_code', v_tank.code,
      'dip_mm', v_dip_mm,
      'book_opening', v_book_open,
      'refill_litres', v_refill,
      'sold_from_tank', v_sold,
      'book_closing', v_book_close,
      'physical_closing', v_physical,
      'variance_litres', v_variance,
      'variance_pct', v_variance_pct,
      'variance_flagged', v_flagged);
  end loop;

  -- ---- cash ---------------------------------------------------------------
  -- Opening cash chains from the previous shift's count, and dues come from
  -- the payments actually recorded against parties during this shift. Neither
  -- is read from the payload any more; see 0020 for why.
  v_position     := public.compute_cash_position(p_shift_id, p_payload);
  v_opening_cash := (v_position->>'opening_cash')::numeric;
  v_dues         := (v_position->>'dues_collected')::numeric;
  v_dues_other   := (v_position->>'dues_non_cash')::numeric;
  v_deposits     := round(coalesce((p_payload#>>'{cash,bank_deposits}')::numeric, 0), 2);
  v_counted      := round(coalesce((p_payload#>>'{cash,counted_cash}')::numeric, 0), 2);

  v_expected := round(v_opening_cash + v_cash_sales + v_dues - v_expenses_cash - v_deposits, 2);
  v_cash_variance := round(v_counted - v_expected, 2);

  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', v_shift.id, 'shift_date', v_shift.shift_date, 'shift_type', v_shift.shift_type,
      'status', v_shift.status, 'starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at),
    'readings', v_lines,
    'sales', jsonb_build_object(
      'gross_litres', v_gross, 'test_litres', v_test, 'net_litres', v_net,
      'rate_per_litre', v_rate, 'sales_amount', v_sales_amount,
      'lubricant_sales', round(v_lub, 2), 'credit_sales', round(v_credit, 2),
      'total_sales', v_total_sales, 'cash_sales', v_cash_sales),
    'tanks', v_tanks,
    'expenses', jsonb_build_object('total', round(v_expenses, 2), 'cash', round(v_expenses_cash, 2)),
    'cash', jsonb_build_object(
      'opening_cash', v_opening_cash, 'cash_sales', v_cash_sales, 'dues_collected', v_dues,
      'opening_source', v_position->>'opening_source',
      'dues_non_cash', v_dues_other,
      'dues_payment_count', (v_position->>'dues_payment_count')::integer,
      'expenses_cash', round(v_expenses_cash, 2), 'bank_deposits', v_deposits,
      'expected_cash', v_expected, 'counted_cash', v_counted,
      'cash_variance', v_cash_variance,
      'requires_reason', abs(v_cash_variance) > abs(v_tolerance)),
    'thresholds', jsonb_build_object('variance_pct', v_threshold, 'cash_tolerance', v_tolerance));
end;
$$;
