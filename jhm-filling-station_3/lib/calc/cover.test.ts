import { describe, expect, it } from 'vitest';
import { stockCover } from './cover';

describe('stockCover', () => {
  it('divides stock on hand by the average daily sale', () => {
    const result = stockCover({
      dailyNetLitres: ['9000', '8500', '9500', '9000', '8000', '10000', '9000'],
      tankPhysicalLitres: ['8455.000', '6200.000'],
    });
    expect(result.avgDailySale.toFixed(3)).toBe('9000.000');
    expect(result.daysCover!.toFixed(2)).toBe('1.63');
    expect(result.lowStock).toBe(true);
  });

  it('is calm when there is more than three days of cover', () => {
    const result = stockCover({ dailyNetLitres: ['3000', '3000', '3000'], tankPhysicalLitres: ['12000', '9000'] });
    expect(result.daysCover!.toFixed(2)).toBe('7.00');
    expect(result.lowStock).toBe(false);
  });

  it('reports no cover figure when there is no sales history', () => {
    const result = stockCover({ dailyNetLitres: [], tankPhysicalLitres: ['12000'] });
    expect(result.daysCover).toBeNull();
    expect(result.lowStock).toBe(false);
  });

  it('does not divide by zero on a week with no sales', () => {
    const result = stockCover({ dailyNetLitres: ['0', '0', '0'], tankPhysicalLitres: ['12000'] });
    expect(result.daysCover).toBeNull();
  });

  it('honours a configured alert threshold', () => {
    const result = stockCover({ dailyNetLitres: ['4000'], tankPhysicalLitres: ['20000'], alertBelowDays: 7 });
    expect(result.daysCover!.toFixed(2)).toBe('5.00');
    expect(result.lowStock).toBe(true);
  });
});
