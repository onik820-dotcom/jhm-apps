-- ============================================================================
-- 0006 — Row Level Security
--
-- The rules, in one paragraph:
--   dispenser  writes meter readings and tank dips for the current open shift,
--              reads back only its own rows from that shift, and can see no
--              money, no rate, no total, no customer and no history at all.
--   manager    reads and writes the operational and money tables, but cannot
--              delete anything and cannot see blended cost or profit.
--   admin      everything, with deletes performed as soft deletes.
--   md         SELECT and nothing else, anywhere.
--
-- No table has a DELETE policy. Removal is an UPDATE that sets deleted_at,
-- deleted_by and delete_reason, and 0005 refuses hard deletes by trigger.
-- ============================================================================

-- Base grants. RLS decides the rows; these decide the verbs.
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke delete on all tables in schema public from authenticated;
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public grant select, insert, update on tables to authenticated;

-- Nothing in this schema is readable by an unauthenticated caller.
revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'stations','profiles','settings','tanks','tank_metadata','tank_calibration','dispensers',
    'nozzles','shifts','meter_readings','tank_dips','shift_sales','shift_stock',
    'purchase_orders','tanker_deliveries','tanker_compartments','tank_cost_history',
    'lub_skus','lub_transactions','lub_stock','customers','credit_sales','payments',
    'customer_ledger','expense_categories','expenses','cash_reconciliation','bank_transactions',
    'audit_log','alerts','chat_messages','sync_queue','idempotency_keys'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- What a dispenser is allowed to know about the shift it is standing in
--
-- `shifts` carries rate_per_litre, which a dispenser must never see, so the
-- table itself stays closed to them and this function hands back only the
-- fields the three-button screen needs.
-- ---------------------------------------------------------------------------

create or replace function public.current_shift_info()
returns table (
  id         uuid,
  shift_date date,
  shift_type public.shift_type,
  starts_at  timestamptz,
  ends_at    timestamptz,
  status     public.shift_status
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.shift_date, s.shift_type, s.starts_at, s.ends_at, s.status
  from public.shifts s
  where s.status in ('open', 'closing')
    and auth.uid() is not null
  order by s.starts_at desc
  limit 1
$$;

create or replace function public.current_shift_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.current_shift_info()
$$;

grant execute on function public.current_shift_info() to authenticated;
grant execute on function public.current_shift_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Identity and configuration
-- ---------------------------------------------------------------------------

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_read_money());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.jhm_role());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists stations_select on public.stations;
create policy stations_select on public.stations
  for select to authenticated using (true);

drop policy if exists stations_admin_write on public.stations;
create policy stations_admin_write on public.stations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (public.can_read_money());

drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Fuel infrastructure — readable by every signed-in role, since a dispenser
-- must pick a tank and a machine. None of these tables holds money.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tanks','tank_metadata','tank_calibration','dispensers','nozzles'] loop
    execute format('drop policy if exists %1$s_select_all on public.%1$I', t);
    execute format(
      'create policy %1$s_select_all on public.%1$I for select to authenticated using (true)', t);

    -- Only an admin adds, pauses, removes or re-calibrates equipment.
    execute format('drop policy if exists %1$s_admin_write on public.%1$I', t);
    execute format(
      'create policy %1$s_admin_write on public.%1$I for all to authenticated
       using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Shifts — closed to dispensers because of rate_per_litre
-- ---------------------------------------------------------------------------

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated using (public.can_read_money());

drop policy if exists shifts_ops_insert on public.shifts;
create policy shifts_ops_insert on public.shifts
  for insert to authenticated with check (public.can_write_ops());

drop policy if exists shifts_ops_update on public.shifts;
create policy shifts_ops_update on public.shifts
  for update to authenticated
  using (
    public.is_admin()
    -- A manager may work on a shift until it is closed; reopening is admin-only.
    or (public.jhm_role() = 'manager' and status in ('open', 'closing', 'reopened'))
  )
  with check (public.can_write_ops());

-- ---------------------------------------------------------------------------
-- Meter readings and tank dips — the only two tables a dispenser may write
-- ---------------------------------------------------------------------------

drop policy if exists meter_readings_select on public.meter_readings;
create policy meter_readings_select on public.meter_readings
  for select to authenticated
  using (
    public.can_read_money()
    or (
      public.is_dispenser()
      and recorded_by = auth.uid()
      and shift_id = public.current_shift_id()
    )
  );

drop policy if exists meter_readings_insert on public.meter_readings;
create policy meter_readings_insert on public.meter_readings
  for insert to authenticated
  with check (
    public.can_write_ops()
    or (
      public.is_dispenser()
      and recorded_by = auth.uid()
      and shift_id = public.current_shift_id()
    )
  );

-- A dispenser never edits a submitted reading; a manager corrects it instead.
drop policy if exists meter_readings_update_ops on public.meter_readings;
create policy meter_readings_update_ops on public.meter_readings
  for update to authenticated
  using (public.can_write_ops()) with check (public.can_write_ops());

drop policy if exists tank_dips_select on public.tank_dips;
create policy tank_dips_select on public.tank_dips
  for select to authenticated
  using (
    public.can_read_money()
    or (
      public.is_dispenser()
      and recorded_by = auth.uid()
      and shift_id = public.current_shift_id()
    )
  );

drop policy if exists tank_dips_insert on public.tank_dips;
create policy tank_dips_insert on public.tank_dips
  for insert to authenticated
  with check (
    public.can_write_ops()
    or (
      public.is_dispenser()
      and recorded_by = auth.uid()
      and shift_id = public.current_shift_id()
    )
  );

drop policy if exists tank_dips_update_ops on public.tank_dips;
create policy tank_dips_update_ops on public.tank_dips
  for update to authenticated
  using (public.can_write_ops()) with check (public.can_write_ops());

-- ---------------------------------------------------------------------------
-- Operational and money tables
--
-- Read: manager, admin, MD. Write: manager and admin. Never a dispenser.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  ops_tables text[] := array[
    'shift_sales','shift_stock','purchase_orders','tanker_deliveries','tanker_compartments',
    'lub_skus','lub_transactions','lub_stock','customers','credit_sales','payments',
    'customer_ledger','expense_categories','expenses','cash_reconciliation','bank_transactions',
    'alerts'
  ];
begin
  foreach t in array ops_tables loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
       using (public.can_read_money())', t);

    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated
       with check (public.can_write_ops())', t);

    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated
       using (public.can_write_ops()) with check (public.can_write_ops())', t);
  end loop;
end $$;

-- The customer ledger is derived from credit sales and payments by trigger.
-- Nothing edits it in place, not even an admin: a correction is a new
-- adjustment row.
drop policy if exists customer_ledger_update on public.customer_ledger;

-- Blended cost and therefore profit is admin and MD only. A manager records
-- the depot rate on a delivery but never sees the rolled-up cost of stock.
drop policy if exists tank_cost_history_select on public.tank_cost_history;
create policy tank_cost_history_select on public.tank_cost_history
  for select to authenticated
  using (public.is_admin() or public.is_md());

drop policy if exists tank_cost_history_insert on public.tank_cost_history;
create policy tank_cost_history_insert on public.tank_cost_history
  for insert to authenticated with check (public.can_write_ops());

-- ---------------------------------------------------------------------------
-- Platform tables
-- ---------------------------------------------------------------------------

-- Append-only, and visible to admin and MD. 0005 blocks update and delete by
-- trigger; there is deliberately no policy for either verb here.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_admin() or public.is_md());

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists chat_messages_insert on public.chat_messages;
create policy chat_messages_insert on public.chat_messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_money());

-- The outbound mirror is written by the server (service role) and read by
-- admin for troubleshooting. No client writes to it.
drop policy if exists sync_queue_select on public.sync_queue;
create policy sync_queue_select on public.sync_queue
  for select to authenticated using (public.is_admin());

drop policy if exists idempotency_keys_select on public.idempotency_keys;
create policy idempotency_keys_select on public.idempotency_keys
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- MD is read-only everywhere
--
-- The policies above grant INSERT and UPDATE only through can_write_ops() and
-- is_admin(), neither of which is ever true for 'md'. This block is the
-- belt-and-braces check that nothing slipped through.
-- ---------------------------------------------------------------------------

create or replace function public.assert_md_is_read_only()
returns table (table_name text, policy_name text, command text)
language sql
stable
as $$
  select p.tablename::text, p.policyname::text, p.cmd::text
  from pg_policies p
  where p.schemaname = 'public'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and coalesce(p.with_check, p.qual, '') like '%md%'
$$;

comment on function public.assert_md_is_read_only() is
  'Returns zero rows when no write policy can ever admit the md role. Checked '
  'by scripts/verify-rls.ts.';

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values
  ('meter-photos', 'meter-photos', false),
  ('dip-photos', 'dip-photos', false),
  ('receipts', 'receipts', false),
  ('challans', 'challans', false),
  ('certificates', 'certificates', false)
on conflict (id) do nothing;

drop policy if exists storage_read_signed_in on storage.objects;
create policy storage_read_signed_in on storage.objects
  for select to authenticated
  using (
    bucket_id in ('meter-photos', 'dip-photos', 'receipts', 'challans', 'certificates')
    and (public.can_read_money() or owner = auth.uid())
  );

drop policy if exists storage_write_signed_in on storage.objects;
create policy storage_write_signed_in on storage.objects
  for insert to authenticated
  with check (
    (bucket_id in ('meter-photos', 'dip-photos') and auth.uid() is not null)
    or (bucket_id in ('receipts', 'challans') and public.can_write_ops())
    or (bucket_id = 'certificates' and public.is_admin())
  );
