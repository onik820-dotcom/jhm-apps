'use client';

import { useState } from 'react';
import { useLang } from '@/lib/i18n/provider';
import { EmptyState, GlassCard } from '@/components/ui/glass';
import { DispenserFrame } from '@/components/dispenser/dispenser-frame';
import { DipEntry, type TankOption } from '@/components/dispenser/dip-entry';

export function DipScreen({
  shiftId,
  tanks,
  userId,
  dipType,
}: {
  shiftId: string | null;
  tanks: TankOption[];
  userId: string;
  dipType: 'close' | 'pre_refill' | 'post_refill';
}) {
  const { t, lang } = useLang();
  const [version, setVersion] = useState(0);

  const title =
    dipType === 'close'
      ? t('dispenser.enterDip')
      : dipType === 'pre_refill'
        ? lang === 'bn'
          ? 'রিফিলের আগের ডিপ'
          : 'Dip before refill'
        : lang === 'bn'
          ? 'রিফিলের পরের ডিপ'
          : 'Dip after refill';

  return (
    <DispenserFrame title={title} userId={userId} refreshKey={version}>
      {tanks.length === 0 ? (
        <GlassCard lift={false}>
          <EmptyState title={t('stock.notCalibrated')} />
        </GlassCard>
      ) : (
        <DipEntry
          shiftId={shiftId}
          tanks={tanks}
          userId={userId}
          dipType={dipType}
          onQueued={() => setVersion((v) => v + 1)}
        />
      )}
    </DispenserFrame>
  );
}
