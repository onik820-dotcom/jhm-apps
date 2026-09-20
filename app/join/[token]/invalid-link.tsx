'use client';

import Link from 'next/link';
import { Fuel } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { GlassCard, Muted } from '@/components/ui/glass';
import { LanguageToggle } from '@/components/language-toggle';

export function InvalidLink() {
  const { t, lang } = useLang();

  return (
    <GlassCard className="w-full max-w-sm p-6 sm:p-8" lift={false}>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
        >
          <Fuel className="h-5 w-5" aria-hidden />
        </div>
        <LanguageToggle />
      </div>

      <h1 className="text-lg font-semibold tracking-tight" lang={lang}>
        {t('join.title')}
      </h1>
      <p className="state-breach mt-3 text-sm" role="alert" lang={lang}>
        {t('join.invalid')}
      </p>
      <Muted className="mt-2" lang={lang}>
        {t('join.invalidHint')}
      </Muted>

      <Link
        href="/login"
        className="tap-target mt-5 inline-flex items-center text-xs font-medium"
        style={{ color: 'var(--color-accent)' }}
        lang={lang}
      >
        {t('auth.signIn')}
      </Link>
    </GlassCard>
  );
}
