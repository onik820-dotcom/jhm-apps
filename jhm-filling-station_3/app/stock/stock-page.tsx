'use client';

import { Gauge, Truck } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber } from '@/lib/format';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import { TankCard } from '@/components/stock/tank-card';
import { DipConverter } from '@/components/stock/dip-converter';
import { EquipmentControls } from '@/components/stock/equipment-controls';
import { AddDispenserForm, AddTankForm } from '@/components/stock/add-equipment';
import type { DispenserDetail, TankDetail } from '@/lib/data/stock';

export function StockPage({
  tanks,
  dispensers,
  isAdmin,
}: {
  tanks: TankDetail[];
  dispensers: DispenserDetail[];
  isAdmin: boolean;
}) {
  const { t, lang } = useLang();
  const calibrated = tanks.filter((tank) => tank.calibrationRows > 0 && tank.finalDipMm);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('stock.tankStock')}
          </h2>
          {isAdmin ? (
            <div className="ml-auto">
              <AddTankForm />
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {tanks.map((tank) => (
            <TankCard key={tank.id} tank={tank} isAdmin={isAdmin} />
          ))}
        </div>
      </section>

      {calibrated.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('stock.convert')}
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {calibrated.map((tank) => (
              <DipConverter
                key={tank.id}
                tankId={tank.id}
                tankCode={tank.code}
                finalDipMm={tank.finalDipMm}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('stock.dispensers')}
          </h2>
          {isAdmin ? (
            <div className="ml-auto">
              <AddDispenserForm tanks={tanks.filter((tk) => tk.status !== 'removed').map((tk) => ({ id: tk.id, code: tk.code }))} />
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dispensers.map((dispenser) => (
            <GlassCard key={dispenser.id} className="space-y-2" lift={false}>
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" style={{ color: 'var(--color-accent)' }} aria-hidden />
                <span className="text-sm font-semibold tracking-tight">{dispenser.code}</span>
                <Chip tone={dispenser.status === 'active' ? 'ok' : 'watch'} className="ml-auto">
                  {dispenser.status}
                </Chip>
              </div>

              <Muted className="tabular">
                {t('tank.tank')} {dispenser.tankCode} · {formatNumber(dispenser.nozzleCount, { lang })}{' '}
                {t('stock.nozzles')} · {formatNumber(dispenser.meterDigits, { lang })} {t('stock.digits')}
              </Muted>
              <Muted className="tabular">
                {t('stock.maxFlow')} {formatNumber(dispenser.maxFlowLpm, { lang, decimals: 0 })} L/min
              </Muted>

              {isAdmin ? (
                <EquipmentControls
                  kind="dispenser"
                  id={dispenser.id}
                  code={dispenser.code}
                  status={dispenser.status}
                />
              ) : null}
            </GlassCard>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-tight" style={{ color: 'var(--text-muted)' }} lang={lang}>
          {t('stock.tankerStock')}
        </h2>
        <GlassCard lift={false}>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4" style={{ color: 'var(--text-faint)' }} aria-hidden />
            <Muted lang={lang}>{t('stock.tankerStock')}</Muted>
          </div>
          <EmptyState title={t('common.empty')} hint={t('common.comingInPhase')} />
        </GlassCard>
      </section>
    </div>
  );
}
