/**
 * Renders each signed-in page against a running dev server and checks that the
 * figures printed on it are the figures the database holds.
 *
 * A typecheck proves a page compiles. It does not prove the page renders, that
 * its queries pass RLS as the signed-in role, or that the number shown is the
 * number stored. All three have broken in this project while the types were
 * perfectly happy — most recently a client component importing a value from a
 * data module, which dragged next/headers into the browser bundle and 500'd a
 * page that compiled without a single complaint.
 *
 *   npx tsx scripts/render-check.ts [baseUrl]
 *
 * Figures are compared through the app's own formatter, in the language the
 * signed-in profile prefers. The seeded manager reads Bangla, so the page says
 * ৳৫৬,০০০.০০ and a check looking for "56,000.00" would fail against a page
 * that is perfectly correct.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker';
import { formatBDT, type Lang } from '../lib/format';

config({ path: '.env.local' });

const BASE = process.argv[2] ?? 'http://localhost:3000';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(URL_).hostname.split('.')[0]!;

let failures = 0;

function check(ok: boolean, name: string, detail: string) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}\n        ${detail}`);
}

interface Session {
  cookie: string;
  lang: Lang;
  name: string;
}

/** The cookie @supabase/ssr expects, built with its own chunker so it cannot drift. */
async function signIn(email: string, password: string): Promise<Session> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in failed: ${error?.message}`);

  const { data: profile } = await client
    .from('profiles')
    .select('full_name, language_pref')
    .eq('id', data.session.user.id)
    .single();

  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return {
    cookie: createChunks(`sb-${REF}-auth-token`, value)
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; '),
    lang: (profile?.language_pref as Lang) ?? 'en',
    name: profile?.full_name ?? email,
  };
}

async function fetchPage(path: string, cookie: string) {
  const response = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
  const body = response.status === 200 ? await response.text() : '';
  return { status: response.status, body };
}

/** Strip markup so a figure split across spans is still found as one string. */
function visible(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

async function main() {
  const manager = await signIn(
    process.env.SEED_MANAGER_EMAIL!,
    process.env.SEED_MANAGER_PASSWORD!,
  );
  const admin = await signIn(process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!);
  console.log(
    `  signed in as ${manager.name} (${manager.lang}) and ${admin.name} (${admin.lang})\n`,
  );

  // Without this the rest proves nothing: the pages might render for anyone.
  const anon = await fetchPage('/dues', '');
  check(
    anon.status === 307 || anon.status === 302,
    'a signed-out visitor is bounced from /dues',
    `status ${anon.status}`,
  );

  const pages: Record<string, string> = {};
  for (const path of ['/dues', '/cash', '/expenses', '/lubricants']) {
    const page = await fetchPage(path, manager.cookie);
    check(page.status === 200, `${path} renders for a manager`, `status ${page.status}`);
    pages[path] = page.status === 200 ? visible(page.body) : '';
    if (page.status === 200) {
      check(
        !page.body.includes('__next_error__') && !visible(page.body).includes('Application error'),
        `${path} renders without an error boundary`,
        'the page is the page, not a crash screen',
      );
      // The shell is on every page; this is asking whether the page's own
      // heading made it past the data fetch.
      const heading =
        path === '/dues'
          ? manager.lang === 'bn'
            ? 'বাকি পার্টি'
            : 'Credit parties'
          : path === '/cash'
            ? manager.lang === 'bn'
              ? 'ক্যাশে আছে'
              : 'In the drawer'
            : path === '/expenses'
              ? manager.lang === 'bn'
                ? 'পাম্পের খাতা'
                : 'Pump book'
              : manager.lang === 'bn'
                ? 'মজুদ'
                : 'On the shelf';
      check(pages[path]!.includes(heading), `${path} rendered its own content`, `found "${heading}"`);
    }
  }

  // ---- the figures on the page are the figures in the database ------------
  const db = createClient(URL_, ANON, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({
    email: process.env.SEED_ADMIN_EMAIL!,
    password: process.env.SEED_ADMIN_PASSWORD!,
  });

  const { data: ageing } = await db.rpc('customer_ageing');
  const owing = (ageing as Array<{ customer_name: string; balance: number; credit_limit: number }>)
    .filter((r) => Number(r.balance) > 0);

  if (owing.length === 0) {
    console.log('  skip  no party owes anything, so /dues has no figure to check');
  }

  for (const party of owing) {
    const shown = formatBDT(Math.abs(Number(party.balance)).toFixed(2), manager.lang);
    check(
      pages['/dues']!.includes(party.customer_name),
      `/dues lists ${party.customer_name}`,
      'the party is on the page',
    );
    check(
      pages['/dues']!.includes(shown),
      `/dues shows ${party.customer_name} owing ${shown}`,
      `rendered in ${manager.lang === 'bn' ? 'Bangla' : 'Latin'} numerals, as the profile asks`,
    );
    if (Number(party.credit_limit) > 0 && Number(party.balance) > Number(party.credit_limit)) {
      check(
        pages['/dues']!.includes(manager.lang === 'bn' ? 'সীমা ছাড়িয়েছে' : 'Over limit'),
        `/dues flags ${party.customer_name} as over its limit`,
        'the over-limit chip is rendered',
      );
    }
  }

  // ---- cost stays with the owner ------------------------------------------
  const lubManager = await fetchPage('/lubricants', manager.cookie);
  const lubAdmin = await fetchPage('/lubricants', admin.cookie);
  const costLabel = (lang: Lang) => (lang === 'bn' ? 'গড় ক্রয়মূল্য' : 'Average cost');

  check(
    !lubManager.body.includes(costLabel(manager.lang)) &&
      !lubManager.body.includes(costLabel('en')) &&
      !lubManager.body.includes(costLabel('bn')),
    'a manager is not shown lubricant cost',
    'no average-cost column anywhere in the manager’s markup',
  );
  check(
    lubAdmin.body.includes(costLabel(admin.lang)),
    'the owner is shown lubricant cost',
    `"${costLabel(admin.lang)}" is present for admin`,
  );

  console.log(`\n${failures === 0 ? 'All render checks passed.' : `${failures} failed.`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
