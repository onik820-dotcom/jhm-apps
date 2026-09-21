-- ============================================================================
-- 0018 — Recording a tanker delivery
--
-- A road tanker arrives with four compartments of 4,500 L. What went into the
-- ground is what the tank's own rod says went in, not what the challan claims;
-- the difference is the shortage the dealer can put to the depot. The purchase
-- is therefore always valued on litres received.
--
-- Two functions, the same shape as the shift close: one computes and writes
-- nothing so the form can show live figures, and one writes the lot in a single
-- transaction.
--
-- Two things here are subtler than they look, and both were found by testing:
--
--   1. A manager records deliveries but may not see blended cost, so RLS hides
--      tank_cost_history from them. That silently broke the moving average —
--      reading the previous cost returned nothing, every tank looked brand new,
--      and each delivery re-based the whole tank at that day's rate. The
--      costing therefore runs as the definer, while the *answer* is only
--      returned to a caller allowed to see cost.
--
--   2. At go-live a tank holds stock that has never been valued. Blending real
--      litres in at a cost of zero would understate the cost of everything sold
--      afterwards, so the first delivery prices the whole tank at that day's
--      depot rate and says so.
--
-- Applied to the live database as migrations 0018 through 0022 while these two
-- were worked out; this file is the settled result.
-- ============================================================================

create or replace function public.tank_has_cost_history(p_tank_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tank_cost_history h
    where h.tank_id = p_tank_id and h.effective_at <= p_at)
$$;

-- SECURITY DEFINER so the costing calculation can read the previous average
-- even when the caller is a manager. Not granted to any client role: both are
-- reached only from inside the delivery functions.
alter function public.tank_avg_cost(uuid, timestamptz) security definer;
revoke execute on function public.tank_avg_cost(uuid, timestamptz) from anon, public, authenticated;
revoke execute on function public.tank_has_cost_history(uuid, timestamptz) from anon, public, authenticated;

comment on function public.tank_avg_cost(uuid, timestamptz) is
  'SECURITY DEFINER so the costing calculation can read the previous average '
  'even when the caller is a manager, who may not see cost. Not granted to any '
  'client role: it is reached only from the delivery functions.';

-- ---------------------------------------------------------------------------
-- Compute: the live figures behind the form. Writes nothing.
-- ---------------------------------------------------------------------------

create or replace function public.compute_tanker_delivery(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rate        numeric;
  v_at          timestamptz;
  v_row         jsonb;
  v_lines       jsonb := '[]'::jsonb;
  v_tank        record;
  v_before      numeric;
  v_after       numeric;
  v_received    numeric;
  v_shortage    numeric;
  v_short_pct   numeric;
  v_tolerance   numeric := public.setting_numeric('shortage_tolerance_pct', 0.3);
  v_limit_pct   numeric := public.setting_numeric('overfill_limit_pct', 95);
  v_declared    numeric;
  v_safe_limit  numeric;
  v_total_decl  numeric := 0;
  v_total_recv  numeric := 0;
  v_by_tank     jsonb := '{}'::jsonb;
  v_tanks       jsonb := '[]'::jsonb;
  v_first_before jsonb := '{}'::jsonb;
  v_old_stock   numeric;
  v_old_cost    numeric;
  v_new_cost    numeric;
  v_tank_recv   numeric;
  v_has_history boolean;
  v_basis       text;
  v_entry       jsonb;
  v_may_see_cost boolean := public.is_admin() or public.is_md();
begin
  -- SECURITY DEFINER, so it checks for itself who is asking.
  if not (public.can_write_ops() or public.is_md()) then
    raise exception 'Not allowed to price a delivery' using errcode = 'insufficient_privilege';
  end if;

  v_rate := round((p_payload->>'depot_rate')::numeric, 2);
  if v_rate is null or v_rate < 0 then
    raise exception 'A depot rate is required' using errcode = 'check_violation';
  end if;
  v_at := coalesce((p_payload->>'arrived_at')::timestamptz, now());

  for v_row in
    select * from jsonb_array_elements(coalesce(p_payload->'compartments', '[]'::jsonb))
    order by (value->>'compartment_no')::integer
  loop
    select t.id, t.code, t.capacity_litres into v_tank
    from public.tanks t where t.id = (v_row->>'tank_id')::uuid;

    if v_tank.id is null then
      raise exception 'Compartment %: unknown tank', v_row->>'compartment_no'
        using errcode = 'no_data_found';
    end if;

    v_declared := round(coalesce((v_row->>'declared_litres')::numeric, 4500), 3);
    v_before := public.dip_to_litres(v_tank.id, (v_row->>'dip_before_mm')::numeric, v_at);
    v_after  := public.dip_to_litres(v_tank.id, (v_row->>'dip_after_mm')::numeric, v_at);

    if v_after < v_before then
      raise exception
        'Compartment %: the dip after a discharge cannot be lower than the dip before it',
        v_row->>'compartment_no' using errcode = 'check_violation';
    end if;

    v_received := round(v_after - v_before, 3);
    v_shortage := round(v_declared - v_received, 3);
    v_short_pct := case when v_declared = 0 then null
                        else round(v_shortage / v_declared * 100, 4) end;

    -- The stock in each tank immediately before its first compartment is the
    -- measured figure the moving average weighs against.
    if not (v_first_before ? v_tank.id::text) then
      v_first_before := jsonb_set(v_first_before, array[v_tank.id::text], to_jsonb(v_before), true);
    end if;

    v_safe_limit := round(v_tank.capacity_litres * v_limit_pct / 100, 3);

    v_total_decl := v_total_decl + v_declared;
    v_total_recv := v_total_recv + v_received;
    v_by_tank := jsonb_set(v_by_tank, array[v_tank.id::text],
      to_jsonb(coalesce((v_by_tank->>v_tank.id::text)::numeric, 0) + v_received), true);

    v_lines := v_lines || jsonb_build_object(
      'compartment_no', (v_row->>'compartment_no')::integer,
      'tank_id', v_tank.id,
      'tank_code', v_tank.code,
      'declared_litres', v_declared,
      'dip_before_mm', (v_row->>'dip_before_mm')::numeric,
      'dip_after_mm', (v_row->>'dip_after_mm')::numeric,
      'litres_before', v_before,
      'litres_after', v_after,
      'received_litres', v_received,
      'shortage_litres', v_shortage,
      'shortage_pct', v_short_pct,
      'shortage_flagged', coalesce(v_short_pct > v_tolerance, false),
      -- A warning, not a refusal: by the time a dip is read the fuel is already
      -- in the ground. It is the pre-discharge preview that has to catch this.
      'safe_limit_litres', v_safe_limit,
      'over_safe_limit', v_after > v_safe_limit,
      'headroom_before', round(v_safe_limit - v_before, 3));
  end loop;

  for v_tank in
    select t.id, t.code from public.tanks t where t.deleted_at is null order by t.code
  loop
    continue when not (v_by_tank ? v_tank.id::text);

    v_tank_recv := round((v_by_tank->>v_tank.id::text)::numeric, 3);
    v_old_stock := round(coalesce((v_first_before->>v_tank.id::text)::numeric, 0), 3);
    v_has_history := public.tank_has_cost_history(v_tank.id, v_at);
    v_old_cost  := public.tank_avg_cost(v_tank.id, v_at);

    if v_has_history then
      v_new_cost := public.moving_average_cost(v_old_stock, v_old_cost, v_tank_recv, v_rate);
      v_basis := 'moving_average';
    else
      v_new_cost := round(v_rate, 4);
      v_basis := 'first_delivery_depot_rate';
    end if;

    v_entry := jsonb_build_object(
      'tank_id', v_tank.id,
      'tank_code', v_tank.code,
      'stock_before', v_old_stock,
      'received_litres', v_tank_recv,
      'stock_after', round(v_old_stock + v_tank_recv, 3));

    -- Money only for the roles allowed to see it. The figures are still
    -- computed and still written; they are simply not handed back.
    if v_may_see_cost then
      v_entry := v_entry || jsonb_build_object(
        'old_avg_cost', v_old_cost,
        'has_cost_history', v_has_history,
        'cost_basis', v_basis,
        'depot_rate', v_rate,
        'new_avg_cost', v_new_cost);
    end if;

    v_tanks := v_tanks || v_entry;
  end loop;

  return jsonb_build_object(
    'depot_rate', v_rate,
    'arrived_at', v_at,
    'compartments', v_lines,
    'tanks', v_tanks,
    'totals', jsonb_build_object(
      'declared', round(v_total_decl, 3),
      'received', round(v_total_recv, 3),
      'shortage', round(v_total_decl - v_total_recv, 3),
      'shortage_pct', case when v_total_decl = 0 then null
                           else round((v_total_decl - v_total_recv) / v_total_decl * 100, 4) end,
      'purchase_value', round(v_total_recv * v_rate, 2)),
    'thresholds', jsonb_build_object('shortage_pct', v_tolerance, 'overfill_pct', v_limit_pct));
end;
$$;

comment on function public.compute_tanker_delivery(jsonb) is
  'Works out a delivery compartment by compartment and writes nothing, so the '
  'form can show received litres, shortage and the new average cost as the dips '
  'are typed. record_tanker_delivery() runs the same function before writing.';

-- ---------------------------------------------------------------------------
-- Costing: computes and writes, and deliberately returns nothing.
-- ---------------------------------------------------------------------------

create or replace function public.record_tank_cost(
  p_tank_id      uuid,
  p_stock_before numeric,
  p_received     numeric,
  p_rate         numeric,
  p_at           timestamptz,
  p_delivery_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost numeric;
  v_note text;
begin
  if not public.can_write_ops() then
    raise exception 'Not allowed to record a tank cost' using errcode = 'insufficient_privilege';
  end if;

  if public.tank_has_cost_history(p_tank_id, p_at) then
    v_cost := public.moving_average_cost(
      p_stock_before, public.tank_avg_cost(p_tank_id, p_at), p_received, p_rate);
    v_note := format('%s L received at %s into %s L already in the tank',
                     p_received, p_rate, p_stock_before);
  else
    v_cost := round(p_rate, 4);
    v_note := format('First valuation: %s L already in the tank take today''s depot rate of %s',
                     p_stock_before, p_rate);
  end if;

  insert into public.tank_cost_history
    (tank_id, effective_at, stock_before_litres, received_litres, depot_rate, avg_cost,
     trigger_delivery_id, note, created_by)
  values
    (p_tank_id, p_at, p_stock_before, p_received, p_rate, v_cost, p_delivery_id, v_note, auth.uid());
end;
$$;

comment on function public.record_tank_cost(uuid, numeric, numeric, numeric, timestamptz, uuid) is
  'Computes the new moving weighted average for a tank and writes it to '
  'tank_cost_history. Returns nothing on purpose: a manager may record a '
  'delivery but may not see blended cost, so the figure never travels back.';

-- ---------------------------------------------------------------------------
-- Record: one transaction. SECURITY INVOKER, so every write stays under RLS.
-- ---------------------------------------------------------------------------

create or replace function public.record_tanker_delivery(p_payload jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_result   jsonb;
  v_actor    uuid := auth.uid();
  v_station  uuid := (select id from public.stations limit 1);
  v_delivery uuid;
  v_row      jsonb;
  v_tank     jsonb;
  v_totals   jsonb;
  v_shift    uuid;
  v_po       uuid;
  v_at       timestamptz;
  v_rate     numeric;
begin
  if not public.can_write_ops() then
    raise exception 'Only a manager or an admin may record a delivery'
      using errcode = 'insufficient_privilege';
  end if;

  v_result := public.compute_tanker_delivery(p_payload);
  v_totals := v_result->'totals';
  v_at := (v_result->>'arrived_at')::timestamptz;
  v_rate := (v_result->>'depot_rate')::numeric;

  -- Attach it to the shift it arrived during, so the close picks it up as that
  -- shift's refill without anyone having to remember.
  v_shift := nullif(p_payload->>'shift_id', '')::uuid;
  if v_shift is null then
    select s.id into v_shift from public.shifts s
    where v_at >= s.starts_at and v_at < s.ends_at
    order by s.starts_at desc limit 1;
  end if;

  if coalesce(btrim(p_payload->>'po_number'), '') <> '' then
    select id into v_po from public.purchase_orders
    where po_number = btrim(p_payload->>'po_number') and deleted_at is null limit 1;
  end if;

  insert into public.tanker_deliveries
    (station_id, po_id, challan_no, truck_reg, driver_name, arrived_at, depot_rate,
     total_declared, total_received, total_shortage, purchase_value, shift_id, notes, created_by)
  values
    (v_station, v_po,
     nullif(btrim(coalesce(p_payload->>'challan_no', '')), ''),
     nullif(btrim(coalesce(p_payload->>'truck_reg', '')), ''),
     nullif(btrim(coalesce(p_payload->>'driver_name', '')), ''),
     v_at, v_rate,
     (v_totals->>'declared')::numeric, (v_totals->>'received')::numeric,
     (v_totals->>'shortage')::numeric, (v_totals->>'purchase_value')::numeric,
     v_shift, nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_actor)
  returning id into v_delivery;

  -- The compartment trigger recomputes litres and shortage from the dips, so
  -- the stored row is derived from the certified chart, not from the payload.
  for v_row in select * from jsonb_array_elements(v_result->'compartments')
  loop
    insert into public.tanker_compartments
      (delivery_id, compartment_no, declared_litres, tank_id,
       dip_before_mm, dip_after_mm, litres_before, litres_after,
       received_litres, shortage_litres, created_by)
    values
      (v_delivery, (v_row->>'compartment_no')::integer, (v_row->>'declared_litres')::numeric,
       (v_row->>'tank_id')::uuid, (v_row->>'dip_before_mm')::numeric, (v_row->>'dip_after_mm')::numeric,
       0, 0, 0, 0, v_actor);

    if (v_row->>'over_safe_limit')::boolean then
      insert into public.alerts (station_id, type, severity, title, title_bn, body, entity_ref, created_by)
      values (v_station, 'tank.overfilled', 'warn',
        format('Tank %s filled past its safe limit', v_row->>'tank_code'),
        format('ট্যাংক %s নিরাপদ সীমার উপরে ভরা হয়েছে', v_row->>'tank_code'),
        format('Compartment %s left it at %s L against a safe limit of %s L',
               v_row->>'compartment_no', v_row->>'litres_after', v_row->>'safe_limit_litres'),
        jsonb_build_object('delivery_id', v_delivery, 'tank_id', v_row->>'tank_id'), v_actor);
    end if;
  end loop;

  for v_tank in select * from jsonb_array_elements(v_result->'tanks')
  loop
    perform public.record_tank_cost(
      (v_tank->>'tank_id')::uuid,
      (v_tank->>'stock_before')::numeric,
      (v_tank->>'received_litres')::numeric,
      v_rate, v_at, v_delivery);
  end loop;

  if coalesce((v_totals->>'shortage_pct')::numeric, 0)
     > public.setting_numeric('shortage_tolerance_pct', 0.3) then
    insert into public.alerts (station_id, type, severity, title, title_bn, body, entity_ref, created_by)
    values (v_station, 'delivery.shortage', 'warn',
      format('Delivery short by %s L', v_totals->>'shortage'),
      format('ডেলিভারিতে %s লিটার কম', v_totals->>'shortage'),
      format('Challan %s declared %s L, the rods measured %s L',
             coalesce(p_payload->>'challan_no', '—'), v_totals->>'declared', v_totals->>'received'),
      jsonb_build_object('delivery_id', v_delivery), v_actor);
  end if;

  perform public.enqueue_sync_event(
    'refill.received',
    v_result || jsonb_build_object('delivery_id', v_delivery),
    format('refill.received:%s', v_delivery));

  return v_result || jsonb_build_object('delivery_id', v_delivery, 'shift_id', v_shift);
end;
$$;

comment on function public.record_tanker_delivery(jsonb) is
  'Records a delivery in one transaction: the delivery, its compartments, the '
  'new moving average cost per tank, and any shortage or overfill alert. The '
  'purchase is valued on litres received, never litres declared.';

revoke execute on function public.compute_tanker_delivery(jsonb) from anon, public;
revoke execute on function public.record_tanker_delivery(jsonb) from anon, public;
revoke execute on function public.record_tank_cost(uuid, numeric, numeric, numeric, timestamptz, uuid) from anon, public;
grant execute on function public.compute_tanker_delivery(jsonb) to authenticated;
grant execute on function public.record_tanker_delivery(jsonb) to authenticated;
grant execute on function public.record_tank_cost(uuid, numeric, numeric, numeric, timestamptz, uuid) to authenticated;
