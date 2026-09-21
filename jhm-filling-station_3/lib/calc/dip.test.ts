import { describe, expect, it } from 'vitest';
import {
  CHART_EXPIRY_WARNING_DAYS,
  chartExpiryStatus,
  chartVersionAt,
  dipToLitres,
  indexChart,
  litresToDip,
  ullageLitres,
  validateChart,
  type CalibrationChart,
} from './dip';
import { CalcError } from './decimal';
import { loadChartCsv, tank1Chart, tank2Chart, VALID_FROM, VALID_TO } from './__fixtures__/charts';

describe('certified chart integrity', () => {
  it('loads Tank 1 with 2070 contiguous rows and Tank 2 with 2051', () => {
    expect(tank1Chart().rows).toHaveLength(2070);
    expect(tank2Chart().rows).toHaveLength(2051);
  });

  it('refuses a chart with a gap', () => {
    const chart = loadChartCsv('tank1_calibration.csv', 'tank-1', 'T1', 2070);
    chart.rows = chart.rows.filter((r) => r.dipMm !== 900);
    const issues = validateChart(chart);
    expect(issues.some((i) => i.code === 'GAP' && i.dipMm === 900)).toBe(true);
    expect(() => indexChart(chart)).toThrow(CalcError);
  });

  it('refuses a chart that is not strictly increasing', () => {
    const chart = loadChartCsv('tank2_calibration.csv', 'tank-2', 'T2', 2051);
    chart.rows[500] = { dipMm: 501, litres: '1' };
    expect(validateChart(chart).some((i) => i.code === 'NOT_MONOTONIC')).toBe(true);
  });

  it('refuses a chart with a duplicate dip', () => {
    const chart: CalibrationChart = {
      tankId: 't', tankCode: 'TX', version: 1, finalDipMm: 3,
      validFrom: VALID_FROM, validTo: VALID_TO,
      rows: [{ dipMm: 1, litres: '1' }, { dipMm: 2, litres: '2' }, { dipMm: 2, litres: '3' }],
    };
    const issues = validateChart(chart);
    expect(issues.some((i) => i.code === 'DUPLICATE')).toBe(true);
  });
});

describe('dipToLitres — Phase 2 acceptance', () => {
  it('returns the certified litres at 1450 mm for both tanks', () => {
    expect(dipToLitres(tank1Chart(), 1450).toFixed(3)).toBe('8455.000');
    expect(dipToLitres(tank2Chart(), 1450).toFixed(3)).toBe('8679.000');
  });

  it('returns exactly 12,000 L at each tank’s own final dip', () => {
    expect(dipToLitres(tank1Chart(), 2070).toFixed(3)).toBe('12000.000');
    expect(dipToLitres(tank2Chart(), 2051).toFixed(3)).toBe('12000.000');
  });

  it('rejects 2071 mm on Tank 1 and 2052 mm on Tank 2', () => {
    expect(() => dipToLitres(tank1Chart(), 2071)).toThrow(/outside the certified range 1–2070/);
    expect(() => dipToLitres(tank2Chart(), 2052)).toThrow(/outside the certified range 1–2051/);
  });

  it('accepts 2051 mm on Tank 1, which is a valid mid-chart dip there', () => {
    // 2051 is Tank 2's maximum but an ordinary reading on Tank 1 — proof that
    // the bound is read per tank and 2070 is never treated as "the" maximum.
    expect(dipToLitres(tank1Chart(), 2051).lessThan(12000)).toBe(true);
  });

  it('rejects a dip below 1 mm', () => {
    expect(() => dipToLitres(tank1Chart(), 0)).toThrow(CalcError);
    expect(() => dipToLitres(tank1Chart(), '-5')).toThrow(/DIP_OUT_OF_RANGE|outside the certified range/);
  });
});

describe('dipToLitres — interpolation', () => {
  it('interpolates linearly between the two bracketing certified rows', () => {
    // Tank 1: 1450 mm = 8455 L, 1451 mm = 8462 L → 1450.5 mm = 8458.5 L
    expect(dipToLitres(tank1Chart(), '1450.5').toFixed(3)).toBe('8458.500');
    // A quarter of the way: 8455 + 0.25 × 7 = 8456.75
    expect(dipToLitres(tank1Chart(), '1450.25').toFixed(3)).toBe('8456.750');
  });

  it('interpolates on Tank 2 as well', () => {
    // Tank 2: 1450 mm = 8679 L, 1451 mm = 8686 L → 1450.5 mm = 8682.5 L
    expect(dipToLitres(tank2Chart(), '1450.5').toFixed(3)).toBe('8682.500');
  });

  it('never uses a cylinder formula — the certified value differs from the ideal', () => {
    // Tank 1 is 3160 mm long, 2200 mm in diameter. A circular-segment model at
    // half depth would give half of 12,000 L; the certified chart does not.
    const halfDepth = dipToLitres(tank1Chart(), 1100);
    expect(halfDepth.equals(6000)).toBe(false);
  });
});

describe('litresToDip', () => {
  it('round-trips an exact chart row', () => {
    expect(litresToDip(tank1Chart(), 8455).toNumber()).toBe(1450);
    expect(litresToDip(tank2Chart(), 12000).toNumber()).toBe(2051);
  });

  it('interpolates a volume between rows', () => {
    const dip = litresToDip(tank1Chart(), '8458.5');
    expect(dip.toFixed(1)).toBe('1450.5');
  });

  it('rejects a volume beyond the tank', () => {
    expect(() => litresToDip(tank1Chart(), 12001)).toThrow(/outside the certified range/);
  });
});

describe('ullage', () => {
  it('reports the empty space at a dip', () => {
    expect(ullageLitres(tank1Chart(), 1450).toFixed(3)).toBe('3545.000'); // 12000 − 8455
    expect(ullageLitres(tank2Chart(), 2051).toFixed(3)).toBe('0.000');
  });
});

describe('chart versioning and expiry', () => {
  it('resolves a reading against the version in force on its own timestamp', () => {
    const v1 = tank1Chart();
    const v2 = indexChart({ ...loadChartCsv('tank1_calibration.csv', 'tank-1', 'T1', 2070), version: 2,
      validFrom: new Date('2027-01-31T00:00:00+06:00'), validTo: new Date('2032-01-30T23:59:59+06:00') });

    expect(chartVersionAt([v1, v2], new Date('2026-09-19T10:00:00+06:00'))?.version).toBe(1);
    expect(chartVersionAt([v1, v2], new Date('2027-06-01T10:00:00+06:00'))?.version).toBe(2);
    expect(chartVersionAt([v1, v2], new Date('2021-01-01T10:00:00+06:00'))).toBeNull();
  });

  it('warns 90 days before expiry and reports expiry afterwards', () => {
    const chart = { validTo: VALID_TO };
    const wellBefore = chartExpiryStatus(chart, new Date('2026-01-01T00:00:00+06:00'));
    expect(wellBefore.warn).toBe(false);
    expect(wellBefore.expired).toBe(false);

    const inWindow = chartExpiryStatus(chart, new Date('2026-12-01T00:00:00+06:00'));
    expect(inWindow.warn).toBe(true);
    expect(inWindow.daysRemaining).toBeLessThanOrEqual(CHART_EXPIRY_WARNING_DAYS);

    const after = chartExpiryStatus(chart, new Date('2027-02-01T00:00:00+06:00'));
    expect(after.expired).toBe(true);
  });
});
