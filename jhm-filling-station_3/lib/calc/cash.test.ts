import { describe, expect, it } from 'vitest';
import { ageingBuckets, checkCreditLimit, reconcileCash, runningBalance } from './cash';

describe('reconcileCash', () => {
  it('builds expected cash from the shift movements', () => {
    const result = reconcileCash({
      openingCash: '25000.00',
      cashSales: '350000.00',
      duesCollected: '40000.00',
      expensesCash: '12500.00',
      bankDeposits: '300000.00',
      countedCash: '102500.00',
    });
    expect(result.expectedCash.toFixed(2)).toBe('102500.00');
    expect(result.cashVariance.toFixed(2)).toBe('0.00');
    expect(result.requiresReason).toBe(false);
  });

  it('demands a reason for any shortfall, however small', () => {
    const result = reconcileCash({
      openingCash: '25000.00',
      cashSales: '350000.00',
      duesCollected: '0',
      expensesCash: '0',
      bankDeposits: '0',
      countedCash: '374999.50',
    });
    expect(result.cashVariance.toFixed(2)).toBe('-0.50');
    expect(result.requiresReason).toBe(true);
  });

  it('demands a reason for an excess too', () => {
    const result = reconcileCash({
      openingCash: '0', cashSales: '1000', duesCollected: '0', expensesCash: '0', bankDeposits: '0', countedCash: '1100',
    });
    expect(result.cashVariance.toFixed(2)).toBe('100.00');
    expect(result.requiresReason).toBe(true);
  });

  it('honours an explicit paisa tolerance', () => {
    const result = reconcileCash({
      openingCash: '0', cashSales: '1000', duesCollected: '0', expensesCash: '0', bankDeposits: '0',
      countedCash: '1000.50', tolerance: '1.00',
    });
    expect(result.requiresReason).toBe(false);
  });
});

describe('runningBalance', () => {
  it('raises the balance on a sale and lowers it on a payment', () => {
    const balance = runningBalance('50000.00', [
      { entryType: 'sale', debit: '120000.00', credit: '0' },
      { entryType: 'payment', debit: '0', credit: '100000.00' },
      { entryType: 'sale', debit: '30000.00', credit: '0' },
    ]);
    expect(balance.toFixed(2)).toBe('100000.00');
  });

  it('handles a part payment exactly', () => {
    const balance = runningBalance('0', [
      { entryType: 'sale', debit: '10899.55', credit: '0' },
      { entryType: 'payment', debit: '0', credit: '5000.00' },
    ]);
    expect(balance.toFixed(2)).toBe('5899.55');
  });
});

describe('checkCreditLimit', () => {
  it('blocks a sale that would push a party past its limit', () => {
    const check = checkCreditLimit('180000.00', '200000.00', '30000.00');
    expect(check.exceeded).toBe(true);
    expect(check.availableCredit.toFixed(2)).toBe('-10000.00');
    expect(check.utilisationPct!.toFixed(2)).toBe('105.00');
  });

  it('allows a sale that fits inside the limit', () => {
    const check = checkCreditLimit('180000.00', '200000.00', '15000.00');
    expect(check.exceeded).toBe(false);
    expect(check.availableCredit.toFixed(2)).toBe('5000.00');
  });

  it('treats a zero limit as unlimited rather than as always exceeded', () => {
    const check = checkCreditLimit('500000.00', '0', '10000.00');
    expect(check.exceeded).toBe(false);
    expect(check.utilisationPct).toBeNull();
  });
});

describe('ageingBuckets', () => {
  it('sorts outstanding items into the four buckets', () => {
    const buckets = ageingBuckets([
      { amount: '1000', ageDays: 0 },
      { amount: '2000', ageDays: 30 },
      { amount: '3000', ageDays: 31 },
      { amount: '4000', ageDays: 90 },
      { amount: '5000', ageDays: 91 },
    ]);
    expect(buckets['0-30'].toFixed(2)).toBe('3000.00');
    expect(buckets['31-60'].toFixed(2)).toBe('3000.00');
    expect(buckets['61-90'].toFixed(2)).toBe('4000.00');
    expect(buckets['90+'].toFixed(2)).toBe('5000.00');
  });
});
