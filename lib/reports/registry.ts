import type { Role } from '@/lib/roles';

/**
 * One definition per report, shared by the screen, the Excel route and the
 * printed page.
 *
 * The alternative — a screen that builds its own table and an export that
 * builds another — is two implementations of the same report, and the first
 * time they disagree nobody can say which one the business should believe.
 * Here a column exists once: its heading in both languages, how it is
 * formatted, and how it totals.
 */

export type ColumnKind = 'text' | 'money' | 'litres' | 'number' | 'date' | 'datetime' | 'percent';

export interface ReportColumn {
  key: string;
  en: string;
  bn: string;
  kind: ColumnKind;
  /** Sum this column into a totals row. Only ever money, litres or a count. */
  total?: boolean;
  /** Hidden from anyone who may not see cost or profit. */
  costOnly?: boolean;
  width?: number;
}

export interface ReportDefinition {
  id: string;
  en: string;
  bn: string;
  /** One line under the title saying what the report is for. */
  descriptionEn: string;
  descriptionBn: string;
  roles: Role[];
  /** 'range' takes a from and a to; 'day' takes a single business day. */
  period: 'range' | 'day';
  columns: ReportColumn[];
  /** Rendered as its own page rather than a table — the Daily Sheet and P&L. */
  layout?: 'sheet' | 'statement';
}

const OWNER: Role[] = ['admin', 'md'];
const ALL: Role[] = ['manager', 'admin', 'md'];

export const REPORTS: ReportDefinition[] = [
  {
    id: 'daily-sheet',
    en: 'Daily Sheet',
    bn: 'দৈনিক বিবরণী',
    descriptionEn: 'The paper form, one business day, with its five signature lines.',
    descriptionBn: 'কাগজের ফরম — এক ব্যবসায়িক দিন, পাঁচটি স্বাক্ষরসহ।',
    roles: ALL,
    period: 'day',
    layout: 'sheet',
    columns: [],
  },
  {
    id: 'profit-loss',
    en: 'Profit & Loss',
    bn: 'লাভ-ক্ষতি',
    descriptionEn: 'Fuel and lubricant margin against the pump book, with the Chairman book shown separately below the operating result.',
    descriptionBn: 'জ্বালানি ও লুব্রিকেন্টের মুনাফা, পাম্পের খাতার খরচ বাদে। চেয়ারম্যানের খাতা আলাদা করে নিচে দেখানো।',
    roles: OWNER,
    period: 'range',
    layout: 'statement',
    columns: [],
  },
  {
    id: 'shift-reconciliation',
    en: 'Shift reconciliation',
    bn: 'শিফট মিলকরণ',
    descriptionEn: 'Every close: litres, sales, the cash count and the variance with its reason.',
    descriptionBn: 'প্রতিটি শিফট বন্ধ — লিটার, বিক্রি, নগদ গণনা ও গরমিলের কারণ।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'shift_date', en: 'Date', bn: 'তারিখ', kind: 'date', width: 14 },
      { key: 'shift_type', en: 'Shift', bn: 'শিফট', kind: 'text', width: 10 },
      { key: 'net_litres', en: 'Net litres', bn: 'নিট লিটার', kind: 'litres', total: true },
      { key: 'rate_per_litre', en: 'Rate', bn: 'দর', kind: 'money' },
      { key: 'sales_amount', en: 'Fuel sales', bn: 'জ্বালানি বিক্রি', kind: 'money', total: true },
      { key: 'lubricant_sales', en: 'Lubricant', bn: 'লুব্রিকেন্ট', kind: 'money', total: true },
      { key: 'credit_sales', en: 'Credit', bn: 'বাকি', kind: 'money', total: true },
      { key: 'cash_sales', en: 'Cash', bn: 'নগদ', kind: 'money', total: true },
      { key: 'expected_cash', en: 'Expected cash', bn: 'থাকার কথা', kind: 'money', total: true },
      { key: 'counted_cash', en: 'Counted', bn: 'গোনা', kind: 'money', total: true },
      { key: 'cash_variance', en: 'Cash variance', bn: 'নগদ গরমিল', kind: 'money', total: true },
      { key: 'variance_reason', en: 'Reason', bn: 'কারণ', kind: 'text', width: 34 },
    ],
  },
  {
    id: 'stock-variance',
    en: 'Tank stock & variance register',
    bn: 'ট্যাংক মজুদ ও গরমিল রেজিস্টার',
    descriptionEn: 'The book against the rod, tank by tank, shift by shift.',
    descriptionBn: 'বই বনাম ডিপ — ট্যাংক ধরে, শিফট ধরে।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'shift_date', en: 'Date', bn: 'তারিখ', kind: 'date', width: 14 },
      { key: 'shift_type', en: 'Shift', bn: 'শিফট', kind: 'text', width: 10 },
      { key: 'tank_code', en: 'Tank', bn: 'ট্যাংক', kind: 'text', width: 8 },
      { key: 'book_opening', en: 'Opening', bn: 'প্রারম্ভিক', kind: 'litres' },
      { key: 'refill_litres', en: 'Received', bn: 'গৃহীত', kind: 'litres', total: true },
      { key: 'sold_from_tank', en: 'Sold', bn: 'বিক্রি', kind: 'litres', total: true },
      { key: 'book_closing', en: 'Book closing', bn: 'বই অনুযায়ী', kind: 'litres' },
      { key: 'physical_closing', en: 'By the rod', bn: 'ডিপ অনুযায়ী', kind: 'litres' },
      { key: 'variance_litres', en: 'Variance', bn: 'গরমিল', kind: 'litres', total: true },
      { key: 'variance_pct', en: 'Variance %', bn: 'গরমিল %', kind: 'percent' },
      { key: 'variance_reason', en: 'Reason', bn: 'কারণ', kind: 'text', width: 34 },
    ],
  },
  {
    id: 'purchase-register',
    en: 'Purchase register',
    bn: 'ক্রয় রেজিস্টার',
    descriptionEn: 'Every tanker, compartment by compartment, with its shortage.',
    descriptionBn: 'প্রতিটি ট্যাংকার — চেম্বার ধরে, ঘাটতিসহ।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'arrived_at', en: 'Arrived', bn: 'আগমন', kind: 'datetime', width: 18 },
      { key: 'challan_no', en: 'Challan', bn: 'চালান', kind: 'text', width: 16 },
      { key: 'truck_reg', en: 'Truck', bn: 'ট্রাক', kind: 'text', width: 20 },
      { key: 'tank_code', en: 'Tank', bn: 'ট্যাংক', kind: 'text', width: 8 },
      { key: 'compartment_no', en: 'Comp.', bn: 'চেম্বার', kind: 'number', width: 8 },
      { key: 'declared_litres', en: 'Declared', bn: 'ঘোষিত', kind: 'litres', total: true },
      { key: 'received_litres', en: 'Received', bn: 'গৃহীত', kind: 'litres', total: true },
      { key: 'shortage_litres', en: 'Shortage', bn: 'ঘাটতি', kind: 'litres', total: true },
      { key: 'shortage_pct', en: 'Shortage %', bn: 'ঘাটতি %', kind: 'percent' },
      { key: 'depot_rate', en: 'Depot rate', bn: 'ডিপো দর', kind: 'money', costOnly: true },
      { key: 'value', en: 'Value', bn: 'মূল্য', kind: 'money', total: true, costOnly: true },
    ],
  },
  {
    id: 'sales-register',
    en: 'Sales register',
    bn: 'বিক্রয় রেজিস্টার',
    descriptionEn: 'Credit sales party by party, with the vehicle and challan against each.',
    descriptionBn: 'বাকি বিক্রয় — পার্টি ধরে, গাড়ি ও চালানসহ।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'sold_at', en: 'When', bn: 'কখন', kind: 'datetime', width: 18 },
      { key: 'party', en: 'Party', bn: 'পার্টি', kind: 'text', width: 30 },
      { key: 'vehicle_no', en: 'Vehicle', bn: 'গাড়ি', kind: 'text', width: 18 },
      { key: 'challan_no', en: 'Challan', bn: 'চালান', kind: 'text', width: 16 },
      { key: 'litres', en: 'Litres', bn: 'লিটার', kind: 'litres', total: true },
      { key: 'rate', en: 'Rate', bn: 'দর', kind: 'money' },
      { key: 'amount', en: 'Amount', bn: 'টাকা', kind: 'money', total: true },
      { key: 'over_limit', en: 'Past limit', bn: 'সীমার বাইরে', kind: 'text', width: 12 },
    ],
  },
  {
    id: 'customer-ageing',
    en: 'Customer ledger & ageing',
    bn: 'পার্টির খতিয়ান ও বয়সভিত্তিক বাকি',
    descriptionEn: 'What each party owes and how long they have owed it, oldest bill cleared first.',
    descriptionBn: 'কোন পার্টির কত বাকি ও কত দিনের — পুরনো বিল আগে পরিশোধ ধরে।',
    roles: ALL,
    period: 'day',
    columns: [
      { key: 'customer_name', en: 'Party', bn: 'পার্টি', kind: 'text', width: 30 },
      { key: 'credit_limit', en: 'Limit', bn: 'সীমা', kind: 'money' },
      { key: 'balance', en: 'Balance', bn: 'বাকি', kind: 'money', total: true },
      { key: 'bucket_0_30', en: '0–30', bn: '০–৩০', kind: 'money', total: true },
      { key: 'bucket_31_60', en: '31–60', bn: '৩১–৬০', kind: 'money', total: true },
      { key: 'bucket_61_90', en: '61–90', bn: '৬১–৯০', kind: 'money', total: true },
      { key: 'bucket_90_plus', en: '90+', bn: '৯০+', kind: 'money', total: true },
      { key: 'oldest_item_days', en: 'Oldest', bn: 'পুরনো', kind: 'number' },
    ],
  },
  {
    id: 'expense-register',
    en: 'Expense register',
    bn: 'খরচ রেজিস্টার',
    descriptionEn: 'Both books, head by head. The Chairman book is never added into the Pump book.',
    descriptionBn: 'দুই খাতা, খাত ধরে। চেয়ারম্যানের খাতা কখনো পাম্পের খাতায় যোগ হয় না।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'spent_at', en: 'When', bn: 'কখন', kind: 'datetime', width: 18 },
      { key: 'book', en: 'Book', bn: 'খাতা', kind: 'text', width: 14 },
      { key: 'head', en: 'Head', bn: 'খাত', kind: 'text', width: 26 },
      { key: 'description', en: 'For', bn: 'বাবদ', kind: 'text', width: 30 },
      { key: 'paid_by', en: 'Paid by', bn: 'যেভাবে', kind: 'text', width: 12 },
      { key: 'amount', en: 'Amount', bn: 'টাকা', kind: 'money', total: true },
    ],
  },
  {
    id: 'cash-book',
    en: 'Cash book',
    bn: 'নগদ খাতা',
    descriptionEn: 'The drawer shift by shift: opening, sales, collections, expenses, deposits, count.',
    descriptionBn: 'শিফট ধরে নগদ — প্রারম্ভিক, বিক্রি, আদায়, খরচ, জমা, গণনা।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'shift_date', en: 'Date', bn: 'তারিখ', kind: 'date', width: 14 },
      { key: 'shift_type', en: 'Shift', bn: 'শিফট', kind: 'text', width: 10 },
      { key: 'opening_cash', en: 'Opening', bn: 'প্রারম্ভিক', kind: 'money' },
      { key: 'cash_sales', en: 'Cash sales', bn: 'নগদ বিক্রি', kind: 'money', total: true },
      { key: 'dues_collected', en: 'Collected', bn: 'আদায়', kind: 'money', total: true },
      { key: 'expenses_cash', en: 'Expenses', bn: 'খরচ', kind: 'money', total: true },
      { key: 'bank_deposits', en: 'Deposited', bn: 'ব্যাংকে জমা', kind: 'money', total: true },
      { key: 'expected_cash', en: 'Expected', bn: 'থাকার কথা', kind: 'money' },
      { key: 'counted_cash', en: 'Counted', bn: 'গোনা', kind: 'money' },
      { key: 'cash_variance', en: 'Variance', bn: 'গরমিল', kind: 'money', total: true },
    ],
  },
  {
    id: 'dispenser-performance',
    en: 'Dispenser performance',
    bn: 'মেশিনভিত্তিক বিক্রি',
    descriptionEn: 'Litres through each nozzle, and what went into the test measure.',
    descriptionBn: 'প্রতিটি নজলের লিটার ও টেস্টে যাওয়া পরিমাণ।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'dispenser_code', en: 'Machine', bn: 'মেশিন', kind: 'text', width: 10 },
      { key: 'nozzle_no', en: 'Nozzle', bn: 'নজল', kind: 'number', width: 8 },
      { key: 'tank_code', en: 'Tank', bn: 'ট্যাংক', kind: 'text', width: 8 },
      { key: 'shifts', en: 'Shifts', bn: 'শিফট', kind: 'number' },
      { key: 'litres', en: 'Litres', bn: 'লিটার', kind: 'litres', total: true },
      { key: 'test_litres', en: 'Test', bn: 'টেস্ট', kind: 'litres', total: true },
      { key: 'rollovers', en: 'Rollovers', bn: 'রোলওভার', kind: 'number', total: true },
    ],
  },
  {
    id: 'lubricant-movement',
    en: 'Lubricant movement',
    bn: 'লুব্রিকেন্ট লেনদেন',
    descriptionEn: 'Bought, sold and issued to the station’s own lorries, which is a cost and never a sale.',
    descriptionBn: 'ক্রয়, বিক্রয় ও নিজস্ব গাড়িতে দেওয়া — যা খরচ, বিক্রি নয়।',
    roles: ALL,
    period: 'range',
    columns: [
      { key: 'txn_at', en: 'When', bn: 'কখন', kind: 'datetime', width: 18 },
      { key: 'sku', en: 'Product', bn: 'পণ্য', kind: 'text', width: 26 },
      { key: 'txn_type', en: 'Movement', bn: 'ধরন', kind: 'text', width: 12 },
      { key: 'qty', en: 'Quantity', bn: 'পরিমাণ', kind: 'litres', total: true },
      { key: 'rate', en: 'Rate', bn: 'দর', kind: 'money' },
      { key: 'amount', en: 'Value', bn: 'মূল্য', kind: 'money', total: true },
      { key: 'party', en: 'Party / vehicle', bn: 'পার্টি / গাড়ি', kind: 'text', width: 24 },
    ],
  },
  {
    id: 'audit-log',
    en: 'Audit log',
    bn: 'অডিট লগ',
    descriptionEn: 'Every change to a financial record, with who made it and what it was before.',
    descriptionBn: 'প্রতিটি হিসাব পরিবর্তন — কে করেছে এবং আগে কী ছিল।',
    roles: ['admin'],
    period: 'range',
    columns: [
      { key: 'at', en: 'When', bn: 'কখন', kind: 'datetime', width: 20 },
      { key: 'actor', en: 'Who', bn: 'কে', kind: 'text', width: 22 },
      { key: 'actor_role', en: 'Role', bn: 'ভূমিকা', kind: 'text', width: 12 },
      { key: 'table_name', en: 'Record', bn: 'রেকর্ড', kind: 'text', width: 22 },
      { key: 'action', en: 'Action', bn: 'কাজ', kind: 'text', width: 12 },
      { key: 'summary', en: 'What changed', bn: 'কী বদলেছে', kind: 'text', width: 48 },
    ],
  },
];

export function reportById(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function reportsForRole(role: Role): ReportDefinition[] {
  return REPORTS.filter((r) => r.roles.includes(role));
}

/** Columns this role may actually see, with cost stripped for a manager. */
export function visibleColumns(report: ReportDefinition, canSeeCost: boolean): ReportColumn[] {
  return report.columns.filter((c) => canSeeCost || !c.costOnly);
}
