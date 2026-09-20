import { CalcError, D, dec, litres, type Decimal, type Numeric } from './decimal';

export interface NozzleMeterSpec {
  /** Digit count of the mechanical totalizer, e.g. 8 → wraps after 99,999,999.99 */
  meterDigits: number;
  /** Rated maximum flow of the dispenser, litres per minute. */
  maxFlowLpm: Numeric;
}

export interface MeterReadingInput {
  openingReading: Numeric;
  closingReading: Numeric;
  spec: NozzleMeterSpec;
  /** Length of the shift in minutes — used only for the sanity guard. */
  shiftMinutes: number;
}

export interface MeterReadingResult {
  litresSold: Decimal;
  /** True when the totalizer wrapped past its digit limit during the shift. */
  isRollover: boolean;
  /**
   * Set when the sale is physically implausible for the shift length. The
   * caller must not save silently — the manager has to confirm or correct.
   */
  implausible: {
    maxPossibleLitres: Decimal;
    reason: string;
  } | null;
}

/** Totalizer capacity: 10^digits, e.g. 8 digits → 100,000,000. */
export function meterCapacity(meterDigits: number): Decimal {
  if (!Number.isInteger(meterDigits) || meterDigits < 4 || meterDigits > 12) {
    throw new CalcError('BAD_METER_DIGITS', `meter_digits must be an integer 4–12, got ${meterDigits}`);
  }
  return new D(10).pow(meterDigits);
}

/**
 * Litres sold on one nozzle across one shift.
 *
 * Mechanical totalizers are lifetime cumulative, so a shift's sale is the
 * difference between the closing and opening readings. When the closing reading
 * is lower than the opening one the totalizer has wrapped, and the sale is the
 * distance to the wrap point plus the closing reading.
 *
 * A rollover is rare and far more often a typo, so it is flagged rather than
 * trusted.
 */
export function litresSold(input: MeterReadingInput): MeterReadingResult {
  const opening = dec(input.openingReading, 'opening_reading');
  const closing = dec(input.closingReading, 'closing_reading');
  const capacity = meterCapacity(input.spec.meterDigits);

  if (opening.isNegative() || closing.isNegative()) {
    throw new CalcError('NEGATIVE_READING', 'A totalizer reading cannot be negative', {
      opening: opening.toString(),
      closing: closing.toString(),
    });
  }
  if (opening.greaterThanOrEqualTo(capacity) || closing.greaterThanOrEqualTo(capacity)) {
    throw new CalcError('READING_OVER_CAPACITY', `A reading exceeds the ${input.spec.meterDigits}-digit totalizer capacity`, {
      capacity: capacity.toString(),
      opening: opening.toString(),
      closing: closing.toString(),
    });
  }

  const isRollover = closing.lessThan(opening);
  const raw = isRollover ? capacity.minus(opening).plus(closing) : closing.minus(opening);
  const sold = litres(raw);

  if (input.shiftMinutes <= 0) {
    throw new CalcError('BAD_SHIFT_LENGTH', `shift_minutes must be positive, got ${input.shiftMinutes}`);
  }
  const maxPossible = litres(dec(input.spec.maxFlowLpm, 'max_flow_lpm').times(input.shiftMinutes));

  const implausible = sold.greaterThan(maxPossible)
    ? {
        maxPossibleLitres: maxPossible,
        reason:
          `${sold.toFixed(3)} L exceeds the ${maxPossible.toFixed(3)} L this nozzle could physically ` +
          `dispense in ${input.shiftMinutes} minutes at ${dec(input.spec.maxFlowLpm).toString()} L/min`,
      }
    : null;

  return { litresSold: sold, isRollover, implausible };
}

/**
 * Gross litres across every nozzle in a shift. Rollovers and implausible
 * readings are surfaced per nozzle so the close wizard can demand confirmation
 * for exactly the rows that need it.
 */
export interface NozzleLine<TId = string> {
  nozzleId: TId;
  result: MeterReadingResult;
}

export function grossLitres<TId>(lines: NozzleLine<TId>[]): Decimal {
  return litres(lines.reduce<Decimal>((acc, l) => acc.plus(l.result.litresSold), new D(0)));
}

export function nozzlesNeedingConfirmation<TId>(lines: NozzleLine<TId>[]): TId[] {
  return lines.filter((l) => l.result.isRollover || l.result.implausible).map((l) => l.nozzleId);
}
