import { CalcError, D, dec, litres as toLitres, type Decimal, type Numeric } from './decimal';

/**
 * A BSTI-certified calibration chart: dip in millimetres → litres, at 1 mm
 * granularity. This chart is the legal reference for the tank's contents. It is
 * never replaced by a cylinder formula — the real tank has dished ends and the
 * certified figures deviate from the ideal cylinder by up to about 2%.
 */
export interface CalibrationRow {
  dipMm: number;
  litres: Numeric;
}

export interface CalibrationChart {
  tankId: string;
  tankCode: string;
  version: number;
  /** The dip at which this tank is full — 2070 mm for T1, 2051 mm for T2. */
  finalDipMm: number;
  validFrom: Date;
  validTo: Date;
  rows: CalibrationRow[];
}

/** A chart that has passed `validateChart`, with an O(1) lookup index. */
export interface IndexedChart extends CalibrationChart {
  readonly byDip: ReadonlyArray<Decimal>; // index i holds the litres at dip (i + 1) mm
}

export interface ChartValidationIssue {
  code: 'GAP' | 'DUPLICATE' | 'NOT_MONOTONIC' | 'RANGE' | 'EMPTY' | 'NEGATIVE';
  message: string;
  dipMm?: number;
}

/**
 * A chart is only loadable when it covers every integer millimetre from 1 to
 * the tank's own final dip, with no gaps, no duplicates, and strictly
 * increasing litres. A chart that fails either check is refused — a hole in the
 * chart would silently mis-state stock.
 */
export function validateChart(chart: CalibrationChart): ChartValidationIssue[] {
  const issues: ChartValidationIssue[] = [];
  if (!Number.isInteger(chart.finalDipMm) || chart.finalDipMm < 1) {
    issues.push({ code: 'RANGE', message: `final_dip_mm must be a positive integer, got ${chart.finalDipMm}` });
    return issues;
  }
  if (chart.rows.length === 0) {
    issues.push({ code: 'EMPTY', message: `Chart for ${chart.tankCode} has no rows` });
    return issues;
  }

  const sorted = [...chart.rows].sort((a, b) => a.dipMm - b.dipMm);
  const seen = new Set<number>();
  let previous: Decimal | null = null;

  for (const row of sorted) {
    if (!Number.isInteger(row.dipMm)) {
      issues.push({ code: 'RANGE', message: `dip_mm must be an integer, got ${row.dipMm}`, dipMm: row.dipMm });
      continue;
    }
    if (row.dipMm < 1 || row.dipMm > chart.finalDipMm) {
      issues.push({
        code: 'RANGE',
        message: `dip ${row.dipMm} mm is outside 1–${chart.finalDipMm} mm for ${chart.tankCode}`,
        dipMm: row.dipMm,
      });
      continue;
    }
    if (seen.has(row.dipMm)) {
      issues.push({ code: 'DUPLICATE', message: `dip ${row.dipMm} mm appears more than once`, dipMm: row.dipMm });
      continue;
    }
    seen.add(row.dipMm);

    const value = dec(row.litres, `litres at ${row.dipMm} mm`);
    if (value.isNegative()) {
      issues.push({ code: 'NEGATIVE', message: `negative litres at dip ${row.dipMm} mm`, dipMm: row.dipMm });
    }
    if (previous !== null && value.lessThanOrEqualTo(previous)) {
      issues.push({
        code: 'NOT_MONOTONIC',
        message: `litres must strictly increase with dip: ${previous.toString()} → ${value.toString()} at ${row.dipMm} mm`,
        dipMm: row.dipMm,
      });
    }
    previous = value;
  }

  for (let mm = 1; mm <= chart.finalDipMm; mm++) {
    if (!seen.has(mm)) {
      issues.push({ code: 'GAP', message: `chart for ${chart.tankCode} is missing dip ${mm} mm`, dipMm: mm });
      if (issues.filter((i) => i.code === 'GAP').length > 20) {
        issues.push({ code: 'GAP', message: '…further gaps suppressed' });
        break;
      }
    }
  }

  return issues;
}

/** Validate and index a chart, or throw. Use this at import and at load time. */
export function indexChart(chart: CalibrationChart): IndexedChart {
  const issues = validateChart(chart);
  if (issues.length > 0) {
    throw new CalcError('INVALID_CALIBRATION_CHART', `Calibration chart for ${chart.tankCode} v${chart.version} is not loadable`, {
      issues: issues.slice(0, 25),
      issueCount: issues.length,
    });
  }
  const byDip = new Array<Decimal>(chart.finalDipMm);
  for (const row of chart.rows) {
    byDip[row.dipMm - 1] = dec(row.litres);
  }
  return { ...chart, byDip };
}

/**
 * Convert a dip reading to litres against a specific chart version.
 *
 * An integer dip is an exact table lookup. A dip recorded with a decimal — the
 * rod reads between two millimetre marks — is linearly interpolated between the
 * two bracketing certified rows.
 */
export function dipToLitres(chart: IndexedChart, dipMm: Numeric): Decimal {
  const dip = dec(dipMm, 'dip_mm');

  if (dip.lessThan(1) || dip.greaterThan(chart.finalDipMm)) {
    throw new CalcError(
      'DIP_OUT_OF_RANGE',
      `Dip ${dip.toString()} mm is outside the certified range 1–${chart.finalDipMm} mm for tank ${chart.tankCode}`,
      { tankCode: chart.tankCode, finalDipMm: chart.finalDipMm, dipMm: dip.toString() },
    );
  }

  if (dip.isInteger()) {
    const exact = chart.byDip[dip.toNumber() - 1];
    if (!exact) {
      throw new CalcError('CHART_HOLE', `Chart for ${chart.tankCode} has no row at ${dip.toString()} mm`);
    }
    return toLitres(exact);
  }

  const lowerMm = dip.floor().toNumber();
  const upperMm = dip.ceil().toNumber();
  const lower = chart.byDip[lowerMm - 1];
  const upper = chart.byDip[upperMm - 1];
  if (!lower || !upper) {
    throw new CalcError('CHART_HOLE', `Chart for ${chart.tankCode} cannot bracket ${dip.toString()} mm`);
  }
  const fraction = dip.minus(lowerMm); // 0 < fraction < 1
  return toLitres(lower.plus(upper.minus(lower).times(fraction)));
}

/**
 * The inverse lookup: what dip corresponds to a volume. Used for ullage and for
 * "how many millimetres will this delivery add" previews — never as the source
 * of a stock figure, which always comes from a measured dip.
 */
export function litresToDip(chart: IndexedChart, volume: Numeric): Decimal {
  const target = dec(volume, 'litres');
  const first = chart.byDip[0];
  const last = chart.byDip[chart.finalDipMm - 1];
  if (!first || !last) throw new CalcError('CHART_HOLE', `Chart for ${chart.tankCode} is not indexed`);

  if (target.lessThan(first) || target.greaterThan(last)) {
    throw new CalcError(
      'VOLUME_OUT_OF_RANGE',
      `${target.toString()} L is outside the certified range ${first.toString()}–${last.toString()} L for tank ${chart.tankCode}`,
      { tankCode: chart.tankCode },
    );
  }

  // The chart is strictly increasing, so a binary search finds the bracket.
  let lo = 0;
  let hi = chart.finalDipMm - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = chart.byDip[mid]!;
    if (value.lessThan(target)) lo = mid + 1;
    else hi = mid;
  }
  const atLo = chart.byDip[lo]!;
  if (atLo.equals(target) || lo === 0) return new D(lo + 1);

  const below = chart.byDip[lo - 1]!;
  const span = atLo.minus(below);
  if (span.isZero()) return new D(lo + 1);
  const fraction = target.minus(below).dividedBy(span);
  return new D(lo).plus(fraction).toDecimalPlaces(1, D.ROUND_HALF_UP);
}

/** Empty space left in the tank, in litres, at a given dip. */
export function ullageLitres(chart: IndexedChart, dipMm: Numeric): Decimal {
  const full = chart.byDip[chart.finalDipMm - 1]!;
  return toLitres(full.minus(dipToLitres(chart, dipMm)));
}

/**
 * Pick the chart version in force at a given moment. A dip reading always
 * resolves against the version valid on its own timestamp, so re-calibrating a
 * tank never retroactively changes a closed shift.
 */
export function chartVersionAt(charts: IndexedChart[], at: Date): IndexedChart | null {
  const candidates = charts.filter((c) => c.validFrom.getTime() <= at.getTime() && at.getTime() <= c.validTo.getTime());
  if (candidates.length === 0) return null;
  return candidates.reduce((newest, c) => (c.version > newest.version ? c : newest));
}

export interface ChartExpiryStatus {
  expired: boolean;
  daysRemaining: number;
  warn: boolean;
  validTo: Date;
}

export const CHART_EXPIRY_WARNING_DAYS = 90;

/**
 * JHM's current charts run 31-01-2022 → 30-01-2027. The admin dashboard warns
 * 90 days out, and dip entry is blocked against an expired version unless an
 * admin overrides with a reason.
 */
export function chartExpiryStatus(chart: Pick<CalibrationChart, 'validTo'>, now: Date): ChartExpiryStatus {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.floor((chart.validTo.getTime() - now.getTime()) / msPerDay);
  return {
    expired: daysRemaining < 0,
    daysRemaining,
    warn: daysRemaining >= 0 && daysRemaining <= CHART_EXPIRY_WARNING_DAYS,
    validTo: chart.validTo,
  };
}
