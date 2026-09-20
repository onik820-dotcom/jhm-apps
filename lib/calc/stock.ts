import { CalcError, dec, litres as toLitres, pct, type Decimal, type Numeric } from './decimal';

/** Default tolerance before a variance becomes an alert: ±0.5% of litres sold. */
export const DEFAULT_VARIANCE_PCT = '0.5';

export interface TankStockInput {
  /** The previous shift's book_closing for this tank. The chain must be unbroken. */
  bookOpening: Numeric;
  /** Litres received into this tank during the shift. */
  refillLitres: Numeric;
  /** Net litres sold by every dispenser mapped to this tank. */
  soldFromTank: Numeric;
  /** Litres from the certified chart at the closing dip. */
  physicalClosing: Numeric;
  /** Threshold in percent; defaults to 0.5. */
  thresholdPct?: Numeric;
}

export interface TankStockResult {
  bookOpening: Decimal;
  refillLitres: Decimal;
  soldFromTank: Decimal;
  bookClosing: Decimal;
  physicalClosing: Decimal;
  varianceLitres: Decimal;
  /** Null when nothing was sold from this tank — a percentage would be meaningless. */
  variancePct: Decimal | null;
  /** True when |variance %| is past the threshold, or litres moved with no sales base. */
  breached: boolean;
  thresholdPct: Decimal;
}

/**
 * Book stock versus physical stock for one tank across one shift.
 *
 * Book stock is what the paperwork says should be in the tank; physical stock
 * is what the dip rod says actually is. The gap between them is the number the
 * business reconciles against, so it is recorded rather than smoothed.
 */
export function tankStock(input: TankStockInput): TankStockResult {
  const bookOpening = toLitres(dec(input.bookOpening, 'book_opening'));
  const refill = toLitres(dec(input.refillLitres, 'refill_litres'));
  const sold = toLitres(dec(input.soldFromTank, 'sold_from_tank'));
  const physical = toLitres(dec(input.physicalClosing, 'physical_closing'));
  const threshold = dec(input.thresholdPct ?? DEFAULT_VARIANCE_PCT, 'threshold_pct');

  if (refill.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'refill_litres cannot be negative');
  if (sold.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'sold_from_tank cannot be negative');
  if (physical.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'physical_closing cannot be negative');

  const bookClosing = toLitres(bookOpening.plus(refill).minus(sold));
  const varianceLitres = toLitres(physical.minus(bookClosing));
  const variancePct = sold.isZero() ? null : pct(varianceLitres, sold)!.toDecimalPlaces(4);

  const breached =
    variancePct === null ? !varianceLitres.isZero() : variancePct.abs().greaterThan(threshold.abs());

  return {
    bookOpening,
    refillLitres: refill,
    soldFromTank: sold,
    bookClosing,
    physicalClosing: physical,
    varianceLitres,
    variancePct,
    breached,
    thresholdPct: threshold,
  };
}

export interface ShiftStockLink {
  shiftId: string;
  tankId: string;
  sequence: number;
  bookOpening: Numeric;
  bookClosing: Numeric;
}

export interface ChainBreak {
  tankId: string;
  fromShiftId: string;
  toShiftId: string;
  expectedOpening: string;
  actualOpening: string;
  differenceLitres: string;
}

/**
 * Shift N's book_closing must be shift N+1's book_opening, per tank. The
 * database enforces this too; this function is what the UI and the
 * recalculation routine use to report exactly where a chain broke.
 */
export function findChainBreaks(links: ShiftStockLink[]): ChainBreak[] {
  const byTank = new Map<string, ShiftStockLink[]>();
  for (const link of links) {
    const list = byTank.get(link.tankId) ?? [];
    list.push(link);
    byTank.set(link.tankId, list);
  }

  const breaks: ChainBreak[] = [];
  for (const [tankId, list] of byTank) {
    const ordered = [...list].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < ordered.length; i++) {
      const previous = ordered[i - 1]!;
      const current = ordered[i]!;
      const expected = toLitres(dec(previous.bookClosing, 'book_closing'));
      const actual = toLitres(dec(current.bookOpening, 'book_opening'));
      if (!expected.equals(actual)) {
        breaks.push({
          tankId,
          fromShiftId: previous.shiftId,
          toShiftId: current.shiftId,
          expectedOpening: expected.toFixed(3),
          actualOpening: actual.toFixed(3),
          differenceLitres: actual.minus(expected).toFixed(3),
        });
      }
    }
  }
  return breaks;
}

/**
 * Re-run the book chain from a given point forward, which is what has to happen
 * whenever an earlier shift is edited or reopened. Sales and refills stay as
 * recorded; only the opening/closing book figures are re-derived.
 */
export interface RecalcShiftInput {
  shiftId: string;
  sequence: number;
  refillLitres: Numeric;
  soldFromTank: Numeric;
  physicalClosing: Numeric;
}

export function recalculateChain(
  startingBookOpening: Numeric,
  shifts: RecalcShiftInput[],
  thresholdPct: Numeric = DEFAULT_VARIANCE_PCT,
): Array<TankStockResult & { shiftId: string }> {
  let opening = toLitres(dec(startingBookOpening, 'book_opening'));
  const ordered = [...shifts].sort((a, b) => a.sequence - b.sequence);
  const out: Array<TankStockResult & { shiftId: string }> = [];

  for (const shift of ordered) {
    const result = tankStock({
      bookOpening: opening,
      refillLitres: shift.refillLitres,
      soldFromTank: shift.soldFromTank,
      physicalClosing: shift.physicalClosing,
      thresholdPct,
    });
    out.push({ ...result, shiftId: shift.shiftId });
    opening = result.bookClosing;
  }
  return out;
}
