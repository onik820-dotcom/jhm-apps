import DecimalJs from 'decimal.js';

/**
 * A private Decimal constructor so that app-wide configuration can never be
 * changed out from under these calculations by another library on the page.
 *
 * Rounding is HALF_UP: the convention the station's paper ledgers already use.
 */
export const D = DecimalJs.clone({
  precision: 34,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -15,
  toExpPos: 30,
});

export type Decimal = InstanceType<typeof D>;
export type Numeric = string | number | Decimal;

/** Scale of a money column in Postgres: NUMERIC(14,2). */
export const MONEY_DP = 2;
/** Scale of a volume column in Postgres: NUMERIC(12,3). */
export const LITRE_DP = 3;

export class CalcError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CalcError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Parse anything the UI or the database hands us into a Decimal.
 *
 * Rejects NaN, Infinity, null and empty strings loudly instead of letting them
 * become a silent zero somewhere downstream in a shift close.
 */
export function dec(value: Numeric | null | undefined, field = 'value'): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new CalcError('MISSING_NUMBER', `${field} is required and was empty`);
  }
  let d: Decimal;
  try {
    d = new D(value as DecimalJs.Value);
  } catch {
    throw new CalcError('NOT_A_NUMBER', `${field} is not a number: ${String(value)}`);
  }
  if (!d.isFinite()) {
    throw new CalcError('NOT_FINITE', `${field} is not finite: ${String(value)}`);
  }
  return d;
}

/** Same as `dec`, but an absent value becomes zero — for optional money fields. */
export function decOr0(value: Numeric | null | undefined, field = 'value'): Decimal {
  if (value === null || value === undefined || value === '') return new D(0);
  return dec(value, field);
}

/** Round to money scale and return a Decimal. */
export function money(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(MONEY_DP, D.ROUND_HALF_UP);
}

/** Round to litre scale and return a Decimal. */
export function litres(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(LITRE_DP, D.ROUND_HALF_UP);
}

/**
 * Serialise for a Postgres NUMERIC(14,2) column — a fixed-point string, never a
 * JS float. `toFixed` on Decimal is exact.
 */
export function moneyStr(value: Numeric): string {
  return money(value).toFixed(MONEY_DP);
}

/** Serialise for a Postgres NUMERIC(12,3) column. */
export function litresStr(value: Numeric): string {
  return litres(value).toFixed(LITRE_DP);
}

export function sum(values: Numeric[], field = 'value'): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v, field)), new D(0));
}

export const ZERO: Decimal = new D(0);

/** Percentage helper that returns null instead of dividing by zero. */
export function pct(part: Numeric, whole: Numeric): Decimal | null {
  const w = dec(whole, 'whole');
  if (w.isZero()) return null;
  return dec(part, 'part').dividedBy(w).times(100);
}
