'use client';

import { useLang } from '@/lib/i18n/provider';
import { EmptyState, GlassCard } from '@/components/ui/glass';
import { CloseWizard } from '@/components/shift/close-wizard';
import type { CloseContext } from '@/lib/data/shift-close';

export function CloseScreen({ context }: { context: CloseContext }) {
  const { t, lang } = useLang();

  if (!context.shift) {
    return (
      <GlassCard lift={false}>
        <EmptyState
          title={t('shift.none')}
          hint={
            lang === 'bn'
              ? 'ড্যাশবোর্ড থেকে শিফট চালু করুন, তারপর এখানে বন্ধ করুন।'
              : 'Open a shift from the dashboard, then close it here.'
          }
        />
      </GlassCard>
    );
  }

  return <CloseWizard context={context} />;
}
