import { dec, decOr0, money, type Decimal, type Numeric } from './decimal';

export interface CashReconciliationInput {
  openingCash: Numeric;
  cashSales: Numeric;
  duesCollected: Numeric;
  expensesCash: Numeric;
  bankDeposits: Numeric;
  countedCash: Numeric;
  /** Any non-zero variance blocks a clean close; this is the paisa tolerance for "zero". */
  tolerance?: Numeric;
}

export interface CashReconciliationResult {
  expectedCash: Decimal;
  countedCash: Decimal;
  cashVariance: Decimal;
  /** True when the manager must type a reason before sign-off is enabled. */
  requiresReason: boolean;
}

/**
 * Expected cash in the drawer versus the cash actually counted.
 *
 * A non-zero variance never rounds away: the manager enters a reason and the
 * variance is stored with the shift.
 */
export function reconcileCash(input: CashReconciliationInput): CashReconciliationResult {
  const expected = money(
    dec(input.openingCash, 'opening_cash')
      .plus(dec(input.cashSales, 'cash_sales'))
      .plus(decOr0(input.duesCollected, 'dues_collected'))
      .minus(decOr0(input.expensesCash, 'expenses_cash'))
      .minus(decOr0(input.bankDeposits, 'bank_deposits')),
  );
  const counted = money(dec(input.countedCash, 'counted_cash'));
  const variance = money(counted.minus(expected));
  const tolerance = money(decOr0(input.tolerance ?? 0, 'tolerance'));

  return {
    expectedCash: expected,
    countedCash: counted,
    cashVariance: variance,
    requiresReason: variance.abs().greaterThan(tolerance),
  };
}

export interface LedgerEntry {
  entryType: 'opening' | 'sale' | 'payment' | 'adjustment';
  debit: Numeric;
  credit: Numeric;
}

/**
 * A credit customer's running balance. Debit raises what the party owes, credit
 * reduces it. The database maintains this with a trigger; this mirror is what
 * the UI uses for previews and what the tests check the trigger against.
 */
export function runningBalance(openingBalance: Numeric, entries: LedgerEntry[]): Decimal {
  let balance = money(dec(openingBalance, 'opening_balance'));
  for (const entry of entries) {
    balance = money(balance.plus(decOr0(entry.debit, 'debit')).minus(decOr0(entry.credit, 'credit')));
  }
  return balance;
}

export interface CreditLimitCheck {
  currentBalance: Decimal;
  creditLimit: Decimal;
  projectedBalance: Decimal;
  availableCredit: Decimal;
  utilisationPct: Decimal | null;
  exceeded: boolean;
}

export function checkCreditLimit(
  currentBalance: Numeric,
  creditLimit: Numeric,
  saleAmount: Numeric = 0,
): CreditLimitCheck {
  const balance = money(dec(currentBalance, 'current_balance'));
  const limit = money(dec(creditLimit, 'credit_limit'));
  const projected = money(balance.plus(decOr0(saleAmount, 'sale_amount')));

  return {
    currentBalance: balance,
    creditLimit: limit,
    projectedBalance: projected,
    availableCredit: money(limit.minus(projected)),
    utilisationPct: limit.isZero() ? null : projected.dividedBy(limit).times(100).toDecimalPlaces(2),
    exceeded: !limit.isZero() && projected.greaterThan(limit),
  };
}

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface AgeingInput {
  amount: Numeric;
  /** Age of the outstanding item in days, as of the report date. */
  ageDays: number;
}

export function ageingBuckets(items: AgeingInput[]): Record<AgeingBucket, Decimal> {
  const out: Record<AgeingBucket, Decimal> = {
    '0-30': money(0),
    '31-60': money(0),
    '61-90': money(0),
    '90+': money(0),
  };
  for (const item of items) {
    const bucket: AgeingBucket =
      item.ageDays <= 30 ? '0-30' : item.ageDays <= 60 ? '31-60' : item.ageDays <= 90 ? '61-90' : '90+';
    out[bucket] = money(out[bucket].plus(dec(item.amount, 'amount')));
  }
  return out;
}
