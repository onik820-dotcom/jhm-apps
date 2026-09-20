import { CalcError, D, dec, decOr0, litres as toLitres, money, type Decimal, type Numeric } from './decimal';

export interface MovingAverageInput {
  oldStockLitres: Numeric;
  oldAvgCost: Numeric;
  receivedLitres: Numeric;
  depotRate: Numeric;
}

/**
 * Moving weighted average cost per tank. Depot rates change between deliveries
 * and the business thinks in terms of "what is the fuel in this tank worth
 * now", not in FIFO layers.
 */
export function movingAverageCost(input: MovingAverageInput): Decimal {
  const oldStock = toLitres(dec(input.oldStockLitres, 'old_stock_litres'));
  const oldCost = money(decOr0(input.oldAvgCost, 'old_avg_cost'));
  const received = toLitres(dec(input.receivedLitres, 'received_litres'));
  const rate = money(dec(input.depotRate, 'depot_rate'));

  if (oldStock.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'old_stock_litres cannot be negative');
  if (received.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'received_litres cannot be negative');

  const totalLitres = oldStock.plus(received);
  if (totalLitres.isZero()) {
    // Nothing on hand and nothing received: the cost of an empty tank is the
    // rate of the last delivery, which keeps the next sale from costing zero.
    return rate;
  }

  const totalValue = oldStock.times(oldCost).plus(received.times(rate));
  // Cost per litre is carried at 4 dp; rounding it to paisa here would drift
  // measurably across a 12,000 L tank.
  return totalValue.dividedBy(totalLitres).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

export interface DieselProfitInput {
  netLitres: Numeric;
  sellingRate: Numeric;
  /** The tank's moving average cost at the moment of sale. */
  avgCostAtSale: Numeric;
}

export interface ProfitLine {
  revenue: Decimal;
  cogs: Decimal;
  grossProfit: Decimal;
  marginPct: Decimal | null;
}

export function dieselProfit(input: DieselProfitInput): ProfitLine {
  const net = toLitres(dec(input.netLitres, 'net_litres'));
  const revenue = money(net.times(dec(input.sellingRate, 'selling_rate')));
  const cogs = money(net.times(dec(input.avgCostAtSale, 'avg_cost_at_sale')));
  const grossProfit = money(revenue.minus(cogs));
  return {
    revenue,
    cogs,
    grossProfit,
    marginPct: revenue.isZero() ? null : grossProfit.dividedBy(revenue).times(100).toDecimalPlaces(2),
  };
}

export interface LubLine {
  skuId: string;
  qty: Numeric;
  saleAmount: Numeric;
  purchaseRate: Numeric;
}

export function lubricantProfit(lines: LubLine[]): ProfitLine {
  let revenue = new D(0);
  let cogs = new D(0);
  for (const line of lines) {
    revenue = revenue.plus(dec(line.saleAmount, `sale_amount (${line.skuId})`));
    cogs = cogs.plus(dec(line.qty, `qty (${line.skuId})`).times(dec(line.purchaseRate, `purchase_rate (${line.skuId})`)));
  }
  const revenueM = money(revenue);
  const cogsM = money(cogs);
  const grossProfit = money(revenueM.minus(cogsM));
  return {
    revenue: revenueM,
    cogs: cogsM,
    grossProfit,
    marginPct: revenueM.isZero() ? null : grossProfit.dividedBy(revenueM).times(100).toDecimalPlaces(2),
  };
}

export interface PnlInput {
  dieselGrossProfit: Numeric;
  lubricantGrossProfit: Numeric;
  totalExpenses: Numeric;
}

export interface PnlResult {
  grossProfit: Decimal;
  totalExpenses: Decimal;
  netProfit: Decimal;
}

export function profitAndLoss(input: PnlInput): PnlResult {
  const gross = money(
    dec(input.dieselGrossProfit, 'diesel_gross_profit').plus(dec(input.lubricantGrossProfit, 'lubricant_gross_profit')),
  );
  const expenses = money(dec(input.totalExpenses, 'total_expenses'));
  return { grossProfit: gross, totalExpenses: expenses, netProfit: money(gross.minus(expenses)) };
}

/** Value of the fuel physically in a tank, at its current average cost. */
export function stockValue(physicalLitres: Numeric, avgCost: Numeric): Decimal {
  return money(toLitres(dec(physicalLitres, 'physical_litres')).times(dec(avgCost, 'avg_cost')));
}
