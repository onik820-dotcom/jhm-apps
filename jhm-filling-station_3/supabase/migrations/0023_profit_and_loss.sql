-- ============================================================================
-- 0023 — What the station actually earned
--
-- Everything before this recorded what happened. This works out what it was
-- worth, which needs one thing the operational tables do not carry: the cost
-- of the fuel at the moment it was sold.
--
-- A shift sells from a tank whose blended cost changes every time a tanker
-- arrives. Costing a month's sales at today's average would be wrong in both
-- directions — it would overstate profit in a falling market and understate it
-- in a rising one — so each shift is costed at the average in force when that
-- shift closed.
--
-- Two accounting decisions that are not arbitrary:
--
--   The Chairman book is not an expense of the station. Money the owner draws
--   is a distribution, not a cost of selling diesel, and folding it into
--   operating profit would make the pump look unprofitable in a month the
--   owner happened to take more out. It is reported, prominently, on its own
--   line below the operating result.
--
--   Own-use lubricant is already an expense, booked at cost by 0020. It is not
--   also a sale. Counting it as revenue would invent a margin on oil nobody
--   paid for, and it would be counted twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The blended cost of a tank at a moment in time
--
-- SECURITY INVOKER, so RLS decides. tank_cost_history is admin and MD only,
-- which means a manager calling this gets nothing back — and that is the
-- correct answer, not a bug to work around. A manager is not shown profit.
-- ---------------------------------------------------------------------------
create or replace function public.tank_cost_at(p_tank_id uuid, p_at timestamptz)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select h.avg_cost
  from public.tank_cost_history h
  where h.tank_id = p_tank_id
    and h.effective_at <= p_at
  order by h.effective_at desc, h.created_at desc
  limit 1
$$;

comment on function public.tank_cost_at(uuid, timestamptz) is
  'The moving average cost in force for a tank at a point in time. Null when '
  'the tank had no valued stock yet, which is a real answer: until the first '
  'delivery prices it, nobody knows what that fuel cost.';

revoke execute on function public.tank_cost_at(uuid, timestamptz) from anon, public;
grant execute on function public.tank_cost_at(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Profit and loss over a date range
--
-- Business days, so a night shift belongs to the date it opened on rather than
-- being split across two months because it crossed midnight.
-- ---------------------------------------------------------------------------
create or replace function public.profit_and_loss(p_from date, p_to date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_fuel_litres   numeric := 0;
  v_fuel_revenue  numeric := 0;
  v_fuel_cogs     numeric := 0;
  v_uncosted      numeric := 0;
  v_lub_revenue   numeric := 0;
  v_lub_cogs      numeric := 0;
  v_lub_qty       numeric := 0;
  v_own_use       numeric := 0;
  v_pump_exp      numeric := 0;
  v_chairman_exp  numeric := 0;
  v_heads         jsonb   := '[]'::jsonb;
  v_days          integer;
  v_row           record;
begin
  if not (public.is_admin() or public.is_md()) then
    raise exception 'Profit is shown to the owner and the MD only'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Give a date range with the start on or before the end'
      using errcode = 'check_violation';
  end if;

  v_days := (p_to - p_from) + 1;

  -- ---- fuel, costed shift by shift ---------------------------------------
  for v_row in
    select
      ss.sold_from_tank,
      ss.tank_id,
      s.ends_at
    from public.shift_stock ss
    join public.shifts s on s.id = ss.shift_id
    where s.status = 'closed'
      and s.shift_date between p_from and p_to
  loop
    declare
      v_cost numeric := public.tank_cost_at(v_row.tank_id, v_row.ends_at);
    begin
      v_fuel_litres := v_fuel_litres + coalesce(v_row.sold_from_tank, 0);
      if v_cost is null then
        -- Litres sold before the tank was ever valued. Costing them at zero
        -- would report the whole sale as profit, so they are held out of the
        -- calculation and reported as the gap they are.
        v_uncosted := v_uncosted + coalesce(v_row.sold_from_tank, 0);
      else
        v_fuel_cogs := v_fuel_cogs + round(coalesce(v_row.sold_from_tank, 0) * v_cost, 2);
      end if;
    end;
  end loop;

  -- Revenue comes from shift_sales, once per shift, not per tank.
  select coalesce(sum(sa.sales_amount), 0)
    into v_fuel_revenue
  from public.shift_sales sa
  join public.shifts s on s.id = sa.shift_id
  where s.status = 'closed' and s.shift_date between p_from and p_to;

  -- ---- lubricants ---------------------------------------------------------
  select
    coalesce(sum(lt.amount) filter (where lt.txn_type = 'sale'), 0),
    coalesce(sum(lt.qty)    filter (where lt.txn_type = 'sale'), 0),
    coalesce(sum(lt.amount) filter (where lt.txn_type = 'own_use'), 0)
  into v_lub_revenue, v_lub_qty, v_own_use
  from public.lub_transactions lt
  where lt.deleted_at is null
    and public.business_date(lt.txn_at) between p_from and p_to;

  -- Lubricant cost of sale at the shelf's average when it left. lub_stock
  -- carries only the current average, so a sale is costed at the average in
  -- force at the time of the nearest preceding purchase — close enough for a
  -- shelf that turns over slowly, and flagged as an estimate in the result.
  select coalesce(sum(round(lt.qty * coalesce(st.avg_cost, 0), 2)), 0)
    into v_lub_cogs
  from public.lub_transactions lt
  join public.lub_stock st on st.sku_id = lt.sku_id
  where lt.deleted_at is null
    and lt.txn_type = 'sale'
    and public.business_date(lt.txn_at) between p_from and p_to;

  -- ---- expenses, the two books kept apart --------------------------------
  select
    coalesce(sum(e.amount) filter (where c."group" <> 'chairman'), 0),
    coalesce(sum(e.amount) filter (where c."group" =  'chairman'), 0)
  into v_pump_exp, v_chairman_exp
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  where e.deleted_at is null
    and public.business_date(e.spent_at) between p_from and p_to;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.total desc), '[]'::jsonb)
    into v_heads
  from (
    select
      c.name,
      c.name_bn,
      c."group" as book,
      round(sum(e.amount), 2) as total
    from public.expenses e
    join public.expense_categories c on c.id = e.category_id
    where e.deleted_at is null
      and public.business_date(e.spent_at) between p_from and p_to
    group by c.name, c.name_bn, c."group"
  ) h;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'days', v_days,

    'fuel', jsonb_build_object(
      'litres',   round(v_fuel_litres, 3),
      'revenue',  round(v_fuel_revenue, 2),
      'cogs',     round(v_fuel_cogs, 2),
      'gross',    round(v_fuel_revenue - v_fuel_cogs, 2),
      'margin_per_litre',
        case when v_fuel_litres > 0
             then round((v_fuel_revenue - v_fuel_cogs) / v_fuel_litres, 4) end,
      -- Litres sold out of stock that was never valued. While this is above
      -- zero the fuel margin is overstated, and the screen says so.
      'uncosted_litres', round(v_uncosted, 3)),

    'lubricants', jsonb_build_object(
      'qty',      round(v_lub_qty, 3),
      'revenue',  round(v_lub_revenue, 2),
      'cogs',     round(v_lub_cogs, 2),
      'gross',    round(v_lub_revenue - v_lub_cogs, 2),
      'cogs_is_estimate', true),

    'gross_profit', round((v_fuel_revenue - v_fuel_cogs) + (v_lub_revenue - v_lub_cogs), 2),

    'expenses', jsonb_build_object(
      'pump',     round(v_pump_exp, 2),
      'chairman', round(v_chairman_exp, 2),
      -- Own use is already inside the pump figure; it is surfaced separately
      -- so it is not mistaken for a cash cost.
      'own_use_included', round(v_own_use, 2),
      'by_head',  v_heads),

    'operating_profit',
      round((v_fuel_revenue - v_fuel_cogs) + (v_lub_revenue - v_lub_cogs) - v_pump_exp, 2),

    'chairman_drawings', round(v_chairman_exp, 2),

    'after_drawings',
      round((v_fuel_revenue - v_fuel_cogs) + (v_lub_revenue - v_lub_cogs)
            - v_pump_exp - v_chairman_exp, 2));
end;
$$;

comment on function public.profit_and_loss(date, date) is
  'Profit over a range of business days. Fuel is costed shift by shift at the '
  'blended average in force when that shift closed. The Chairman book sits '
  'below the operating result, not inside it: an owner''s drawings are a '
  'distribution, not a cost of selling diesel.';

revoke execute on function public.profit_and_loss(date, date) from anon, public;
grant execute on function public.profit_and_loss(date, date) to authenticated;
