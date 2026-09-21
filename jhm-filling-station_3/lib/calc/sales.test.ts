import { describe, expect, it } from 'vitest';
import { cashSplit, shiftSale } from './sales';
import { CalcError } from './decimal';

describe('shiftSale', () => {
  it('excludes test litres from the sale', () => {
    const result = shiftSale({ grossLitres: '4520.500', testLitres: '20.500', ratePerLitre: '109.00' });
    expect(result.netLitres.toFixed(3)).toBe('4500.000');
    expect(result.salesAmount.toFixed(2)).toBe('490500.00');
  });

  it('rounds money to paisa, not to a float', () => {
    const result = shiftSale({ grossLitres: '333.333', testLitres: '0', ratePerLitre: '107.75' });
    // 333.333 × 107.75 = 35,916.63075 → 35,916.63
    expect(result.salesAmount.toFixed(2)).toBe('35916.63');
  });

  it('rejects test litres greater than gross litres', () => {
    expect(() => shiftSale({ grossLitres: '10', testLitres: '11', ratePerLitre: '109' })).toThrow(/cannot exceed gross/);
  });

  it('rejects negative inputs', () => {
    expect(() => shiftSale({ grossLitres: '-1', testLitres: '0', ratePerLitre: '109' })).toThrow(CalcError);
    expect(() => shiftSale({ grossLitres: '10', testLitres: '0', ratePerLitre: '-109' })).toThrow(CalcError);
  });
});

describe('cashSplit', () => {
  it('derives cash sales as total minus credit', () => {
    const result = cashSplit({ dieselSales: '490500.00', lubricantSales: '9500.00', creditSales: '150000.00' });
    expect(result.totalSales.toFixed(2)).toBe('500000.00');
    expect(result.cashSales.toFixed(2)).toBe('350000.00');
  });

  it('rejects credit sales larger than total sales', () => {
    expect(() => cashSplit({ dieselSales: '100', lubricantSales: '0', creditSales: '101' })).toThrow(/cannot exceed total sales/);
  });
});
