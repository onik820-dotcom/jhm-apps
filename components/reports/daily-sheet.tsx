'use client';

import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatLitres, formatNumber, formatTime } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Muted } from '@/components/ui/glass';

/**
 * The Daily Sheet.
 *
 * A replica of the paper form the station already fills in by hand, for one
 * business day, ending in its five signature lines.
 *
 * WHAT IS CERTAIN AND WHAT IS NOT. The brief describes this as "a faithful
 * digital replica of the existing paper form, including all five signature
 * lines", and that sentence is the only written description of the form that
 * exists. The form itself has not been seen. Five signature lines is therefore
 * a fact; which five, their order, and the order of the sections above them
 * are not.
 *
 * So every figure here is computed and certain, and every *caption* comes from
 * settings.daily_sheet_labels — headings and all five signature lines, in both
 * languages. Correcting the sheet against the real form is an admin edit to
 * one row, not a code change. Until somebody confirms it, the sheet says so on
 * its own face rather than presenting a guess as a replica.
 */

type Json = Record<string, unknown>;

interface Bilingual {
  en?: string;
  bn?: string;
}

export interface DailySheetData extends Json {
  date: string;
  station: { name: string; name_bn: string | null; address: string; dealer_name: string };
  labels: {
    title?: Bilingual;
    meters?: Bilingual;
    tanks?: Bilingual;
    sales?: Bilingual;
    credit?: Bilingual;
    lubricants?: Bilingual;
    expenses?: Bilingual;
    cash?: Bilingual;
    signatures?: Bilingual;
    signature_lines?: Bilingual[];
    confirmed?: boolean;
  };
  shift_count: number;
  shifts: Array<Json>;
  meters: Array<Json>;
  tanks: Array<Json>;
  deliveries: Array<Json>;
  sales: Json;
  credit: Array<Json>;
  lubricants: Array<Json>;
  expenses: Array<Json>;
  cash: Array<Json>;
}

export function DailySheet({ sheet }: { sheet: DailySheetData }) {
  const { lang } = useLang();
  const L = (b?: Bilingual, fallback = '') => (b ? (lang === 'bn' ? (b.bn ?? b.en) : (b.en ?? b.bn)) ?? fallback : fallback);

  const labels = sheet.labels ?? {};
  const signatureLines = labels.signature_lines ?? [];
  const confirmed = labels.confirmed === true;

  const s = (sheet.sales ?? {}) as Record<string, number | string>;
  const shiftLabel = (type: unknown) =>
    type === 'night' ? (lang === 'bn' ? 'রাত' : 'Night') : lang === 'bn' ? 'দিন' : 'Day';

  const pumpExpenses = sheet.expenses.filter(
    (e) => e.book !== 'chairman' && e.book !== 'own_use',
  );
  const ownUseExpenses = sheet.expenses.filter((e) => e.book === 'own_use');
  const chairmanExpenses = sheet.expenses.filter((e) => e.book === 'chairman');

  return (
    <div className="print-sheet space-y-4 text-sm">
      {/* ---- the caption warning, on screen and on paper ---- */}
      {!confirmed ? (
        <div
          className="print-block rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--color-watch)', color: 'var(--color-watch)' }}
          lang={lang}
        >
          {lang === 'bn'
            ? 'এই ফরমের সব সংখ্যা হিসাব করা ও নিশ্চিত। কিন্তু শিরোনাম ও পাঁচটি স্বাক্ষরের নাম কাগজের আসল ফরমের সঙ্গে মিলিয়ে দেখা হয়নি — অ্যাডমিন সেটিংসে মিলিয়ে নিশ্চিত করুন।'
            : 'Every figure on this sheet is computed and certain. The headings and the five signature captions have not been checked against the paper form — an admin can correct them in settings, and this notice disappears once they are confirmed.'}
        </div>
      ) : null}

      {/* ---- masthead ---- */}
      <header className="print-block text-center">
        <h1 className="text-base font-bold tracking-tight">
          {lang === 'bn' && sheet.station.name_bn ? sheet.station.name_bn : sheet.station.name}
        </h1>
        <p className="text-xs">{sheet.station.address}</p>
        <p className="text-xs">
          {lang === 'bn' ? 'ডিলার' : 'Dealer'}: {sheet.station.dealer_name}
        </p>
        <h2 className="mt-2 text-sm font-semibold underline">
          {L(labels.title, lang === 'bn' ? 'দৈনিক বিবরণী' : 'Daily Sheet')}
        </h2>
        <p className="tabular mt-1 text-xs">
          {lang === 'bn' ? 'তারিখ' : 'Date'}: <strong>{formatDate(sheet.date, lang)}</strong>
          {sheet.shift_count > 0 ? (
            <>
              {'  ·  '}
              {lang === 'bn' ? 'শিফট' : 'Shifts'}: {formatNumber(sheet.shift_count, { lang })}
            </>
          ) : null}
        </p>
      </header>

      {sheet.shift_count === 0 ? (
        <p className="py-8 text-center text-sm" lang={lang}>
          {lang === 'bn'
            ? 'এই তারিখে কোনো শিফট বন্ধ হয়নি।'
            : 'No shift was closed on this date.'}
        </p>
      ) : null}

      {/* ---- 1. meters ---- */}
      {sheet.meters.length > 0 ? (
        <Section title={L(labels.meters, 'Meter readings')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'মেশিন' : 'Machine'}</Th>
                <Th>{lang === 'bn' ? 'নজল' : 'Nozzle'}</Th>
                <Th>{lang === 'bn' ? 'শিফট' : 'Shift'}</Th>
                <Th right>{lang === 'bn' ? 'শুরুর রিডিং' : 'Opening'}</Th>
                <Th right>{lang === 'bn' ? 'শেষের রিডিং' : 'Closing'}</Th>
                <Th right>{lang === 'bn' ? 'লিটার' : 'Litres'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.meters.map((m, i) => {
                const opening = m.opening as number | null;
                const closing = m.closing as number;
                const litres =
                  opening === null ? null : dec(closing).minus(dec(opening)).toFixed(2);
                return (
                  <tr key={i}>
                    <Td>{String(m.dispenser_code ?? '')}</Td>
                    <Td>{formatNumber(Number(m.nozzle_no ?? 0), { lang })}</Td>
                    <Td>{shiftLabel(m.shift_type)}</Td>
                    <Td right>{opening === null ? '—' : formatNumber(opening, { lang, decimals: 2 })}</Td>
                    <Td right>{formatNumber(closing, { lang, decimals: 2 })}</Td>
                    <Td right strong>
                      {litres === null ? '—' : formatNumber(litres, { lang, decimals: 2 })}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* ---- 2. tanks ---- */}
      {sheet.tanks.length > 0 ? (
        <Section title={L(labels.tanks, 'Tank stock')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'ট্যাংক' : 'Tank'}</Th>
                <Th>{lang === 'bn' ? 'শিফট' : 'Shift'}</Th>
                <Th right>{lang === 'bn' ? 'প্রারম্ভিক' : 'Opening'}</Th>
                <Th right>{lang === 'bn' ? 'গৃহীত' : 'Received'}</Th>
                <Th right>{lang === 'bn' ? 'বিক্রি' : 'Sold'}</Th>
                <Th right>{lang === 'bn' ? 'বই অনুযায়ী' : 'Book'}</Th>
                <Th right>{lang === 'bn' ? 'ডিপ (মিমি)' : 'Dip (mm)'}</Th>
                <Th right>{lang === 'bn' ? 'প্রকৃত' : 'Actual'}</Th>
                <Th right>{lang === 'bn' ? 'গরমিল' : 'Variance'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.tanks.map((t, i) => (
                <tr key={i}>
                  <Td>{String(t.tank_code ?? '')}</Td>
                  <Td>{shiftLabel(t.shift_type)}</Td>
                  <Td right>{formatLitres(t.book_opening as number, lang)}</Td>
                  <Td right>{formatLitres(t.refill_litres as number, lang)}</Td>
                  <Td right>{formatLitres(t.sold_from_tank as number, lang)}</Td>
                  <Td right>{formatLitres(t.book_closing as number, lang)}</Td>
                  <Td right>
                    {t.closing_dip_mm === null ? '—' : formatNumber(t.closing_dip_mm as number, { lang })}
                  </Td>
                  <Td right>{formatLitres(t.physical_closing as number, lang)}</Td>
                  <Td right strong={Boolean(t.variance_flagged)}>
                    {formatLitres(t.variance_litres as number, lang, true)}
                    {t.variance_flagged ? ' *' : ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.tanks.some((t) => t.variance_flagged) ? (
            <p className="mt-1 text-[10px]">
              {'* '}
              {sheet.tanks
                .filter((t) => t.variance_flagged && t.variance_reason)
                .map((t) => `${t.tank_code}: ${t.variance_reason}`)
                .join('  ·  ')}
            </p>
          ) : null}
        </Section>
      ) : null}

      {/* ---- tanker receipts ---- */}
      {sheet.deliveries.length > 0 ? (
        <Section title={lang === 'bn' ? 'ট্যাংকার গ্রহণ' : 'Tanker receipts'}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'সময়' : 'Time'}</Th>
                <Th>{lang === 'bn' ? 'চালান' : 'Challan'}</Th>
                <Th>{lang === 'bn' ? 'ট্রাক' : 'Truck'}</Th>
                <Th right>{lang === 'bn' ? 'ঘোষিত' : 'Declared'}</Th>
                <Th right>{lang === 'bn' ? 'গৃহীত' : 'Received'}</Th>
                <Th right>{lang === 'bn' ? 'ঘাটতি' : 'Shortage'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.deliveries.map((d, i) => (
                <tr key={i}>
                  <Td>{formatTime(String(d.arrived_at), lang)}</Td>
                  <Td>{String(d.challan_no ?? '')}</Td>
                  <Td>{String(d.truck_reg ?? '')}</Td>
                  <Td right>{formatLitres(d.total_declared as number, lang)}</Td>
                  <Td right>{formatLitres(d.total_received as number, lang)}</Td>
                  <Td right>{formatLitres(d.total_shortage as number, lang)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* ---- 3. sales summary ---- */}
      <Section title={L(labels.sales, 'Sales summary')}>
        <table className="w-full text-xs">
          <tbody>
            <Money label={lang === 'bn' ? 'মোট লিটার (গ্রস)' : 'Gross litres'} value={s.gross_litres} litres />
            <Money label={lang === 'bn' ? 'টেস্ট / পরিমাপ' : 'Test measure'} value={s.test_litres} litres />
            <Money label={lang === 'bn' ? 'নিট লিটার' : 'Net litres'} value={s.net_litres} litres strong />
            <Money label={lang === 'bn' ? 'বিক্রয় দর' : 'Rate per litre'} value={s.rate_per_litre} />
            <Money label={lang === 'bn' ? 'জ্বালানি বিক্রি' : 'Fuel sales'} value={s.fuel_amount} />
            <Money label={lang === 'bn' ? 'লুব্রিকেন্ট বিক্রি' : 'Lubricant sales'} value={s.lubricant_amount} />
            <Money label={lang === 'bn' ? 'মোট বিক্রি' : 'Total sales'} value={s.total_amount} strong />
            <Money label={lang === 'bn' ? 'বাদ: বাকি বিক্রি' : 'Less: credit sales'} value={s.credit_sales} />
            <Money label={lang === 'bn' ? 'নগদ বিক্রি' : 'Cash sales'} value={s.cash_sales} strong />
          </tbody>
        </table>
      </Section>

      {/* ---- 4. credit, party-wise ---- */}
      {sheet.credit.length > 0 ? (
        <Section title={L(labels.credit, 'Credit sales')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'পার্টি' : 'Party'}</Th>
                <Th>{lang === 'bn' ? 'গাড়ি' : 'Vehicle'}</Th>
                <Th>{lang === 'bn' ? 'চালান' : 'Challan'}</Th>
                <Th right>{lang === 'bn' ? 'লিটার' : 'Litres'}</Th>
                <Th right>{lang === 'bn' ? 'দর' : 'Rate'}</Th>
                <Th right>{lang === 'bn' ? 'টাকা' : 'Amount'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.credit.map((c, i) => (
                <tr key={i}>
                  <Td>
                    {lang === 'bn' && c.party_bn ? String(c.party_bn) : String(c.party ?? '')}
                    {c.over_limit ? ' *' : ''}
                  </Td>
                  <Td>{String(c.vehicle_no ?? '')}</Td>
                  <Td>{String(c.challan_no ?? '')}</Td>
                  <Td right>{c.litres === null ? '—' : formatLitres(c.litres as number, lang)}</Td>
                  <Td right>{c.rate === null ? '—' : formatBDT(c.rate as number, lang)}</Td>
                  <Td right strong>
                    {formatBDT(c.amount as number, lang)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.credit.some((c) => c.over_limit) ? (
            <p className="mt-1 text-[10px]" lang={lang}>
              {lang === 'bn'
                ? '* মালিকের অনুমোদনে ঋণসীমার বাইরে।'
                : '* allowed past the credit limit by the owner.'}
            </p>
          ) : null}
        </Section>
      ) : null}

      {/* ---- 5. lubricants ---- */}
      {sheet.lubricants.length > 0 ? (
        <Section title={L(labels.lubricants, 'Lubricants')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'পণ্য' : 'Product'}</Th>
                <Th>{lang === 'bn' ? 'ধরন' : 'Movement'}</Th>
                <Th right>{lang === 'bn' ? 'পরিমাণ' : 'Quantity'}</Th>
                <Th right>{lang === 'bn' ? 'দর' : 'Rate'}</Th>
                <Th right>{lang === 'bn' ? 'মূল্য' : 'Value'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.lubricants.map((l, i) => (
                <tr key={i}>
                  <Td>{lang === 'bn' && l.sku_bn ? String(l.sku_bn) : String(l.sku ?? '')}</Td>
                  <Td>
                    {l.txn_type === 'own_use'
                      ? lang === 'bn'
                        ? 'নিজস্ব ব্যবহার'
                        : 'Own use'
                      : lang === 'bn'
                        ? 'বিক্রয়'
                        : 'Sale'}
                    {l.vehicle_ref ? ` — ${String(l.vehicle_ref)}` : ''}
                  </Td>
                  <Td right>{formatLitres(l.qty as number, lang)}</Td>
                  <Td right>{formatBDT(l.rate as number, lang)}</Td>
                  <Td right strong>
                    {formatBDT(l.amount as number, lang)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.lubricants.some((l) => l.txn_type === 'own_use') ? (
            <p className="mt-1 text-[10px]" lang={lang}>
              {lang === 'bn'
                ? 'নিজস্ব ব্যবহার ক্রয়মূল্যে খরচ হিসেবে বসেছে — বিক্রি নয়।'
                : 'Own use is booked as an expense at cost, not counted as a sale.'}
            </p>
          ) : null}
        </Section>
      ) : null}

      {/* ---- 6. expenses, two books ---- */}
      {sheet.expenses.length > 0 ? (
        <Section title={L(labels.expenses, 'Expenses')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <ExpenseBook
              title={lang === 'bn' ? 'পাম্পের খাতা' : 'Pump book'}
              rows={pumpExpenses}
            />
            {ownUseExpenses.length > 0 ? (
              <ExpenseBook
                title={lang === 'bn' ? 'নিজস্ব ব্যবহার' : 'Own use'}
                rows={ownUseExpenses}
              />
            ) : null}
            <ExpenseBook
              title={lang === 'bn' ? 'চেয়ারম্যানের খাতা' : 'Chairman book'}
              rows={chairmanExpenses}
            />
          </div>
        </Section>
      ) : null}

      {/* ---- 7. the cash account ---- */}
      {sheet.cash.length > 0 ? (
        <Section title={L(labels.cash, 'Cash account')}>
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>{lang === 'bn' ? 'শিফট' : 'Shift'}</Th>
                <Th right>{lang === 'bn' ? 'প্রারম্ভিক' : 'Opening'}</Th>
                <Th right>{lang === 'bn' ? 'নগদ বিক্রি' : 'Cash sales'}</Th>
                <Th right>{lang === 'bn' ? 'বাকি আদায়' : 'Collected'}</Th>
                <Th right>{lang === 'bn' ? 'খরচ' : 'Expenses'}</Th>
                <Th right>{lang === 'bn' ? 'ব্যাংকে' : 'Deposited'}</Th>
                <Th right>{lang === 'bn' ? 'থাকার কথা' : 'Expected'}</Th>
                <Th right>{lang === 'bn' ? 'গোনা' : 'Counted'}</Th>
                <Th right>{lang === 'bn' ? 'গরমিল' : 'Variance'}</Th>
              </tr>
            </thead>
            <tbody>
              {sheet.cash.map((c, i) => (
                <tr key={i}>
                  <Td>{shiftLabel(c.shift_type)}</Td>
                  <Td right>{formatBDT(c.opening_cash as number, lang)}</Td>
                  <Td right>{formatBDT(c.cash_sales as number, lang)}</Td>
                  <Td right>{formatBDT(c.dues_collected as number, lang)}</Td>
                  <Td right>{formatBDT(c.expenses_cash as number, lang)}</Td>
                  <Td right>{formatBDT(c.bank_deposits as number, lang)}</Td>
                  <Td right>{formatBDT(c.expected_cash as number, lang)}</Td>
                  <Td right strong>
                    {formatBDT(c.counted_cash as number, lang)}
                  </Td>
                  <Td right strong={dec(String(c.cash_variance ?? 0)).isZero() === false}>
                    {formatBDT(c.cash_variance as number, lang, true)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {/* ---- 8. signatures ---- */}
      <section className="print-block pt-6">
        <p className="mb-6 text-center text-xs font-semibold">
          {L(labels.signatures, lang === 'bn' ? 'স্বাক্ষর' : 'Signatures')}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-5 sm:gap-x-3">
          {signatureLines.map((line, i) => (
            <div key={i} className="text-center">
              <div className="mb-1 border-t" style={{ borderColor: 'currentColor' }} />
              <p className="text-[10px] leading-tight">{L(line)}</p>
            </div>
          ))}
        </div>
        {signatureLines.length !== 5 ? (
          <Muted className="mt-3 text-center" lang={lang}>
            {lang === 'bn'
              ? `সেটিংসে ${formatNumber(signatureLines.length, { lang })}টি স্বাক্ষরের নাম আছে; ফরমে পাঁচটি থাকার কথা।`
              : `Settings define ${signatureLines.length} signature lines; the form is described as having five.`}
          </Muted>
        ) : null}
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { lang } = useLang();
  return (
    <section className="print-block">
      <h3 className="mb-1 border-b text-xs font-semibold" style={{ borderColor: 'var(--hairline)' }} lang={lang}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border px-1.5 py-1 text-[10px] font-medium ${right ? 'text-right' : 'text-left'}`}
      style={{ borderColor: 'var(--hairline)' }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  strong,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={`tabular border px-1.5 py-1 ${right ? 'text-right' : ''} ${strong ? 'font-semibold' : ''}`}
      style={{ borderColor: 'var(--hairline)' }}
    >
      {children}
    </td>
  );
}

function Money({
  label,
  value,
  litres,
  strong,
}: {
  label: string;
  value: unknown;
  litres?: boolean;
  strong?: boolean;
}) {
  const { lang } = useLang();
  return (
    <tr>
      <Td strong={strong}>{label}</Td>
      <Td right strong={strong}>
        {litres ? formatLitres(value as number, lang) : formatBDT(value as number, lang)}
      </Td>
    </tr>
  );
}

function ExpenseBook({ title, rows }: { title: string; rows: Array<Json> }) {
  const { lang } = useLang();
  const total = rows.reduce((acc, r) => acc.plus(dec(String(r.amount ?? 0))), dec(0));

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold" lang={lang}>
        {title}
      </p>
      <table className="w-full text-xs">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td>—</Td>
              <Td right>{formatBDT(0, lang)}</Td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <Td>
                  {lang === 'bn' && r.head_bn ? String(r.head_bn) : String(r.head ?? '')}
                  {r.description ? ` — ${String(r.description)}` : ''}
                </Td>
                <Td right>{formatBDT(r.amount as number, lang)}</Td>
              </tr>
            ))
          )}
          <tr>
            <Td strong>{lang === 'bn' ? 'মোট' : 'Total'}</Td>
            <Td right strong>
              {formatBDT(total.toFixed(2), lang)}
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
