import { CalcError, D, dec, litres as toLitres, money, pct, type Decimal, type Numeric } from './decimal';
import { dipToLitres, type IndexedChart } from './dip';

/** A road tanker arrives with four compartments of 4,500 L. */
export const COMPARTMENT_DECLARED_LITRES = '4500';
export const COMPARTMENTS_PER_TANKER = 4;
/** Shortage tolerance before the delivery is flagged, as a percent of declared. */
export const DEFAULT_SHORTAGE_TOLERANCE_PCT = '0.3';
/** A compartment may not be discharged into a tank past this fill fraction. */
export const OVERFILL_LIMIT_PCT = '95';

export interface CompartmentInput {
  compartmentNo: number;
  declaredLitres: Numeric;
  chart: IndexedChart;
  dipBeforeMm: Numeric;
  dipAfterMm: Numeric;
  shortageTolerancePct?: Numeric;
}

export interface CompartmentResult {
  compartmentNo: number;
  tankCode: string;
  declaredLitres: Decimal;
  litresBefore: Decimal;
  litresAfter: Decimal;
  receivedLitres: Decimal;
  shortageLitres: Decimal;
  shortagePct: Decimal | null;
  shortageFlagged: boolean;
}

/**
 * What actually went into the tank, measured by the tank's own dip rod against
 * its certified chart — not by what the challan claims. The difference between
 * the two is the shortage the dealer can claim against the depot.
 */
export function compartmentReceipt(input: CompartmentInput): CompartmentResult {
  if (!Number.isInteger(input.compartmentNo) || input.compartmentNo < 1 || input.compartmentNo > COMPARTMENTS_PER_TANKER) {
    throw new CalcError('BAD_COMPARTMENT_NO', `compartment_no must be 1–${COMPARTMENTS_PER_TANKER}, got ${input.compartmentNo}`);
  }

  const declared = toLitres(dec(input.declaredLitres, 'declared_litres'));
  const before = dipToLitres(input.chart, input.dipBeforeMm);
  const after = dipToLitres(input.chart, input.dipAfterMm);

  if (after.lessThan(before)) {
    throw new CalcError('DIP_WENT_DOWN', 'The dip after a discharge cannot be lower than the dip before it', {
      compartmentNo: input.compartmentNo,
      litresBefore: before.toFixed(3),
      litresAfter: after.toFixed(3),
    });
  }

  const received = toLitres(after.minus(before));
  const shortage = toLitres(declared.minus(received));
  const shortagePct = declared.isZero() ? null : pct(shortage, declared)!.toDecimalPlaces(4);
  const tolerance = dec(input.shortageTolerancePct ?? DEFAULT_SHORTAGE_TOLERANCE_PCT, 'shortage_tolerance_pct');

  return {
    compartmentNo: input.compartmentNo,
    tankCode: input.chart.tankCode,
    declaredLitres: declared,
    litresBefore: before,
    litresAfter: after,
    receivedLitres: received,
    shortageLitres: shortage,
    shortagePct,
    shortageFlagged: shortagePct !== null && shortagePct.greaterThan(tolerance),
  };
}

export interface DeliveryTotals {
  totalDeclared: Decimal;
  totalReceived: Decimal;
  totalShortage: Decimal;
  shortagePct: Decimal | null;
  purchaseValue: Decimal;
  flaggedCompartments: number[];
}

export function deliveryTotals(compartments: CompartmentResult[], depotRatePerLitre: Numeric): DeliveryTotals {
  const rate = money(dec(depotRatePerLitre, 'depot_rate'));
  const declared = compartments.reduce<Decimal>((a, c) => a.plus(c.declaredLitres), new D(0));
  const received = compartments.reduce<Decimal>((a, c) => a.plus(c.receivedLitres), new D(0));
  const shortage = toLitres(declared.minus(received));

  return {
    totalDeclared: toLitres(declared),
    totalReceived: toLitres(received),
    totalShortage: shortage,
    shortagePct: declared.isZero() ? null : pct(shortage, declared)!.toDecimalPlaces(4),
    purchaseValue: money(toLitres(received).times(rate)),
    flaggedCompartments: compartments.filter((c) => c.shortageFlagged).map((c) => c.compartmentNo),
  };
}

export interface OverfillCheck {
  willOverfill: boolean;
  capacityLitres: Decimal;
  safeLimitLitres: Decimal;
  currentLitres: Decimal;
  projectedLitres: Decimal;
  headroomLitres: Decimal;
}

/**
 * Checked before a compartment is discharged: a tank that is already most of
 * the way full cannot take another 4,500 L.
 */
export function checkOverfill(
  chart: IndexedChart,
  currentDipMm: Numeric,
  incomingLitres: Numeric,
  limitPct: Numeric = OVERFILL_LIMIT_PCT,
): OverfillCheck {
  const capacity = chart.byDip[chart.finalDipMm - 1]!;
  const safeLimit = toLitres(capacity.times(dec(limitPct, 'limit_pct')).dividedBy(100));
  const current = dipToLitres(chart, currentDipMm);
  const projected = toLitres(current.plus(dec(incomingLitres, 'incoming_litres')));

  return {
    willOverfill: projected.greaterThan(safeLimit),
    capacityLitres: toLitres(capacity),
    safeLimitLitres: safeLimit,
    currentLitres: current,
    projectedLitres: projected,
    headroomLitres: toLitres(safeLimit.minus(current)),
  };
}
