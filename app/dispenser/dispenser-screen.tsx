'use client';

import Link from 'next/link';
import { Camera, Fuel, LogOut, Ruler } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber, formatTime } from '@/lib/format';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import { LanguageToggle } from '@/components/language-toggle';
import type { CurrentShift } from '@/lib/data/overview';

export function DispenserScreen({
  fullName,
  shift,
  submitted,
}: {
  fullName: string;
  shift: CurrentShift | null;
  submitted: number;
}) {
  const { t, lang } = useLang();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-4">
      <header className="mb-5 flex items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
        >
          <Fuel className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight" lang={lang}>
            {fullName}
          </p>
          <Muted lang={lang}>
            {shift
              ? `${t(shift.shiftType === 'day' ? 'shift.day' : 'shift.night')} · ${formatTime(shift.startsAt, lang)}–${formatTime(shift.endsAt, lang)}`
              : t('shift.none')}
          </Muted>
        </div>
        <LanguageToggle />
        <form action="/auth/signout" method="post">
          <button type="submit" className="tap-target rounded-xl px-2 py-2" aria-label={t('auth.signOut')}>
            <LogOut className="h-4 w-4" style={{ color: 'var(--text-muted)' }} aria-hidden />
          </button>
        </form>
      </header>

      <div className="flex flex-1 flex-col gap-3">
        <ForecourtLink href="/dispenser/meter" disabled={!shift} icon={Camera} label={t('dispenser.takeReading')} />
        {/* A refill dip is not tied to a shift being open — fuel arrives when
            it arrives — so it stays available either way. */}
        <ForecourtLink href="/dispenser/dip" disabled={!shift} icon={Ruler} label={t('dispenser.enterDip')} />
        <ForecourtLink href="/dispenser/dip?type=pre_refill" icon={Fuel} label={t('dispenser.refillDip')} />
      </div>

      <GlassCard className="mt-4 flex items-center justify-between py-3" lift={false}>
        <span className="tabular text-sm font-medium" lang={lang}>
          {formatNumber(submitted, { lang })} {t('dispenser.submittedThisShift')}
        </span>
        {submitted > 0 ? <Chip tone="ok">✓</Chip> : null}
      </GlassCard>

      {!shift ? (
        <Muted className="mt-3 text-center" lang={lang}>
          {t('shift.none')}
        </Muted>
      ) : null}

    </div>
  );
}

/**
 * A forecourt target: big enough to hit one-handed in sunlight, and rendered
 * as a link so it works the moment the page paints rather than after hydration.
 */
function ForecourtLink({
  href,
  icon: Icon,
  label,
  disabled = false,
}: {
  href: string;
  icon: typeof Camera;
  label: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="glass forecourt-button flex w-full flex-col items-center justify-center rounded-xl px-6 py-6 opacity-40"
        aria-disabled="true"
      >
        <Icon className="mb-2 h-8 w-8" style={{ color: 'var(--color-accent)' }} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="glass glass-lift forecourt-button flex w-full flex-col items-center justify-center rounded-xl px-6 py-6"
    >
      <Icon className="mb-2 h-8 w-8" style={{ color: 'var(--color-accent)' }} aria-hidden />
      {label}
    </Link>
  );
}
