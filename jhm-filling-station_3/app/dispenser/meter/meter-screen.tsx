'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import { EmptyState, GlassCard } from '@/components/ui/glass';
import { DispenserFrame } from '@/components/dispenser/dispenser-frame';
import { MeterCapture, type NozzleOption } from '@/components/dispenser/meter-capture';

export function MeterScreen({
  shiftId,
  nozzles,
  userId,
}: {
  shiftId: string | null;
  nozzles: NozzleOption[];
  userId: string;
}) {
  const { t } = useLang();
  const [version, setVersion] = useState(0);

  return (
    <DispenserFrame title={t('dispenser.takeReading')} userId={userId} refreshKey={version}>
      {!shiftId ? (
        <GlassCard lift={false}>
          <EmptyState title={t('shift.none')} />
        </GlassCard>
      ) : nozzles.length === 0 ? (
        <GlassCard lift={false}>
          <EmptyState title={t('common.empty')} />
        </GlassCard>
      ) : (
        <MeterCapture
          shiftId={shiftId}
          nozzles={nozzles}
          userId={userId}
          onQueued={() => setVersion((v) => v + 1)}
        />
      )}
    </DispenserFrame>
  );
}
