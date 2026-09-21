'use client';

import Link from 'next/link';
import { AlertTriangle, Gauge } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber } from '@/lib/format';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import { TankGauge } from '@/components/tank-gauge';
import { EquipmentControls } from '@/components/stock/equipment-controls';
import type { DispenserOverview, TankOverview } from '@/lib/data/overview';
import type { DashboardKpis } from '@/lib/data/dashboard';
import { KpiRow } from '@/components/dashboard/kpi-row';

export function AdminDashboard({
  tanks,
  dispensers,
  kpis,
}: {
  tanks: TankOverview[];
  dispensers: DispenserOverview[];
  kpis: DashboardKpis | null;
}) {
  const { t, lang } = useLang();
  const expiringCharts = tanks.filter((tank) => tank.chartExpiringSoon || tank.chartExpired);

  return (
    <div className="space-y-5">
      {expiringCharts.length > 0 ? (
        <GlassCard className="flex items-start gap-3" lift={false}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 state-watch" aria-hidden />
          <div>
            <p className="text-sm font-semibold tracking-tight" lang={lang}>
              {lang === 'bn' ? 'ক্যালিব্রেশন চার্টের মেয়াদ' : 'Calibration charts approaching expiry'}
            </p>
            <Muted lang={lang}>
              {expiringCharts
                .map((tank) =>
                  `${tank.code}: ${tank.chartValidTo}` +
                  (tank.chartDaysRemaining !== null
                    ? ` (${formatNumber(tank.chartDaysRemaining, { lang })} ${lang === 'bn' ? 'দিন' : 'days'})`
                    : ''),
                )
                .join(' · ')}
            </Muted>
          </div>
        </GlassCard>
      ) : null}

      {kpis ? <KpiRow kpis={kpis} /> : null}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {lang === 'bn' ? 'ট্যাংক' : 'Tanks'}
          </h2>
          {/* The forms live on the stock page, next to the charts they depend on. */}
          <Link href="/stock" className="text-xs font-medium" style={{ color: 'var(--color-accent)' }} lang={lang}>
            {t('stock.addTank')} →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {tanks.map((tank) => (
            <div key={tank.id} className="space-y-2">
              <TankGauge tank={tank} />
              <div className="flex flex-wrap items-center gap-2 px-1">
                <Muted className="tabular">
                  {t('tank.calibration')}: {formatNumber(tank.calibrationRows, { lang })}{' '}
                  {lang === 'bn' ? 'সারি' : 'rows'}
                  {tank.finalDipMm ? ` · ${lang === 'bn' ? 'পূর্ণ ডিপ' : 'final dip'} ${formatNumber(tank.finalDipMm, { lang })} mm` : ''}
                </Muted>
                <div className="ml-auto">
                  <EquipmentControls kind="tank" id={tank.id} code={tank.code} status={tank.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {lang === 'bn' ? 'ডিসপেনসার' : 'Dispensers'}
          </h2>
          <Link href="/stock" className="text-xs font-medium" style={{ color: 'var(--color-accent)' }} lang={lang}>
            {t('stock.addDispenser')} →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dispensers.map((dispenser) => (
            <GlassCard key={dispenser.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" style={{ color: 'var(--color-accent)' }} aria-hidden />
                <span className="text-sm font-semibold tracking-tight">{dispenser.code}</span>
                <Chip tone={dispenser.status === 'active' ? 'ok' : 'watch'} className="ml-auto">
                  {dispenser.status}
                </Chip>
              </div>
              <Muted className="tabular">
                {lang === 'bn' ? 'ট্যাংক' : 'Tank'} {dispenser.tankCode} ·{' '}
                {formatNumber(dispenser.nozzleCount, { lang })} {lang === 'bn' ? 'নজল' : 'nozzle'} ·{' '}
                {formatNumber(dispenser.meterDigits, { lang })} {lang === 'bn' ? 'ডিজিট' : 'digit'}
              </Muted>
              <Muted className="tabular">
                {lang === 'bn' ? 'সর্বোচ্চ প্রবাহ' : 'Max flow'} {formatNumber(dispenser.maxFlowLpm, { lang, decimals: 0 })} L/min
              </Muted>
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <GlassCard lift={false}>
          <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'গরমিল প্যানেল' : 'Variance panel'}
          </h2>
          <EmptyState title={t('common.empty')} hint={t('common.comingInPhase')} />
        </GlassCard>
        <GlassCard lift={false}>
          <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
            {t('nav.audit')}
          </h2>
          <EmptyState title={t('common.empty')} hint={t('common.comingInPhase')} />
        </GlassCard>
      </section>
    </div>
  );
}
