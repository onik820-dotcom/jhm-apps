-- ============================================================================
-- 0005 — Audit trail
--
-- Every insert, update and delete on a financial table is recorded with the
-- full before and after image, the actor and their role. The audit log is
-- append-only: no role, including admin, has an update or delete policy on it.
--
-- Deletes are soft. A hard DELETE is refused outright by trigger, so even a
-- service-role key or a stray SQL console cannot erase history.
-- ============================================================================

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action public.audit_action;
  v_before jsonb;
  v_after  jsonb;
  v_record uuid;
  v_reason text := nullif(current_setting('app.audit_reason', true), '');
  v_ip     inet;
begin
  begin
    v_ip := nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', '')::inet;
  exception when others then
    v_ip := null;
  end;

  if tg_op = 'INSERT' then
    v_action := 'insert';
    v_after := to_jsonb(new);
    v_record := (v_after ->> 'id')::uuid;
  elsif tg_op = 'UPDATE' then
    v_action := 'update';
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_record := (v_after ->> 'id')::uuid;
    -- A soft delete carries its own reason column; prefer it over the session one.
    if (v_after ? 'delete_reason') and (v_after ->> 'deleted_at') is not null
       and (v_before ->> 'deleted_at') is null then
      v_reason := coalesce(v_after ->> 'delete_reason', v_reason);
    end if;
  else
    v_action := 'delete';
    v_before := to_jsonb(old);
    v_record := (v_before ->> 'id')::uuid;
  end if;

  insert into public.audit_log (table_name, record_id, action, before, after, actor_id, actor_role, reason, ip)
  values (tg_table_name, v_record, v_action, v_before, v_after, auth.uid(), public.jhm_role(), v_reason, v_ip);

  return coalesce(new, old);
end;
$$;

-- A hard delete is never the right answer in this system. Reversals and soft
-- deletes are; they keep the number that was there before.
create or replace function public.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_hard_delete', true), 'off') = 'on' then
    return old;
  end if;
  raise exception
    'Records in % are never hard-deleted. Set deleted_at, deleted_by and delete_reason instead.',
    tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

do $$
declare
  t text;
  audited text[] := array[
    'profiles','settings','tanks','tank_metadata','tank_calibration','dispensers','nozzles',
    'shifts','meter_readings','tank_dips','shift_sales','shift_stock',
    'purchase_orders','tanker_deliveries','tanker_compartments','tank_cost_history',
    'lub_skus','lub_transactions','customers','credit_sales','payments','customer_ledger',
    'expense_categories','expenses','cash_reconciliation','bank_transactions'
  ];
  -- Tables that must never lose a row, even to a service-role key.
  protected text[] := array[
    'tank_calibration','shifts','meter_readings','tank_dips','shift_sales','shift_stock',
    'tanker_deliveries','tanker_compartments','tank_cost_history','lub_transactions',
    'credit_sales','payments','customer_ledger','expenses','cash_reconciliation','bank_transactions'
  ];
begin
  foreach t in array audited loop
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function public.audit_trigger()', t);
  end loop;

  foreach t in array protected loop
    execute format('drop trigger if exists trg_no_delete_%1$s on public.%1$I', t);
    execute format(
      'create trigger trg_no_delete_%1$s before delete on public.%1$I
       for each row execute function public.prevent_hard_delete()', t);
  end loop;
end $$;

-- The audit log itself is immutable.
create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The audit log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists trg_audit_log_immutable on public.audit_log;
create trigger trg_audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();

-- Set the reason for the edit about to be made, so the audit row carries it.
-- The API route calls this immediately before an update within the same
-- transaction.
create or replace function public.set_audit_reason(p_reason text)
returns void
language sql
volatile
as $$
  select set_config('app.audit_reason', coalesce(p_reason, ''), true)
$$;
