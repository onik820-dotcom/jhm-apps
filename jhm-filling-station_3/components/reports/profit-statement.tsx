'use client';

import { AlertTriangle } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatLitres, formatNumber } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Muted } from '@/components/ui/glass';

/**
 * Profit and loss.
 *
 * Two things on this page are opinions rather than arithmetic, and both are
 * stated on its face rather than buried:
 *
 *   The Chairman book sits below the operating result, not inside it. Money
 *   the owner draws is a distribution, not a cost of selling diesel; folding
 *   it in would make the pump look unprofitable in a month the owner happened
 *   to take more out.
 *
 *   Own-use lubricant is inside the pump expenses, at cost. It is a real cost
 *   and never a sale — counting it as revenue would invent a margin on oil
 *   nobody paid for.
 */

export interface ProfitStatementData {
  from: string;
  to: string;
  days: number;
  fuel: {
    litres: number;
    revenue: number;
    cogs: number;
    gross: number;
    margin_per_litre: number | null;
    uncosted_litres: number;
  };
  lubricants: { qty: number; revenue: number; cogs: number; gross: number; cogs_is_estimate: boolean };
  gross_profit: number;
  expenses: {
    pump: number;
    chairman: number;
    own_use: number;
    by_head: Array<{ name: string; name_bn: string | null; book: string; total: number }>;
  };
  operating_profit: number;
  chairman_drawings: number;
  after_drawings: number;
}

export function ProfitStatement({ data }: { data: ProfitStatementData }) {
  const { lang } = useLang();
  const t = (en: string, bn: string) => (lang === 'bn' ? bn : en);

  const pumpHeads = data.expenses.by_head.filter((h) => h.book !== 'chairman' && h.book !== 'own_use');
  const ownUseHeads = data.expenses.by_head.filter((h) => h.book === 'own_use');
  const chairmanHeads = data.expenses.by_head.filter((h) => h.book === 'chairman');
  const loss = dec(String(data.operating_profit)).lessThan(0);

  return (
    <div className="print-sheet space-y-4">
      <header className="print-block text-center">
        <h2 className="text-sm font-semibold underline">{t('Profit & Loss', 'লাভ-ক্ষতি')}</h2>
        <p className="tabular text-xs">
          {formatDate(data.from, lang)} — {formatDate(data.to, lang)}
          {'  ·  '}
          {formatNumber(data.days, { lang })} {t('days', 'দিন')}
        </p>
      </header>

      {data.fuel.uncosted_litres > 0 ? (
        <p className="state-watch print-block flex items-start gap-2 text-xs" lang={lang}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {lang === 'bn'
              ? `${formatLitres(data.fuel.uncosted_litres, lang)} বিক্রি হয়েছে এমন মজুদ থেকে যার ক্রয়মূল্য জানা নেই, তাই মুনাফা বাস্তবের চেয়ে বেশি দেখাচ্ছে। প্রারম্ভিক মজুদের মূল্য নির্ধারণ করুন।`
              : `${formatLitres(data.fuel.uncosted_litres, lang)} were sold out of stock that was never valued, so this margin is overstated. Set an opening valuation for the tanks.`}
          </span>
        </p>
      ) : null}

      <table className="w-full text-xs">
        <tbody>
          <Head>{t('Fuel', 'জ্বালানি')}</Head>
          <Line label={t('Litres sold', 'বিক্রিত লিটার')} value={formatLitres(data.fuel.litres, lang)} />
          <Line label={t('Revenue', 'বিক্রয়')} value={formatBDT(data.fuel.revenue, lang)} />
          <Line
            label={t('Less: cost of fuel sold', 'বাদ: বিক্রিত জ্বালানির ক্রয়মূল্য')}
            value={formatBDT(data.fuel.cogs, lang)}
          />
          <Line label={t('Fuel margin', 'জ্বালানির মুনাফা')} value={formatBDT(data.fuel.gross, lang)} strong />
          {data.fuel.margin_per_litre !== null ? (
            <Line
              label={t('Margin per litre', 'প্রতি লিটারে মুনাফা')}
              value={formatBDT(data.fuel.margin_per_litre, lang)}
              muted
            />
          ) : null}

          <Head>{t('Lubricants', 'লুব্রিকেন্ট')}</Head>
          <Line label={t('Sold', 'বিক্রি')} value={formatLitres(data.lubricants.qty, lang)} />
          <Line label={t('Revenue', 'বিক্রয়')} value={formatBDT(data.lubricants.revenue, lang)} />
          <Line
            label={t('Less: cost of oil sold', 'বাদ: বিক্রিত তেলের ক্রয়মূল্য')}
            value={formatBDT(data.lubricants.cogs, lang)}
          />
          <Line
            label={t('Lubricant margin', 'লুব্রিকেন্টের মুনাফা')}
            value={formatBDT(data.lubricants.gross, lang)}
            strong
          />

          <Head>{t('Gross profit', 'মোট মুনাফা')}</Head>
          <Line label={t('Fuel and lubricants', 'জ্বালানি ও লুব্রিকেন্ট')} value={formatBDT(data.gross_profit, lang)} strong />

          <Head>{t('Pump book expenses', 'পাম্পের খাতার খরচ')}</Head>
          {pumpHeads.map((h) => (
            <Line
              key={h.name}
              label={lang === 'bn' && h.name_bn ? h.name_bn : h.name}
              value={formatBDT(h.total, lang)}
              indent
            />
          ))}
          <Line label={t('Total pump expenses', 'পাম্পের মোট খরচ')} value={formatBDT(data.expenses.pump, lang)} strong />

          {/* Its own book. Oil into the station's lorries is neither a running
              cost the manager answers for nor money the owner drew, so it gets
              a line of its own instead of enlarging one of the other two. */}
          {data.expenses.own_use > 0 ? (
            <>
              <Head>{t('Own use', 'নিজস্ব ব্যবহার')}</Head>
              {ownUseHeads.map((h) => (
                <Line
                  key={h.name}
                  label={lang === 'bn' && h.name_bn ? h.name_bn : h.name}
                  value={formatBDT(h.total, lang)}
                  indent
                />
              ))}
              <Line
                label={t('Oil to the station’s own lorries', 'নিজস্ব গাড়ির তেল')}
                value={formatBDT(data.expenses.own_use, lang)}
                strong
              />
            </>
          ) : null}

          <Head>{t('Operating profit', 'পরিচালন মুনাফা')}</Head>
          <Line
            label={
              data.expenses.own_use > 0
                ? t('After pump expenses and own use', 'পাম্পের খরচ ও নিজস্ব ব্যবহার বাদে')
                : t('After pump expenses', 'পাম্পের খরচ বাদে')
            }
            value={formatBDT(data.operating_profit, lang)}
            strong
            tone={loss ? 'breach' : 'ok'}
          />

          <Head>{t('Chairman book', 'চেয়ারম্যানের খাতা')}</Head>
          {chairmanHeads.map((h) => (
            <Line
              key={h.name}
              label={lang === 'bn' && h.name_bn ? h.name_bn : h.name}
              value={formatBDT(h.total, lang)}
              indent
            />
          ))}
          <Line
            label={t('Owner drawings', 'মালিকের উত্তোলন')}
            value={formatBDT(data.chairman_drawings, lang)}
            strong
          />
          <Line
            label={t('After drawings', 'উত্তোলনের পর')}
            value={formatBDT(data.after_drawings, lang)}
            strong
          />
        </tbody>
      </table>

      <div className="print-block space-y-1 pt-2">
        <Muted lang={lang}>
          {lang === 'bn'
            ? 'চেয়ারম্যানের খাতা পরিচালন মুনাফার নিচে রাখা হয়েছে — মালিকের উত্তোলন ডিজেল বিক্রির খরচ নয়, মুনাফার বণ্টন।'
            : 'The Chairman book sits below the operating result. An owner’s drawings are a distribution of profit, not a cost of selling diesel.'}
        </Muted>
        {data.expenses.own_use > 0 ? (
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'নিজস্ব গাড়ির তেল আলাদা খাতে, ক্রয়মূল্যে — পাম্পের খরচের মধ্যে নয় এবং বিক্রি হিসেবেও নয়। পরিচালন মুনাফা থেকে বাদ যায়, কারণ তেলটা সত্যিই ব্যবসা থেকে বেরিয়েছে।'
              : 'Oil issued to the station’s own lorries has its own book, valued at cost — not inside pump expenses and never counted as a sale. It still comes off operating profit, because the oil really did leave the business.'}
          </Muted>
        ) : null}
        {data.lubricants.cogs_is_estimate && data.lubricants.revenue > 0 ? (
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'লুব্রিকেন্টের ক্রয়মূল্য বর্তমান গড় দরে হিসাব করা — শেলফের ঐতিহাসিক দর রাখা হয় না, তাই এটি আনুমানিক।'
              : 'Lubricant cost of sale uses the shelf’s current average. The shelf keeps no historical cost, so this one figure is an estimate.'}
          </Muted>
        ) : null}
      </div>
    </div>
  );
}

function Head({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  return (
    <tr>
      <td colSpan={2} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide" lang={lang}>
        {children}
      </td>
    </tr>
  );
}

function Line({
  label,
  value,
  strong,
  indent,
  muted,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  indent?: boolean;
  muted?: boolean;
  tone?: 'ok' | 'breach';
}) {
  const { lang } = useLang();
  return (
    <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
      <td
        className={`py-1 ${indent ? 'pl-4' : ''} ${strong ? 'font-semibold' : ''}`}
        style={muted ? { color: 'var(--text-faint)' } : undefined}
        lang={lang}
      >
        {label}
      </td>
      <td
        className={`tabular py-1 text-right ${strong ? 'font-semibold' : ''} ${tone ? `state-${tone}` : ''}`}
        style={muted ? { color: 'var(--text-faint)' } : undefined}
      >
        {value}
      </td>
    </tr>
  );
}
