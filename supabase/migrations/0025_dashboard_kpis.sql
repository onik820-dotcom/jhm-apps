-- ============================================================================
-- 0025 — The figures on the four dashboards
--
-- One function, because the four dashboards answer the same questions and a
-- second implementation is a second set of numbers to reconcile. What differs
-- is who may see what, and that is decided here rather than in the browser:
-- a page can be told not to render a figure, but if the figure reached the
-- page it reached the person, in the network tab if nowhere else.
--
--   dispenser  never calls this. It has its own screen with no money on it.
--   manager    sales, litres, cash, dues, variance, cover. No profit, no cost.
--   admin, md  all of it.
--
-- Today means the current business day, 06:00 to 06:00 — so at 2am the night
-- shift still counts towards the day it opened on, which is how the station
-- thinks about it and how every other figure in the system is dated.
-- ============================================================================

create or replace function public.dashboard_kpis()
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_today       date := public.business_date(now());
  v_month_start date := date_trunc('month', v_today)::date;
  v_sees_profit boolean := public.is_admin() or public.is_md();

  v_today_sales   numeric := 0;
  v_today_litres  numeric := 0;
  v_month_sales   numeric := 0;
  v_month_litres  numeric := 0;
  v_cash          numeric;
  v_dues          numeric := 0;
  v_over_limit    integer := 0;
  v_open_variance integer := 0;
  v_stock         numeric := 0;
  v_cover         numeric;
  v_month_profit  numeric;
  v_pl            jsonb;
begin
  if not public.can_read_money() then
    raise exception 'These figures are not open to your role'
      using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(sa.sales_amount + sa.lubricant_sales) filter (where s.shift_date = v_today), 0),
    coalesce(sum(sa.net_litres)  filter (where s.shift_date = v_today), 0),
    coalesce(sum(sa.sales_amount + sa.lubricant_sales), 0),
    coalesce(sum(sa.net_litres), 0)
  into v_today_sales, v_today_litres, v_month_sales, v_month_litres
  from public.shift_sales sa
  join public.shifts s on s.id = sa.shift_id
  where s.status = 'closed' and s.shift_date >= v_month_start;

  -- What the last close counted, which is what should be in the drawer now.
  select cr.counted_cash into v_cash
  from public.cash_reconciliation cr
  join public.shifts s on s.id = cr.shift_id
  where s.status = 'closed'
  order by s.ends_at desc
  limit 1;

  -- Dues are summed from each party's own running balance, never re-derived
  -- from the transactions: the ledger is the record.
  select
    coalesce(sum(greatest(public.customer_balance(c.id), 0)), 0),
    count(*) filter (
      where c.credit_limit > 0 and public.customer_balance(c.id) > c.credit_limit)
  into v_dues, v_over_limit
  from public.customers c
  where c.deleted_at is null;

  -- A flagged variance stays open until somebody resolves the alert.
  select count(*) into v_open_variance
  from public.alerts a
  where a.type = 'variance.exceeded' and a.resolved_at is null;

  -- Days of cover: what is in the tanks against how fast it has been selling
  -- this month. With no sales yet there is no rate to divide by, and the
  -- honest answer is "not known" rather than a large number.
  select coalesce(sum(public.dip_to_litres(t.id, d.dip_mm, d.recorded_at)), 0)
  into v_stock
  from public.tanks t
  join lateral (
    select td.dip_mm, td.recorded_at
    from public.tank_dips td
    where td.tank_id = t.id and td.deleted_at is null
    order by td.recorded_at desc
    limit 1
  ) d on true
  where t.deleted_at is null and t.status <> 'removed';

  if v_month_litres > 0 then
    v_cover := round(
      v_stock / (v_month_litres / greatest(1, (v_today - v_month_start) + 1)), 1);
  end if;

  if v_sees_profit then
    v_pl := public.profit_and_loss(v_month_start, v_today);
    v_month_profit := (v_pl->>'operating_profit')::numeric;
  end if;

  return jsonb_build_object(
    'business_date', v_today,
    'today', jsonb_build_object(
      'sales',  round(v_today_sales, 2),
      'litres', round(v_today_litres, 3)),
    'month', jsonb_build_object(
      'sales',  round(v_month_sales, 2),
      'litres', round(v_month_litres, 3),
      'from',   v_month_start),
    'cash_in_hand',      case when v_cash is null then null else round(v_cash, 2) end,
    'dues_outstanding',  round(v_dues, 2),
    'parties_over_limit', v_over_limit,
    'open_variances',    v_open_variance,
    'stock_litres',      round(v_stock, 3),
    'days_cover',        v_cover,
    -- Absent rather than zero for a manager: a zero would read as "no profit",
    -- which is a different statement from "not yours to see".
    'month_profit',      case when v_sees_profit then round(coalesce(v_month_profit, 0), 2) end,
    'sees_profit',       v_sees_profit);
end;
$$;

comment on function public.dashboard_kpis() is
  'The figures behind the manager, admin and MD dashboards, for the current '
  'business day and month to date. Profit is omitted entirely for a manager '
  'rather than sent and hidden in the browser.';

revoke execute on function public.dashboard_kpis() from anon, public;
grant execute on function public.dashboard_kpis() to authenticated;
