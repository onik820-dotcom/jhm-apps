-- ============================================================================
-- 0017 — Closing a shift
--
-- The close is one transaction. Either every record lands — readings, dips,
-- sales, per-tank stock, credit rows, lubricant movements, expenses, the cash
-- count — or none of them do. A half-closed shift would leave the stock chain
-- broken and the next shift unable to open its book.
--
-- Sign-off is refused while any variance past its threshold has no written
-- reason. That refusal lives here, in the database, not only in the wizard.
--
-- SECURITY INVOKER on purpose: every financial write it makes is still checked
-- by RLS. Only the outbound event queue needs elevated rights, and that goes
-- through the narrow helper in 0016.
-- ============================================================================

create or replace function public.close_shift(p_shift_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result      jsonb;
  v_shift       public.shifts;
  v_actor       uuid := auth.uid();
  v_tank        jsonb;
  v_row         jsonb;
  v_reason      text;
  v_station     uuid;
  v_sales       jsonb;
  v_cash        jsonb;
  v_flagged     integer := 0;
  v_sku_rate    numeric;
begin
  if not public.can_write_ops() then
    raise exception 'Only a manager or an admin may close a shift'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if v_shift.id is null then
    raise exception 'Unknown shift %', p_shift_id using errcode = 'no_data_found';
  end if;
  if v_shift.status = 'closed' then
    raise exception 'That shift is already closed' using errcode = 'check_violation';
  end if;

  -- The same computation the wizard displayed.
  v_result := public.compute_shift_close(p_shift_id, p_payload);
  v_sales := v_result->'sales';
  v_cash := v_result->'cash';
  v_station := v_shift.station_id;

  -- ---- a flagged variance needs a reason before anything is written -------
  for v_tank in select * from jsonb_array_elements(v_result->'tanks')
  loop
    if (v_tank->>'variance_flagged')::boolean then
      v_flagged := v_flagged + 1;
      v_reason := nullif(btrim(coalesce(
        p_payload#>>array['variance_reasons', v_tank->>'tank_id'], '')), '');
      if v_reason is null then
        raise exception
          'Tank % is out by % L, % percent of what it sold. Write why before signing off.',
          v_tank->>'tank_code', v_tank->>'variance_litres',
          coalesce(v_tank->>'variance_pct', 'an unknown')
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  if (v_cash->>'requires_reason')::boolean then
    v_reason := nullif(btrim(coalesce(p_payload->>'cash_variance_reason', '')), '');
    if v_reason is null then
      raise exception
        'The cash is out by %. Write why before signing off.', v_cash->>'cash_variance'
        using errcode = 'check_violation';
    end if;
  end if;

  for v_row in select * from jsonb_array_elements(v_result->'readings')
  loop
    insert into public.meter_readings
      (shift_id, nozzle_id, reading_type, reading, is_rollover, recorded_by, confirmed_by, confirmed_at, created_by)
    values
      (p_shift_id, (v_row->>'nozzle_id')::uuid, 'close', (v_row->>'closing')::numeric,
       (v_row->>'is_rollover')::boolean, v_actor, v_actor, now(), v_actor);
  end loop;

  for v_tank in select * from jsonb_array_elements(v_result->'tanks')
  loop
    insert into public.tank_dips
      (shift_id, tank_id, dip_type, dip_mm, litres, recorded_by, recorded_at, created_by)
    values
      (p_shift_id, (v_tank->>'tank_id')::uuid, 'close', (v_tank->>'dip_mm')::numeric,
       0, v_actor, v_shift.ends_at, v_actor);
  end loop;

  insert into public.shift_sales
    (shift_id, gross_litres, test_litres, net_litres, rate_per_litre,
     sales_amount, lubricant_sales, cash_sales, credit_sales, created_by)
  values
    (p_shift_id,
     (v_sales->>'gross_litres')::numeric, (v_sales->>'test_litres')::numeric,
     (v_sales->>'net_litres')::numeric, (v_sales->>'rate_per_litre')::numeric,
     (v_sales->>'sales_amount')::numeric, (v_sales->>'lubricant_sales')::numeric,
     (v_sales->>'cash_sales')::numeric, (v_sales->>'credit_sales')::numeric, v_actor)
  on conflict (shift_id) do update set
    gross_litres = excluded.gross_litres, test_litres = excluded.test_litres,
    net_litres = excluded.net_litres, rate_per_litre = excluded.rate_per_litre,
    sales_amount = excluded.sales_amount, lubricant_sales = excluded.lubricant_sales,
    cash_sales = excluded.cash_sales, credit_sales = excluded.credit_sales;

  -- The chain trigger on shift_stock checks that this shift's opening matches
  -- the previous shift's closing, per tank.
  for v_tank in select * from jsonb_array_elements(v_result->'tanks')
  loop
    insert into public.shift_stock
      (shift_id, tank_id, book_opening, refill_litres, sold_from_tank, book_closing,
       physical_closing, variance_litres, variance_pct, variance_reason, variance_flagged, created_by)
    values
      (p_shift_id, (v_tank->>'tank_id')::uuid,
       (v_tank->>'book_opening')::numeric, (v_tank->>'refill_litres')::numeric,
       (v_tank->>'sold_from_tank')::numeric, (v_tank->>'book_closing')::numeric,
       (v_tank->>'physical_closing')::numeric, (v_tank->>'variance_litres')::numeric,
       nullif(v_tank->>'variance_pct', '')::numeric,
       nullif(btrim(coalesce(p_payload#>>array['variance_reasons', v_tank->>'tank_id'], '')), ''),
       (v_tank->>'variance_flagged')::boolean, v_actor)
    on conflict (shift_id, tank_id) do update set
      book_opening = excluded.book_opening, refill_litres = excluded.refill_litres,
      sold_from_tank = excluded.sold_from_tank, book_closing = excluded.book_closing,
      physical_closing = excluded.physical_closing, variance_litres = excluded.variance_litres,
      variance_pct = excluded.variance_pct, variance_reason = excluded.variance_reason,
      variance_flagged = excluded.variance_flagged;

    -- An out-of-tolerance variance raises an alert immediately, not at month end.
    if (v_tank->>'variance_flagged')::boolean then
      insert into public.alerts (station_id, type, severity, title, title_bn, body, entity_ref, created_by)
      values (
        v_station, 'variance.exceeded', 'critical',
        format('Tank %s variance %s L', v_tank->>'tank_code', v_tank->>'variance_litres'),
        format('ট্যাংক %s গরমিল %s লিটার', v_tank->>'tank_code', v_tank->>'variance_litres'),
        nullif(btrim(coalesce(p_payload#>>array['variance_reasons', v_tank->>'tank_id'], '')), ''),
        jsonb_build_object('shift_id', p_shift_id, 'tank_id', v_tank->>'tank_id',
                           'variance_litres', v_tank->>'variance_litres',
                           'variance_pct', v_tank->>'variance_pct'),
        v_actor);

      perform public.enqueue_sync_event(
        'variance.exceeded',
        jsonb_build_object('shift_id', p_shift_id, 'tank', v_tank),
        format('variance.exceeded:%s:%s', p_shift_id, v_tank->>'tank_id'));
    end if;
  end loop;

  -- Party-wise credit sales; the ledger trigger posts each one.
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'credit_sales', '[]'::jsonb))
  loop
    insert into public.credit_sales
      (shift_id, customer_id, product, litres, rate, amount, vehicle_no, challan_no, sold_at, created_by)
    values
      (p_shift_id, (v_row->>'customer_id')::uuid,
       coalesce((v_row->>'product')::public.product_type, 'diesel'),
       nullif(v_row->>'litres', '')::numeric, nullif(v_row->>'rate', '')::numeric,
       (v_row->>'amount')::numeric, nullif(v_row->>'vehicle_no', ''), nullif(v_row->>'challan_no', ''),
       v_shift.ends_at, v_actor);
  end loop;

  -- Lubricant sales; the stock trigger moves the shelf.
  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'lubricant_sales', '[]'::jsonb))
  loop
    select current_sale_rate into v_sku_rate from public.lub_skus where id = (v_row->>'sku_id')::uuid;
    insert into public.lub_transactions
      (sku_id, txn_type, qty, rate, amount, shift_id, customer_id, txn_at, created_by)
    values
      ((v_row->>'sku_id')::uuid, 'sale',
       (v_row->>'qty')::numeric,
       coalesce(nullif(v_row->>'rate', '')::numeric, v_sku_rate, 0),
       (v_row->>'amount')::numeric, p_shift_id,
       nullif(v_row->>'customer_id', '')::uuid, v_shift.ends_at, v_actor);
  end loop;

  for v_row in select * from jsonb_array_elements(coalesce(p_payload->'expenses', '[]'::jsonb))
  loop
    insert into public.expenses
      (station_id, shift_id, category_id, amount, description, paid_by, spent_at, approved_by, approved_at, created_by)
    values
      (v_station, p_shift_id, (v_row->>'category_id')::uuid, (v_row->>'amount')::numeric,
       nullif(v_row->>'description', ''),
       coalesce((v_row->>'paid_by')::public.paid_by, 'cash'),
       v_shift.ends_at, v_actor, now(), v_actor);
  end loop;

  insert into public.cash_reconciliation
    (shift_id, opening_cash, cash_sales, dues_collected, expenses_cash, bank_deposits,
     expected_cash, counted_cash, cash_variance, variance_reason, created_by)
  values
    (p_shift_id,
     (v_cash->>'opening_cash')::numeric, (v_cash->>'cash_sales')::numeric,
     (v_cash->>'dues_collected')::numeric, (v_cash->>'expenses_cash')::numeric,
     (v_cash->>'bank_deposits')::numeric, (v_cash->>'expected_cash')::numeric,
     (v_cash->>'counted_cash')::numeric, (v_cash->>'cash_variance')::numeric,
     nullif(btrim(coalesce(p_payload->>'cash_variance_reason', '')), ''), v_actor)
  on conflict (shift_id) do update set
    opening_cash = excluded.opening_cash, cash_sales = excluded.cash_sales,
    dues_collected = excluded.dues_collected, expenses_cash = excluded.expenses_cash,
    bank_deposits = excluded.bank_deposits, expected_cash = excluded.expected_cash,
    counted_cash = excluded.counted_cash, cash_variance = excluded.cash_variance,
    variance_reason = excluded.variance_reason;

  update public.shifts
  set status = 'closed',
      rate_per_litre = (v_sales->>'rate_per_litre')::numeric,
      closed_by = v_actor,
      closed_at = now()
  where id = p_shift_id;

  perform public.enqueue_sync_event(
    'shift.closed', v_result, format('shift.closed:%s', p_shift_id));

  return v_result || jsonb_build_object('closed', true, 'flagged_tanks', v_flagged);
end;
$$;

comment on function public.close_shift(uuid, jsonb) is
  'Closes a shift in one transaction: readings, dips, sales, per-tank stock, '
  'credit rows, lubricant movements, expenses and the cash count, then locks '
  'the shift. Refuses sign-off while any flagged variance has no written reason.';

revoke execute on function public.close_shift(uuid, jsonb) from anon, public;
grant execute on function public.close_shift(uuid, jsonb) to authenticated;
