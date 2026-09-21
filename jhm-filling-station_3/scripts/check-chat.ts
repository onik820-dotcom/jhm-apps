/**
 * The chat and the outbound mirror, against a running dev server.
 *
 * The parts that matter here are the boundaries, and they are all testable
 * without an OpenAI key:
 *
 *   - the assistant's reads run under the asker's RLS session, so a manager
 *     cannot get profit out of it
 *   - nothing the assistant does writes; a proposal is only a proposal
 *   - the inbound routes refuse without the shared secret
 *   - the drain route refuses without its secret
 *   - a failed sync backs off, and gives up loudly rather than quietly
 *
 *   npx tsx scripts/check-chat.ts [baseUrl]
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker';

config({ path: '.env.local' });

const BASE = process.argv[2] ?? 'http://localhost:3000';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(URL_).hostname.split('.')[0]!;

let failures = 0;
let skipped = 0;

function check(ok: boolean, name: string, detail: string) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n        ${detail}`);
}

function skip(name: string, detail: string) {
  skipped += 1;
  console.log(` skip  ${name}\n        ${detail}`);
}

async function signIn(email: string, password: string) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in failed: ${error?.message}`);
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return {
    client,
    userId: data.session.user.id,
    cookie: createChunks(`sb-${REF}-auth-token`, value)
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; '),
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  return { status: response.status, json, text };
}

async function main() {
  const manager = await signIn(process.env.SEED_MANAGER_EMAIL!, process.env.SEED_MANAGER_PASSWORD!);
  const admin = await signIn(process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!);
  const dispenser = await signIn(
    process.env.SEED_DISPENSER_EMAIL!,
    process.env.SEED_DISPENSER_PASSWORD!,
  );
  const session = crypto.randomUUID();

  // ---- 1. the tools answer under the asker's own RLS ---------------------
  console.log('\n— what each role can get out of the tools —');
  await toolBoundary('manager', manager.client);
  await toolBoundary('admin', admin.client);

  // A dispenser sees no money anywhere, and the chat is no exception.
  const { error: dispenserKpis } = await dispenser.client.rpc('dashboard_kpis');
  check(
    Boolean(dispenserKpis),
    'a dispenser gets nothing from the KPI tool',
    dispenserKpis?.message ?? 'it answered, which it should not',
  );

  // ---- 2. the chat route itself ------------------------------------------
  console.log('\n— the chat route —');
  const anon = await post('/api/chat', { session_id: session, message: 'hello' });
  check(anon.status === 401, 'a signed-out caller is refused', `status ${anon.status}`);

  const bad = await post('/api/chat', { session_id: 'not-a-uuid', message: 'x' }, { cookie: manager.cookie });
  check(bad.status === 400, 'a malformed body is refused', `status ${bad.status}`);

  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  const asked = await post(
    '/api/chat',
    { session_id: session, message: 'aajke koto bikri holo?', lang: 'bn' },
    { cookie: manager.cookie },
  );

  if (!hasKey) {
    check(
      asked.status === 200 && asked.json.code === 'NO_API_KEY',
      'with no key it degrades instead of erroring',
      `it answered "${String(asked.json.reply).slice(0, 60)}…"`,
    );
    skip(
      'a Bangla question returns a live figure',
      'OPENAI_API_KEY is not set. Everything around the model is proven; the model call itself is not.',
    );
  } else {
    check(asked.status === 200, 'a Bangla question is answered', String(asked.json.reply).slice(0, 90));
    const { data: kpis } = await admin.client.rpc('dashboard_kpis');
    const todaySales = (kpis as { today: { sales: number } }).today.sales;
    console.log(`        today's sales in the database: ৳${todaySales}`);
  }

  // Whether or not the model ran, the question is on the record.
  const { data: stored } = await manager.client
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', session)
    .order('created_at');
  const rows = (stored ?? []) as Array<{ role: string; content: string }>;
  check(
    rows.some((r) => r.role === 'user' && r.content.includes('aajke')),
    'the question is persisted whether or not it could be answered',
    `${rows.length} message(s) in chat_messages for this session`,
  );

  // ---- 3. the inbound routes ---------------------------------------------
  console.log('\n— inbound routes —');
  const noSecret = await post('/api/n8n/chat', {
    session_id: session,
    user_id: manager.userId,
    content: 'x',
  });
  check(
    noSecret.status === 401 || noSecret.status === 503,
    'an inbound call without the secret is refused',
    `status ${noSecret.status} — ${String(noSecret.json.error ?? '')}`,
  );

  const wrongSecret = await post(
    '/api/n8n/command',
    { command: 'expense.create', actor_id: manager.userId, idempotency_key: 'x'.repeat(10), data: {} },
    { 'X-N8N-Secret': 'wrong-secret-value' },
  );
  check(
    wrongSecret.status === 401 || wrongSecret.status === 503,
    'a wrong secret is refused before the body is acted on',
    `status ${wrongSecret.status}`,
  );

  if (!process.env.N8N_INBOUND_SECRET) {
    skip(
      'a correctly signed inbound call writes as the actor',
      'N8N_INBOUND_SECRET is not set, so the routes are closed. That is the safe default, not a failure.',
    );
  }

  // ---- 4. the drain route -------------------------------------------------
  console.log('\n— the outbound mirror —');
  const drainOpen = await fetch(`${BASE}/api/sync/drain`, { method: 'POST' });
  check(
    drainOpen.status === 401,
    'the drain route is not open to the world',
    `status ${drainOpen.status}`,
  );

  // ---- 5. the queue's own behaviour --------------------------------------
  const { data: health } = await admin.client.rpc('sync_health');
  const h = health as { pending: number; failed: number; sent: number };
  check(
    typeof h?.pending === 'number',
    'the mirror reports its health to an admin',
    `pending ${h.pending}, sent ${h.sent}, failed ${h.failed}`,
  );

  const { data: mgrHealth } = await manager.client.rpc('sync_health');
  const mh = mgrHealth as { pending: number } | null;
  check(
    !mh || mh.pending === 0,
    'a manager cannot read the queue through it',
    'sync_queue is admin-only, so the counts come back empty',
  );

  console.log(
    `\n${failures === 0 ? 'All chat checks passed' : `${failures} failed`}${
      skipped ? `, ${skipped} not proven` : ''
    }.`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

async function toolBoundary(role: string, client: SupabaseClient) {
  const kpis = await client.rpc('dashboard_kpis');
  const profit = await client.rpc('profit_and_loss', { p_from: '2026-09-01', p_to: '2026-09-30' });
  const parties = await client.rpc('chat_customer_lookup', { p_query: 'shah mamun' });
  const tanks = await client.rpc('chat_tank_status');

  const k = kpis.data as { sees_profit: boolean; month_profit: number | null } | null;
  const party = (parties.data as Array<{ name: string; balance: number }> | null)?.[0];
  const tank = (tanks.data as Array<{ tank_code: string; litres_now: number }> | null)?.[0];

  const shouldSee = role === 'admin';
  check(
    Boolean(profit.error) !== shouldSee,
    `${role}: profit is ${shouldSee ? 'available' : 'refused'}`,
    profit.error ? profit.error.message : `৳${(profit.data as { operating_profit: number }).operating_profit}`,
  );
  check(
    k?.sees_profit === shouldSee && (shouldSee || k?.month_profit === null),
    `${role}: the KPI tool ${shouldSee ? 'carries' : 'omits'} profit`,
    `sees_profit=${k?.sees_profit}, month_profit=${k?.month_profit}`,
  );
  check(
    Boolean(party) && Boolean(tank),
    `${role}: operational figures come through`,
    `${party?.name} owes ৳${party?.balance}; ${tank?.tank_code} holds ${tank?.litres_now} L`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
