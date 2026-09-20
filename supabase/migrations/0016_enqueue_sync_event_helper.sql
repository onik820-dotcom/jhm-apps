-- ============================================================================
-- 0016 — Queueing an outbound event
--
-- close_shift() runs as the caller so that every financial write it makes is
-- still checked by RLS. The outbound mirror is different: `sync_queue` is
-- internal plumbing with no insert policy for anyone, which is right — no
-- client should be able to post arbitrary events to n8n.
--
-- So the enqueue goes through this one narrow SECURITY DEFINER helper. It can
-- write to `sync_queue` and nothing else, and it still refuses a caller who is
-- not a manager or an admin.
-- ============================================================================

create or replace function public.enqueue_sync_event(
  p_event_type      text,
  p_payload         jsonb,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_write_ops() then
    raise exception 'Not allowed to queue an event' using errcode = 'insufficient_privilege';
  end if;

  insert into public.sync_queue (event_type, payload, idempotency_key, created_by)
  values (p_event_type, p_payload, p_idempotency_key, auth.uid())
  on conflict (idempotency_key) do nothing;
end;
$$;

comment on function public.enqueue_sync_event(text, jsonb, text) is
  'The only way a client-side transaction can add to the outbound n8n queue. '
  'SECURITY DEFINER because sync_queue has no insert policy by design; it can '
  'touch nothing else, and still checks the caller''s role.';

revoke execute on function public.enqueue_sync_event(text, jsonb, text) from anon, public;
grant execute on function public.enqueue_sync_event(text, jsonb, text) to authenticated;
