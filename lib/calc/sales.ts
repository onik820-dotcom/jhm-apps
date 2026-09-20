import { CalcError, dec, litres as toLitres, money, type Decimal, type Numeric } from './decimal';

export interface ShiftSaleInput {
  /** Sum of every nozzle's litres for the shift. */
  grossLitres: Numeric;
  /**
   * Litres pumped into the test measure and poured back into the tank. They
   * leave the dispenser but come back, so they are excluded from sales and
   * added back to tank stock.
   */
  testLitres: Numeric;
  ratePerLitre: Numeric;
}

export interface ShiftSaleResult {
  grossLitres: Decimal;
  testLitres: Decimal;
  netLitres: Decimal;
  ratePerLitre: Decimal;
  salesAmount: Decimal;
}

export function shiftSale(input: ShiftSaleInput): ShiftSaleResult {
  const gross = toLitres(dec(input.grossLitres, 'gross_litres'));
  const test = toLitres(dec(input.testLitres, 'test_litres'));
  const rate = money(dec(input.ratePerLitre, 'rate_per_litre'));

  if (gross.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'gross_litres cannot be negative');
  if (test.isNegative()) throw new CalcError('NEGATIVE_LITRES', 'test_litres cannot be negative');
  if (rate.isNegative()) throw new CalcError('NEGATIVE_RATE', 'rate_per_litre cannot be negative');
  if (test.greaterThan(gross)) {
    throw new CalcError('TEST_EXCEEDS_GROSS', 'test_litres cannot exceed gross_litres', {
      grossLitres: gross.toFixed(3),
      testLitres: test.toFixed(3),
    });
  }

  const net = toLitres(gross.minus(test));
  return {
    grossLitres: gross,
    testLitres: test,
    netLitres: net,
    ratePerLitre: rate,
    salesAmount: money(net.times(rate)),
  };
}

export interface CashSplitInput {
  dieselSales: Numeric;
  lubricantSales: Numeric;
  /** Sum of the party-wise credit rows for the shift. */
  creditSales: Numeric;
}

export interface CashSplitResult {
  totalSales: Decimal;
  creditSales: Decimal;
  cashSales: Decimal;
}

export function cashSplit(input: CashSplitInput): CashSplitResult {
  const total = money(dec(input.dieselSales, 'diesel_sales').plus(dec(input.lubricantSales, 'lubricant_sales')));
  const credit = money(dec(input.creditSales, 'credit_sales'));
  if (credit.greaterThan(total)) {
    throw new CalcError('CREDIT_EXCEEDS_SALES', 'Credit sales cannot exceed total sales for the shift', {
      totalSales: total.toFixed(2),
      creditSales: credit.toFixed(2),
    });
  }
  return { totalSales: total, creditSales: credit, cashSales: money(total.minus(credit)) };
}
