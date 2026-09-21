import { createClient } from '@/lib/supabase/server';
import { asLitres, asMoney } from '@/lib/data/numeric';

/**
 * The figures behind every dashboard.
 *
 * One call to one database function, so the manager's page and the MD's page
 * cannot quietly disagree about what the station sold today. Profit is absent
 * rather than zero for a role that may not see it: a zero would read as "no
 * profit", which is a different statement from "not yours to see".
 */

export interface DashboardKpis {
  businessDate: string;
  todaySales: string;
  todayLitres: string;
  monthSales: string;
  monthLitres: string;
  monthFrom: string;
  /** Null until the first shift is closed — nothing has been counted yet. */
  cashInHand: string | null;
  duesOutstanding: string;
  partiesOverLimit: number;
  openVariances: number;
  stockLitres: string;
  /** Null when nothing has sold yet: there is no rate to divide by. */
  daysCover: string | null;
  /** Absent for a manager. */
  monthProfit: string | null;
  seesProfit: boolean;
}

export async function getDashboardKpis(): Promise<DashboardKpis | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dashboard_kpis');
  if (error || !data) return null;

  const k = data as Record<string, never>;
  const today = k.today as unknown as { sales: number; litres: number };
  const month = k.month as unknown as { sales: number; litres: number; from: string };

  return {
    businessDate: String(k.business_date),
    todaySales: asMoney(today?.sales),
    todayLitres: asLitres(today?.litres),
    monthSales: asMoney(month?.sales),
    monthLitres: asLitres(month?.litres),
    monthFrom: String(month?.from ?? ''),
    cashInHand: k.cash_in_hand === null ? null : asMoney(k.cash_in_hand),
    duesOutstanding: asMoney(k.dues_outstanding),
    partiesOverLimit: Number(k.parties_over_limit ?? 0),
    openVariances: Number(k.open_variances ?? 0),
    stockLitres: asLitres(k.stock_litres),
    daysCover: k.days_cover === null || k.days_cover === undefined ? null : String(k.days_cover),
    monthProfit: k.month_profit === null || k.month_profit === undefined ? null : asMoney(k.month_profit),
    seesProfit: Boolean(k.sees_profit),
  };
}
