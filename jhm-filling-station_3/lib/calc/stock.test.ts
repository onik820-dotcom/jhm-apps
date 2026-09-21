import { describe, expect, it } from 'vitest';
import { findChainBreaks, recalculateChain, tankStock } from './stock';

describe('tankStock', () => {
  it('computes book closing from opening, refills and sales', () => {
    const result = tankStock({ bookOpening: '8000', refillLitres: '9000', soldFromTank: '4500', physicalClosing: '12500' });
    expect(result.bookClosing.toFixed(3)).toBe('12500.000');
    expect(result.varianceLitres.toFixed(3)).toBe('0.000');
    expect(result.breached).toBe(false);
  });

  it('records a shortfall as a negative variance', () => {
    const result = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '4000', physicalClosing: '3980' });
    expect(result.bookClosing.toFixed(3)).toBe('4000.000');
    expect(result.varianceLitres.toFixed(3)).toBe('-20.000');
    expect(result.variancePct!.toFixed(2)).toBe('-0.50');
  });

  it('holds at exactly the 0.5% threshold and breaches past it', () => {
    const atThreshold = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '4000', physicalClosing: '3980' });
    expect(atThreshold.breached).toBe(false);

    // The Phase 4 acceptance case: an injected 1% discrepancy must alert.
    const onePercent = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '4000', physicalClosing: '3960' });
    expect(onePercent.variancePct!.toFixed(2)).toBe('-1.00');
    expect(onePercent.breached).toBe(true);
  });

  it('honours a configured threshold', () => {
    const result = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '4000', physicalClosing: '3960', thresholdPct: '1.5' });
    expect(result.breached).toBe(false);
  });

  it('reports no percentage when nothing was sold, but still flags any movement', () => {
    const clean = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '0', physicalClosing: '8000' });
    expect(clean.variancePct).toBeNull();
    expect(clean.breached).toBe(false);

    const moved = tankStock({ bookOpening: '8000', refillLitres: '0', soldFromTank: '0', physicalClosing: '7950' });
    expect(moved.variancePct).toBeNull();
    expect(moved.breached).toBe(true);
  });
});

describe('shift chain continuity', () => {
  const links = [
    { shiftId: 's1', tankId: 't1', sequence: 1, bookOpening: '8000.000', bookClosing: '6000.000' },
    { shiftId: 's2', tankId: 't1', sequence: 2, bookOpening: '6000.000', bookClosing: '4000.000' },
    { shiftId: 's3', tankId: 't1', sequence: 3, bookOpening: '4000.000', bookClosing: '2000.000' },
  ];

  it('passes an unbroken chain', () => {
    expect(findChainBreaks(links)).toEqual([]);
  });

  it('names the exact shift where a chain breaks', () => {
    const broken = [...links];
    broken[2] = { ...broken[2]!, bookOpening: '4100.000' };
    const breaks = findChainBreaks(broken);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ fromShiftId: 's2', toShiftId: 's3', expectedOpening: '4000.000', actualOpening: '4100.000' });
  });

  it('keeps the chain for each tank separate', () => {
    const twoTanks = [
      ...links,
      { shiftId: 's1', tankId: 't2', sequence: 1, bookOpening: '5000.000', bookClosing: '4000.000' },
      { shiftId: 's2', tankId: 't2', sequence: 2, bookOpening: '4000.000', bookClosing: '3000.000' },
    ];
    expect(findChainBreaks(twoTanks)).toEqual([]);
  });
});

describe('recalculateChain', () => {
  it('carries each closing forward as the next opening', () => {
    const results = recalculateChain('10000', [
      { shiftId: 's1', sequence: 1, refillLitres: '0', soldFromTank: '2000', physicalClosing: '8000' },
      { shiftId: 's2', sequence: 2, refillLitres: '9000', soldFromTank: '3000', physicalClosing: '14000' },
      { shiftId: 's3', sequence: 3, refillLitres: '0', soldFromTank: '2500', physicalClosing: '11500' },
    ]);

    expect(results.map((r) => r.bookClosing.toFixed(3))).toEqual(['8000.000', '14000.000', '11500.000']);
    expect(results.every((r) => r.varianceLitres.isZero())).toBe(true);
  });

  it('propagates a corrected earlier shift into every later shift', () => {
    // The same shifts, but the opening stock is corrected by +50 L. Every later
    // book closing moves by the same 50 L, which is what reopening a shift does.
    const results = recalculateChain('10050', [
      { shiftId: 's1', sequence: 1, refillLitres: '0', soldFromTank: '2000', physicalClosing: '8000' },
      { shiftId: 's2', sequence: 2, refillLitres: '9000', soldFromTank: '3000', physicalClosing: '14000' },
    ]);
    expect(results.map((r) => r.bookClosing.toFixed(3))).toEqual(['8050.000', '14050.000']);
    expect(results[0]!.varianceLitres.toFixed(3)).toBe('-50.000');
    expect(findChainBreaks(results.map((r, i) => ({
      shiftId: r.shiftId, tankId: 't1', sequence: i + 1,
      bookOpening: r.bookOpening, bookClosing: r.bookClosing,
    })))).toEqual([]);
  });
});
