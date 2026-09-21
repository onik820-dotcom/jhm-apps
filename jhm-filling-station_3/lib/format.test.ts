import { describe, expect, it } from 'vitest';
import { businessDate, currentShiftType, formatBDT, formatDip, formatLitres, formatPercent, toBanglaDigits } from './format';

describe('Bangladeshi number grouping', () => {
  it('groups by lakh and crore, not by thousand', () => {
    expect(formatBDT('1234567.89')).toBe('৳12,34,567.89');
    expect(formatBDT('100000')).toBe('৳1,00,000.00');
    expect(formatBDT('12345678901.50')).toBe('৳12,34,56,78,901.50');
  });

  it('leaves small numbers ungrouped', () => {
    expect(formatBDT('999')).toBe('৳999.00');
    expect(formatBDT('0')).toBe('৳0.00');
  });

  it('keeps the minus sign in front of the taka sign', () => {
    expect(formatBDT('-1500')).toBe('৳-1,500.00');
  });

  it('switches to Bangla numerals with the language', () => {
    expect(formatBDT('1234567.89', 'bn')).toBe('৳১২,৩৪,৫৬৭.৮৯');
    expect(toBanglaDigits('2070')).toBe('২০৭০');
  });
});

describe('volumes and dips', () => {
  it('shows litres to three decimals', () => {
    expect(formatLitres('8455')).toBe('8,455.000 L');
    expect(formatLitres('8455', 'bn')).toBe('৮,৪৫৫.০০০ লিটার');
  });

  it('shows a whole-millimetre dip without decimals and a part-millimetre one with', () => {
    expect(formatDip(1450)).toBe('1,450 mm');
    expect(formatDip('1450.5')).toBe('1,450.5 mm');
  });

  it('signs a variance percentage', () => {
    expect(formatPercent('-0.5')).toBe('-0.50%');
    expect(formatPercent('0.42')).toBe('+0.42%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('the business day runs 06:00 to 06:00 Asia/Dhaka', () => {
  it('attributes a night shift closing at 05:30 to the previous date', () => {
    // 2026-09-20 05:30 in Dhaka is 2026-09-19 23:30 UTC.
    expect(businessDate(new Date('2026-09-19T23:30:00Z'))).toBe('2026-09-19');
  });

  it('starts a new business day at 06:00', () => {
    // 2026-09-20 06:00 Dhaka = 2026-09-20 00:00 UTC.
    expect(businessDate(new Date('2026-09-20T00:00:00Z'))).toBe('2026-09-20');
    // One minute earlier still belongs to the day before.
    expect(businessDate(new Date('2026-09-19T23:59:00Z'))).toBe('2026-09-19');
  });

  it('names the shift a moment falls in', () => {
    expect(currentShiftType(new Date('2026-09-20T04:00:00Z'))).toBe('day'); // 10:00 Dhaka
    expect(currentShiftType(new Date('2026-09-20T14:00:00Z'))).toBe('night'); // 20:00 Dhaka
    expect(currentShiftType(new Date('2026-09-20T00:00:00Z'))).toBe('day'); // 06:00 Dhaka exactly
    expect(currentShiftType(new Date('2026-09-20T12:00:00Z'))).toBe('night'); // 18:00 Dhaka exactly
  });
});
