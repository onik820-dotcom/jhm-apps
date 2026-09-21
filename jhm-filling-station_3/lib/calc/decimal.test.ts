import { describe, expect, it } from 'vitest';
import { CalcError, dec, decOr0, litresStr, money, moneyStr, pct, sum } from './decimal';

describe('parsing', () => {
  it('refuses an empty or missing number instead of treating it as zero', () => {
    expect(() => dec(null, 'rate_per_litre')).toThrow(/rate_per_litre is required/);
    expect(() => dec(undefined)).toThrow(CalcError);
    expect(() => dec('')).toThrow(CalcError);
  });

  it('refuses NaN and Infinity', () => {
    expect(() => dec(Number.NaN)).toThrow(CalcError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(/not finite/);
    expect(() => dec('twelve')).toThrow(/not a number/);
  });

  it('lets an optional field default to zero', () => {
    expect(decOr0(null).isZero()).toBe(true);
    expect(decOr0('12.5').toFixed(2)).toBe('12.50');
  });
});

describe('scales', () => {
  it('rounds money to paisa, half up', () => {
    expect(moneyStr('10.005')).toBe('10.01');
    expect(moneyStr('10.004')).toBe('10.00');
    expect(moneyStr(0.615)).toBe('0.62'); // a float would give 0.61
  });

  it('rounds litres to three decimals', () => {
    expect(litresStr('4500.0005')).toBe('4500.001');
    expect(litresStr(4500)).toBe('4500.000');
  });

  it('adds without float drift', () => {
    expect(sum(['0.1', '0.2']).toFixed(2)).toBe('0.30');
    expect(money('0.1').plus(money('0.2')).equals('0.3')).toBe(true);
  });
});

describe('pct', () => {
  it('returns a percentage', () => {
    expect(pct('-20', '4000')!.toFixed(2)).toBe('-0.50');
  });

  it('returns null rather than dividing by zero', () => {
    expect(pct('5', '0')).toBeNull();
  });
});
