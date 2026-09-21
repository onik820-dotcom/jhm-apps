-- ============================================================================
-- 0028 — What the chat may ask, and how the mirror drains
--
-- THE ONE DECISION THAT MATTERS HERE
--
-- Every function the assistant can call is SECURITY INVOKER, so Row Level
-- Security decides what comes back. The assistant has no privileges of its
-- own: it runs entirely inside the session of whoever is typing.
--
-- That is not a detail. The alternative — a service-role key querying Supabase
-- on the assistant's behalf — would collapse every role boundary this project
-- has built. A manager who cannot open the Profit & Loss screen could simply
-- ask the chat "ei mash e profit koto?" and be told. Here, the same question
-- makes profit_and_loss() raise insufficient_privilege for them, exactly as it
-- does everywhere else, and the assistant has to say it cannot see that.
--
-- The corollary: the assistant can never write. Nothing below mutates a
-- financial record. A spoken "log this expense" produces a *proposal* the
-- person taps to confirm, and the confirmation goes through the ordinary
-- server action with the ordinary triggers. The model's output is never the
-- write.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Finding a party the way somebody says its name out loud
--
-- "Shah Mamun truck er baki koto ekhon?" — the name arrives transliterated,
-- misspelt, or in Bangla, and may be a vehicle number rather than a name. A
-- trigram match over the English name, the Bangla name and the vehicle list
-- handles all three; an exact `=` would handle none of them.
-- ---------------------------------------------------------------------------
create or replace function public.chat_customer_lookup(p_query text, p_limit integer default 5)
returns table (
  customer_id   uuid,
  name          text,
  name_bn       text,
  balance       numeric,
  credit_limit  numeric,
  is_active     boolean,
  vehicles      text[],
  bucket_90_plus numeric,
  oldest_item_days integer,
  match_score   real
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (select btrim(coalesce(p_query, '')) as term)
  select
    c.id,
    c.name,
    c.name_bn,
    public.customer_balance(c.id),
    c.credit_limit,
    c.is_active,
    c.vehicle_numbers,
    a.bucket_90_plus,
    a.oldest_item_days,
    greatest(
      extensions.similarity(c.name, (select term from q)),
      extensions.similarity(coalesce(c.name_bn, ''), (select term from q)),
      coalesce((
        select max(extensions.similarity(v, (select term from q)))
        from unnest(c.vehicle_numbers) as v
      ), 0)
    ) as score
  from public.customers c
  left join public.customer_ageing() a on a.customer_id = c.id
  where c.deleted_at is null
    and (select term from q) <> ''
    and (
      c.name ilike '%' || (select term from q) || '%'
      or coalesce(c.name_bn, '') ilike '%' || (select term from q) || '%'
      or exists (select 1 from unnest(c.vehicle_numbers) v
                  where v ilike '%' || (select term from q) || '%')
      or extensions.similarity(c.name, (select term from q)) > 0.2
      or extensions.similarity(coalesce(c.name_bn, ''), (select term from q)) > 0.2
    )
  order by score desc, c.name
  limit greatest(1, least(coalesce(p_limit, 5), 20))
$$;

comment on function public.chat_customer_lookup(text, integer) is
  'Fuzzy party search for the assistant: English name, Bangla name or vehicle '
  'number, however it was spelt or transliterated. SECURITY INVOKER, so a role '
  'that cannot read customers gets nothing.';

revoke execute on function public.chat_customer_lookup(text, integer) from anon, public;
grant execute on function public.chat_customer_lookup(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- What is in the tanks right now, and how the last close went
-- ---------------------------------------------------------------------------
create or replace function public.chat_tank_status()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.tank_code), '[]'::jsonb)
  from (
    select
      tk.code as tank_code,
      tk.capacity_litres,
      d.dip_mm            as last_dip_mm,
      d.recorded_at       as last_dip_at,
      public.dip_to_litres(tk.id, d.dip_mm, d.recorded_at) as litres_now,
      s.variance_litres   as last_variance_litres,
      s.variance_pct      as last_variance_pct,
      s.variance_flagged  as last_variance_flagged,
      s.variance_reason   as last_variance_reason,
      sh.shift_date       as last_variance_shift_date,
      sh.shift_type       as last_variance_shift_type
    from public.tanks tk
    left join lateral (
      select td.dip_mm, td.recorded_at
      from public.tank_dips td
      where td.tank_id = tk.id and td.deleted_at is null
      order by td.recorded_at desc
      limit 1
    ) d on true
    left join lateral (
      select ss.variance_litres, ss.variance_pct, ss.variance_flagged,
             ss.variance_reason, ss.shift_id
      from public.shift_stock ss
      join public.shifts x on x.id = ss.shift_id
      where ss.tank_id = tk.id
      order by x.starts_at desc
      limit 1
    ) s on true
    left join public.shifts sh on sh.id = s.shift_id
    where tk.deleted_at is null and tk.status <> 'removed'
  ) t
$$;

revoke execute on function public.chat_tank_status() from anon, public;
grant execute on function public.chat_tank_status() to authenticated;

create or replace function public.chat_shift_status(p_recent integer default 4)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'open', (
      select to_jsonb(o) from (
        select sh.id, sh.shift_date, sh.shift_type, sh.status, sh.starts_at, sh.ends_at
        from public.shifts sh
        where sh.status in ('open', 'closing', 'reopened')
        order by sh.starts_at desc
        limit 1
      ) o),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.starts_at desc)
      from (
        select sh.shift_date, sh.shift_type, sh.status, sh.starts_at,
               sa.net_litres, sa.sales_amount, sa.lubricant_sales,
               sa.cash_sales, sa.credit_sales,
               cr.counted_cash, cr.cash_variance
        from public.shifts sh
        left join public.shift_sales sa on sa.shift_id = sh.id
        left join public.cash_reconciliation cr on cr.shift_id = sh.id
        where sh.status = 'closed'
        order by sh.starts_at desc
        limit greatest(1, least(coalesce(p_recent, 4), 20))
      ) r), '[]'::jsonb))
$$;

revoke execute on function public.chat_shift_status(integer) from anon, public;
grant execute on function public.chat_shift_status(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Draining the outbound mirror
--
-- sync_queue has no insert or update policy for any client — the app writes to
-- it only through enqueue_sync_event(), and only the drainer moves a row on.
-- These three are SECURITY DEFINER for that reason, and each does one narrow
-- thing: claim a batch, mark one sent, mark one failed.
--
-- A failed sync must never touch the local record. The shift closed; Sheets
-- being unreachable is Sheets' problem, and the row waits.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sync_batch(p_limit integer default 20)
returns setof public.sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.sync_queue q
  set attempts = q.attempts + 1,
      next_attempt_at = now() + interval '5 minutes'
  where q.id in (
    select id from public.sync_queue
    where status = 'pending' and next_attempt_at <= now()
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    -- Two drainers running at once must not both take the same row.
    for update skip locked
  )
  returning q.*;
end;
$$;

comment on function public.claim_sync_batch(integer) is
  'Claims due events for one drain pass and bumps attempts immediately, so a '
  'drainer that dies mid-POST cannot leave a row to be retried forever. '
  'SECURITY DEFINER because no client role may write to sync_queue.';

create or replace function public.mark_sync_sent(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.sync_queue
  set status = 'sent', sent_at = now(), last_error = null
  where id = p_id
$$;

create or replace function public.mark_sync_failed(p_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row      public.sync_queue;
  v_max      integer := public.setting_numeric('sync_max_attempts', 5)::integer;
  v_give_up  boolean;
  v_backoff  interval;
begin
  select * into v_row from public.sync_queue where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('found', false);
  end if;

  v_give_up := v_row.attempts >= v_max;

  -- Exponential: 1, 2, 4, 8, 16 minutes.
  v_backoff := (power(2, greatest(0, v_row.attempts - 1)) || ' minutes')::interval;

  update public.sync_queue
  set status = case when v_give_up then 'failed'::public.sync_status else 'pending'::public.sync_status end,
      last_error = left(coalesce(p_error, ''), 1000),
      next_attempt_at = now() + v_backoff
  where id = p_id;

  -- Giving up is not a silent event. The admin is told the mirror has stopped
  -- keeping up, because the local record is now ahead of Sheets.
  if v_give_up then
    insert into public.alerts (station_id, type, severity, title, title_bn, body, entity_ref)
    values (
      (select id from public.stations limit 1),
      'sync.failed', 'critical',
      format('Sync gave up on %s after %s attempts', v_row.event_type, v_row.attempts),
      format('%s সিঙ্ক %s বার চেষ্টার পর ব্যর্থ', v_row.event_type, v_row.attempts),
      left(coalesce(p_error, ''), 500),
      jsonb_build_object('sync_queue_id', v_row.id, 'event_type', v_row.event_type,
                         'idempotency_key', v_row.idempotency_key));
  end if;

  return jsonb_build_object('found', true, 'gave_up', v_give_up, 'attempts', v_row.attempts);
end;
$$;

revoke execute on function public.claim_sync_batch(integer) from anon, public, authenticated;
revoke execute on function public.mark_sync_sent(uuid) from anon, public, authenticated;
revoke execute on function public.mark_sync_failed(uuid, text) from anon, public, authenticated;
grant execute on function public.claim_sync_batch(integer) to service_role;
grant execute on function public.mark_sync_sent(uuid) to service_role;
grant execute on function public.mark_sync_failed(uuid, text) to service_role;

-- A view of the mirror's health, for the admin screen. Readable by admin only,
-- through the existing sync_queue policy.
create or replace function public.sync_health()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'failed',  count(*) filter (where status = 'failed'),
    'sent',    count(*) filter (where status = 'sent'),
    'oldest_pending', min(created_at) filter (where status = 'pending'))
  from public.sync_queue
$$;

revoke execute on function public.sync_health() from anon, public;
grant execute on function public.sync_health() to authenticated;
