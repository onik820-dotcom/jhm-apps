import { D, dec, litres as toLitres, type Decimal, type Numeric } from './decimal';

/** Days of stock below which a purchase order needs to go out. */
export const DEFAULT_COVER_ALERT_DAYS = 3;
/** Window used for the average daily sale. */
export const COVER_WINDOW_DAYS = 7;

export interface StockCoverInput {
  /** Net litres for each of the last closed days, most recent first or last — order does not matter. */
  dailyNetLitres: Numeric[];
  tankPhysicalLitres: Numeric[];
  alertBelowDays?: number;
}

export interface StockCoverResult {
  avgDailySale: Decimal;
  totalPhysicalLitres: Decimal;
  /** Null when there is no sales history to divide by. */
  daysCover: Decimal | null;
  lowStock: boolean;
  daysConsidered: number;
}

/**
 * How long the fuel on hand lasts at the recent rate of sale. Shown on every
 * dashboard so a PO goes out before the tanks run dry, not after.
 */
export function stockCover(input: StockCoverInput): StockCoverResult {
  const days = input.dailyNetLitres.map((v, i) => toLitres(dec(v, `daily_net_litres[${i}]`)));
  const total = input.tankPhysicalLitres.reduce<Decimal>(
    (acc, v, i) => acc.plus(dec(v, `tank_physical_litres[${i}]`)),
    new D(0),
  );
  const totalPhysical = toLitres(total);

  if (days.length === 0) {
    return { avgDailySale: toLitres(0), totalPhysicalLitres: totalPhysical, daysCover: null, lowStock: false, daysConsidered: 0 };
  }

  const avg = toLitres(days.reduce<Decimal>((a, d) => a.plus(d), new D(0)).dividedBy(days.length));
  if (avg.isZero()) {
    return { avgDailySale: avg, totalPhysicalLitres: totalPhysical, daysCover: null, lowStock: false, daysConsidered: days.length };
  }

  const cover = totalPhysical.dividedBy(avg).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const alertBelow = input.alertBelowDays ?? DEFAULT_COVER_ALERT_DAYS;

  return {
    avgDailySale: avg,
    totalPhysicalLitres: totalPhysical,
    daysCover: cover,
    lowStock: cover.lessThan(alertBelow),
    daysConsidered: days.length,
  };
}
