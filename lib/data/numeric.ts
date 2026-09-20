import { D, dec, type Numeric } from '@/lib/calc/decimal';

/**
 * The boundary where a Postgres `numeric` becomes a string we can trust.
 *
 * PostgREST serialises every `numeric` column as a JSON *number*, so by the
 * time supabase-js hands a row over, `amount` is already a JavaScript double —
 * for table selects, for set-returning functions and for values inside a
 * jsonb result alike. Several of this project's data layers declare those
 * fields as `string`, which was simply wrong; the type said one thing and the
 * runtime did another.
 *
 * No money has actually been lost by it. A double round-trips through its
 * shortest decimal representation, and decimal.js builds from exactly that, so
 * `18765065.55` comes back as `18765065.55` at every station-sized magnitude.
 * What the double cannot survive is *arithmetic* — two of them added in
 * JavaScript is a float operation, and that is the thing the whole project is
 * built to avoid.
 *
 * So numbers are converted here, once, on the way in: every figure below this
 * line really is a fixed-point string, and anything that wants to add two of
 * them has to go through decimal.js to do it.
 */

function toScale(value: Numeric | null | undefined, dp: number, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  return dec(value).toDecimalPlaces(dp, D.ROUND_HALF_UP).toFixed(dp);
}

/** A money column: NUMERIC(14,2). */
export function asMoney(value: Numeric | null | undefined, fallback = '0.00'): string {
  return toScale(value, 2, fallback);
}

/** A volume column: NUMERIC(12,3). */
export function asLitres(value: Numeric | null | undefined, fallback = '0.000'): string {
  return toScale(value, 3, fallback);
}

/** A cost column carried at four decimals, such as a moving average. */
export function asCost(value: Numeric | null | undefined, fallback = '0.0000'): string {
  return toScale(value, 4, fallback);
}

/** Money that is genuinely absent, kept as null rather than becoming zero. */
export function asMoneyOrNull(value: Numeric | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return asMoney(value);
}

/** A percentage, kept at four decimals to match how variance is stored. */
export function asPctOrNull(value: Numeric | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return toScale(value, 4, '0.0000');
}
