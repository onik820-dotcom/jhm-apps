import { describe, expect, it } from 'vitest';
import { dieselProfit, lubricantProfit, movingAverageCost, profitAndLoss, stockValue } from './cost';

describe('movingAverageCost', () => {
  it('weights the old stock against the new delivery', () => {
    // 5,000 L at ৳100 plus 9,000 L at ৳106 → 1,454,000 / 14,000 = 103.8571…
    const cost = movingAverageCost({ oldStockLitres: '5000', oldAvgCost: '100.00', receivedLitres: '9000', depotRate: '106.00' });
    expect(cost.toFixed(4)).toBe('103.8571');
  });

  it('takes the depot rate when the tank was empty', () => {
    const cost = movingAverageCost({ oldStockLitres: '0', oldAvgCost: '0', receivedLitres: '9000', depotRate: '104.50' });
    expect(cost.toFixed(4)).toBe('104.5000');
  });

  it('falls back to the depot rate rather than dividing by zero', () => {
    const cost = movingAverageCost({ oldStockLitres: '0', oldAvgCost: '0', receivedLitres: '0', depotRate: '104.50' });
    expect(cost.toFixed(2)).toBe('104.50');
  });

  it('leaves the average untouched when nothing is received', () => {
    const cost = movingAverageCost({ oldStockLitres: '5000', oldAvgCost: '101.2500', receivedLitres: '0', depotRate: '110.00' });
    expect(cost.toFixed(4)).toBe('101.2500');
  });

  it('carries cost at 4 dp so it does not drift across a 12,000 L tank', () => {
    const cost = movingAverageCost({ oldStockLitres: '7000', oldAvgCost: '103.3333', receivedLitres: '5000', depotRate: '107.7777' });
    expect(cost.decimalPlaces()).toBeLessThanOrEqual(4);
  });
});

describe('dieselProfit', () => {
  it('prices cost of goods at the average cost at the time of sale', () => {
    const line = dieselProfit({ netLitres: '4500.000', sellingRate: '109.00', avgCostAtSale: '103.8571' });
    expect(line.revenue.toFixed(2)).toBe('490500.00');
    expect(line.cogs.toFixed(2)).toBe('467356.95');
    expect(line.grossProfit.toFixed(2)).toBe('23143.05');
    expect(line.marginPct!.toFixed(2)).toBe('4.72');
  });
});

describe('lubricantProfit', () => {
  it('sums margin across SKUs', () => {
    const line = lubricantProfit([
      { skuId: 'mobil-super-1l', qty: '10', saleAmount: '9000.00', purchaseRate: '760.00' },
      { skuId: 'gear-oil-loose', qty: '5', saleAmount: '2500.00', purchaseRate: '420.00' },
    ]);
    expect(line.revenue.toFixed(2)).toBe('11500.00');
    expect(line.cogs.toFixed(2)).toBe('9700.00');
    expect(line.grossProfit.toFixed(2)).toBe('1800.00');
  });
});

describe('profitAndLoss', () => {
  it('nets expenses off gross profit', () => {
    const pnl = profitAndLoss({ dieselGrossProfit: '23143.05', lubricantGrossProfit: '1800.00', totalExpenses: '7250.50' });
    expect(pnl.grossProfit.toFixed(2)).toBe('24943.05');
    expect(pnl.netProfit.toFixed(2)).toBe('17692.55');
  });

  it('reports a loss rather than clamping at zero', () => {
    const pnl = profitAndLoss({ dieselGrossProfit: '1000', lubricantGrossProfit: '0', totalExpenses: '2500' });
    expect(pnl.netProfit.toFixed(2)).toBe('-1500.00');
  });
});

describe('stockValue', () => {
  it('values physical stock at the tank average cost', () => {
    // 8455 L × ৳103.8571 = ৳878,111.7805 → ৳878,111.78
    expect(stockValue('8455.000', '103.8571').toFixed(2)).toBe('878111.78');
  });
});
