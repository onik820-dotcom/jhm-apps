-- ============================================================================
-- 0007 — Static seed
--
-- The station, its thresholds, its two tanks with BSTI metadata, its four
-- dispensers, the expense categories and the credit-party rows.
--
-- Three things in this file are documented assumptions, not facts from the
-- business. They are marked ASSUMPTION and listed in README.md under "Confirm
-- before go-live":
--   1. which dispenser draws from which tank
--   2. one nozzle per dispenser, and an 8-digit totalizer
--   3. the credit-party names and their opening balances
--
-- The calibration rows themselves are loaded separately by scripts/seed.ts
-- from the certified CSVs, because they are 4,121 rows.
-- ============================================================================

insert into public.stations (id, name, name_bn, address, dealer_name, timezone)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'M/S. J.H.M. Filling Station',
  'মেসার্স জে.এইচ.এম. ফিলিং স্টেশন',
  'Jashore–Khulna Highway, Chengutia, Abhaynagar, Jashore',
  'Dealer of Padma Oil Company Limited',
  'Asia/Dhaka'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Thresholds and operating parameters
-- ---------------------------------------------------------------------------

insert into public.settings (station_id, key, value, description) values
  ((select id from public.stations limit 1), 'variance_threshold_pct', '{"value": 0.5}',
    'Stock variance past this percentage of litres sold raises an alert and fires the n8n webhook.'),
  ((select id from public.stations limit 1), 'shortage_tolerance_pct', '{"value": 0.3}',
    'Tanker compartment shortage past this percentage of declared litres is flagged.'),
  ((select id from public.stations limit 1), 'overfill_limit_pct', '{"value": 95}',
    'A compartment may not be discharged past this fill percentage of the tank.'),
  ((select id from public.stations limit 1), 'cover_alert_days', '{"value": 3}',
    'Days of stock cover below which a purchase order needs to go out.'),
  ((select id from public.stations limit 1), 'cash_variance_tolerance', '{"value": 0}',
    'Taka tolerance treated as a clean cash close. Zero means any difference needs a reason.'),
  ((select id from public.stations limit 1), 'chart_expiry_warning_days', '{"value": 90}',
    'Days before a calibration chart expires that the admin dashboard starts warning.'),
  ((select id from public.stations limit 1), 'shift_day_start', '{"value": "06:00"}',
    'Day shift start, Asia/Dhaka. The business day runs 06:00 to 06:00.'),
  ((select id from public.stations limit 1), 'shift_night_start', '{"value": "18:00"}',
    'Night shift start, Asia/Dhaka.'),
  ((select id from public.stations limit 1), 'sync_max_attempts', '{"value": 5}',
    'Attempts before an outbound n8n event is marked failed and raises an alert.')
on conflict (station_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Tanks
--
-- Both hold 12,000 L, but their dip ranges differ and that difference matters:
-- Tank 1 is full at 2070 mm, Tank 2 at 2051 mm.
-- ---------------------------------------------------------------------------

insert into public.tanks (id, station_id, code, product, capacity_litres, status)
values
  ('00000000-0000-0000-0000-0000000000a1'::uuid,
   (select id from public.stations limit 1), 'T1', 'diesel', 12000.000, 'active'),
  ('00000000-0000-0000-0000-0000000000a2'::uuid,
   (select id from public.stations limit 1), 'T2', 'diesel', 12000.000, 'active')
on conflict (id) do nothing;

insert into public.tank_metadata (
  tank_id, length_mm, diameter_mm, gross_height_mm, final_dip_mm,
  dip_pipe_length_mm, dip_pipe_diameter_mm, manhole_mm,
  calibration_method, calibrated_by, calibration_office,
  calibration_date, previous_calibration, validity_from, validity_to
) values
  ('00000000-0000-0000-0000-0000000000a1'::uuid,
   3160, 2200, 2380, 2070, 1620, 50, 600,
   'API', 'Md. Almas Mia, Inspector (Metrology)', 'BSTI Khulna',
   date '2022-02-02', date '2016-10-26', date '2022-01-31', date '2027-01-30'),
  ('00000000-0000-0000-0000-0000000000a2'::uuid,
   null, null, null, 2051, null, null, null,
   'API', 'Md. Almas Mia, Inspector (Metrology)', 'BSTI Khulna',
   date '2022-02-02', null, date '2022-01-31', date '2027-01-30')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Dispensers and nozzles
--
-- ASSUMPTION: M1 and M2 draw from Tank 1, M3 and M4 from Tank 2. Per-tank
-- variance is impossible without this mapping, so it is seeded rather than
-- left null — but it must be confirmed against the forecourt pipework.
--
-- ASSUMPTION: one nozzle per dispenser and an 8-digit totalizer. Both are
-- per-row columns, so correcting them is an admin edit, not a migration.
-- ---------------------------------------------------------------------------

insert into public.dispensers (id, station_id, code, tank_id, nozzle_count, meter_digits, max_flow_lpm, status)
values
  ('00000000-0000-0000-0000-0000000000b1'::uuid, (select id from public.stations limit 1),
   'M1', '00000000-0000-0000-0000-0000000000a1'::uuid, 1, 8, 50, 'active'),
  ('00000000-0000-0000-0000-0000000000b2'::uuid, (select id from public.stations limit 1),
   'M2', '00000000-0000-0000-0000-0000000000a1'::uuid, 1, 8, 50, 'active'),
  ('00000000-0000-0000-0000-0000000000b3'::uuid, (select id from public.stations limit 1),
   'M3', '00000000-0000-0000-0000-0000000000a2'::uuid, 1, 8, 50, 'active'),
  ('00000000-0000-0000-0000-0000000000b4'::uuid, (select id from public.stations limit 1),
   'M4', '00000000-0000-0000-0000-0000000000a2'::uuid, 1, 8, 50, 'active')
on conflict (id) do nothing;

insert into public.nozzles (dispenser_id, nozzle_no, product, status)
select d.id, n.nozzle_no, 'diesel', 'active'
from public.dispensers d
cross join lateral generate_series(1, d.nozzle_count) as n(nozzle_no)
on conflict (dispenser_id, nozzle_no) do nothing;

-- ---------------------------------------------------------------------------
-- Expense categories
--
-- Seventeen active categories, split across the Pump book and the Chairman
-- book exactly as the paper sheet does. Names in both languages.
-- ---------------------------------------------------------------------------

insert into public.expense_categories (station_id, name, name_bn, "group", sort_order) values
  ((select id from public.stations limit 1), 'Staff Salary',             'কর্মচারী বেতন',            'staff',        1),
  ((select id from public.stations limit 1), 'Staff Food & Tiffin',      'কর্মচারী খাবার ও টিফিন',   'staff',        2),
  ((select id from public.stations limit 1), 'Electricity Bill',         'বিদ্যুৎ বিল',               'utility',      3),
  ((select id from public.stations limit 1), 'Generator Fuel',           'জেনারেটর জ্বালানি',        'utility',      4),
  ((select id from public.stations limit 1), 'Mobile & Internet',        'মোবাইল ও ইন্টারনেট',       'utility',      5),
  ((select id from public.stations limit 1), 'Dispenser Repair',         'মেশিন মেরামত',             'maintenance',  6),
  ((select id from public.stations limit 1), 'Building & Civil Repair',  'ভবন ও পূর্ত মেরামত',        'maintenance',  7),
  ((select id from public.stations limit 1), 'Cleaning & Washing',       'পরিষ্কার পরিচ্ছন্নতা',      'pump',         8),
  ((select id from public.stations limit 1), 'Stationery & Printing',    'স্টেশনারি ও ছাপা',          'pump',         9),
  ((select id from public.stations limit 1), 'Transport & Carrying',     'পরিবহন ও বহন খরচ',         'pump',        10),
  ((select id from public.stations limit 1), 'Entertainment',            'আপ্যায়ন খরচ',              'pump',        11),
  ((select id from public.stations limit 1), 'Owners Association Fee',   'মালিক সমিতির চাঁদা',        'association', 12),
  ((select id from public.stations limit 1), 'Bank Charge',              'ব্যাংক চার্জ',              'other',       13),
  ((select id from public.stations limit 1), 'Loan Instalment',          'ঋণের কিস্তি',               'loan',        14),
  ((select id from public.stations limit 1), 'Donation & Subscription',  'অনুদান ও চাঁদা',            'donation',    15),
  ((select id from public.stations limit 1), 'Chairman Personal',        'চেয়ারম্যান ব্যক্তিগত',      'chairman',    16),
  ((select id from public.stations limit 1), 'Miscellaneous',            'বিবিধ',                     'other',       17)
on conflict (station_id, name) do nothing;

-- Oil issued to the station's own lorries reduces lubricant stock and books
-- here rather than counting as a sale. Confirm with the business whether it
-- should sit in the Pump book or somewhere of its own.
insert into public.expense_categories (station_id, name, name_bn, "group", sort_order)
values ((select id from public.stations limit 1), 'Lubricant Own Use', 'নিজস্ব ব্যবহার — লুব্রিকেন্ট', 'pump', 18)
on conflict (station_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Credit parties
--
-- ASSUMPTION: the business runs about 21 credit accounts. Their real names,
-- vehicle numbers, credit limits and — most importantly — their opening
-- balances at go-live are not yet known, so 21 inactive placeholder rows are
-- created. An admin renames each one and sets its opening balance on the
-- Customers screen; the ledger trigger takes the opening balance from there.
--
-- They are seeded inactive on purpose: an inactive party cannot be picked in
-- the credit-sale form, so no sale can be booked against a placeholder.
-- ---------------------------------------------------------------------------

insert into public.customers (station_id, name, type, opening_balance, credit_limit, is_active, notes)
select
  (select id from public.stations limit 1),
  'Credit Party ' || lpad(g::text, 2, '0'),
  'company',
  0,
  0,
  false,
  'Placeholder seeded at install. Rename to the real party, set the opening '
  'balance from the Due Customer Ledger workbook, set a credit limit, then activate.'
from generate_series(1, 21) as g
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Lubricant SKUs
--
-- Placeholder shelf so the module has something to work with. Rates are zero
-- until the real purchase and sale rates are entered.
-- ---------------------------------------------------------------------------

insert into public.lub_skus (station_id, name, name_bn, brand, pack_type, pack_size_litres, is_active, reorder_level)
values
  ((select id from public.stations limit 1), 'Engine Oil — Loose', 'ইঞ্জিন অয়েল — খোলা', 'Padma', 'loose', null, true, 20),
  ((select id from public.stations limit 1), 'Engine Oil — 1 L Can', 'ইঞ্জিন অয়েল — ১ লিটার ক্যান', 'Padma', 'can', 1, true, 12),
  ((select id from public.stations limit 1), 'Engine Oil — 5 L Can', 'ইঞ্জিন অয়েল — ৫ লিটার ক্যান', 'Padma', 'can', 5, true, 6),
  ((select id from public.stations limit 1), 'Gear Oil — Loose', 'গিয়ার অয়েল — খোলা', 'Padma', 'loose', null, true, 10),
  ((select id from public.stations limit 1), 'Grease', 'গ্রিজ', 'Padma', 'grease', null, true, 5)
on conflict do nothing;

insert into public.lub_stock (sku_id, qty_on_hand, avg_cost)
select id, 0, 0 from public.lub_skus
on conflict (sku_id) do nothing;
