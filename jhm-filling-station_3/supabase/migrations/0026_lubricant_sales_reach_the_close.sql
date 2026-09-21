-- ============================================================================
-- 0026 — Oil sold during the shift reaches the shift's accounts
--
-- Found while seeding a trading day for the Phase 7 reports. The night shift
-- sold ৳7,440 of engine oil and closed like this:
--
--     lubricant_sales in shift_sales   ৳0.00
--     oil actually sold that shift     ৳7,440.00
--     expected cash                    ৳7,440 short of the truth
--
-- Phase 6 gave lubricants their own screen, so a manager can sell a can at
-- nine in the evening. The close, written in Phase 4, only ever counted what
-- was typed into its own lubricant step. Anything sold on the other screen
-- was invisible to it: the money went into the drawer, the drawer was
-- reconciled against a figure that did not include it, and the night came out
-- with a surplus somebody had to explain — or did not, if the notes went
-- somewhere else.
--
-- The same shape as the dues bug 0020 fixed. The fix is the same: stop asking
-- what was typed, and count what was recorded.
--
-- Second thing, found at the same time: a lubricant sale to a credit party
-- reduced the shelf and billed nobody. credit_sales carries fuel; oil on
-- credit went through lub_transactions, which had no ledger trigger. The
-- party got their oil for free until somebody noticed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Oil on credit bills the party
-- ---------------------------------------------------------------------------
create or replace function public.post_lub_credit_sale_to_ledger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sku public.lub_skus;
begin
  if new.txn_type <> 'sale' or new.customer_id is null or new.deleted_at is not null then
    return new;
  end if;

  select * into v_sku from public.lub_skus where id = new.sku_id;

  insert into public.customer_ledger
    (customer_id, entry_at, entry_date, entry_type, description, debit, credit,
     source_table, source_id, created_by)
  values
    (new.customer_id, new.txn_at, public.business_date(new.txn_at), 'sale',
     format('%s — %s', v_sku.name, to_char(new.qty, 'FM999,999.000')),
     new.amount, 0, 'lub_transactions', new.id, new.created_by);

  return new;
end;
$$;

comment on function public.post_lub_credit_sale_to_ledger() is
  'Oil sold to a credit party posts to that party''s ledger. Without this the '
  'shelf moved and nobody was billed.';

drop trigger if exists trg_lub_credit_ledger on public.lub_transactions;
create trigger trg_lub_credit_ledger
  after insert on public.lub_transactions
  for each row execute function public.post_lub_credit_sale_to_ledger();

-- ---------------------------------------------------------------------------
-- What the shelf sold during a shift, however it was recorded
-- ---------------------------------------------------------------------------
create or replace function public.shift_lubricant_sales(p_shift_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cash',   round(coalesce(sum(lt.amount) filter (where lt.customer_id is null), 0), 2),
    'credit', round(coalesce(sum(lt.amount) filter (where lt.customer_id is not null), 0), 2),
    'total',  round(coalesce(sum(lt.amount), 0), 2),
    'count',  count(*))
  from public.lub_transactions lt
  where lt.shift_id = p_shift_id
    and lt.txn_type = 'sale'
    and lt.deleted_at is null
$$;

comment on function public.shift_lubricant_sales(uuid) is
  'Lubricant sold during a shift, from the movement rows rather than from what '
  'was typed into the close. Split by whether it was paid for or put on a '
  'party''s account, because only the first reaches the drawer.';

revoke execute on function public.shift_lubricant_sales(uuid) from anon, public;
grant execute on function public.shift_lubricant_sales(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- compute_shift_close again, now counting oil sold on the Lubricants screen
--
-- Unchanged from 0020 apart from the lubricant block. The tank arithmetic is
-- left alone deliberately: the business has reconciled against those figures
-- and this migration is not the place to move them.
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
  v_lub_recorded  jsonb;
  v_lub_typed     numeric := 0;
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

  -- Oil typed into the wizard's lubricant step, which close_shift() is about
  -- to insert.
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'lubricant_sales', '[]'::jsonb))
  loop
    v_lub_typed := v_lub_typed + round(coalesce((v_row->>'amount')::numeric, 0), 2);
    -- A can sold to a party on the wizard is credit, not cash in the drawer.
    if nullif(v_row->>'customer_id', '') is not null then
      v_credit := v_credit + round(coalesce((v_row->>'amount')::numeric, 0), 2);
    end if;
  end loop;

  -- Oil already sold on the Lubricants screen and attached to this shift.
  -- Before 0026 this was invisible to the close: the money reached the drawer
  -- and the reconciliation did not know about it.
  v_lub_recorded := public.shift_lubricant_sales(p_shift_id);
  v_lub := v_lub_typed + (v_lub_recorded->>'total')::numeric;
  v_credit := v_credit + (v_lub_recorded->>'credit')::numeric;

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
      'lubricant_entered', round(v_lub_typed, 2),
      'lubricant_recorded', (v_lub_recorded->>'total')::numeric,
      'lubricant_on_credit', (v_lub_recorded->>'credit')::numeric,
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
