/**
 * Proves the Phase 1 security claims against a live database, signing in as
 * each seeded role and checking what it can and cannot reach.
 *
 *   npm run verify:rls
 *
 * This is the check Phase 1 is judged on: a dispenser must not be able to
 * select from `expenses`. Everything else here guards the same boundary from
 * other angles.
 */
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config({ path: '.env' });

type Status = 'pass' | 'fail' | 'skip';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];

const LABEL: Record<Status, string> = { pass: '  PASS', fail: '  FAIL', skip: '  SKIP' };

/**
 * `skip` is not `fail`. A check against an empty table proves nothing, but it
 * has not found a leak either — saying so honestly is better than a green tick
 * that means "there was nothing to hide".
 */
function record(name: string, status: Status, detail: string) {
  checks.push({ name, status, detail });
  console.log(`${LABEL[status]}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return supabase;
}

/**
 * RLS hides rows rather than raising, so "blocked" means an error or no rows.
 *
 * That alone is weak evidence: an empty table returns nothing to everyone. So
 * this also asks a session that IS allowed to read the table how many rows are
 * really there, and refuses to call the check a pass when the answer is zero —
 * there was nothing to hide, so nothing was proven.
 */
async function expectNoAccess(
  supabase: SupabaseClient,
  table: string,
  label: string,
  privileged: SupabaseClient,
) {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  const blocked = Boolean(error) || !data || data.length === 0;

  const { count } = await privileged.from(table).select('*', { count: 'exact', head: true });
  const rowsThatExist = count ?? 0;

  if (rowsThatExist === 0) {
    record(
      `${label} cannot read ${table}`,
      'skip',
      'unproven: the table is empty, so returning nothing proves nothing',
    );
    return;
  }

  record(
    `${label} cannot read ${table}`,
    blocked ? 'pass' : 'fail',
    error ? error.message : `0 of ${rowsThatExist} existing rows returned`,
  );
}

async function expectWriteRejected(
  supabase: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  label: string,
) {
  const { error } = await supabase.from(table).insert(row);
  record(`${label} cannot write to ${table}`, (Boolean(error)) ? 'pass' : 'fail', error?.message ?? 'the insert was accepted');
}

async function main() {
  const creds = {
    dispenser: [process.env.SEED_DISPENSER_EMAIL, process.env.SEED_DISPENSER_PASSWORD],
    manager: [process.env.SEED_MANAGER_EMAIL, process.env.SEED_MANAGER_PASSWORD],
    admin: [process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD],
    md: [process.env.SEED_MD_EMAIL, process.env.SEED_MD_PASSWORD],
  } as const;

  for (const [role, [email, password]] of Object.entries(creds)) {
    if (!email || !password) {
      throw new Error(`Set SEED_${role.toUpperCase()}_EMAIL and SEED_${role.toUpperCase()}_PASSWORD first.`);
    }
  }

  // All four sessions up front: the "cannot read" checks need a privileged
  // session alongside the restricted one, to tell a policy that is hiding rows
  // from a table that simply has none.
  const dispenser = await signIn(creds.dispenser[0]!, creds.dispenser[1]!);
  const manager = await signIn(creds.manager[0]!, creds.manager[1]!);
  const admin = await signIn(creds.admin[0]!, creds.admin[1]!);
  const md = await signIn(creds.md[0]!, creds.md[1]!);

  console.log('\ndispenser — the most restricted role');
  // The check Phase 1 is judged on.
  await expectNoAccess(dispenser, 'expenses', 'dispenser', admin);
  await expectNoAccess(dispenser, 'shifts', 'dispenser', admin);
  await expectNoAccess(dispenser, 'customers', 'dispenser', admin);
  await expectNoAccess(dispenser, 'credit_sales', 'dispenser', admin);
  await expectNoAccess(dispenser, 'shift_sales', 'dispenser', admin);
  await expectNoAccess(dispenser, 'cash_reconciliation', 'dispenser', admin);
  await expectNoAccess(dispenser, 'tank_cost_history', 'dispenser', admin);
  await expectNoAccess(dispenser, 'audit_log', 'dispenser', admin);

  {
    // It must, however, be able to see the equipment it is standing in front of.
    const { data, error } = await dispenser.from('tanks').select('code').order('code');
    record('dispenser can read the tank list', (!error && (data?.length ?? 0) > 0) ? 'pass' : 'fail', error?.message ?? `${data?.length ?? 0} tanks`);
  }

  console.log('\nmd — read-only everywhere');
  {
    const { error } = await md.from('tanks').select('code').limit(1);
    record('md can read tanks', (!error) ? 'pass' : 'fail', error?.message ?? 'ok');
  }
  await expectWriteRejected(md, 'expense_categories', { name: `rls-probe-${Date.now()}`, group: 'other' }, 'md');
  await expectWriteRejected(
    md,
    'alerts',
    { type: 'rls-probe', severity: 'info', title: 'probe' },
    'md',
  );

  console.log('\nmanager — operational access, no profit, no deletes');
  {
    const { error } = await manager.from('expenses').select('id').limit(1);
    record('manager can read expenses', (!error) ? 'pass' : 'fail', error?.message ?? 'ok');
  }
  await expectNoAccess(manager, 'tank_cost_history', 'manager', admin);
  await expectNoAccess(manager, 'audit_log', 'manager', admin);

  console.log('\nadmin — full access, and the audit log stays immutable');
  {
    const { error } = await admin.from('audit_log').select('id').limit(1);
    record('admin can read the audit log', (!error) ? 'pass' : 'fail', error?.message ?? 'ok');
  }
  {
    const { error } = await admin.from('audit_log').delete().neq('id', 0);
    record('admin cannot delete from the audit log', (Boolean(error)) ? 'pass' : 'fail', error?.message ?? 'the delete was accepted');
  }
  {
    const { data, error } = await admin.rpc('assert_md_is_read_only');
    const clean = !error && Array.isArray(data) && data.length === 0;
    record(
      'no write policy anywhere admits the md role',
      clean ? 'pass' : 'fail',
      error?.message ?? `${Array.isArray(data) ? data.length : '?'} suspicious policies`,
    );
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const passed = checks.filter((c) => c.status === 'pass');
  const skipped = checks.filter((c) => c.status === 'skip');

  console.log(
    `\n${passed.length} proven, ${skipped.length} unproven, ${failed.length} failed, of ${checks.length} checks`,
  );

  if (skipped.length > 0) {
    console.log(
      '\nUnproven checks are against tables that are still empty, so there was ' +
        'nothing for a policy to hide. They become conclusive once the station ' +
        'has real data — from the first closed shift onward.',
    );
    for (const check of skipped) console.log(`  - ${check.name}`);
  }

  if (failed.length > 0) {
    console.error('\nFailed:');
    for (const check of failed) console.error(`  - ${check.name}: ${check.detail}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('\nVerification could not run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
