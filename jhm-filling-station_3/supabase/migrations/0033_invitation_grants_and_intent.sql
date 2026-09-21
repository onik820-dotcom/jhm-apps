-- ============================================================================
-- 0033 — Who may call the new functions, and why they are SECURITY DEFINER
--
-- Postgres grants EXECUTE on a new function to PUBLIC unless told otherwise,
-- and PUBLIC includes `anon`. So `grant execute … to authenticated` in 0031
-- and 0032 added nothing: the functions were already callable by anyone with
-- the publishable key.
--
-- Every one of them refuses an anon caller on its own — is_admin() is false
-- without a session, and list_people() has that test inside its WHERE clause,
-- so it returns an empty set rather than a roster. Nothing leaked. But an API
-- surface that says "anyone may call this" while the function says "only an
-- admin" is a disagreement, and the next person to read it has to work out
-- which one is the rule. This makes them agree.
-- ============================================================================

revoke execute on function public.create_invitation(text, public.user_role, text, text, text, integer) from public, anon;
revoke execute on function public.revoke_invitation(uuid, text) from public, anon;
revoke execute on function public.list_people() from public, anon;
revoke execute on function public.set_person_active(uuid, boolean, text) from public, anon;

grant execute on function public.create_invitation(text, public.user_role, text, text, text, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid, text) to authenticated;
grant execute on function public.list_people() to authenticated;
grant execute on function public.set_person_active(uuid, boolean, text) to authenticated;

-- invitation_preview and accept_invitation stay open to anon on purpose: the
-- person holding the link has no session, and giving them one is the entire
-- job. Both are guarded by a 256-bit token they must already hold, both read
-- the email and the role off the invitation row rather than the request, and
-- accept_invitation takes the row FOR UPDATE so one link makes one account.
revoke execute on function public.invitation_preview(text) from public;
revoke execute on function public.accept_invitation(text, text, text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The written record, in the same place as migrations 0012 and 0022.
-- ---------------------------------------------------------------------------

comment on function public.provision_account(text, text, public.user_role, text, text, text, uuid) is
  'SECURITY DEFINER: writes auth.users, auth.identities and public.profiles, none of which a signed-in role may touch. Takes a role as an argument, so it is granted to nobody and is reachable only from accept_invitation and from a migration.';

comment on function public.create_invitation(text, public.user_role, text, text, text, integer) is
  'SECURITY DEFINER: checks auth.users for an existing account, which no client role may read. Admin-only, and refuses any role but manager or dispenser.';

comment on function public.revoke_invitation(uuid, text) is
  'SECURITY DEFINER: the invitations table has a select policy and no write policy, so every write goes through a guarded function. Admin-only, and needs a reason.';

comment on function public.invitation_preview(text) is
  'SECURITY DEFINER, anon-callable on purpose: the invitee has no session. Answers only for a live token, and says nothing at all for one that is wrong, spent or expired.';

comment on function public.accept_invitation(text, text, text) is
  'SECURITY DEFINER, anon-callable on purpose: this is what gives the invitee an account. Email and role come off the locked invitation row, never off the request.';

comment on function public.list_people() is
  'SECURITY DEFINER: joins profiles to auth.users for the email, which PostgREST does not expose. Admin-only, enforced inside the query.';

comment on function public.set_person_active(uuid, boolean, text) is
  'SECURITY DEFINER: writes profiles.is_active past RLS. Admin-only, needs a reason, and refuses to switch off the caller''s own account.';
