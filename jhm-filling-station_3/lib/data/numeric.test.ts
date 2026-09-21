import { describe, expect, it } from 'vitest';
import { asCost, asLitres, asMoney, asMoneyOrNull, asPctOrNull } from './numeric';
import { dec, moneyStr, sum } from '@/lib/calc/decimal';

/**
 * PostgREST hands every `numeric` back as a JSON number, so these helpers are
 * the only thing standing between the database and JavaScript float
 * arithmetic. They are worth testing at the magnitudes and shapes this
 * station's money actually takes.
 */
describe('the numeric boundary', () => {
  it('brings a double back to the exact figure the column holds', () => {
    // What supabase-js really delivers: a JSON number, not a string.
    const fromPostgrest = [18765065.55, 99999999.99, 56000.1, 0.05, 104.6398];
    const expected = ['18765065.55', '99999999.99', '56000.10', '0.05', '104.64'];
    expect(fromPostgrest.map((v) => asMoney(v))).toEqual(expected);
  });

  it('keeps a whole tanker load to the litre', () => {
    expect(asLitres(17957)).toBe('17957.000');
    expect(asLitres(4498.5)).toBe('4498.500');
    expect(asLitres('0.001')).toBe('0.001');
  });

  it('carries a blended cost at four decimals, not two', () => {
    // The moving average from Phase 5: ((9,697 x 104.50) + (997 x 106.00)) / 10,694
    expect(asCost(104.6398)).toBe('104.6398');
    expect(asMoney(104.6398)).toBe('104.64');
  });

  it('rounds half up, the way the paper ledgers do', () => {
    expect(asMoney(1.005)).toBe('1.01');
    expect(asMoney(2.675)).toBe('2.68');
    expect(asLitres(0.0005)).toBe('0.001');
  });

  it('treats a missing figure as zero rather than NaN', () => {
    expect(asMoney(null)).toBe('0.00');
    expect(asMoney(undefined)).toBe('0.00');
    expect(asMoney('')).toBe('0.00');
    expect(asLitres(null)).toBe('0.000');
  });

  it('keeps a genuinely absent figure absent', () => {
    // A credit limit of zero means "no limit agreed", which is not the same as
    // a party with no row at all. Null must survive as null.
    expect(asMoneyOrNull(null)).toBeNull();
    expect(asMoneyOrNull(0)).toBe('0.00');
    expect(asPctOrNull(null)).toBeNull();
    expect(asPctOrNull(0.8912)).toBe('0.8912');
  });

  it('holds a negative balance, for a party paid in advance', () => {
    expect(asMoney(-4500.25)).toBe('-4500.25');
  });

  it('survives a sum that float arithmetic gets wrong', () => {
    // 0.1 + 0.2 is the canonical float failure. Through the boundary and
    // decimal.js it is exact; done in JavaScript it is not.
    const rows = [0.1, 0.2].map((v) => asMoney(v));
    expect(moneyStr(sum(rows))).toBe('0.30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('adds a shift of credit sales to the paisa', () => {
    // Twelve awkward amounts, the sort a night of credit sales produces.
    const amounts = [
      2583.33, 1041.67, 9812.45, 733.19, 15000.01, 4499.99, 87.5, 12345.67, 6.66, 100000.1,
      55.55, 909.09,
    ].map((v) => asMoney(v));

    const viaDecimal = moneyStr(sum(amounts));
    const viaFloat = amounts.reduce((acc, v) => acc + Number(v), 0).toFixed(2);

    expect(viaDecimal).toBe('147075.21');
    // The float route happens to agree here; the point is that nothing in the
    // app depends on it happening to.
    expect(viaFloat).toBe(viaDecimal);
    expect(dec(viaDecimal).equals(dec('147075.21'))).toBe(true);
  });

  it('refuses a value that is not a number at all', () => {
    expect(() => asMoney('not a number')).toThrow();
    expect(() => asMoney(Number.NaN)).toThrow();
    expect(() => asMoney(Number.POSITIVE_INFINITY)).toThrow();
  });
});
