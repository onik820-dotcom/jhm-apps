'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, ChevronRight, Plus, Search } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatNumber, formatPercent } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import type { AgeingTotals, CreditParty, PaymentRow } from '@/lib/data/money';
import { PartyPanel } from '@/components/dues/party-panel';
import { PartyForm } from '@/components/dues/party-form';

export function DuesScreen({
  parties,
  totals,
  payments,
  isAdmin,
}: {
  parties: CreditParty[];
  totals: AgeingTotals;
  payments: PaymentRow[];
  isAdmin: boolean;
}) {
  const { t, lang } = useLang();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CreditParty | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parties
      .filter((p) => (showInactive ? true : p.isActive || dec(p.balance).greaterThan(0)))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.nameBn ?? '').includes(query.trim()) ||
          p.vehicleNumbers.some((v) => v.toLowerCase().includes(q)),
      );
  }, [parties, query, showInactive]);

  const open = openId ? parties.find((p) => p.id === openId) ?? null : null;
  const inactiveHidden = parties.length - visible.length;

  return (
    <div className="space-y-6">
      {/* ---- what the parties owe, in total and by age ---- */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard lift={false}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('kpi.duesOutstanding')}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
            {formatBDT(totals.balance, lang)}
          </p>
          <Muted className="tabular mt-1" lang={lang}>
            {formatNumber(totals.partiesOwing, { lang })} {t('dues.partiesOwing')}
          </Muted>
        </GlassCard>

        {(
          [
            ['0-30', totals.bucket0to30, 'ok'],
            ['31-90', null, 'watch'],
            ['90+', totals.bucket90plus, 'breach'],
          ] as const
        ).map(([label, value, tone]) => {
          const amount =
            value ?? dec(totals.bucket31to60).plus(dec(totals.bucket61to90)).toFixed(2);
          return (
            <GlassCard key={label} lift={false}>
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                  {t('dues.ageing')}
                </p>
                <Chip tone={tone} className="tabular ml-auto">
                  {localiseRange(label, lang)} {t('dues.days')}
                </Chip>
              </div>
              <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
                {formatBDT(amount, lang)}
              </p>
            </GlassCard>
          );
        })}
      </section>

      {/* ---- things that want attention before they become a habit ---- */}
      {totals.overLimit > 0 || totals.undatedOpenings > 0 ? (
        <GlassCard lift={false} className="space-y-1.5">
          {totals.overLimit > 0 ? (
            <p className="state-breach flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span lang={lang}>
                {formatNumber(totals.overLimit, { lang })}{' '}
                {lang === 'bn' ? 'পার্টি ঋণসীমার বাইরে আছে' : 'parties are past their credit limit'}
              </span>
            </p>
          ) : null}
          {totals.undatedOpenings > 0 ? (
            <p className="state-watch flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span lang={lang}>
                {formatNumber(totals.undatedOpenings, { lang })}{' '}
                {lang === 'bn'
                  ? 'পার্টির প্রারম্ভিক বাকির তারিখ দেওয়া নেই, তাই বয়স অনুমান'
                  : 'opening balances have no date, so their ageing is a guess'}
              </span>
            </p>
          ) : null}
        </GlassCard>
      ) : null}

      {/* ---- the parties ---- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t('dues.title')}
          </h2>

          <label className="glass ml-auto flex items-center gap-2 px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={lang === 'bn' ? 'নাম বা গাড়ি' : 'Name or vehicle'}
              lang={lang}
              className="w-32 bg-transparent text-sm outline-none sm:w-44"
            />
          </label>

          <button
            type="button"
            onClick={() => setEditing('new')}
            className="tap-target flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            lang={lang}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('dues.newParty')}
          </button>
        </div>

        {visible.length === 0 ? (
          <GlassCard lift={false}>
            <EmptyState title={t('common.empty')} />
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {visible.map((p) => (
              <PartyRow key={p.id} party={p} onOpen={() => startTransition(() => setOpenId(p.id))} />
            ))}
          </div>
        )}

        {inactiveHidden > 0 ? (
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="tap-target mt-2 text-xs underline"
            style={{ color: 'var(--text-faint)' }}
            lang={lang}
          >
            {showInactive
              ? lang === 'bn'
                ? 'নিষ্ক্রিয় পার্টি লুকান'
                : 'Hide inactive parties'
              : `${formatNumber(inactiveHidden, { lang })} ${
                  lang === 'bn' ? 'নিষ্ক্রিয় পার্টি দেখান' : 'inactive parties — show'
                }`}
          </button>
        ) : null}
      </section>

      {/* ---- what has come in lately ---- */}
      <section>
        <h2
          className="mb-2 text-sm font-semibold tracking-tight"
          style={{ color: 'var(--text-muted)' }}
          lang={lang}
        >
          {t('dues.takePayment')}
        </h2>
        <GlassCard lift={false}>
          {payments.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                      <td className="px-2 py-2">{p.customerName}</td>
                      <td className="px-2 py-2">
                        <Chip tone={p.method === 'cash' ? 'ok' : 'neutral'}>{p.method}</Chip>
                      </td>
                      <td className="tabular px-2 py-2 text-right" style={{ color: 'var(--text-faint)' }}>
                        {formatDate(p.receivedAt, lang)}
                      </td>
                      <td className="tabular px-2 py-2 text-right font-medium">
                        {formatBDT(p.amount, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </section>

      {open ? (
        <PartyPanel
          party={open}
          isAdmin={isAdmin}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setEditing(open);
          }}
        />
      ) : null}

      {editing ? (
        <PartyForm
          party={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function localiseRange(label: string, lang: 'bn' | 'en') {
  return lang === 'bn' ? label.replace(/\d+/g, (d) => formatNumber(d, { lang })) : label;
}

function PartyRow({ party, onOpen }: { party: CreditParty; onOpen: () => void }) {
  const { t, lang } = useLang();

  const balance = dec(party.balance);
  const limit = dec(party.creditLimit);
  const hasLimit = limit.greaterThan(0);
  const exceeded = hasLimit && balance.greaterThan(limit);
  const utilisation = hasLimit ? balance.dividedBy(limit).times(100) : null;

  const tone = exceeded
    ? 'breach'
    : utilisation && utilisation.greaterThanOrEqualTo(80)
      ? 'watch'
      : balance.greaterThan(0)
        ? 'neutral'
        : 'ok';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass glass-lift tap-target flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight">
            {lang === 'bn' && party.nameBn ? party.nameBn : party.name}
          </span>
          {!party.isActive ? (
            <Chip lang={lang}>{t('dues.inactive')}</Chip>
          ) : null}
          {exceeded ? (
            <Chip tone="breach" lang={lang}>
              {t('dues.overLimit')}
            </Chip>
          ) : null}
        </span>
        {party.oldestItemDays && party.oldestItemDays > 30 ? (
          <Muted className="tabular mt-0.5" lang={lang}>
            {t('dues.oldest')} {formatNumber(party.oldestItemDays, { lang })} {t('dues.days')}
            {!party.openingDated ? ` · ${lang === 'bn' ? 'অনুমান' : 'estimated'}` : ''}
          </Muted>
        ) : null}
      </span>

      <span className="text-right">
        <span className={`tabular block text-sm font-semibold ${balance.lessThan(0) ? 'state-ok' : ''}`}>
          {formatBDT(balance.abs().toFixed(2), lang)}
        </span>
        <Muted className="tabular" lang={lang}>
          {balance.lessThan(0)
            ? t('dues.inAdvance')
            : hasLimit
              ? `${t('dues.limit')} ${formatBDT(limit, lang)}`
              : t('dues.noLimit')}
        </Muted>
      </span>

      {utilisation ? (
        <Chip tone={tone} className="tabular">
          {formatPercent(utilisation.toDecimalPlaces(0).toString(), lang, false)}
        </Chip>
      ) : null}

      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-faint)' }} aria-hidden />
    </button>
  );
}
