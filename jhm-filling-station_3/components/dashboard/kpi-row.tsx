'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatLitres, formatNumber } from '@/lib/format';
import { CardTitle, CardValue, GlassCard, Muted } from '@/components/ui/glass';
import type { DashboardKpis } from '@/lib/data/dashboard';

/**
 * The same figures on every dashboard that is allowed to see them.
 *
 * Profit appears only when the database sent it. A manager's response has no
 * profit key at all, so there is nothing for a browser to reveal.
 */
export function KpiRow({ kpis }: { kpis: DashboardKpis }) {
  const { t, lang } = useLang();

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          title={t('kpi.todaySales')}
          value={formatBDT(kpis.todaySales, lang)}
          hint={`${formatLitres(kpis.todayLitres, lang)} ${lang === 'bn' ? 'বিক্রি' : 'sold'}`}
        />
        <Kpi
          title={t('kpi.cashInHand')}
          value={kpis.cashInHand === null ? '—' : formatBDT(kpis.cashInHand, lang)}
          hint={
            kpis.cashInHand === null
              ? lang === 'bn'
                ? 'এখনো কোনো শিফট বন্ধ হয়নি'
                : 'no shift closed yet'
              : lang === 'bn'
                ? 'শেষ গণনা অনুযায়ী'
                : 'as last counted'
          }
        />
        <Kpi
          title={t('kpi.duesOutstanding')}
          value={formatBDT(kpis.duesOutstanding, lang)}
          hint={
            kpis.partiesOverLimit > 0
              ? `${formatNumber(kpis.partiesOverLimit, { lang })} ${
                  lang === 'bn' ? 'পার্টি সীমার বাইরে' : 'past their limit'
                }`
              : undefined
          }
          tone={kpis.partiesOverLimit > 0 ? 'breach' : undefined}
        />
        {kpis.seesProfit && kpis.monthProfit !== null ? (
          <Kpi
            title={`${t('kpi.netProfit')} · ${t('kpi.monthToDate')}`}
            value={formatBDT(kpis.monthProfit, lang)}
            hint={
              lang === 'bn'
                ? 'পাম্পের খরচ বাদে, চেয়ারম্যানের খাতা ছাড়া'
                : 'after pump expenses, before owner drawings'
            }
          />
        ) : (
          <Kpi
            title={t('kpi.daysCover')}
            value={
              kpis.daysCover === null
                ? '—'
                : `${formatNumber(kpis.daysCover, { lang, decimals: 1 })}`
            }
            hint={formatLitres(kpis.stockLitres, lang)}
          />
        )}
      </section>

      {/* The second row is the same for everybody who can see this page. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Small
          title={t('kpi.monthToDate')}
          value={formatBDT(kpis.monthSales, lang)}
          hint={formatLitres(kpis.monthLitres, lang)}
        />
        {kpis.seesProfit ? (
          <Small
            title={t('kpi.daysCover')}
            value={
              kpis.daysCover === null
                ? '—'
                : formatNumber(kpis.daysCover, { lang, decimals: 1 })
            }
            hint={formatLitres(kpis.stockLitres, lang)}
          />
        ) : null}
        <Small
          title={t('kpi.litresSold')}
          value={formatLitres(kpis.monthLitres, lang)}
          hint={t('kpi.monthToDate')}
        />
        {kpis.openVariances > 0 ? (
          <Link href="/reports?r=stock-variance" className="block">
            <GlassCard className="h-full">
              <CardTitle>{t('kpi.variance')}</CardTitle>
              <p className="state-breach tabular mt-1 flex items-center gap-1.5 text-xl font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {formatNumber(kpis.openVariances, { lang })}
              </p>
              <Muted lang={lang}>
                {lang === 'bn' ? 'অমীমাংসিত গরমিল' : 'unresolved, tap to see them'}
              </Muted>
            </GlassCard>
          </Link>
        ) : (
          <Small
            title={t('kpi.variance')}
            value={formatNumber(0, { lang })}
            hint={lang === 'bn' ? 'সব মিলেছে' : 'nothing outstanding'}
            tone="ok"
          />
        )}
      </section>
    </div>
  );
}

function Kpi({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'breach';
}) {
  const { lang } = useLang();
  return (
    <GlassCard>
      <CardTitle>{title}</CardTitle>
      <CardValue className={tone ? `state-${tone}` : undefined}>{value}</CardValue>
      {hint ? <Muted lang={lang}>{hint}</Muted> : null}
    </GlassCard>
  );
}

function Small({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'breach';
}) {
  const { lang } = useLang();
  return (
    <GlassCard lift={false}>
      <CardTitle className="text-xs">{title}</CardTitle>
      <p className={`tabular mt-1 text-xl font-semibold tracking-tight ${tone ? `state-${tone}` : ''}`}>
        {value}
      </p>
      {hint ? <Muted lang={lang}>{hint}</Muted> : null}
    </GlassCard>
  );
}
