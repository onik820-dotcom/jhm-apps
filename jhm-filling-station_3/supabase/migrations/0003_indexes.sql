-- ============================================================================
-- 0003 — Indexes
-- ============================================================================

-- The calibration lookup runs on every dip entry and every refill compartment.
create index if not exists idx_tank_calibration_lookup
  on public.tank_calibration (tank_id, version, dip_mm);
create index if not exists idx_tank_calibration_validity
  on public.tank_calibration (tank_id, valid_from, valid_to);

create index if not exists idx_meter_readings_shift_nozzle
  on public.meter_readings (shift_id, nozzle_id);
create index if not exists idx_meter_readings_nozzle_time
  on public.meter_readings (nozzle_id, created_at desc);
create unique index if not exists uq_meter_readings_client_ref
  on public.meter_readings (client_ref) where client_ref is not null;

create index if not exists idx_tank_dips_shift_tank
  on public.tank_dips (shift_id, tank_id);
create index if not exists idx_tank_dips_tank_time
  on public.tank_dips (tank_id, recorded_at desc);
create unique index if not exists uq_tank_dips_client_ref
  on public.tank_dips (client_ref) where client_ref is not null;

create index if not exists idx_customer_ledger_customer_date
  on public.customer_ledger (customer_id, entry_date);
create index if not exists idx_customer_ledger_customer_entry_at
  on public.customer_ledger (customer_id, entry_at desc);

create index if not exists idx_shift_stock_tank_shift
  on public.shift_stock (tank_id, shift_id);

create index if not exists idx_expenses_shift on public.expenses (shift_id);
create index if not exists idx_expenses_category_date on public.expenses (category_id, spent_at);

create index if not exists idx_credit_sales_customer_shift
  on public.credit_sales (customer_id, shift_id);
create index if not exists idx_credit_sales_shift on public.credit_sales (shift_id);

create index if not exists idx_shifts_date_type on public.shifts (shift_date desc, shift_type);
create index if not exists idx_shifts_status on public.shifts (status) where status <> 'closed';
create index if not exists idx_shifts_starts_at on public.shifts (starts_at desc);

create index if not exists idx_payments_customer on public.payments (customer_id, received_at desc);
create index if not exists idx_lub_transactions_sku on public.lub_transactions (sku_id, txn_at desc);
create index if not exists idx_lub_transactions_shift on public.lub_transactions (shift_id);

create index if not exists idx_tanker_compartments_delivery
  on public.tanker_compartments (delivery_id);
create index if not exists idx_tanker_deliveries_arrived
  on public.tanker_deliveries (arrived_at desc);
create index if not exists idx_tank_cost_history_tank
  on public.tank_cost_history (tank_id, effective_at desc);

create index if not exists idx_audit_log_record on public.audit_log (table_name, record_id, created_at desc);
create index if not exists idx_audit_log_actor on public.audit_log (actor_id, created_at desc);

create index if not exists idx_alerts_open
  on public.alerts (created_at desc) where resolved_at is null;
create index if not exists idx_chat_messages_session on public.chat_messages (session_id, created_at);
create index if not exists idx_sync_queue_pending
  on public.sync_queue (next_attempt_at) where status = 'pending';

create index if not exists idx_customers_name_trgm
  on public.customers using gin (name gin_trgm_ops);
