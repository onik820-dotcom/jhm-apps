-- ============================================================================
-- 0024 — The Daily Sheet
--
-- One business day, 06:00 to 06:00, in the shape the paper form uses: meter
-- readings per nozzle, tank movement per tank, the sales summary, party-wise
-- credit, the expense list, the cash count, and the signature block.
--
-- WHAT IS KNOWN AND WHAT IS ASSUMED
--
-- The master prompt says the Daily Sheet is "a faithful digital replica of the
-- existing paper form, including all five signature lines". That sentence is
-- the only description of the form anyone has written down, and the form
-- itself has not been seen. Five signature lines is therefore a fact; which
-- five, and the order of the sections above them, is not.
--
-- So the structure the business cannot change is computed here, and everything
-- that is a guess about the paper — every heading and all five signature
-- captions — lives in `settings` under `daily_sheet_labels`, in both
-- languages. Correcting the sheet to match the real form is an admin edit to
-- one JSON row. It is not a migration, a deploy, or a conversation with a
-- developer.
--
-- The seeded captions follow the usual order of responsibility at a Padma Oil
-- dealership — the person who pumped, the person who ran the shift, the person
-- who counted, the person who keeps the books, the owner. They are a starting
-- point, and the Reports screen says so on the sheet itself until an admin
-- confirms them.
-- ============================================================================

insert into public.settings (station_id, key, value, description)
values (
  (select id from public.stations limit 1),
  'daily_sheet_labels',
  jsonb_build_object(
    'title',            jsonb_build_object('en', 'Daily Sales & Stock Sheet', 'bn', 'দৈনিক বিক্রয় ও মজুদ বিবরণী'),
    'meters',           jsonb_build_object('en', 'Meter readings', 'bn', 'মিটার রিডিং'),
    'tanks',            jsonb_build_object('en', 'Tank stock', 'bn', 'ট্যাংক মজুদ'),
    'sales',            jsonb_build_object('en', 'Sales summary', 'bn', 'বিক্রয় সারসংক্ষেপ'),
    'credit',           jsonb_build_object('en', 'Credit sales, party-wise', 'bn', 'বাকি বিক্রয় — পার্টিভিত্তিক'),
    'lubricants',       jsonb_build_object('en', 'Lubricants', 'bn', 'লুব্রিকেন্ট'),
    'expenses',         jsonb_build_object('en', 'Expenses', 'bn', 'খরচ'),
    'cash',             jsonb_build_object('en', 'Cash account', 'bn', 'নগদ হিসাব'),
    'signatures',       jsonb_build_object('en', 'Signatures', 'bn', 'স্বাক্ষর'),
    'signature_lines',  jsonb_build_array(
      jsonb_build_object('en', 'Dispenser / Salesman', 'bn', 'ডিসপেনসার / বিক্রয়কর্মী'),
      jsonb_build_object('en', 'Pump Manager',         'bn', 'পাম্প ম্যানেজার'),
      jsonb_build_object('en', 'Cash Counted By',      'bn', 'নগদ গণনাকারী'),
      jsonb_build_object('en', 'Accountant',           'bn', 'হিসাবরক্ষক'),
      jsonb_build_object('en', 'Chairman / Proprietor','bn', 'চেয়ারম্যান / স্বত্বাধিকারী')),
    'confirmed',        false),
  'Headings and the five signature captions on the Daily Sheet. Seeded from '
  'the usual order of responsibility at a dealership because the paper form '
  'has not been seen. Set "confirmed" to true once an admin has checked every '
  'caption against the real sheet; until then the printed sheet carries a note '
  'saying the captions are unconfirmed.')
on conflict (station_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Every figure on the sheet, for one business day
--
-- SECURITY INVOKER. The sheet carries no blended cost and no profit, so a
-- manager may read their own day; RLS already stops a dispenser reaching any
-- of the tables behind it.
-- ---------------------------------------------------------------------------
create or replace function public.daily_sheet(p_date date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_station    public.stations;
  v_labels     jsonb;
  v_shifts     jsonb;
  v_meters     jsonb;
  v_tanks      jsonb;
  v_credit     jsonb;
  v_lubs       jsonb;
  v_expenses   jsonb;
  v_cash       jsonb;
  v_deliveries jsonb;
  v_sales      record;
  v_shift_ids  uuid[];
begin
  if not public.can_read_money() then
    raise exception 'The daily sheet is not open to your role'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_station from public.stations limit 1;

  select s.value into v_labels
  from public.settings s
  where s.key = 'daily_sheet_labels'
  limit 1;

  -- Both shifts of the business day. A night shift belongs to the date it
  -- opened on, which is what shift_date already carries.
  select array_agg(sh.id order by sh.starts_at) into v_shift_ids
  from public.shifts sh
  where sh.shift_date = p_date;

  v_shift_ids := coalesce(v_shift_ids, array[]::uuid[]);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at), '[]'::jsonb) into v_shifts
  from (
    select
      sh.id, sh.shift_type, sh.status, sh.starts_at, sh.ends_at,
      sh.rate_per_litre,
      p.full_name as closed_by, p.full_name_bn as closed_by_bn,
      sh.closed_at
    from public.shifts sh
    left join public.profiles p on p.id = sh.closed_by
    where sh.id = any(v_shift_ids)
  ) x;

  -- ---- meter readings, nozzle by nozzle, opening and closing -------------
  select coalesce(jsonb_agg(to_jsonb(m) order by m.dispenser_code, m.nozzle_no, m.starts_at), '[]'::jsonb)
    into v_meters
  from (
    select
      d.code as dispenser_code,
      n.nozzle_no,
      sh.shift_type,
      sh.starts_at,
      -- The opening is the previous shift's close for this nozzle, which is
      -- how the chain is defined everywhere else in the system.
      (select mr2.reading
         from public.meter_readings mr2
         join public.shifts s2 on s2.id = mr2.shift_id
        where mr2.nozzle_id = n.id
          and mr2.reading_type = 'close'
          and mr2.deleted_at is null
          and s2.starts_at < sh.starts_at
        order by s2.starts_at desc, mr2.created_at desc
        limit 1) as opening,
      mr.reading as closing,
      mr.is_rollover
    from public.meter_readings mr
    join public.nozzles n     on n.id = mr.nozzle_id
    join public.dispensers d  on d.id = n.dispenser_id
    join public.shifts sh     on sh.id = mr.shift_id
    where mr.shift_id = any(v_shift_ids)
      and mr.reading_type = 'close'
      and mr.deleted_at is null
  ) m;

  -- ---- tank movement ------------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(t) order by t.tank_code, t.starts_at), '[]'::jsonb)
    into v_tanks
  from (
    select
      tk.code as tank_code,
      sh.shift_type,
      sh.starts_at,
      ss.book_opening,
      ss.refill_litres,
      ss.sold_from_tank,
      ss.book_closing,
      ss.physical_closing,
      ss.variance_litres,
      ss.variance_pct,
      ss.variance_flagged,
      ss.variance_reason,
      (select td.dip_mm from public.tank_dips td
        where td.shift_id = ss.shift_id and td.tank_id = ss.tank_id
          and td.dip_type = 'close' and td.deleted_at is null
        order by td.recorded_at desc limit 1) as closing_dip_mm
    from public.shift_stock ss
    join public.tanks tk  on tk.id = ss.tank_id
    join public.shifts sh on sh.id = ss.shift_id
    where ss.shift_id = any(v_shift_ids)
  ) t;

  -- ---- the sales line -----------------------------------------------------
  select
    coalesce(sum(sa.gross_litres), 0)    as gross_litres,
    coalesce(sum(sa.test_litres), 0)     as test_litres,
    coalesce(sum(sa.net_litres), 0)      as net_litres,
    coalesce(max(sa.rate_per_litre), 0)  as rate,
    coalesce(sum(sa.sales_amount), 0)    as fuel_amount,
    coalesce(sum(sa.lubricant_sales), 0) as lubricant_amount,
    coalesce(sum(sa.cash_sales), 0)      as cash_sales,
    coalesce(sum(sa.credit_sales), 0)    as credit_sales
  into v_sales
  from public.shift_sales sa
  where sa.shift_id = any(v_shift_ids);

  -- ---- party-wise credit --------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(c) order by c.sold_at), '[]'::jsonb) into v_credit
  from (
    select
      cu.name as party, cu.name_bn as party_bn,
      cs.vehicle_no, cs.challan_no, cs.litres, cs.rate, cs.amount, cs.sold_at,
      cs.over_limit_approved_by is not null as over_limit
    from public.credit_sales cs
    join public.customers cu on cu.id = cs.customer_id
    where cs.shift_id = any(v_shift_ids) and cs.deleted_at is null
  ) c;

  -- ---- lubricants, sales and own use side by side ------------------------
  select coalesce(jsonb_agg(to_jsonb(l) order by l.txn_at), '[]'::jsonb) into v_lubs
  from (
    select sk.name as sku, sk.name_bn as sku_bn, lt.txn_type,
           lt.qty, lt.rate, lt.amount, lt.vehicle_ref, lt.txn_at
    from public.lub_transactions lt
    join public.lub_skus sk on sk.id = lt.sku_id
    where lt.shift_id = any(v_shift_ids)
      and lt.deleted_at is null
      and lt.txn_type in ('sale', 'own_use')
  ) l;

  -- ---- expenses, with the two books kept apart ---------------------------
  select coalesce(jsonb_agg(to_jsonb(e) order by e.spent_at), '[]'::jsonb) into v_expenses
  from (
    select ec.name as head, ec.name_bn as head_bn, ec."group" as book,
           ex.description, ex.paid_by, ex.amount, ex.spent_at
    from public.expenses ex
    join public.expense_categories ec on ec.id = ex.category_id
    where ex.shift_id = any(v_shift_ids) and ex.deleted_at is null
  ) e;

  -- ---- tanker receipts on the day ----------------------------------------
  select coalesce(jsonb_agg(to_jsonb(dl) order by dl.arrived_at), '[]'::jsonb) into v_deliveries
  from (
    select td.challan_no, td.truck_reg, td.arrived_at,
           td.total_declared, td.total_received, td.total_shortage
    from public.tanker_deliveries td
    where td.deleted_at is null
      and public.business_date(td.arrived_at) = p_date
  ) dl;

  -- ---- the cash account ---------------------------------------------------
  select coalesce(jsonb_agg(to_jsonb(ca) order by ca.starts_at), '[]'::jsonb) into v_cash
  from (
    select sh.shift_type, sh.starts_at,
           cr.opening_cash, cr.cash_sales, cr.dues_collected, cr.expenses_cash,
           cr.bank_deposits, cr.expected_cash, cr.counted_cash, cr.cash_variance,
           cr.variance_reason
    from public.cash_reconciliation cr
    join public.shifts sh on sh.id = cr.shift_id
    where cr.shift_id = any(v_shift_ids)
  ) ca;

  return jsonb_build_object(
    'date', p_date,
    'station', jsonb_build_object(
      'name', v_station.name, 'name_bn', v_station.name_bn,
      'address', v_station.address, 'dealer_name', v_station.dealer_name),
    'labels', coalesce(v_labels, '{}'::jsonb),
    'shift_count', coalesce(array_length(v_shift_ids, 1), 0),
    'shifts', v_shifts,
    'meters', v_meters,
    'tanks', v_tanks,
    'deliveries', v_deliveries,
    'sales', jsonb_build_object(
      'gross_litres',     round(v_sales.gross_litres, 3),
      'test_litres',      round(v_sales.test_litres, 3),
      'net_litres',       round(v_sales.net_litres, 3),
      'rate_per_litre',   round(v_sales.rate, 2),
      'fuel_amount',      round(v_sales.fuel_amount, 2),
      'lubricant_amount', round(v_sales.lubricant_amount, 2),
      'total_amount',     round(v_sales.fuel_amount + v_sales.lubricant_amount, 2),
      'cash_sales',       round(v_sales.cash_sales, 2),
      'credit_sales',     round(v_sales.credit_sales, 2)),
    'credit', v_credit,
    'lubricants', v_lubs,
    'expenses', v_expenses,
    'cash', v_cash);
end;
$$;

comment on function public.daily_sheet(date) is
  'Every figure the paper Daily Sheet carries, for one business day. Headings '
  'and the five signature captions come from settings.daily_sheet_labels so '
  'they can be corrected against the real form without a migration.';

revoke execute on function public.daily_sheet(date) from anon, public;
grant execute on function public.daily_sheet(date) to authenticated;
