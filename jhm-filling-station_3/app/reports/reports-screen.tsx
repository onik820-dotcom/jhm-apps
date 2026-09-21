'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Printer } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatDateTime, formatLitres, formatNumber, formatPercent } from '@/lib/format';
import { EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import type { ReportColumn } from '@/lib/reports/registry';
import type { ReportRow } from '@/lib/reports/run';
import { DailySheet, type DailySheetData } from '@/components/reports/daily-sheet';
import { ProfitStatement, type ProfitStatementData } from '@/components/reports/profit-statement';

interface ReportChoice {
  id: string;
  en: string;
  bn: string;
  descriptionEn: string;
  descriptionBn: string;
  period: 'range' | 'day';
  layout: string | null;
}

export function ReportsScreen({
  available,
  reportId,
  columns,
  rows,
  totals,
  sheet,
  statement,
  error,
  from,
  to,
  period,
}: {
  available: ReportChoice[];
  reportId: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, string>;
  sheet: unknown;
  statement: unknown;
  error: string | null;
  from: string;
  to: string;
  period: 'range' | 'day';
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const params = useSearchParams();

  const current = available.find((r) => r.id === reportId);

  function go(next: Partial<{ r: string; from: string; to: string }>) {
    const q = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) q.set(key, value);
    router.push(`/reports?${q.toString()}`);
  }

  const exportHref = `/api/reports/${reportId}/xlsx?from=${from}&to=${to}&lang=${lang}`;

  return (
    <div className="space-y-4">
      {/* ---- everything in this block comes off when the page prints ---- */}
      <div className="no-print space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('nav.reports')}
          </h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {period === 'range' ? (
              <label className="flex items-center gap-1.5 text-xs">
                <span style={{ color: 'var(--text-faint)' }} lang={lang}>
                  {lang === 'bn' ? 'থেকে' : 'From'}
                </span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => go({ from: e.target.value })}
                  className="tabular rounded-lg border bg-transparent px-2 py-1.5 text-xs outline-none"
                  style={{ borderColor: 'var(--hairline)' }}
                />
              </label>
            ) : null}

            <label className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--text-faint)' }} lang={lang}>
                {period === 'range' ? (lang === 'bn' ? 'পর্যন্ত' : 'To') : lang === 'bn' ? 'তারিখ' : 'Date'}
              </span>
              <input
                type="date"
                value={to}
                onChange={(e) => go({ to: e.target.value })}
                className="tabular rounded-lg border bg-transparent px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: 'var(--hairline)' }}
              />
            </label>

            <a
              href={exportHref}
              className="tap-target flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--hairline)' }}
              lang={lang}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Excel
            </a>

            <button
              type="button"
              onClick={() => window.print()}
              className="tap-target flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--color-accent)', color: 'white' }}
              lang={lang}
            >
              <Printer className="h-3.5 w-3.5" aria-hidden />
              PDF
            </button>
          </div>
        </div>

        {/* Quick ranges, because a month is the question people actually ask. */}
        {period === 'range' ? (
          <div className="flex flex-wrap gap-1">
            {(
              [
                [lang === 'bn' ? 'আজ' : 'Today', to, to],
                [lang === 'bn' ? 'এ মাস' : 'This month', `${to.slice(0, 7)}-01`, to],
                [lang === 'bn' ? 'এ বছর' : 'This year', `${to.slice(0, 4)}-01-01`, to],
              ] as const
            ).map(([label, f, t2]) => (
              <button
                key={label}
                type="button"
                onClick={() => go({ from: f, to: t2 })}
                className="tap-target rounded-lg px-2.5 py-1 text-[11px] font-medium"
                style={
                  from === f
                    ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }
                    : { color: 'var(--text-faint)' }
                }
                lang={lang}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {available.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => go({ r: r.id })}
              lang={lang}
              className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
              style={
                r.id === reportId
                  ? { background: 'var(--color-accent)', color: 'white' }
                  : { border: '1px solid var(--hairline)', color: 'var(--text-muted)' }
              }
            >
              {lang === 'bn' ? r.bn : r.en}
            </button>
          ))}
        </div>

        {current ? (
          <Muted lang={lang}>{lang === 'bn' ? current.descriptionBn : current.descriptionEn}</Muted>
        ) : null}
      </div>

      {error ? (
        <GlassCard lift={false}>
          <p className="state-breach text-sm">{error}</p>
        </GlassCard>
      ) : null}

      <GlassCard lift={false}>
        {sheet ? (
          <DailySheet sheet={sheet as DailySheetData} />
        ) : statement ? (
          <ProfitStatement data={statement as ProfitStatementData} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('common.empty')}
            hint={
              lang === 'bn'
                ? 'এই সময়ের কোনো রেকর্ড নেই।'
                : 'Nothing was recorded in this period.'
            }
          />
        ) : (
          <div className="print-sheet">
            <header className="print-only mb-3 text-center">
              <h1 className="text-base font-bold">
                {lang === 'bn' ? 'জে.এইচ.এম. ফিলিং স্টেশন' : 'M/S. J.H.M. Filling Station'}
              </h1>
              <h2 className="text-sm font-semibold">
                {lang === 'bn' ? current?.bn : current?.en}
              </h2>
              <p className="tabular text-xs">
                {period === 'day'
                  ? formatDate(to, lang)
                  : `${formatDate(from, lang)} — ${formatDate(to, lang)}`}
              </p>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-faint)' }}>
                    {columns.map((c) => (
                      <th
                        key={c.key}
                        className={`border-b px-2 py-2 font-medium ${
                          isNumeric(c) ? 'text-right' : 'text-left'
                        }`}
                        style={{ borderColor: 'var(--hairline)' }}
                        lang={lang}
                      >
                        {lang === 'bn' ? c.bn : c.en}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-2 py-1.5 ${isNumeric(c) ? 'tabular text-right' : ''}`}
                        >
                          {render(row[c.key], c, lang)}
                        </td>
                      ))}
                    </tr>
                  ))}

                  {Object.keys(totals).length > 0 ? (
                    <tr className="border-t-2" style={{ borderColor: 'var(--text-muted)' }}>
                      {columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={`px-2 py-2 font-semibold ${isNumeric(c) ? 'tabular text-right' : ''}`}
                        >
                          {i === 0
                            ? lang === 'bn'
                              ? 'মোট'
                              : 'Total'
                            : totals[c.key] !== undefined
                              ? render(totals[c.key], c, lang)
                              : ''}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <Muted className="mt-2" lang={lang}>
              {formatNumber(rows.length, { lang })}{' '}
              {lang === 'bn' ? 'সারি' : rows.length === 1 ? 'row' : 'rows'}
            </Muted>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function isNumeric(c: ReportColumn) {
  return c.kind === 'money' || c.kind === 'litres' || c.kind === 'number' || c.kind === 'percent';
}

function render(value: string | number | null | undefined, c: ReportColumn, lang: 'bn' | 'en') {
  if (value === null || value === undefined || value === '') return '—';
  switch (c.kind) {
    case 'money':
      return formatBDT(value, lang);
    case 'litres':
      return formatLitres(value, lang);
    case 'percent':
      return formatPercent(String(value), lang);
    case 'number':
      return formatNumber(value, { lang });
    case 'date':
      return formatDate(String(value), lang);
    case 'datetime':
      return formatDateTime(String(value), lang);
    default:
      return String(value);
  }
}
