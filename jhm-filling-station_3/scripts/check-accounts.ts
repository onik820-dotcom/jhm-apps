/**
 * The four station accounts, and the invitation flow, against the live API.
 *
 * Everything here has already been proved in SQL. This proves it again through
 * GoTrue and PostgREST, which is a different thing: an account can look
 * perfect in auth.users and still fail every sign-in, and that failure names
 * neither the column nor the user. The only way to know an account works is to
 * sign in with it.
 *
 * The page checks need a server; they are skipped if nothing answers.
 *
 *   npx tsx scripts/check-accounts.ts [baseUrl]
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker';
import { config } from 'dotenv';

config({ path: '.env.local' });

const BASE = process.argv[2] ?? 'http://localhost:3000';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL_ || !ANON) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  process.exit(1);
}

let failures = 0;

function check(ok: boolean, name: string, detail: string) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(34)} ${detail}`);
}

function anonClient(): SupabaseClient {
  return createClient(URL_!, ANON!, { auth: { persistSession: false } });
}

async function signIn(email: string, password: string): Promise<SupabaseClient | null> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  return error ? null : client;
}

/** The same session the browser would carry, as a cookie header. */
async function cookieFor(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const ref = new URL(URL_!).hostname.split('.')[0]!;
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return createChunks(`sb-${ref}-auth-token`, value)
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');
}

async function serverIsUp(): Promise<boolean> {
  try {
    await fetch(`${BASE}/login`, { redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

interface Account {
  label: string;
  emailVar: string;
  passwordVar: string;
  role: string;
  home: string;
}

const ACCOUNTS: Account[] = [
  { label: 'admin', emailVar: 'STATION_ADMIN_EMAIL', passwordVar: 'STATION_ADMIN_PASSWORD', role: 'admin', home: '/admin' },
  { label: 'MD', emailVar: 'STATION_MD_EMAIL', passwordVar: 'STATION_MD_PASSWORD', role: 'md', home: '/md' },
  { label: 'manager', emailVar: 'STATION_MANAGER_EMAIL', passwordVar: 'STATION_MANAGER_PASSWORD', role: 'manager', home: '/manager' },
  { label: 'employee', emailVar: 'STATION_EMPLOYEE_EMAIL', passwordVar: 'STATION_EMPLOYEE_PASSWORD', role: 'dispenser', home: '/dispenser' },
];

async function main() {
  console.log('\nSTATION ACCOUNTS\n');

  const sessions = new Map<string, SupabaseClient>();

  for (const account of ACCOUNTS) {
    const email = process.env[account.emailVar];
    const password = process.env[account.passwordVar];

    if (!email || !password) {
      check(false, `${account.label} signs in`, `${account.emailVar} / ${account.passwordVar} are not set in .env.local`);
      continue;
    }

    const client = await signIn(email, password);
    if (!client) {
      check(false, `${account.label} signs in`, `${email} was refused`);
      continue;
    }
    sessions.set(account.label, client);

    const { data: auth } = await client.auth.getUser();
    const { data: profile } = await client
      .from('profiles')
      .select('role, is_active, full_name')
      .eq('id', auth.user!.id)
      .maybeSingle();

    check(true, `${account.label} signs in`, email);
    check(
      profile?.role === account.role && profile?.is_active === true,
      `${account.label} profile`,
      `${profile?.full_name ?? '—'}, role "${profile?.role ?? 'none'}", lands on ${account.home}`,
    );
  }

  console.log('\nTHE ROSTER\n');

  const admin = sessions.get('admin');
  const manager = sessions.get('manager');

  if (admin) {
    const { data, error } = await admin.rpc('list_people');
    const rows = (data ?? []) as Array<{ email: string; role: string; is_active: boolean }>;
    check(!error && rows.length >= 4, 'admin sees the roster', error?.message ?? `${rows.length} accounts, each with its email`);
    check(
      rows.every((r) => typeof r.email === 'string' && r.email.includes('@')),
      'roster carries emails',
      'the email lives in auth.users, which PostgREST does not expose',
    );
  }

  if (manager) {
    const { data } = await manager.rpc('list_people');
    check(((data ?? []) as unknown[]).length === 0, 'manager sees no roster', 'who can sign in is not a manager question');
  }

  console.log('\nINVITATIONS\n');

  const probe = `check-${Date.now()}@jhm.invalid`;

  if (manager) {
    const { error } = await manager.rpc('create_invitation', {
      p_email: probe,
      p_role: 'dispenser',
      p_full_name: 'Probe',
    });
    check(Boolean(error), 'manager cannot invite', error?.message ?? 'IT WENT THROUGH');
  }

  if (admin) {
    const escalate = await admin.rpc('create_invitation', {
      p_email: probe,
      p_role: 'admin',
      p_full_name: 'Probe',
    });
    check(Boolean(escalate.error), 'no admin by invitation', escalate.error?.message ?? 'IT WENT THROUGH');

    const { data, error } = await admin.rpc('create_invitation', {
      p_email: probe,
      p_role: 'dispenser',
      p_full_name: 'Probe Employee',
      p_valid_days: 1,
    });
    const created = (data ?? [])[0] as { invitation_id: string; token: string } | undefined;
    check(!error && Boolean(created?.token), 'admin creates an invitation', error?.message ?? `token is ${created?.token.length ?? 0} hex characters`);

    if (created) {
      // The invitee has no session at all — this is the part that has to work
      // for someone opening a link on their own phone.
      const stranger = anonClient();
      const preview = await stranger.rpc('invitation_preview', { p_token: created.token });
      const seen = (preview.data ?? [])[0] as { full_name: string; role: string } | undefined;
      check(seen?.full_name === 'Probe Employee' && seen?.role === 'dispenser', 'a stranger can read the link', `${seen?.full_name ?? 'nothing'} / ${seen?.role ?? '—'}`);

      const hidden = await stranger.from('user_invitations').select('id');
      check(((hidden.data ?? []) as unknown[]).length === 0, 'a stranger reads no invitations', 'the table itself stays closed');

      const wrong = await stranger.rpc('invitation_preview', { p_token: 'deadbeef' });
      check(((wrong.data ?? []) as unknown[]).length === 0, 'a wrong link shows nothing', 'no hint that anything is there');

      const revoked = await admin.rpc('revoke_invitation', {
        p_id: created.invitation_id,
        p_reason: 'Automated check, tidying up after itself',
      });
      check(!revoked.error, 'admin cancels it', revoked.error?.message ?? 'with a reason, which is required');

      const after = await stranger.rpc('invitation_preview', { p_token: created.token });
      check(((after.data ?? []) as unknown[]).length === 0, 'the cancelled link is dead', 'the same token now reads as nothing');
    }
  }

  console.log('\nTHE PAGES\n');

  if (!(await serverIsUp())) {
    console.log(`  --   skipped                            nothing is answering on ${BASE}`);
  } else if (admin) {
    const asAdmin = await fetch(`${BASE}/people`, {
      headers: { cookie: await cookieFor(admin) },
      redirect: 'manual',
    });
    const html = asAdmin.status === 200 ? await asAdmin.text() : '';
    check(asAdmin.status === 200, 'admin opens /people', `status ${asAdmin.status}`);
    check(
      html.includes('invite-email') && html.includes('invite-role'),
      '/people carries the invite form',
      'name, email, role and the number of days the link lives',
    );

    if (manager) {
      const asManager = await fetch(`${BASE}/people`, {
        headers: { cookie: await cookieFor(manager) },
        redirect: 'manual',
      });
      check(
        asManager.status === 307 || asManager.status === 302,
        'manager is turned away from /people',
        `status ${asManager.status} to ${asManager.headers.get('location') ?? '—'}`,
      );
    }

    const { data } = await admin.rpc('create_invitation', {
      p_email: `page-${Date.now()}@jhm.invalid`,
      p_role: 'manager',
      p_full_name: 'Page Check',
      p_valid_days: 1,
    });
    const made = (data ?? [])[0] as { invitation_id: string; token: string } | undefined;

    if (made) {
      // No cookie at all — this is the link arriving on a stranger's phone.
      const joinPage = await fetch(`${BASE}/join/${made.token}`, { redirect: 'manual' });
      const joinHtml = joinPage.status === 200 ? await joinPage.text() : '';
      check(joinPage.status === 200, 'the link opens with no session', `status ${joinPage.status}`);
      check(
        joinHtml.includes('Page Check') && joinHtml.includes('join-password'),
        'the join page greets them',
        'their name, the role they are joining as, and a password field',
      );

      const badPage = await fetch(`${BASE}/join/deadbeef`, { redirect: 'manual' });
      const badHtml = badPage.status === 200 ? await badPage.text() : '';
      check(
        badPage.status === 200 && !badHtml.includes('join-password'),
        'a wrong link offers no form',
        `status ${badPage.status}, and no password field on the page`,
      );

      await admin.rpc('revoke_invitation', {
        p_id: made.invitation_id,
        p_reason: 'Automated page check, tidying up after itself',
      });
    }
  }

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
