import { D, dec, type Numeric } from '@/lib/calc/decimal';
import { formatInTimeZone } from 'date-fns-tz';

export type Lang = 'bn' | 'en';

export const TIMEZONE = 'Asia/Dhaka';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

export function toBanglaDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]!);
}

export function localiseDigits(input: string, lang: Lang): string {
  return lang === 'bn' ? toBanglaDigits(input) : input;
}

/**
 * Bangladeshi grouping: the last three digits, then pairs. 1234567.89 becomes
 * 12,34,567.89 — not 1,234,567.89.
 */
function groupLakhCrore(integerPart: string): string {
  const negative = integerPart.startsWith('-');
  const digits = negative ? integerPart.slice(1) : integerPart;
  if (digits.length <= 3) return integerPart;

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped},${last3}`;
}

export interface NumberFormatOptions {
  lang?: Lang;
  decimals?: number;
  /** Render a leading ৳. */
  currency?: boolean;
  /** Show + for positive values, used for variance figures. */
  signed?: boolean;
}

export function formatNumber(value: Numeric, options: NumberFormatOptions = {}): string {
  const { lang = 'en', decimals = 0, currency = false, signed = false } = options;
  const d = dec(value).toDecimalPlaces(decimals, D.ROUND_HALF_UP);
  const fixed = d.toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');

  let out = groupLakhCrore(intPart);
  if (fracPart) out = `${out}.${fracPart}`;
  if (signed && d.greaterThan(0)) out = `+${out}`;
  if (currency) out = `৳${out.startsWith('-') ? `-${out.slice(1)}` : out}`;

  return localiseDigits(out, lang);
}

/** Money, always two decimals, always with the taka sign. */
export function formatBDT(value: Numeric, lang: Lang = 'en', signed = false): string {
  return formatNumber(value, { lang, decimals: 2, currency: true, signed });
}

/** Litres, always three decimals. */
export function formatLitres(value: Numeric, lang: Lang = 'en', signed = false): string {
  const n = formatNumber(value, { lang, decimals: 3, signed });
  return `${n} ${lang === 'bn' ? 'লিটার' : 'L'}`;
}

/** A dip reading in millimetres, one decimal when it is between marks. */
export function formatDip(value: Numeric, lang: Lang = 'en'): string {
  const d = dec(value);
  const decimals = d.isInteger() ? 0 : 1;
  return `${formatNumber(d, { lang, decimals })} ${lang === 'bn' ? 'মিমি' : 'mm'}`;
}

export function formatPercent(value: Numeric | null, lang: Lang = 'en', signed = true): string {
  if (value === null) return '—';
  return `${formatNumber(value, { lang, decimals: 2, signed })}%`;
}

export function formatDateTime(value: Date | string, lang: Lang = 'en', pattern = 'dd-MM-yyyy HH:mm'): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return localiseDigits(formatInTimeZone(date, TIMEZONE, pattern), lang);
}

export function formatDate(value: Date | string, lang: Lang = 'en'): string {
  return formatDateTime(value, lang, 'dd-MM-yyyy');
}

export function formatTime(value: Date | string, lang: Lang = 'en'): string {
  return formatDateTime(value, lang, 'HH:mm');
}

/**
 * The business day a moment belongs to. A day runs 06:00 → 06:00 Asia/Dhaka,
 * so a night shift closing at 05:30 still belongs to the previous date. This
 * mirrors public.business_date() in the database.
 */
export function businessDate(at: Date = new Date()): string {
  const hour = Number(formatInTimeZone(at, TIMEZONE, 'H'));
  const dateStr = formatInTimeZone(at, TIMEZONE, 'yyyy-MM-dd');
  if (hour >= 6) return dateStr;

  const previous = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  return formatInTimeZone(previous, TIMEZONE, 'yyyy-MM-dd');
}

/** Which shift a moment falls in: day 06:00–18:00, night 18:00–06:00. */
export function currentShiftType(at: Date = new Date()): 'day' | 'night' {
  const hour = Number(formatInTimeZone(at, TIMEZONE, 'H'));
  return hour >= 6 && hour < 18 ? 'day' : 'night';
}
