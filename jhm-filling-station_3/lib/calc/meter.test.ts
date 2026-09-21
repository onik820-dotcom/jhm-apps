import { describe, expect, it } from 'vitest';
import { grossLitres, litresSold, meterCapacity, nozzlesNeedingConfirmation } from './meter';
import { CalcError } from './decimal';

const spec = { meterDigits: 8, maxFlowLpm: '50' };
const SHIFT_MINUTES = 12 * 60;

describe('litresSold', () => {
  it('subtracts the opening reading from the closing reading', () => {
    const result = litresSold({ openingReading: '1234567.89', closingReading: '1236789.01', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.litresSold.toFixed(3)).toBe('2221.120');
    expect(result.isRollover).toBe(false);
    expect(result.implausible).toBeNull();
  });

  it('is exact where a float would drift', () => {
    const result = litresSold({ openingReading: '0.1', closingReading: '0.3', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.litresSold.toFixed(3)).toBe('0.200'); // 0.3 − 0.1 !== 0.19999999999999998
  });

  it('returns zero when the nozzle was not used', () => {
    const result = litresSold({ openingReading: '500', closingReading: '500', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.litresSold.isZero()).toBe(true);
  });
});

describe('rollover', () => {
  it('wraps an 8-digit totalizer and flags it', () => {
    // 99,999,950 → 100 means 50 L to the wrap plus 100 L after it.
    const result = litresSold({ openingReading: '99999950', closingReading: '100', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.litresSold.toFixed(3)).toBe('150.000');
    expect(result.isRollover).toBe(true);
  });

  it('honours a different digit count per nozzle', () => {
    const sixDigit = { meterDigits: 6, maxFlowLpm: '50' };
    const result = litresSold({ openingReading: '999900', closingReading: '50', spec: sixDigit, shiftMinutes: SHIFT_MINUTES });
    expect(result.litresSold.toFixed(3)).toBe('150.000');
    expect(result.isRollover).toBe(true);
  });

  it('reports capacity as 10^digits', () => {
    expect(meterCapacity(8).toString()).toBe('100000000');
    expect(() => meterCapacity(3)).toThrow(CalcError);
  });

  it('rejects a reading at or above the totalizer capacity', () => {
    expect(() => litresSold({ openingReading: '100000000', closingReading: '5', spec, shiftMinutes: SHIFT_MINUTES })).toThrow(
      /exceeds the 8-digit totalizer/,
    );
  });

  it('rejects a negative reading', () => {
    expect(() => litresSold({ openingReading: '-1', closingReading: '5', spec, shiftMinutes: SHIFT_MINUTES })).toThrow(CalcError);
  });
});

describe('sanity guard', () => {
  it('flags a sale beyond what the nozzle could physically dispense', () => {
    // 50 L/min × 720 min = 36,000 L is the ceiling for a 12-hour shift.
    const result = litresSold({ openingReading: '0', closingReading: '40000', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.implausible).not.toBeNull();
    expect(result.implausible!.maxPossibleLitres.toFixed(3)).toBe('36000.000');
  });

  it('does not flag a sale at exactly the ceiling', () => {
    const result = litresSold({ openingReading: '0', closingReading: '36000', spec, shiftMinutes: SHIFT_MINUTES });
    expect(result.implausible).toBeNull();
  });

  it('rejects a non-positive shift length', () => {
    expect(() => litresSold({ openingReading: '0', closingReading: '10', spec, shiftMinutes: 0 })).toThrow(CalcError);
  });
});

describe('shift aggregation', () => {
  const lines = [
    { nozzleId: 'M1-N1', result: litresSold({ openingReading: '1000', closingReading: '1500.5', spec, shiftMinutes: SHIFT_MINUTES }) },
    { nozzleId: 'M1-N2', result: litresSold({ openingReading: '2000', closingReading: '2250.25', spec, shiftMinutes: SHIFT_MINUTES }) },
    { nozzleId: 'M2-N1', result: litresSold({ openingReading: '99999900', closingReading: '100', spec, shiftMinutes: SHIFT_MINUTES }) },
  ];

  it('sums every nozzle', () => {
    expect(grossLitres(lines).toFixed(3)).toBe('950.750'); // 500.5 + 250.25 + 200
  });

  it('lists only the nozzles a manager must confirm', () => {
    expect(nozzlesNeedingConfirmation(lines)).toEqual(['M2-N1']);
  });
});
