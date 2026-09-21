'use client';

import { AlertTriangle, Link2, Link2Off } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import type { CashPosition, CashShift } from '@/lib/data/money';

/**
 * The drawer, shift by shift.
 *
 * Nothing on this page is entered here: the count happens in the shift close
 * wizard, and this is where it is read back. What it adds is the chain — every
 * shift's opening set against the previous shift's count, so a figure that was
 * quietly adjusted to make a night balance has nowhere to hide.
 */
export function CashScreen({ position }: { position: CashPosition }) {
  const { t, lang } = useLang();

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <GlassCard lift={false}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('cash.inHand')}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {position.inHand === null ? '—' : formatBDT(position.inHand, lang)}
          </p>
          <Muted className="mt-1" lang={lang}>
            {position.shifts[0]
              ? `${formatDate(position.shifts[0].shiftDate, lang)} · ${t(
                  position.shifts[0].shiftType === 'night' ? 'shift.night' : 'shift.day',
                )}`
              : t('common.empty')}
          </Muted>
        </GlassCard>

        <GlassCard lift={false} className="sm:col-span-2">
          <div className="flex items-start gap-2">
            {position.chainUnbroken ? (
              <Link2 className="state-ok mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <Link2Off className="state-breach mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <div>
              <p
                className={`text-sm font-medium ${position.chainUnbroken ? 'state-ok' : 'state-breach'}`}
                lang={lang}
              >
                {position.chainUnbroken ? t('cash.chainUnbroken') : t('cash.chainBroken')}
              </p>
              <Muted className="mt-0.5" lang={lang}>
                {position.chainUnbroken
                  ? lang === 'bn'
                    ? 'প্রারম্ভিক নগদ টাইপ করা হয় না — আগের শিফটের গোনা টাকাই পরেরটির শুরু।'
                    : 'Opening cash is never typed. Each shift starts at whatever the last one counted.'
                  : lang === 'bn'
                    ? `${formatDate(position.brokenAt ?? '', lang)} তারিখে প্রারম্ভিক নগদ আগের শিফটের গোনা টাকার সঙ্গে মেলেনি।`
                    : `On ${formatDate(position.brokenAt ?? '', lang)} a shift opened at a figure the previous one did not count.`}
              </Muted>
            </div>
          </div>
        </GlassCard>
      </section>

      <section>
        <h2
          className="mb-2 text-sm font-semibold tracking-tight"
          style={{ color: 'var(--text-muted)' }}
          lang={lang}
        >
          {t('cash.title')}
        </h2>

        {position.shifts.length === 0 ? (
          <GlassCard lift={false}>
            <EmptyState
              title={t('common.empty')}
              hint={
                lang === 'bn'
                  ? 'প্রথম শিফট বন্ধ হলে এখানে হিসাব আসবে।'
                  : 'The drawer appears here once the first shift is closed.'
              }
            />
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {position.shifts.map((s, i) => (
              <ShiftCard
                key={s.shiftId}
                shift={s}
                previousCount={position.shifts[i + 1]?.countedCash ?? null}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ShiftCard({ shift, previousCount }: { shift: CashShift; previousCount: string | null }) {
  const { t, lang } = useLang();

  const variance = dec(shift.cashVariance);
  const balanced = variance.isZero();
  const chained = previousCount === null || dec(shift.openingCash).equals(dec(previousCount));

  return (
    <GlassCard lift={false} className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">
          {formatDate(shift.shiftDate, lang)}
        </span>
        <Chip lang={lang}>{t(shift.shiftType === 'night' ? 'shift.night' : 'shift.day')}</Chip>
        <Chip tone={balanced ? 'ok' : 'breach'} className="tabular ml-auto" lang={lang}>
          {balanced
            ? lang === 'bn'
              ? 'মিলেছে'
              : 'Balanced'
            : `${t('cash.variance')} ${formatBDT(variance, lang, true)}`}
        </Chip>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
        <Line
          label={t('cash.opening')}
          value={shift.openingCash}
          hint={previousCount === null ? t('cash.firstShift') : t('cash.fromPreviousShift')}
          tone={chained ? undefined : 'breach'}
        />
        <Line label={t('cash.sales')} value={shift.cashSales} />
        <Line label={t('cash.dues')} value={shift.duesCollected} sign="+" />
        <Line label={t('cash.expenses')} value={shift.expensesCash} sign="−" />
        <Line label={t('cash.deposits')} value={shift.bankDeposits} sign="−" />
        <Line label={t('cash.expected')} value={shift.expectedCash} strong />
        <Line label={t('cash.counted')} value={shift.countedCash} strong />
      </div>

      {!chained ? (
        <p className="state-breach flex items-start gap-2 text-xs" lang={lang}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {lang === 'bn'
              ? `আগের শিফটে গোনা হয়েছিল ${formatBDT(previousCount ?? '0', lang)}, কিন্তু এই শিফট শুরু হয়েছে ${formatBDT(shift.openingCash, lang)} দিয়ে।`
              : `The previous shift counted ${formatBDT(previousCount ?? '0', lang)} but this one opened at ${formatBDT(shift.openingCash, lang)}.`}
          </span>
        </p>
      ) : null}

      {shift.varianceReason ? (
        <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--hairline)' }}>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }} lang={lang}>
            {t('common.reason')}
          </p>
          <p className="text-xs">{shift.varianceReason}</p>
        </div>
      ) : null}
    </GlassCard>
  );
}

function Line({
  label,
  value,
  hint,
  sign,
  strong,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  sign?: '+' | '−';
  strong?: boolean;
  tone?: 'breach';
}) {
  const { lang } = useLang();
  return (
    <div>
      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }} lang={lang}>
        {sign ? `${sign} ` : ''}
        {label}
      </p>
      <p className={`tabular text-sm ${strong ? 'font-semibold' : ''} ${tone ? `state-${tone}` : ''}`}>
        {formatBDT(value, lang)}
      </p>
      {hint ? (
        <p className="text-[10px]" style={{ color: 'var(--text-faint)' }} lang={lang}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
