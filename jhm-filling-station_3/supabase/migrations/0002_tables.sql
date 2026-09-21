-- ============================================================================
-- 0002 — Core tables
--
-- Conventions, applied everywhere:
--   money   numeric(14,2)   taka, two decimals
--   volume  numeric(12,3)   litres, three decimals
--   cost    numeric(14,4)   cost per litre, carried at four decimals
--   dip     numeric(8,1)    millimetres, one decimal for a between-marks read
--
-- Every mutable table carries updated_at/updated_by and soft-delete columns.
-- Nothing in this schema is ever hard-deleted: deletion sets deleted_at and a
-- reason, and the audit trigger records the before and after images.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Identity and configuration
-- ---------------------------------------------------------------------------

create table if not exists public.stations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_bn       text,
  address       text not null,
  dealer_name   text not null,
  timezone      text not null default 'Asia/Dhaka',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete restrict,
  station_id    uuid references public.stations(id),
  full_name     text not null,
  full_name_bn  text,
  phone         text,
  role          public.user_role not null default 'dispenser',
  is_active     boolean not null default true,
  language_pref public.language_pref not null default 'bn',
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

comment on column public.profiles.role is
  'Enforced in RLS, never only in the UI. dispenser < manager < admin; md is read-only everywhere.';

create table if not exists public.settings (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  key           text not null,
  value         jsonb not null,
  description   text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  unique (station_id, key)
);

-- ---------------------------------------------------------------------------
-- Fuel infrastructure
-- ---------------------------------------------------------------------------

create table if not exists public.tanks (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid references public.stations(id),
  code            text not null,
  product         public.product_type not null default 'diesel',
  capacity_litres numeric(12,3) not null check (capacity_litres > 0),
  status          public.equipment_status not null default 'active',
  installed_at    date,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz,
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles(id),
  delete_reason   text,
  unique (station_id, code)
);

create table if not exists public.tank_metadata (
  id                   uuid primary key default gen_random_uuid(),
  tank_id              uuid not null references public.tanks(id),
  length_mm            integer,
  diameter_mm          integer,
  gross_height_mm      integer,
  -- The dip at which this tank is full. 2070 mm for T1, 2051 mm for T2.
  -- Every bound check reads this column; 2070 is never a global constant.
  final_dip_mm         integer not null check (final_dip_mm > 0),
  dip_pipe_length_mm   integer,
  dip_pipe_diameter_mm integer,
  manhole_mm           integer,
  calibration_method   text,
  calibrated_by        text,
  calibration_office   text,
  calibration_date     date,
  previous_calibration date,
  validity_from        date not null,
  validity_to          date not null,
  certificate_image_url text,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id),
  updated_at           timestamptz,
  updated_by           uuid references public.profiles(id),
  check (validity_to > validity_from)
);

create table if not exists public.tank_calibration (
  id          uuid primary key default gen_random_uuid(),
  tank_id     uuid not null references public.tanks(id),
  version     integer not null default 1,
  dip_mm      integer not null check (dip_mm >= 1),
  litres      numeric(12,3) not null check (litres >= 0),
  valid_from  date not null,
  valid_to    date not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  unique (tank_id, version, dip_mm),
  check (valid_to > valid_from)
);

comment on table public.tank_calibration is
  'BSTI-certified dip-to-litres chart at 1 mm granularity. The legal reference '
  'for tank contents — never replaced by a cylinder formula. Versioned, so a '
  'dip always resolves against the chart in force on its own timestamp.';

create table if not exists public.dispensers (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  code          text not null,
  -- Every dispenser draws from exactly one tank. Without this mapping,
  -- per-tank variance cannot be computed at all.
  tank_id       uuid not null references public.tanks(id),
  nozzle_count  integer not null default 1 check (nozzle_count between 1 and 8),
  meter_digits  integer not null default 8 check (meter_digits between 4 and 12),
  max_flow_lpm  numeric(8,2) not null default 50 check (max_flow_lpm > 0),
  status        public.equipment_status not null default 'active',
  installed_at  date,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text,
  unique (station_id, code)
);

create table if not exists public.nozzles (
  id            uuid primary key default gen_random_uuid(),
  dispenser_id  uuid not null references public.dispensers(id),
  nozzle_no     integer not null check (nozzle_no >= 1),
  product       public.product_type not null default 'diesel',
  status        public.equipment_status not null default 'active',
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text,
  unique (dispenser_id, nozzle_no)
);

-- ---------------------------------------------------------------------------
-- Shifts and readings
-- ---------------------------------------------------------------------------

create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  -- The business day a shift belongs to. A day runs 06:00 → 06:00 Asia/Dhaka,
  -- so the night shift spans two calendar dates and is attributed to the date
  -- it opened on.
  shift_date    date not null,
  shift_type    public.shift_type not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        public.shift_status not null default 'open',
  rate_per_litre numeric(14,2),
  opened_by     uuid references public.profiles(id),
  closed_by     uuid references public.profiles(id),
  closed_at     timestamptz,
  reopened_by   uuid references public.profiles(id),
  reopened_at   timestamptz,
  reopen_reason text,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  unique (station_id, shift_date, shift_type),
  check (ends_at > starts_at)
);

create table if not exists public.meter_readings (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references public.shifts(id),
  nozzle_id     uuid not null references public.nozzles(id),
  reading_type  public.reading_type not null,
  reading       numeric(12,2) not null check (reading >= 0),
  photo_url     text,
  ai_extracted  jsonb,
  ai_confidence numeric(5,4) check (ai_confidence between 0 and 1),
  is_rollover   boolean not null default false,
  recorded_by   uuid references public.profiles(id),
  confirmed_by  uuid references public.profiles(id),
  confirmed_at  timestamptz,
  client_ref    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

comment on column public.meter_readings.client_ref is
  'Idempotency handle from the offline queue: a re-sent reading updates rather '
  'than duplicating.';

create table if not exists public.tank_dips (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid references public.shifts(id),
  tank_id       uuid not null references public.tanks(id),
  dip_type      public.dip_type not null,
  dip_mm        numeric(8,1) not null check (dip_mm >= 1),
  litres        numeric(12,3) not null check (litres >= 0),
  calibration_version integer,
  photo_url     text,
  recorded_by   uuid references public.profiles(id),
  recorded_at   timestamptz not null default now(),
  client_ref    text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

create table if not exists public.shift_sales (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts(id),
  gross_litres   numeric(12,3) not null default 0 check (gross_litres >= 0),
  test_litres    numeric(12,3) not null default 0 check (test_litres >= 0),
  net_litres     numeric(12,3) not null default 0 check (net_litres >= 0),
  rate_per_litre numeric(14,2) not null check (rate_per_litre >= 0),
  sales_amount   numeric(14,2) not null default 0,
  lubricant_sales numeric(14,2) not null default 0,
  cash_sales     numeric(14,2) not null default 0,
  credit_sales   numeric(14,2) not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz,
  updated_by     uuid references public.profiles(id),
  unique (shift_id),
  check (test_litres <= gross_litres)
);

create table if not exists public.shift_stock (
  id               uuid primary key default gen_random_uuid(),
  shift_id         uuid not null references public.shifts(id),
  tank_id          uuid not null references public.tanks(id),
  book_opening     numeric(12,3) not null,
  refill_litres    numeric(12,3) not null default 0 check (refill_litres >= 0),
  sold_from_tank   numeric(12,3) not null default 0 check (sold_from_tank >= 0),
  book_closing     numeric(12,3) not null,
  physical_closing numeric(12,3),
  variance_litres  numeric(12,3),
  variance_pct     numeric(9,4),
  variance_reason  text,
  variance_flagged boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz,
  updated_by       uuid references public.profiles(id),
  unique (shift_id, tank_id)
);

comment on table public.shift_stock is
  'Shift N book_closing is shift N+1 book_opening for the same tank. Enforced '
  'by trigger; a correction to an earlier shift must be followed by '
  'recalculate_from().';

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  po_number     text not null,
  supplier      text not null default 'Padma Oil Company Limited',
  order_date    date not null,
  litres        numeric(12,3) not null check (litres > 0),
  rate          numeric(14,2) not null check (rate >= 0),
  status        public.po_status not null default 'ordered',
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text,
  unique (station_id, po_number)
);

create table if not exists public.tanker_deliveries (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid references public.stations(id),
  po_id          uuid references public.purchase_orders(id),
  challan_no     text,
  truck_reg      text,
  driver_name    text,
  arrived_at     timestamptz not null default now(),
  depot_rate     numeric(14,2) not null check (depot_rate >= 0),
  total_declared numeric(12,3) not null default 0,
  total_received numeric(12,3) not null default 0,
  total_shortage numeric(12,3) not null default 0,
  purchase_value numeric(14,2) not null default 0,
  shift_id       uuid references public.shifts(id),
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz,
  updated_by     uuid references public.profiles(id),
  deleted_at     timestamptz,
  deleted_by     uuid references public.profiles(id),
  delete_reason  text
);

create table if not exists public.tanker_compartments (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references public.tanker_deliveries(id),
  compartment_no  integer not null check (compartment_no between 1 and 4),
  declared_litres numeric(12,3) not null default 4500 check (declared_litres >= 0),
  tank_id         uuid not null references public.tanks(id),
  dip_before_mm   numeric(8,1) not null check (dip_before_mm >= 1),
  dip_after_mm    numeric(8,1) not null check (dip_after_mm >= 1),
  litres_before   numeric(12,3) not null,
  litres_after    numeric(12,3) not null,
  received_litres numeric(12,3) not null,
  shortage_litres numeric(12,3) not null default 0,
  shortage_pct    numeric(9,4),
  shortage_flagged boolean not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz,
  updated_by      uuid references public.profiles(id),
  unique (delivery_id, compartment_no),
  check (dip_after_mm >= dip_before_mm)
);

create table if not exists public.tank_cost_history (
  id                  uuid primary key default gen_random_uuid(),
  tank_id             uuid not null references public.tanks(id),
  effective_at        timestamptz not null default now(),
  stock_before_litres numeric(12,3),
  received_litres     numeric(12,3),
  depot_rate          numeric(14,2),
  avg_cost            numeric(14,4) not null check (avg_cost >= 0),
  trigger_delivery_id uuid references public.tanker_deliveries(id),
  note                text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id)
);

-- ---------------------------------------------------------------------------
-- Lubricants / Mobil
-- ---------------------------------------------------------------------------

create table if not exists public.lub_skus (
  id                    uuid primary key default gen_random_uuid(),
  station_id            uuid references public.stations(id),
  name                  text not null,
  name_bn               text,
  brand                 text,
  pack_type             public.pack_type not null,
  pack_size_litres      numeric(12,3),
  current_purchase_rate numeric(14,2) not null default 0,
  current_sale_rate     numeric(14,2) not null default 0,
  reorder_level         numeric(12,3) not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  updated_at            timestamptz,
  updated_by            uuid references public.profiles(id),
  deleted_at            timestamptz,
  deleted_by            uuid references public.profiles(id),
  delete_reason         text
);

create table if not exists public.lub_transactions (
  id            uuid primary key default gen_random_uuid(),
  sku_id        uuid not null references public.lub_skus(id),
  txn_type      public.lub_txn_type not null,
  qty           numeric(12,3) not null,
  rate          numeric(14,2) not null default 0,
  amount        numeric(14,2) not null default 0,
  shift_id      uuid references public.shifts(id),
  customer_id   uuid,
  vehicle_ref   text,
  note          text,
  txn_at        timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

comment on column public.lub_transactions.txn_type is
  'own_use is oil issued to the station''s own lorries: it reduces stock and '
  'books as an expense, and is never counted as revenue.';

create table if not exists public.lub_stock (
  sku_id       uuid primary key references public.lub_skus(id),
  qty_on_hand  numeric(12,3) not null default 0,
  avg_cost     numeric(14,4) not null default 0,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Credit customers
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  station_id       uuid references public.stations(id),
  name             text not null,
  name_bn          text,
  type             public.customer_type not null default 'company',
  phone            text,
  address          text,
  vehicle_numbers  text[] not null default '{}',
  opening_balance  numeric(14,2) not null default 0,
  credit_limit     numeric(14,2) not null default 0,
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz,
  updated_by       uuid references public.profiles(id),
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles(id),
  delete_reason    text
);

comment on column public.customers.credit_limit is
  'Zero means no limit has been set for this party, not a limit of zero.';

alter table public.lub_transactions
  drop constraint if exists lub_transactions_customer_id_fkey;
alter table public.lub_transactions
  add constraint lub_transactions_customer_id_fkey
  foreign key (customer_id) references public.customers(id);

create table if not exists public.credit_sales (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts(id),
  customer_id    uuid not null references public.customers(id),
  product        public.product_type not null default 'diesel',
  litres         numeric(12,3),
  rate           numeric(14,2),
  amount         numeric(14,2) not null check (amount >= 0),
  vehicle_no     text,
  challan_no     text,
  slip_photo_url text,
  sold_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz,
  updated_by     uuid references public.profiles(id),
  deleted_at     timestamptz,
  deleted_by     uuid references public.profiles(id),
  delete_reason  text
);

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id),
  amount        numeric(14,2) not null check (amount > 0),
  method        public.payment_method not null,
  reference     text,
  slip_url      text,
  received_at   timestamptz not null default now(),
  received_by   uuid references public.profiles(id),
  shift_id      uuid references public.shifts(id),
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

create table if not exists public.customer_ledger (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  entry_date      date not null default (now() at time zone 'Asia/Dhaka')::date,
  entry_at        timestamptz not null default now(),
  entry_type      public.ledger_entry_type not null,
  description     text,
  debit           numeric(14,2) not null default 0 check (debit >= 0),
  credit          numeric(14,2) not null default 0 check (credit >= 0),
  running_balance numeric(14,2) not null default 0,
  source_table    text,
  source_id       uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id)
);

comment on column public.customer_ledger.running_balance is
  'Maintained by trigger on insert. Never recomputed on read.';

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------

create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid references public.stations(id),
  name        text not null,
  name_bn     text,
  "group"     public.expense_group not null default 'pump',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz,
  updated_by  uuid references public.profiles(id),
  unique (station_id, name)
);

create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  station_id     uuid references public.stations(id),
  shift_id       uuid references public.shifts(id),
  category_id    uuid not null references public.expense_categories(id),
  amount         numeric(14,2) not null check (amount > 0),
  description    text,
  description_bn text,
  paid_by        public.paid_by not null default 'cash',
  receipt_url    text,
  spent_at       timestamptz not null default now(),
  approved_by    uuid references public.profiles(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz,
  updated_by     uuid references public.profiles(id),
  deleted_at     timestamptz,
  deleted_by     uuid references public.profiles(id),
  delete_reason  text
);

create table if not exists public.cash_reconciliation (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.shifts(id),
  opening_cash    numeric(14,2) not null default 0,
  cash_sales      numeric(14,2) not null default 0,
  dues_collected  numeric(14,2) not null default 0,
  expenses_cash   numeric(14,2) not null default 0,
  bank_deposits   numeric(14,2) not null default 0,
  expected_cash   numeric(14,2) not null default 0,
  counted_cash    numeric(14,2) not null default 0,
  cash_variance   numeric(14,2) not null default 0,
  variance_reason text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz,
  updated_by      uuid references public.profiles(id),
  unique (shift_id)
);

create table if not exists public.bank_transactions (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  txn_date      date not null,
  bank_name     text not null,
  account_no    text,
  type          public.bank_txn_type not null,
  amount        numeric(14,2) not null check (amount > 0),
  reference     text,
  slip_url      text,
  shift_id      uuid references public.shifts(id),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz,
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  deleted_by    uuid references public.profiles(id),
  delete_reason text
);

-- ---------------------------------------------------------------------------
-- Platform
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id          bigserial primary key,
  table_name  text not null,
  record_id   uuid,
  action      public.audit_action not null,
  before      jsonb,
  after       jsonb,
  actor_id    uuid,
  actor_role  public.user_role,
  reason      text,
  ip          inet,
  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. No update or delete policy exists for any role, including '
  'admin. Written by trigger, never by the application directly.';

create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid references public.stations(id),
  type        text not null,
  severity    public.alert_severity not null default 'warn',
  title       text not null,
  title_bn    text,
  body        text,
  body_bn     text,
  entity_ref  jsonb,
  is_read     boolean not null default false,
  read_at     timestamptz,
  read_by     uuid references public.profiles(id),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null,
  user_id         uuid references public.profiles(id),
  role            public.chat_role not null,
  content         text not null,
  content_lang    public.language_pref,
  audio_url       text,
  n8n_request_id  text,
  created_at      timestamptz not null default now()
);

create table if not exists public.sync_queue (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  payload        jsonb not null,
  idempotency_key text not null,
  status         public.sync_status not null default 'pending',
  attempts       integer not null default 0,
  last_error     text,
  next_attempt_at timestamptz not null default now(),
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  unique (idempotency_key)
);

comment on table public.sync_queue is
  'Outbound mirror to n8n / Google Sheets. A failed sync never blocks or rolls '
  'back the local write — this app is the system of record.';

create table if not exists public.idempotency_keys (
  key         text primary key,
  route       text not null,
  user_id     uuid references public.profiles(id),
  request_hash text,
  response    jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.idempotency_keys is
  'Every mutating API route accepts an Idempotency-Key. A double-tap on the '
  'forecourt returns the first response instead of creating a second record.';
