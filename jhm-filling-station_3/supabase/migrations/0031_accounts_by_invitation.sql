-- ============================================================================
-- 0031 — Accounts by invitation
--
-- Until now every account was made by hand, which does not survive contact
-- with a station that hires. An admin needs to be able to say "Rafiq is the
-- new night manager" without anyone typing a password into a chat message.
--
-- The shape is the ordinary one: the admin creates an invitation, the system
-- returns a single-use link, and the person at the other end chooses their own
-- password. The admin never learns it. The role is fixed at the moment the
-- invitation is written and is read from the invitation row at acceptance —
-- never from whatever the browser posts — so a link for an employee cannot be
-- turned into a manager account by editing a form field.
--
-- Only manager and dispenser can be invited. An admin account can read the
-- audit log and the profit figures, and an MD account is the owner's own
-- window on the business; neither is something that should follow from
-- possession of a URL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The invitation
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invitation_status') then
    create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
  end if;
end;
$$;

create table if not exists public.user_invitations (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid references public.stations(id),
  email         text not null,
  role          public.user_role not null,
  full_name     text not null,
  full_name_bn  text,
  phone         text,
  -- The link is a secret, so only its sha256 lives here. A stolen backup of
  -- this table cannot be turned back into a working invitation.
  token_hash    text not null unique,
  status        public.invitation_status not null default 'pending',
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id),
  revoked_at    timestamptz,
  revoked_by    uuid references public.profiles(id),
  revoke_reason text,
  constraint user_invitations_role_is_invitable
    check (role in ('manager', 'dispenser'))
);

create unique index if not exists user_invitations_one_pending_per_email
  on public.user_invitations (lower(email))
  where status = 'pending';

create index if not exists user_invitations_status_created
  on public.user_invitations (status, created_at desc);

comment on table public.user_invitations is
  'Outstanding and spent invitations to join the station. The raw link is shown once, at creation, and never stored.';

alter table public.user_invitations enable row level security;

-- Admin reads them; nobody else sees that they exist. Every write goes through
-- the functions below, which is why there is no insert or update policy.
drop policy if exists "admin reads invitations" on public.user_invitations;
create policy "admin reads invitations"
  on public.user_invitations for select to authenticated
  using (public.is_admin());

drop trigger if exists audit_user_invitations on public.user_invitations;
create trigger audit_user_invitations
  after insert or update or delete on public.user_invitations
  for each row execute function public.audit_trigger();

drop trigger if exists no_hard_delete_user_invitations on public.user_invitations;
create trigger no_hard_delete_user_invitations
  before delete on public.user_invitations
  for each row execute function public.prevent_hard_delete();

-- ---------------------------------------------------------------------------
-- Making the account itself
-- ---------------------------------------------------------------------------

/**
 * Create a signed-in-able account and its profile in one transaction.
 *
 * Not callable from the API. It is the shared body of the invitation flow and
 * the seeding of the station's first accounts, and nothing else may reach it —
 * it takes a role as an argument, so an exposed version would be a way to mint
 * an admin.
 *
 * The eight empty strings that look like padding are not padding. GoTrue scans
 * confirmation_token, recovery_token, email_change_token_new and email_change
 * into non-nullable Go strings, and a NULL in any of them makes every sign-in
 * for that account fail with "Database error querying schema" — an error that
 * names neither the column nor the user. The other four are filled against the
 * same class of failure.
 */
create or replace function public.provision_account(
  p_email        text,
  p_password     text,
  p_role         public.user_role,
  p_full_name    text,
  p_full_name_bn text default null,
  p_phone        text default null,
  p_created_by   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'That is not an email address: %', p_email
      using errcode = 'check_violation';
  end if;

  if length(coalesce(p_password, '')) < 10 then
    raise exception 'A password for this system is at least 10 characters'
      using errcode = 'check_violation';
  end if;

  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'An account needs a name on it' using errcode = 'check_violation';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'An account already exists for %', v_email
      using errcode = 'unique_violation';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    now(), now(),
    '', '', '', '', '', '', '', '', false, false
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object(
      'sub', v_id::text, 'email', v_email,
      'email_verified', true, 'phone_verified', false
    ),
    'email', now(), now()
  );

  insert into public.profiles (
    id, station_id, full_name, full_name_bn, phone, role, is_active, created_by
  ) values (
    v_id, (select s.id from public.stations s order by s.id limit 1),
    btrim(p_full_name), nullif(btrim(coalesce(p_full_name_bn, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''), p_role, true, p_created_by
  );

  return v_id;
end;
$fn$;

revoke all on function public.provision_account(
  text, text, public.user_role, text, text, text, uuid
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin side
-- ---------------------------------------------------------------------------

/** Write an invitation and return its link exactly once. */
create or replace function public.create_invitation(
  p_email        text,
  p_role         public.user_role,
  p_full_name    text,
  p_full_name_bn text default null,
  p_phone        text default null,
  p_valid_days   integer default 7
)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  v_email   text := lower(btrim(p_email));
  v_token   text;
  v_id      uuid;
  v_expires timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may invite someone to this station'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role not in ('manager', 'dispenser') then
    raise exception
      'An invitation link may only create a manager or an employee. An admin or MD account is made deliberately, not by whoever holds a URL.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'That is not an email address: %', p_email
      using errcode = 'check_violation';
  end if;

  if coalesce(btrim(p_full_name), '') = '' then
    raise exception 'Say who the invitation is for' using errcode = 'check_violation';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'There is already an account for %', v_email
      using errcode = 'unique_violation';
  end if;

  -- Re-inviting the same person replaces the outstanding link rather than
  -- leaving two live ones, so the older mail stops working.
  update public.user_invitations i
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'Replaced by a newer invitation'
   where lower(i.email) = v_email and i.status = 'pending';

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 7), 30)));

  insert into public.user_invitations (
    station_id, email, role, full_name, full_name_bn, phone,
    token_hash, expires_at, created_by
  ) values (
    (select s.id from public.stations s order by s.id limit 1),
    v_email, p_role, btrim(p_full_name),
    nullif(btrim(coalesce(p_full_name_bn, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expires, auth.uid()
  )
  returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$fn$;

/** Cancel an outstanding invitation. Needs a reason, like every other undo. */
create or replace function public.revoke_invitation(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.is_admin() then
    raise exception 'Only an admin may cancel an invitation'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Cancelling an invitation needs a reason'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_reason', btrim(p_reason), true);

  update public.user_invitations i
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = btrim(p_reason)
   where i.id = p_id and i.status = 'pending';

  if not found then
    raise exception 'That invitation is not outstanding — it was already used or cancelled'
      using errcode = 'no_data_found';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Invitee side — reachable without a session, because the invitee has none
-- ---------------------------------------------------------------------------

/**
 * What the link is for, so the join page can greet the person by name.
 *
 * Returns nothing at all for a token that is wrong, spent or expired. There is
 * no enumeration risk in answering: the token is 256 bits of randomness, and
 * nothing here is reachable without holding it.
 */
create or replace function public.invitation_preview(p_token text)
returns table (email text, role public.user_role, full_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $fn$
  select i.email, i.role, i.full_name, i.expires_at
  from public.user_invitations i
  where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and i.status = 'pending'
    and i.expires_at > now();
$fn$;

/**
 * Spend the invitation and create the account.
 *
 * Email and role come off the invitation row, never off the request, and the
 * row is locked for the length of the transaction so the same link cannot be
 * opened twice in two tabs and make two accounts.
 */
create or replace function public.accept_invitation(
  p_token    text,
  p_password text,
  p_phone    text default null
)
returns table (email text, role public.user_role)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $fn$
declare
  inv    public.user_invitations%rowtype;
  v_user uuid;
begin
  select * into inv
    from public.user_invitations i
   where i.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     for update;

  if not found then
    raise exception 'That invitation link is not valid'
      using errcode = 'invalid_authorization_specification';
  end if;

  if inv.status <> 'pending' then
    raise exception 'That invitation has already been used or cancelled'
      using errcode = 'invalid_authorization_specification';
  end if;

  if inv.expires_at <= now() then
    update public.user_invitations i
       set status = 'revoked', revoked_at = now(),
           revoke_reason = 'Expired without being used'
     where i.id = inv.id;
    raise exception 'That invitation expired on %. Ask the admin for a new link.',
      to_char(inv.expires_at at time zone 'Asia/Dhaka', 'DD Mon YYYY')
      using errcode = 'invalid_authorization_specification';
  end if;

  v_user := public.provision_account(
    inv.email, p_password, inv.role, inv.full_name, inv.full_name_bn,
    coalesce(nullif(btrim(coalesce(p_phone, '')), ''), inv.phone), inv.created_by
  );

  update public.user_invitations i
     set status = 'accepted', accepted_at = now(), accepted_by = v_user
   where i.id = inv.id;

  return query select inv.email, inv.role;
end;
$fn$;

grant execute on function public.create_invitation(text, public.user_role, text, text, text, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid, text) to authenticated;
grant execute on function public.invitation_preview(text) to anon, authenticated;
grant execute on function public.accept_invitation(text, text, text) to anon, authenticated;
