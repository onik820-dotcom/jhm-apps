/**
 * The report set, rendered and exported against a running dev server.
 *
 * Checks three things a typecheck cannot: that each report's page renders for
 * the roles allowed it and 403s or hides for the rest, that the Daily Sheet
 * carries every field it is supposed to, and that the Excel export is a real
 * workbook whose figures match the ones on the page.
 *
 *   npx tsx scripts/check-reports.ts [baseUrl] [date]
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker';
import ExcelJS from 'exceljs';
import { formatBDT, formatLitres, type Lang } from '../lib/format';
import { REPORTS } from '../lib/reports/registry';

config({ path: '.env.local' });

const BASE = process.argv[2] ?? 'http://localhost:3000';
const DATE = process.argv[3] ?? process.env.DEMO_DATE ?? '2026-09-18';
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
  role: string;
}

async function signIn(email: string, password: string, role: string): Promise<Session> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in failed: ${error?.message}`);
  const { data: profile } = await client
    .from('profiles')
    .select('language_pref')
    .eq('id', data.session.user.id)
    .single();
  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return {
    cookie: createChunks(`sb-${REF}-auth-token`, value)
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; '),
    lang: (profile?.language_pref as Lang) ?? 'en',
    role,
  };
}

function visible(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

async function page(path: string, cookie: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'manual' });
  return { status: r.status, body: r.status === 200 ? await r.text() : '' };
}

async function main() {
  const manager = await signIn(
    process.env.SEED_MANAGER_EMAIL!,
    process.env.SEED_MANAGER_PASSWORD!,
    'manager',
  );
  const admin = await signIn(process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!, 'admin');
  const md = await signIn(process.env.SEED_MD_EMAIL!, process.env.SEED_MD_PASSWORD!, 'md');

  console.log(`  against ${BASE}, business day ${DATE}\n`);

  // ---- 1. every report renders for a role that may open it ---------------
  for (const report of REPORTS) {
    const who = report.roles.includes('admin') ? admin : md;
    const r = await page(`/reports?r=${report.id}&from=${DATE}&to=${DATE}`, who.cookie);
    const text = visible(r.body);
    const title = who.lang === 'bn' ? report.bn : report.en;
    check(
      r.status === 200 && text.includes(title),
      `${report.id} renders`,
      `status ${r.status}, "${title}" on the page`,
    );
  }

  // ---- 2. a manager is not shown the P&L --------------------------------
  const plForManager = await page(`/reports?r=profit-loss&from=${DATE}&to=${DATE}`, manager.cookie);
  const managerText = visible(plForManager.body);
  check(
    !managerText.includes('লাভ-ক্ষতি') && !managerText.includes('Profit & Loss'),
    'a manager cannot open Profit & Loss',
    'the page falls back to a report they may see rather than erroring',
  );

  const plApi = await fetch(`${BASE}/api/reports/profit-loss/xlsx?from=${DATE}&to=${DATE}`, {
    headers: { cookie: manager.cookie },
    redirect: 'manual',
  });
  check(
    plApi.status === 403,
    'a manager cannot export Profit & Loss either',
    `the export route answers ${plApi.status}`,
  );

  // ---- 3. the Daily Sheet carries its fields -----------------------------
  const db = createClient(URL_, ANON, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({
    email: process.env.SEED_ADMIN_EMAIL!,
    password: process.env.SEED_ADMIN_PASSWORD!,
  });
  const { data: sheet } = await db.rpc('daily_sheet', { p_date: DATE });

  const sheetPage = await page(`/reports?r=daily-sheet&to=${DATE}`, admin.cookie);
  const sheetText = visible(sheetPage.body);

  const sections: Array<[string, unknown]> = [
    ['meters', sheet?.meters],
    ['tanks', sheet?.tanks],
    ['deliveries', sheet?.deliveries],
    ['credit', sheet?.credit],
    ['lubricants', sheet?.lubricants],
    ['expenses', sheet?.expenses],
    ['cash', sheet?.cash],
  ];
  for (const [name, rows] of sections) {
    const count = Array.isArray(rows) ? rows.length : 0;
    check(count > 0, `the sheet has a ${name} section with rows`, `${count} row(s) from the database`);
  }

  // Five signature lines, and every caption printed.
  const lines = (sheet?.labels?.signature_lines ?? []) as Array<{ en: string; bn: string }>;
  check(lines.length === 5, 'the sheet has five signature lines', `${lines.length} defined in settings`);
  for (const line of lines) {
    const caption = admin.lang === 'bn' ? line.bn : line.en;
    check(sheetText.includes(caption), `signature line "${caption}" is printed`, 'found on the page');
  }

  // The figures on the page are the figures in the sheet.
  const sales = sheet?.sales ?? {};
  const pairs: Array<[string, string]> = [
    ['net litres', formatLitres(sales.net_litres, admin.lang)],
    ['fuel sales', formatBDT(sales.fuel_amount, admin.lang)],
    ['total sales', formatBDT(sales.total_amount, admin.lang)],
    ['cash sales', formatBDT(sales.cash_sales, admin.lang)],
    ['credit sales', formatBDT(sales.credit_sales, admin.lang)],
  ];
  for (const [what, shown] of pairs) {
    check(sheetText.includes(shown), `the sheet prints ${what} as ${shown}`, 'matches the database');
  }

  // Until an admin confirms the captions the sheet says so on its own face.
  const confirmed = sheet?.labels?.confirmed === true;
  check(
    confirmed || sheetText.includes('মিলিয়ে দেখা হয়নি') || sheetText.includes('not been checked'),
    'an unconfirmed sheet says so on the page',
    confirmed ? 'captions are confirmed' : 'the notice is printed',
  );

  // ---- 4. the workbook is real and agrees with the page ------------------
  const xlsx = await fetch(`${BASE}/api/reports/cash-book/xlsx?from=${DATE}&to=${DATE}&lang=en`, {
    headers: { cookie: admin.cookie },
  });
  check(
    xlsx.headers.get('content-type')?.includes('spreadsheetml') === true,
    'the Excel export is a real workbook',
    `content-type ${xlsx.headers.get('content-type')}`,
  );

  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await xlsx.arrayBuffer());
  const ws = book.worksheets[0]!;

  const { data: cash } = await db
    .from('cash_reconciliation')
    .select('counted_cash, shifts!inner(shift_date)')
    .eq('shifts.shift_date', DATE);
  const expectedCounts = (cash ?? []).map((c) => Number(c.counted_cash));

  const countedColumn: number[] = [];
  ws.eachRow((row) => {
    const value = row.getCell(9).value;
    if (typeof value === 'number') countedColumn.push(value);
  });

  check(
    expectedCounts.every((v) => countedColumn.includes(v)),
    'the workbook holds the same cash counts as the database',
    `${expectedCounts.map((v) => v.toFixed(2)).join(', ')} present in the sheet`,
  );
  check(
    countedColumn.length > 0 && countedColumn.every((v) => typeof v === 'number'),
    'money is written as numbers, not text',
    'the accountant can select the column and get a sum',
  );

  console.log(`\n${failures === 0 ? 'All report checks passed.' : `${failures} failed.`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
