import { describe, expect, it } from 'vitest';
import { checkOverfill, compartmentReceipt, deliveryTotals } from './refill';
import { dipToLitres, litresToDip, type IndexedChart } from './dip';
import type { Numeric } from './decimal';
import { tank1Chart, tank2Chart } from './__fixtures__/charts';

/**
 * The integer dip the rod would read after roughly `added` litres go in. Real
 * dips are whole millimetres, so flooring here reproduces the small rounding
 * the forecourt actually sees — each millimetre is 4–8 L at these levels.
 */
function dipAfterAdding(chart: IndexedChart, startDipMm: number, added: Numeric): number {
  return litresToDip(chart, dipToLitres(chart, startDipMm).plus(added)).floor().toNumber();
}

describe('compartmentReceipt', () => {
  it('measures what arrived by the tank dip, not by the challan', () => {
    const chart = tank1Chart();
    const after = dipAfterAdding(chart, 1000, 4500);
    const result = compartmentReceipt({
      compartmentNo: 1,
      declaredLitres: '4500',
      chart,
      dipBeforeMm: 1000,
      dipAfterMm: after,
    });

    expect(result.litresBefore.toFixed(3)).toBe('5163.000'); // certified value at 1000 mm
    expect(result.receivedLitres.equals(result.litresAfter.minus(result.litresBefore))).toBe(true);
    expect(result.shortageLitres.equals(result.declaredLitres.minus(result.receivedLitres))).toBe(true);
    expect(result.tankCode).toBe('T1');
  });

  it('flags a shortage past the 0.3% tolerance', () => {
    const chart = tank1Chart();
    const after = dipAfterAdding(chart, 1000, 4460); // 40 L short of the challan
    const result = compartmentReceipt({ compartmentNo: 2, declaredLitres: '4500', chart, dipBeforeMm: 1000, dipAfterMm: after });

    expect(result.shortageLitres.greaterThanOrEqualTo(40)).toBe(true);
    expect(result.shortagePct!.greaterThan('0.3')).toBe(true);
    expect(result.shortageFlagged).toBe(true);
  });

  it('does not flag a full delivery, where only whole-millimetre reading remains', () => {
    const chart = tank2Chart();
    const after = dipAfterAdding(chart, 800, 4500);
    const result = compartmentReceipt({ compartmentNo: 1, declaredLitres: '4500', chart, dipBeforeMm: 800, dipAfterMm: after });

    expect(result.shortagePct!.lessThanOrEqualTo('0.3')).toBe(true);
    expect(result.shortageFlagged).toBe(false);
  });

  it('rejects a dip that went down during a discharge', () => {
    expect(() =>
      compartmentReceipt({ compartmentNo: 1, declaredLitres: '4500', chart: tank1Chart(), dipBeforeMm: 1200, dipAfterMm: 1100 }),
    ).toThrow(/cannot be lower than the dip before/);
  });

  it('rejects a compartment number outside 1–4', () => {
    expect(() =>
      compartmentReceipt({ compartmentNo: 5, declaredLitres: '4500', chart: tank1Chart(), dipBeforeMm: 1000, dipAfterMm: 1100 }),
    ).toThrow(/compartment_no must be 1–4/);
  });

  it('rejects a dip beyond the tank’s own certified range', () => {
    expect(() =>
      compartmentReceipt({ compartmentNo: 1, declaredLitres: '4500', chart: tank2Chart(), dipBeforeMm: 2000, dipAfterMm: 2052 }),
    ).toThrow(/outside the certified range 1–2051/);
  });
});

describe('deliveryTotals — an 18,000 L tanker split across both tanks', () => {
  const t1 = tank1Chart();
  const t2 = tank2Chart();

  // Two compartments into each tank, discharged one after the other, so the
  // second compartment starts from where the first one finished.
  const t1First = dipAfterAdding(t1, 300, 4500);
  const t1Second = dipAfterAdding(t1, t1First, 4460); // this one came up short
  const t2First = dipAfterAdding(t2, 300, 4500);
  const t2Second = dipAfterAdding(t2, t2First, 4500);

  const compartments = [
    compartmentReceipt({ compartmentNo: 1, declaredLitres: '4500', chart: t1, dipBeforeMm: 300, dipAfterMm: t1First }),
    compartmentReceipt({ compartmentNo: 2, declaredLitres: '4500', chart: t1, dipBeforeMm: t1First, dipAfterMm: t1Second }),
    compartmentReceipt({ compartmentNo: 3, declaredLitres: '4500', chart: t2, dipBeforeMm: 300, dipAfterMm: t2First }),
    compartmentReceipt({ compartmentNo: 4, declaredLitres: '4500', chart: t2, dipBeforeMm: t2First, dipAfterMm: t2Second }),
  ];

  it('declares 18,000 L across four compartments', () => {
    expect(deliveryTotals(compartments, '104.50').totalDeclared.toFixed(3)).toBe('18000.000');
  });

  it('receives close to 18,000 L, measured tank-side', () => {
    const totals = deliveryTotals(compartments, '104.50');
    expect(totals.totalReceived.greaterThan(17900)).toBe(true);
    expect(totals.totalReceived.lessThanOrEqualTo(totals.totalDeclared)).toBe(true);
    expect(totals.totalShortage.equals(totals.totalDeclared.minus(totals.totalReceived))).toBe(true);
  });

  it('values the purchase on litres received, not litres declared', () => {
    const totals = deliveryTotals(compartments, '104.50');
    expect(totals.purchaseValue.toFixed(2)).toBe(totals.totalReceived.times('104.50').toDecimalPlaces(2).toFixed(2));
    expect(totals.purchaseValue.lessThan(totals.totalDeclared.times('104.50'))).toBe(true);
  });

  it('names only the compartment that came up short', () => {
    expect(deliveryTotals(compartments, '104.50').flaggedCompartments).toEqual([2]);
  });

  it('leaves both tanks inside their certified range', () => {
    expect(dipToLitres(t1, t1Second).lessThanOrEqualTo(12000)).toBe(true);
    expect(dipToLitres(t2, t2Second).lessThanOrEqualTo(12000)).toBe(true);
  });
});

describe('checkOverfill', () => {
  it('warns when a compartment would push a tank past 95% of capacity', () => {
    const check = checkOverfill(tank1Chart(), 2000, '4500'); // 2000 mm already holds 11,730 L
    expect(check.willOverfill).toBe(true);
    expect(check.safeLimitLitres.toFixed(3)).toBe('11400.000');
    expect(check.headroomLitres.isNegative()).toBe(true);
  });

  it('allows a discharge that stays inside the limit', () => {
    const check = checkOverfill(tank2Chart(), 800, '4500');
    expect(check.willOverfill).toBe(false);
    expect(check.headroomLitres.greaterThan(4500)).toBe(true);
  });

  it('measures headroom against the tank’s own capacity', () => {
    const check = checkOverfill(tank2Chart(), 300, '4500');
    expect(check.capacityLitres.toFixed(3)).toBe('12000.000');
    expect(check.currentLitres.toFixed(3)).toBe('907.000');
    expect(check.projectedLitres.toFixed(3)).toBe('5407.000');
  });
});
