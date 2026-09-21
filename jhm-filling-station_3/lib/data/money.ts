import { createClient } from '@/lib/supabase/server';
import { dec, moneyStr, sum } from '@/lib/calc/decimal';
import { asMoney } from '@/lib/data/numeric';

/**
 * Money, parties and the drawer.
 *
 * Every figure leaves this file as a fixed-point string. PostgREST hands
 * numerics over as JavaScript doubles — for table selects as much as for
 * functions — so each one is converted through decimal.js on the way in; see
 * lib/data/numeric.ts for what that is guarding against. Below this line
 * nothing is a float, and nothing adds two amounts without decimal.js.
 */

export interface CreditParty {
  id: string;
  name: string;
  nameBn: string | null;
  type: string;
  phone: string | null;
  vehicleNumbers: string[];
  creditLimit: string;
  openingBalance: string;
  openingBalanceAsOf: string | null;
  isActive: boolean;
  notes: string | null;
  /** From customer_ageing(), so it is the ledger's own figure, not a re-add. */
  balance: string;
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket90plus: string;
  oldestItemDays: number | null;
  /** False when the opening balance is being aged from a guessed date. */
  openingDated: boolean;
}

/** As PostgREST actually returns it: every numeric arrives as a JSON number. */
interface AgeingRow {
  customer_id: string;
  customer_name: string;
  customer_name_bn: string | null;
  credit_limit: number;
  balance: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  oldest_item_days: number | null;
  opening_dated: boolean;
}

export async function getCreditParties(): Promise<CreditParty[]> {
  const supabase = await createClient();

  const [{ data: customers }, { data: ageing }] = await Promise.all([
    supabase
      .from('customers')
      .select(
        'id, name, name_bn, type, phone, vehicle_numbers, credit_limit, opening_balance, opening_balance_as_of, is_active, notes',
      )
      .is('deleted_at', null)
      .order('name'),
    supabase.rpc('customer_ageing'),
  ]);

  const byId = new Map<string, AgeingRow>(
    ((ageing ?? []) as AgeingRow[]).map((row) => [row.customer_id, row]),
  );

  return (customers ?? []).map((c) => {
    const age = byId.get(c.id);
    return {
      id: c.id,
      name: c.name,
      nameBn: c.name_bn,
      type: c.type,
      phone: c.phone,
      vehicleNumbers: c.vehicle_numbers ?? [],
      creditLimit: asMoney(c.credit_limit),
      openingBalance: asMoney(c.opening_balance),
      openingBalanceAsOf: c.opening_balance_as_of,
      isActive: c.is_active,
      notes: c.notes,
      balance: asMoney(age?.balance ?? c.opening_balance),
      bucket0to30: asMoney(age?.bucket_0_30),
      bucket31to60: asMoney(age?.bucket_31_60),
      bucket61to90: asMoney(age?.bucket_61_90),
      bucket90plus: asMoney(age?.bucket_90_plus),
      oldestItemDays: age?.oldest_item_days ?? null,
      openingDated: age?.opening_dated ?? true,
    };
  });
}

// A party's statement is fetched by the getStatement action in app/dues, not
// from here: it is loaded when a party is opened rather than for all 21 at
// once, so it belongs with the panel that asks for it.

export interface AgeingTotals {
  balance: string;
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket90plus: string;
  partiesOwing: number;
  overLimit: number;
  undatedOpenings: number;
}

/**
 * Totals are summed here rather than in SQL so the page shows the sum of
 * exactly the rows it is displaying. A total that comes from a different query
 * than its rows is a total nobody can check.
 */
export function ageingTotals(parties: CreditParty[]): AgeingTotals {
  const total = (pick: (p: CreditParty) => string) => moneyStr(sum(parties.map(pick)));

  return {
    balance: total((p) => p.balance),
    bucket0to30: total((p) => p.bucket0to30),
    bucket31to60: total((p) => p.bucket31to60),
    bucket61to90: total((p) => p.bucket61to90),
    bucket90plus: total((p) => p.bucket90plus),
    partiesOwing: parties.filter((p) => dec(p.balance).greaterThan(0)).length,
    overLimit: parties.filter(
      (p) => dec(p.creditLimit).greaterThan(0) && dec(p.balance).greaterThan(dec(p.creditLimit)),
    ).length,
    undatedOpenings: parties.filter((p) => !p.openingDated).length,
  };
}

export interface PaymentRow {
  id: string;
  customerId: string;
  customerName: string;
  amount: string;
  method: string;
  reference: string | null;
  receivedAt: string;
  note: string | null;
}

export async function getRecentPayments(limit = 30): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('payments')
    .select('id, customer_id, amount, method, reference, received_at, note, customers(name)')
    .is('deleted_at', null)
    .order('received_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => {
    const joined = r.customers as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(joined) ? joined[0]?.name : joined?.name;
    return {
      id: r.id,
      customerId: r.customer_id,
      customerName: name ?? '—',
      amount: asMoney(r.amount),
      method: r.method,
      reference: r.reference,
      receivedAt: r.received_at,
      note: r.note,
    };
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseCategory {
  id: string;
  name: string;
  nameBn: string | null;
  group: string;
  sortOrder: number;
}

export async function getExpenseCategories(): Promise<ExpenseCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('expense_categories')
    .select('id, name, name_bn, group:group, sort_order')
    .eq('is_active', true)
    .order('sort_order');

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    nameBn: c.name_bn,
    group: c.group,
    sortOrder: c.sort_order,
  }));
}

export interface ExpenseRow {
  id: string;
  amount: string;
  description: string | null;
  descriptionBn: string | null;
  paidBy: string;
  spentAt: string;
  categoryId: string;
  categoryName: string;
  categoryNameBn: string | null;
  group: string;
  /** True for a row a trigger wrote, which nobody should edit by hand. */
  isDerived: boolean;
}

export interface ExpenseBook {
  rows: ExpenseRow[];
  /** Day, month and year totals per book, for the two-book summary. */
  totals: Record<'day' | 'month' | 'year', Record<string, string>>;
}

function paisa(rows: ExpenseRow[]): string {
  return moneyStr(sum(rows.map((r) => r.amount)));
}

/**
 * Two books, as the paper does it: the Pump book is what the station spends to
 * run, and the Chairman book is what the owner draws. They are never added
 * together into one "expenses" figure, because only the first belongs in the
 * cost of running the pump.
 */
export async function getExpenses(): Promise<ExpenseBook> {
  const supabase = await createClient();
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const { data } = await supabase
    .from('expenses')
    .select(
      'id, amount, description, description_bn, paid_by, spent_at, category_id, expense_categories(name, name_bn, group)',
    )
    .is('deleted_at', null)
    .gte('spent_at', since.toISOString())
    .order('spent_at', { ascending: false });

  const rows: ExpenseRow[] = (data ?? []).map((r) => {
    const joined = r.expense_categories as unknown as
      | { name: string; name_bn: string | null; group: string }
      | { name: string; name_bn: string | null; group: string }[]
      | null;
    const cat = Array.isArray(joined) ? joined[0] : joined;
    return {
      id: r.id,
      amount: asMoney(r.amount),
      description: r.description,
      descriptionBn: r.description_bn,
      paidBy: r.paid_by,
      spentAt: r.spent_at,
      categoryId: r.category_id,
      categoryName: cat?.name ?? '—',
      categoryNameBn: cat?.name_bn ?? null,
      group: cat?.group ?? 'other',
      isDerived: cat?.name === 'Lubricant Own Use',
    };
  });

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(6, 0, 0, 0);
  if (now.getHours() < 6) startOfDay.setDate(startOfDay.getDate() - 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const within = (from: Date) => rows.filter((r) => new Date(r.spentAt) >= from);
  const byBook = (subset: ExpenseRow[]) => {
    const books: Record<string, string> = {};
    const groups = new Set(subset.map((r) => r.group));
    for (const g of groups) books[g] = paisa(subset.filter((r) => r.group === g));
    books.all = paisa(subset);
    // Three books since Phase 8: the pump's running costs, the owner's
    // drawings, and oil the station put into its own lorries. They are never
    // summed into one "expenses" figure, because only the first is what it
    // costs to run the pump.
    books.chairman = paisa(subset.filter((r) => r.group === 'chairman'));
    books.own_use = paisa(subset.filter((r) => r.group === 'own_use'));
    books.pump = paisa(subset.filter((r) => r.group !== 'chairman' && r.group !== 'own_use'));
    return books;
  };

  return {
    rows,
    totals: {
      day: byBook(within(startOfDay)),
      month: byBook(within(startOfMonth)),
      year: byBook(within(startOfYear)),
    },
  };
}

// ---------------------------------------------------------------------------
// The drawer
// ---------------------------------------------------------------------------

export interface CashShift {
  shiftId: string;
  shiftDate: string;
  shiftType: string;
  endsAt: string;
  openingCash: string;
  cashSales: string;
  duesCollected: string;
  expensesCash: string;
  bankDeposits: string;
  expectedCash: string;
  countedCash: string;
  cashVariance: string;
  varianceReason: string | null;
}

export interface CashPosition {
  shifts: CashShift[];
  /** The count from the most recent close: what should be in the drawer now. */
  inHand: string | null;
  /** True while consecutive closes chain — each opening equals the last count. */
  chainUnbroken: boolean;
  brokenAt: string | null;
}

export async function getCashPosition(limit = 30): Promise<CashPosition> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('cash_reconciliation')
    .select(
      'shift_id, opening_cash, cash_sales, dues_collected, expenses_cash, bank_deposits, expected_cash, counted_cash, cash_variance, variance_reason, shifts(shift_date, shift_type, ends_at)',
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  const shifts: CashShift[] = (data ?? []).map((r) => {
    const joined = r.shifts as unknown as
      | { shift_date: string; shift_type: string; ends_at: string }
      | { shift_date: string; shift_type: string; ends_at: string }[]
      | null;
    const s = Array.isArray(joined) ? joined[0] : joined;
    return {
      shiftId: r.shift_id,
      shiftDate: s?.shift_date ?? '',
      shiftType: s?.shift_type ?? '',
      endsAt: s?.ends_at ?? '',
      openingCash: asMoney(r.opening_cash),
      cashSales: asMoney(r.cash_sales),
      duesCollected: asMoney(r.dues_collected),
      expensesCash: asMoney(r.expenses_cash),
      bankDeposits: asMoney(r.bank_deposits),
      expectedCash: asMoney(r.expected_cash),
      countedCash: asMoney(r.counted_cash),
      cashVariance: asMoney(r.cash_variance),
      varianceReason: r.variance_reason,
    };
  });

  shifts.sort((a, b) => (a.endsAt < b.endsAt ? 1 : -1));

  // Walk backwards through consecutive closes: every shift's opening must be
  // the one before it counted. A break means a close was recorded out of order
  // or the drawer was reconciled against a figure nobody counted.
  let chainUnbroken = true;
  let brokenAt: string | null = null;
  for (let i = 0; i < shifts.length - 1; i += 1) {
    const later = shifts[i];
    const earlier = shifts[i + 1];
    if (!later || !earlier) break;
    if (!dec(later.openingCash).equals(dec(earlier.countedCash))) {
      chainUnbroken = false;
      brokenAt = later.shiftDate;
      break;
    }
  }

  return {
    shifts,
    inHand: shifts[0]?.countedCash ?? null,
    chainUnbroken,
    brokenAt,
  };
}
