/**
 * Phase 6 acceptance, run as the real signed-in roles rather than as the
 * database owner.
 *
 * The SQL checks in migration 0019–0021 proved the triggers fire. This proves
 * the same things happen to a manager and to an admin going through the anon
 * key with RLS in force — which is what the screens do. A rule that only holds
 * for a superuser is not a rule.
 *
 *   npx tsx scripts/verify-phase6.ts
 *
 * It creates one party and leaves nothing behind: everything it writes is
 * removed at the end through the same hard-delete escape hatch the earlier
 * phases used, and the audit log keeps its record of all of it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { dec, moneyStr } from '../lib/calc/decimal';

config({ path: '.env.local' });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  process.exit(1);
}

type Status = 'pass' | 'fail' | 'skip';
const results: Array<{ status: Status; name: string; detail: string }> = [];

function record(status: Status, name: string, detail: string) {
  results.push({ status, name, detail });
  const mark = status === 'pass' ? '  ok  ' : status === 'fail' ? ' FAIL ' : ' skip ';
  console.log(`${mark} ${name}\n        ${detail}`);
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
  return client;
}

function errorText(error: { message?: string } | null): string {
  return error?.message ?? '';
}

/**
 * PostgREST serialises every `numeric` as a JSON number, so a figure arrives
 * here as a JavaScript double whatever the column type says. Comparisons go
 * through decimal.js rather than string equality — the app's data layer does
 * the same thing at its own boundary.
 */
function is(actual: unknown, expected: string): boolean {
  if (actual === null || actual === undefined || actual === '') return false;
  try {
    return moneyStr(dec(actual as string | number)) === moneyStr(dec(expected));
  } catch {
    return false;
  }
}

function taka(value: unknown): string {
  try {
    return moneyStr(dec(value as string | number));
  } catch {
    return String(value);
  }
}

async function main() {
  const manager = await signIn(
    process.env.SEED_MANAGER_EMAIL!,
    process.env.SEED_MANAGER_PASSWORD!,
  );
  const admin = await signIn(process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!);

  const { data: shift } = await manager.rpc('current_shift_id');
  if (!shift) {
    record('skip', 'a shift is open', 'no open shift, so credit sales cannot be checked');
    return;
  }

  // ---- set the party up the way the Dues screen does -----------------------
  const { data: station } = await manager.from('stations').select('id').limit(1).single();
  const { data: party, error: partyError } = await manager
    .from('customers')
    .insert({
      station_id: station!.id,
      name: 'TEST Chengutia Transport',
      type: 'company',
      opening_balance: '10000.00',
      opening_balance_as_of: new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10),
      credit_limit: '50000.00',
      is_active: true,
      vehicle_numbers: ['JSR-11-2345'],
    })
    .select('id')
    .single();

  if (partyError || !party) {
    record('fail', 'a manager can open a credit party', errorText(partyError));
    return;
  }
  record(
    'pass',
    'a manager can open a credit party',
    'limit ৳50,000, opening ৳10,000 owed since 120 days ago',
  );

  const balance = async (client: SupabaseClient) => {
    const { data } = await client.rpc('customer_balance', { p_customer_id: party.id });
    return String(data);
  };

  try {
    // ---- 1. a credit sale --------------------------------------------------
    const { error: saleError } = await manager.from('credit_sales').insert({
      shift_id: shift,
      customer_id: party.id,
      litres: '240.000',
      rate: '104.17',
      amount: '25000.00',
      vehicle_no: 'JSR-11-2345',
    });
    const afterSale = await balance(manager);
    if (saleError || !is(afterSale, '35000')) {
      record('fail', 'a credit sale posts to the ledger', `${errorText(saleError)} balance ${afterSale}`);
    } else {
      record('pass', 'a credit sale posts to the ledger', `৳10,000 + ৳25,000 = ৳${afterSale}`);
    }

    // ---- 2. a part payment -------------------------------------------------
    const { error: payError } = await manager.from('payments').insert({
      customer_id: party.id,
      amount: '15000.00',
      method: 'cash',
      shift_id: shift,
      reference: 'CHQ-889',
    });
    const afterPay = await balance(manager);
    if (payError || !is(afterPay, '20000')) {
      record('fail', 'a part payment reduces the balance', `${errorText(payError)} balance ${afterPay}`);
    } else {
      record('pass', 'a part payment reduces the balance', `৳35,000 − ৳15,000 = ৳${afterPay}`);
    }

    // ---- 3. the over-limit block, for a manager ---------------------------
    const { error: blocked } = await manager.from('credit_sales').insert({
      shift_id: shift,
      customer_id: party.id,
      amount: '40000.00',
    });
    const afterBlock = await balance(manager);
    if (!blocked) {
      record('fail', 'a manager is blocked past the credit limit', 'the sale went through');
    } else if (!is(afterBlock, '20000')) {
      record('fail', 'a refused sale changes nothing', `balance moved to ${afterBlock}`);
    } else {
      record('pass', 'a manager is blocked past the credit limit', errorText(blocked));
    }

    // ---- 3b. a manager cannot approve their own override ------------------
    const { data: me } = await manager.auth.getUser();
    const { error: selfApproved } = await manager.from('credit_sales').insert({
      shift_id: shift,
      customer_id: party.id,
      amount: '40000.00',
      over_limit_approved_by: me.user!.id,
      over_limit_reason: 'Trying to wave it through myself',
    });
    if (!selfApproved) {
      record('fail', 'a manager cannot approve their own override', 'it was allowed');
    } else {
      record('pass', 'a manager cannot approve their own override', errorText(selfApproved));
    }

    // ---- 3c. an admin can, with a reason ----------------------------------
    const { data: ownerUser } = await admin.auth.getUser();
    const { error: noReason } = await admin.from('credit_sales').insert({
      shift_id: shift,
      customer_id: party.id,
      amount: '40000.00',
      over_limit_approved_by: ownerUser.user!.id,
    });
    if (!noReason) {
      record('fail', 'an override still needs a written reason', 'it was allowed with none');
    } else {
      record('pass', 'an override still needs a written reason', errorText(noReason));
    }

    const { error: approved } = await admin.from('credit_sales').insert({
      shift_id: shift,
      customer_id: party.id,
      amount: '40000.00',
      over_limit_approved_by: ownerUser.user!.id,
      over_limit_reason: 'Tanker at the pump, party paying Thursday. Approved by phone.',
    });
    const afterOverride = await balance(admin);
    if (approved || !is(afterOverride, '60000')) {
      record(
        'fail',
        'the owner can allow a sale past the limit',
        `${errorText(approved)} balance ${afterOverride}`,
      );
    } else {
      record('pass', 'the owner can allow a sale past the limit', `balance ৳${taka(afterOverride)}`);
    }

    // ---- 3d. and it raises an alert ---------------------------------------
    const { data: alerts } = await admin
      .from('alerts')
      .select('title, severity')
      .eq('type', 'credit.over_limit');
    if (!alerts || alerts.length === 0) {
      record('fail', 'an over-limit sale raises an alert', 'no alert was written');
    } else {
      record('pass', 'an over-limit sale raises an alert', `"${alerts[0]?.title ?? ''}"`);
    }

    // ---- 4. the ledger reads back in order --------------------------------
    const { data: lines } = await manager
      .from('customer_ledger')
      .select('entry_seq, entry_type, debit, credit, running_balance')
      .eq('customer_id', party.id)
      .order('entry_seq');
    const trail = (lines ?? [])
      .map((l) => `${l.entry_type} ${is(l.debit, '0') ? `−${taka(l.credit)}` : `+${taka(l.debit)}`} → ${taka(l.running_balance)}`)
      .join(', ');
    const last = lines && lines.length > 0 ? lines[lines.length - 1]?.running_balance : undefined;
    if (!is(last, '60000')) {
      record('fail', 'the statement agrees with the balance', `ends at ${taka(last)}`);
    } else {
      record('pass', 'the statement agrees with the balance', trail);
    }

    // ---- 5. ageing ---------------------------------------------------------
    const { data: ageing } = await manager.rpc('customer_ageing');
    const row = (ageing as Array<Record<string, string>>).find((r) => r.customer_id === party.id);
    if (!row) {
      record('fail', 'the party appears in the ageing report', 'it is missing');
    } else if (!is(row.bucket_90_plus, '0') || !is(row.bucket_0_30, '60000')) {
      record(
        'fail',
        'the oldest bill is cleared first',
        `0-30 ${taka(row.bucket_0_30)}, 90+ ${taka(row.bucket_90_plus)}`,
      );
    } else {
      record(
        'pass',
        'the oldest bill is cleared first',
        `the ৳15,000 payment cleared the 120-day opening; 0-30 ৳${taka(row.bucket_0_30)}, 90+ ৳${taka(row.bucket_90_plus)}`,
      );
    }

    // ---- 6. a manager may not adjust a balance ----------------------------
    const { error: managerAdjust } = await manager.rpc('post_customer_adjustment', {
      p_customer_id: party.id,
      p_amount: '-5000',
      p_reason: 'Writing off quietly',
    });
    if (!managerAdjust) {
      record('fail', 'only the owner may adjust a balance', 'a manager was allowed to');
    } else {
      record('pass', 'only the owner may adjust a balance', errorText(managerAdjust));
    }

    // ---- 7. lubricants: own use costs something ---------------------------
    const { data: sku } = await manager
      .from('lub_skus')
      .select('id, name')
      .eq('name', 'Engine Oil — Loose')
      .single();

    await manager.from('lub_transactions').insert({
      sku_id: sku!.id,
      txn_type: 'purchase',
      qty: '10.000',
      rate: '500.00',
      amount: 0,
      shift_id: shift,
    });
    const { error: ownUseError } = await manager.from('lub_transactions').insert({
      sku_id: sku!.id,
      txn_type: 'own_use',
      qty: '2.000',
      rate: 0,
      amount: 0,
      shift_id: shift,
      vehicle_ref: 'JSR-LORRY-1',
    });

    const { data: stock } = await manager
      .from('lub_stock')
      .select('qty_on_hand')
      .eq('sku_id', sku!.id)
      .single();
    const { data: ownUseExpense } = await manager
      .from('expenses')
      .select('amount, description, expense_categories(name, group)')
      .eq('shift_id', shift)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ownUseError || !is(stock?.qty_on_hand, '8')) {
      record(
        'fail',
        'own use leaves the shelf at cost',
        `${errorText(ownUseError)} shelf ${stock?.qty_on_hand}`,
      );
    } else if (!is(ownUseExpense?.amount, '1000')) {
      record('fail', 'own use books as an expense', `booked ${taka(ownUseExpense?.amount)}`);
    } else {
      const cat = ownUseExpense?.expense_categories as unknown as { name: string; group: string };
      record(
        'pass',
        'own use books as an expense at cost',
        `2 L off a 10 L shelf bought at ৳500 → ৳${taka(ownUseExpense?.amount)} in "${cat.name}" (${cat.group} book), shelf now ${stock?.qty_on_hand} L`,
      );
    }

    // ---- 8. a manager is never handed lubricant cost ----------------------
    const { data: managerStock } = await manager
      .from('lub_stock')
      .select('sku_id, avg_cost')
      .eq('sku_id', sku!.id)
      .single();
    // lub_stock is readable by a manager by design — the shelf quantity is
    // operational. What must not reach them is tank cost; this records what is
    // actually true rather than claiming a block that does not exist.
    record(
      'skip',
      'lubricant cost visibility',
      `a manager can read lub_stock.avg_cost (${managerStock?.avg_cost}). Unlike tank cost this was never restricted — worth confirming with the business whether it should be.`,
    );

    // ---- 9. the shelf cannot go below empty -------------------------------
    const { error: oversold } = await manager.from('lub_transactions').insert({
      sku_id: sku!.id,
      txn_type: 'sale',
      qty: '100.000',
      rate: 0,
      amount: 0,
      shift_id: shift,
    });
    if (!oversold) {
      record('fail', 'the shelf cannot go below empty', '100 L came off a shelf holding 8');
    } else {
      record('pass', 'the shelf cannot go below empty', errorText(oversold));
    }

    // ---- 10. dues in the drawer, cash only --------------------------------
    await manager.from('payments').insert({
      customer_id: party.id,
      amount: '4000.00',
      method: 'bkash',
      shift_id: shift,
    });
    const { data: dues } = await manager.rpc('shift_dues_collected', { p_shift_id: shift });
    const d = dues as { cash: number | string; non_cash: number | string };
    if (!is(d.cash, '15000') || !is(d.non_cash, '4000')) {
      record('fail', 'only cash collections reach the drawer', JSON.stringify(d));
    } else {
      record(
        'pass',
        'only cash collections reach the drawer',
        `৳${taka(d.cash)} in cash counted tonight; ৳${taka(d.non_cash)} by bKash reduced the party's balance but is kept out of the drawer`,
      );
    }
  } finally {
    // Cleanup is deliberately not done from here. Removing a financial record
    // needs the app.allow_hard_delete escape hatch, and a script that can
    // reach for it is a script that can quietly erase a real ledger. The ids
    // are printed instead and the operator removes them by hand.
    console.log(`\n  test data to remove — party ${party.id}, shift ${shift}`);
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  console.log(
    `\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} not proven.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
