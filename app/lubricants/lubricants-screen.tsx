'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatLitres } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
// Types only. Importing a *value* from lib/data pulls lib/supabase/server in
// with it, and that imports next/headers, which cannot exist in a client
// bundle — the page 500s with an import-trace error rather than a type error,
// so the compiler will not catch this one for you.
import type { LubMovement, LubSku, LubSummary } from '@/lib/data/lubricants';
import { recordLubMovement } from './actions';

type TxnType = 'purchase' | 'sale' | 'own_use' | 'adjustment';

const INPUT = 'tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none';
const BORDER = { borderColor: 'var(--hairline)' } as const;

export function LubricantsScreen({
  skus,
  movements,
  summary,
  parties,
  canSeeCost,
}: {
  skus: LubSku[];
  movements: LubMovement[];
  summary: LubSummary;
  parties: Array<{ id: string; name: string }>;
  canSeeCost: boolean;
}) {
  const { t, lang } = useLang();
  const [form, setForm] = useState<TxnType | null>(null);

  const actions: Array<[TxnType, string]> = [
    ['purchase', t('lub.buy')],
    ['sale', t('lub.sell')],
    ['own_use', t('lub.ownUse')],
    ['adjustment', t('lub.adjust')],
  ];

  return (
    <div className="space-y-6">
      {/* ---- the month, with own use kept out of sales ---- */}
      <section className="grid gap-3 sm:grid-cols-3">
        <GlassCard lift={false}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('lub.sell')} · {t('kpi.monthToDate')}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
            {formatBDT(summary.soldValue, lang)}
          </p>
          <Muted className="tabular mt-1">{formatLitres(summary.soldQty, lang)}</Muted>
        </GlassCard>

        <GlassCard lift={false}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('lub.ownUse')} · {t('kpi.monthToDate')}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
            {formatBDT(summary.ownUseValue, lang)}
          </p>
          <Muted className="tabular mt-1" lang={lang}>
            {formatLitres(summary.ownUseQty, lang)} ·{' '}
            {lang === 'bn' ? 'খরচ, বিক্রি নয়' : 'an expense, not a sale'}
          </Muted>
        </GlassCard>

        <GlassCard lift={false}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('lub.buy')} · {t('kpi.monthToDate')}
          </p>
          <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
            {formatBDT(summary.purchasedValue, lang)}
          </p>
          <Muted className="tabular mt-1">{formatLitres(summary.purchasedQty, lang)}</Muted>
        </GlassCard>
      </section>

      {/* ---- the shelf ---- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t('lub.onShelf')}
          </h2>
          <div className="ml-auto flex flex-wrap gap-1">
            {actions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm(key)}
                lang={lang}
                className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
                style={
                  key === 'purchase' || key === 'sale'
                    ? { background: 'var(--color-accent)', color: 'white' }
                    : { border: '1px solid var(--hairline)', color: 'var(--text-muted)' }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <GlassCard lift={false}>
          {skus.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-faint)' }}>
                    <th className="px-2 py-2 text-left text-xs font-medium" lang={lang}>
                      {lang === 'bn' ? 'পণ্য' : 'Product'}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                      {t('lub.onShelf')}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                      {t('lub.saleRate')}
                    </th>
                    {canSeeCost ? (
                      <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                        {t('stock.avgCost')}
                      </th>
                    ) : null}
                    {canSeeCost ? (
                      <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                        {t('lub.value')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s) => (
                    <tr key={s.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                      <td className="px-2 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">
                            {lang === 'bn' && s.nameBn ? s.nameBn : s.name}
                          </span>
                          {s.belowReorder ? (
                            <Chip tone="watch" lang={lang}>
                              {t('lub.belowReorder')}
                            </Chip>
                          ) : null}
                          {!s.isActive ? <Chip lang={lang}>{t('dues.inactive')}</Chip> : null}
                        </span>
                      </td>
                      <td className="tabular px-2 py-2 text-right font-medium">
                        {formatLitres(s.qtyOnHand, lang)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">
                        {dec(s.saleRate).isZero() ? '—' : formatBDT(s.saleRate, lang)}
                      </td>
                      {canSeeCost ? (
                        <td className="tabular px-2 py-2 text-right">
                          {formatBDT(s.avgCost ?? '0', lang)}
                        </td>
                      ) : null}
                      {canSeeCost ? (
                        <td className="tabular px-2 py-2 text-right">
                          {formatBDT(s.stockValue ?? '0', lang)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </section>

      {/* ---- movements ---- */}
      <section>
        <h2
          className="mb-2 text-sm font-semibold tracking-tight"
          style={{ color: 'var(--text-muted)' }}
          lang={lang}
        >
          {t('lub.movements')}
        </h2>
        <GlassCard lift={false}>
          {movements.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                      <td className="px-2 py-2">
                        <Chip
                          tone={
                            m.txnType === 'sale'
                              ? 'ok'
                              : m.txnType === 'own_use'
                                ? 'watch'
                                : 'neutral'
                          }
                          lang={lang}
                        >
                          {t(
                            m.txnType === 'sale'
                              ? 'lub.sell'
                              : m.txnType === 'purchase'
                                ? 'lub.buy'
                                : m.txnType === 'own_use'
                                  ? 'lub.ownUse'
                                  : 'lub.adjust',
                          )}
                        </Chip>
                      </td>
                      <td className="px-2 py-2">{m.skuName}</td>
                      <td className="px-2 py-2" style={{ color: 'var(--text-faint)' }}>
                        {m.customerName ?? m.vehicleRef ?? ''}
                      </td>
                      <td
                        className="tabular whitespace-nowrap px-2 py-2 text-right"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        {formatDate(m.txnAt, lang)}
                      </td>
                      <td className="tabular px-2 py-2 text-right">{formatLitres(m.qty, lang)}</td>
                      <td className="tabular px-2 py-2 text-right font-medium">
                        {formatBDT(m.amount, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </section>

      {form ? (
        <MovementForm
          type={form}
          skus={skus.filter((s) => s.isActive)}
          parties={parties}
          onClose={() => setForm(null)}
        />
      ) : null}
    </div>
  );
}

function MovementForm({
  type,
  skus,
  parties,
  onClose,
}: {
  type: TxnType;
  skus: LubSku[];
  parties: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [skuId, setSkuId] = useState(skus[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sku = skus.find((s) => s.id === skuId);
  const title = t(
    type === 'sale'
      ? 'lub.sell'
      : type === 'purchase'
        ? 'lub.buy'
        : type === 'own_use'
          ? 'lub.ownUse'
          : 'lub.adjust',
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await recordLubMovement({
      sku_id: skuId,
      txn_type: type,
      qty,
      rate,
      customer_id: customerId,
      vehicle_ref: vehicle,
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('common.error'));
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass w-full max-w-lg space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold tracking-tight" lang={lang}>
          {title}
        </h2>

        {type === 'own_use' ? <Muted lang={lang}>{t('lub.ownUseHint')}</Muted> : null}
        {type === 'adjustment' ? <Muted lang={lang}>{t('lub.adjustHint')}</Muted> : null}

        <label className="block space-y-1">
          <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {lang === 'bn' ? 'পণ্য' : 'Product'}
          </span>
          <select value={skuId} onChange={(e) => setSkuId(e.target.value)} className={INPUT} style={BORDER}>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {lang === 'bn' && s.nameBn ? s.nameBn : s.name}
              </option>
            ))}
          </select>
          {sku ? (
            <Muted className="tabular" lang={lang}>
              {t('lub.onShelf')} {formatLitres(sku.qtyOnHand, lang)}
            </Muted>
          ) : null}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('lub.qty')}
            </span>
            <input
              value={qty}
              inputMode="decimal"
              onChange={(e) => setQty(e.target.value)}
              className={INPUT}
              style={BORDER}
              placeholder={type === 'adjustment' ? '-0.000' : '0.000'}
            />
          </label>

          {type === 'own_use' ? (
            <label className="block space-y-1">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                {t('lub.rate')}
              </span>
              <input
                value=""
                readOnly
                disabled
                className={`${INPUT} opacity-50`}
                style={BORDER}
                placeholder={lang === 'bn' ? 'ক্রয়মূল্যে' : 'At cost'}
              />
              <Muted lang={lang}>
                {lang === 'bn'
                  ? 'শেলফের গড় ক্রয়মূল্যে হিসাব হবে'
                  : 'Priced at the shelf’s average cost'}
              </Muted>
            </label>
          ) : type !== 'adjustment' ? (
            <label className="block space-y-1">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                {t('lub.rate')}
              </span>
              <input
                value={rate}
                inputMode="decimal"
                onChange={(e) => setRate(e.target.value)}
                className={INPUT}
                style={BORDER}
                placeholder={
                  type === 'sale' ? (sku?.saleRate ?? '0.00') : (sku?.purchaseRate ?? '0.00')
                }
              />
            </label>
          ) : null}
        </div>

        {type === 'sale' ? (
          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('dues.party')}
            </span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={INPUT}
              style={BORDER}
            >
              <option value="">{lang === 'bn' ? 'নগদ বিক্রি' : 'Cash sale'}</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {type === 'own_use' ? (
          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('dues.vehicle')}
            </span>
            <input
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              className={INPUT}
              style={BORDER}
            />
          </label>
        ) : null}

        {type === 'adjustment' ? (
          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('common.reason')}
            </span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={BORDER} />
          </label>
        ) : null}

        {error ? <p className="state-breach text-sm">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-target flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={BORDER}
            lang={lang}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={
              busy || !qty.trim() || !skuId || (type === 'adjustment' && !note.trim())
            }
            className="tap-target flex-1 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            lang={lang}
          >
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
