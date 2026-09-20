-- ============================================================================
-- 0032 — The roster
--
-- profiles carries the name and the role; the email lives in auth.users, which
-- PostgREST does not expose and should not. An admin looking at "who can get
-- into this system" needs both in one list, so this is the one place the two
-- are joined, behind an admin check.
--
-- last_sign_in_at is on the list deliberately. An account nobody has used for
-- three months is either a person who left or a password somebody shared, and
-- neither is visible from the profile alone.
-- ============================================================================

create or replace function public.list_people()
returns table (
  id             uuid,
  full_name      text,
  full_name_bn   text,
  email          text,
  phone          text,
  role           public.user_role,
  is_active      boolean,
  created_at     timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select p.id, p.full_name, p.full_name_bn, u.email::text, p.phone,
         p.role, p.is_active, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.deleted_at is null
    and public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'md' then 1 when 'manager' then 2 else 3 end,
    p.full_name;
$fn$;

/**
 * Turn an account off, or back on.
 *
 * Not a delete: the person's name is on shift closes, dips and ledger entries
 * going back months, and those rows have to keep pointing at a real profile.
 * is_active = false is what "no longer works here" looks like — the middleware
 * refuses the session on the next request, and every RLS policy stops seeing
 * them as anybody.
 *
 * Nobody may switch themselves off. An admin who did would be locked out with
 * no way back in, since the only people who can reverse it are admins.
 */
create or replace function public.set_person_active(
  p_id     uuid,
  p_active boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Only an admin may activate or deactivate an account'
      using errcode = 'insufficient_privilege';
  end if;

  if p_id = auth.uid() then
    raise exception 'You cannot switch off your own account'
      using errcode = 'check_violation';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why this account is changing'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.profiles p
     set is_active = p_active, updated_at = now(), updated_by = auth.uid()
   where p.id = p_id and p.deleted_at is null;

  if not found then
    raise exception 'No such account' using errcode = 'no_data_found';
  end if;
end;
$fn$;

grant execute on function public.list_people() to authenticated;
grant execute on function public.set_person_active(uuid, boolean, text) to authenticated;
