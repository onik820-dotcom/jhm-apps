'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLang } from '@/lib/i18n/provider';
import { formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { Chip, Muted } from '@/components/ui/glass';
import { TankGauge } from '@/components/tank-gauge';
import type { TankOverview } from '@/lib/data/overview';
import type { DashboardKpis } from '@/lib/data/dashboard';
import { KpiRow } from '@/components/dashboard/kpi-row';

export function MdDashboard({
  tanks,
  kpis,
}: {
  tanks: TankOverview[];
  kpis: DashboardKpis | null;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date());

  // Live, without a poll: Postgres tells us when the numbers behind this page
  // move, and the server component re-renders with fresh figures.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('md-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tank_dips' }, () => {
        setUpdatedAt(new Date());
        router.refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_sales' }, () => {
        setUpdatedAt(new Date());
        router.refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_stock' }, () => {
        setUpdatedAt(new Date());
        router.refresh();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Chip tone="ok">🟢 {t('common.live')}</Chip>
        <Muted className="tabular">
          {t('common.updated')} {formatDateTime(updatedAt, lang, 'HH:mm:ss')}
        </Muted>
      </div>

      {kpis ? <KpiRow kpis={kpis} /> : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {tanks.map((tank) => (
          <TankGauge key={tank.id} tank={tank} />
        ))}
      </section>

      {/* Realtime: Postgres tells the page when the numbers behind it move,
          and the whole server component re-renders with fresh figures. There
          is no polling and no mutating control anywhere on this page. */}
    </div>
  );
}


