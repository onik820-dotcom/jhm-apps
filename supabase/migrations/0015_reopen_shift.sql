-- ============================================================================
-- 0015 — Reopening a closed shift
--
-- Admin only, reason required. Reopening does not itself rewrite anything: the
-- manager corrects the figures and closes the shift again, and then
-- recalculate_from() rebuilds every later shift, whose opening stock will have
-- moved with the correction.
--
-- Note on history: this migration was applied together with the first version
-- of close_shift(), which 0017 replaced a few minutes later. Only the final
-- close_shift() is kept, in 0017, so a fresh database ends up in exactly the
-- state the live one is in without carrying a superseded definition.
-- ============================================================================

create or replace function public.reopen_shift(p_shift_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_shift public.shifts;
  v_later integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may reopen a closed shift'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Reopening a shift needs a reason' using errcode = 'check_violation';
  end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if v_shift.id is null then
    raise exception 'Unknown shift %', p_shift_id using errcode = 'no_data_found';
  end if;
  if v_shift.status <> 'closed' then
    raise exception 'That shift is not closed' using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_reason', p_reason, true);

  update public.shifts
  set status = 'reopened', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = p_reason
  where id = p_shift_id;

  select count(*) into v_later
  from public.shifts s where s.starts_at > v_shift.starts_at and s.status = 'closed';

  return jsonb_build_object(
    'reopened', true,
    'shift_id', p_shift_id,
    'later_closed_shifts', v_later,
    'note', 'Correct the figures, close it again, then run recalculate_from() for the later shifts.');
end;
$$;

revoke execute on function public.reopen_shift(uuid, text) from anon, public;
grant execute on function public.reopen_shift(uuid, text) to authenticated;
