-- ============================================================================
-- 0012 — Why four functions stay SECURITY DEFINER
--
-- The Supabase linter flags every SECURITY DEFINER function a signed-in user
-- can call. These four are deliberate; the comments record why, so a later
-- reviewer does not "fix" them and open a hole or break a role.
-- ============================================================================

comment on function public.jhm_role() is
  'SECURITY DEFINER on purpose: policies on other tables must be able to ask '
  'for the caller''s role without re-entering the policies on `profiles`, '
  'which would recurse. It reads exactly one row — the caller''s own — and '
  'returns only the role, so a signed-in user learns nothing they do not '
  'already know about themselves.';

comment on function public.current_shift_info() is
  'SECURITY DEFINER on purpose: a dispenser must know which shift they are '
  'standing in, but `shifts` carries rate_per_litre and no dispenser may see a '
  'rate, so that table stays closed to them. This returns only the id, date, '
  'type, start, end and status — no money of any kind — and returns nothing at '
  'all to a caller who is not signed in.';

comment on function public.current_shift_id() is
  'SECURITY DEFINER on purpose, for the same reason as current_shift_info(). '
  'The RLS policies on meter_readings and tank_dips call it to confirm a '
  'dispenser is writing to the shift they are actually working.';

comment on function public.recalculate_from(uuid) is
  'SECURITY DEFINER on purpose: rewriting the book chain means standing the '
  'chain-guard trigger down for the transaction, which an ordinary caller '
  'cannot do. Its first statement refuses anyone who is not an admin, so the '
  'elevated rights are unreachable without that role.';
