'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDateTime, formatLitres, formatNumber, formatPercent } from '@/lib/format';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import { DeliveryForm } from '@/components/refill/delivery-form';
import type { DeliveryRow, PurchaseRegister, PurchaseTotals, RefillTank } from '@/lib/data/refill';

type Period = 'day' | 'month' | 'year';

export function RefillScreen({
  tanks,
  deliveries,
  register,
  canSeeCost,
}: {
  tanks: RefillTank[];
  deliveries: DeliveryRow[];
  register: PurchaseRegister;
  canSeeCost: boolean;
}) {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState<Period>('month');

  const periodLabels: Record<Period, string> = {
    day: lang === 'bn' ? 'আজ' : 'Day',
    month: lang === 'bn' ? 'এ মাস' : 'Month',
    year: lang === 'bn' ? 'এ বছর' : 'Year',
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
          {t('nav.refill')}
        </h2>

        {/* Headroom before anything is poured: a tank most of the way full
            cannot take another 4,500 L compartment. */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {tanks.map((tank) => (
            <GlassCard key={tank.id} lift={false} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="text-sm font-semibold tracking-tight">
                {t('tank.tank')} {tank.code}
              </span>
              <Muted className="tabular">
                {tank.currentLitres ? formatLitres(tank.currentLitres, lang) : t('common.empty')}
              </Muted>
              {tank.headroomLitres ? (
                <Chip
                  tone={Number(tank.headroomLitres) < 4500 ? 'watch' : 'ok'}
                  className="tabular ml-auto"
                  lang={lang}
                >
                  {lang === 'bn' ? 'জায়গা' : 'Headroom'} {formatLitres(tank.headroomLitres, lang)}
                </Chip>
              ) : null}
            </GlassCard>
          ))}
        </div>

        {tanks.length > 0 ? (
          <DeliveryForm tanks={tanks} canSeeCost={canSeeCost} />
        ) : (
          <GlassCard lift={false}>
            <EmptyState title={t('stock.notCalibrated')} />
          </GlassCard>
        )}
      </section>

      {/* ---- purchase register, tank by tank ---- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {lang === 'bn' ? 'ক্রয় রেজিস্টার' : 'Purchase register'}
          </h2>
          <div className="ml-auto flex gap-1">
            {(['day', 'month', 'year'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                lang={lang}
                className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
                style={
                  period === key
                    ? { background: 'var(--color-accent)', color: 'white' }
                    : { color: 'var(--text-muted)' }
                }
              >
                {periodLabels[key]}
              </button>
            ))}
          </div>
        </div>

        <GlassCard lift={false}>
          {register.byTank.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-faint)' }}>
                    <th className="px-2 py-2 text-left text-xs font-medium" lang={lang}>
                      {t('tank.tank')}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                      {lang === 'bn' ? 'ডেলিভারি' : 'Deliveries'}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                      {lang === 'bn' ? 'লিটার' : 'Litres'}
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                      {lang === 'bn' ? 'ঘাটতি' : 'Shortage'}
                    </th>
                    {canSeeCost ? (
                      <th className="px-2 py-2 text-right text-xs font-medium" lang={lang}>
                        {lang === 'bn' ? 'মূল্য' : 'Value'}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {register.byTank.map((row) => (
                    <RegisterRow
                      key={row.tankCode}
                      label={row.tankCode}
                      totals={row[period]}
                      canSeeCost={canSeeCost}
                    />
                  ))}
                  <RegisterRow
                    label={lang === 'bn' ? 'মোট' : 'Total'}
                    totals={register.overall[period]}
                    canSeeCost={canSeeCost}
                    strong
                  />
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </section>

      {/* ---- delivery history ---- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
          {lang === 'bn' ? 'ডেলিভারির ইতিহাস' : 'Delivery history'}
        </h2>

        {deliveries.length === 0 ? (
          <GlassCard lift={false}>
            <EmptyState title={t('common.empty')} />
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {deliveries.map((d) => (
              <GlassCard key={d.id} lift={false} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold tracking-tight">{d.challanNo ?? '—'}</span>
                  <Muted className="tabular">{formatDateTime(d.arrivedAt, lang)}</Muted>
                  {d.truckReg ? <Muted>{d.truckReg}</Muted> : null}
                  <Chip
                    tone={Number(d.shortagePct ?? 0) > 0.3 ? 'watch' : 'ok'}
                    className="tabular ml-auto"
                    lang={lang}
                  >
                    {formatLitres(d.totalReceived, lang)}
                    {' · '}
                    {lang === 'bn' ? 'ঘাটতি' : 'short'} {formatLitres(d.totalShortage, lang)}
                  </Chip>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {d.compartments.map((c) => (
                        <tr key={c.compartmentNo} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                          <td className="tabular px-2 py-1.5">#{formatNumber(c.compartmentNo, { lang })}</td>
                          <td className="px-2 py-1.5">{c.tankCode}</td>
                          <td className="tabular px-2 py-1.5 text-right" style={{ color: 'var(--text-faint)' }}>
                            {formatNumber(c.dipBeforeMm, { lang })} → {formatNumber(c.dipAfterMm, { lang })} mm
                          </td>
                          <td className="tabular px-2 py-1.5 text-right font-medium">
                            {formatLitres(c.receivedLitres, lang)}
                          </td>
                          <td
                            className={`tabular px-2 py-1.5 text-right ${c.shortageFlagged ? 'state-watch' : ''}`}
                          >
                            {formatLitres(c.shortageLitres, lang)} {formatPercent(c.shortagePct, lang)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canSeeCost ? (
                  <Muted className="tabular" lang={lang}>
                    {lang === 'bn' ? 'ডিপো দর' : 'Depot rate'} {formatBDT(d.depotRate, lang)} ·{' '}
                    {lang === 'bn' ? 'ক্রয়মূল্য' : 'purchase value'} {formatBDT(d.purchaseValue, lang)}
                  </Muted>
                ) : null}
              </GlassCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RegisterRow({
  label,
  totals,
  canSeeCost,
  strong = false,
}: {
  label: string;
  totals: PurchaseTotals;
  canSeeCost: boolean;
  strong?: boolean;
}) {
  const { lang } = useLang();
  return (
    <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
      <td className={`px-2 py-2 ${strong ? 'font-semibold' : ''}`}>{label}</td>
      <td className="tabular px-2 py-2 text-right">{formatNumber(totals.deliveries, { lang })}</td>
      <td className={`tabular px-2 py-2 text-right ${strong ? 'font-semibold' : ''}`}>
        {formatLitres(totals.litres, lang)}
      </td>
      <td className="tabular px-2 py-2 text-right">{formatLitres(totals.shortage, lang)}</td>
      {canSeeCost ? (
        <td className={`tabular px-2 py-2 text-right ${strong ? 'font-semibold' : ''}`}>
          {formatBDT(totals.value, lang)}
        </td>
      ) : null}
    </tr>
  );
}
