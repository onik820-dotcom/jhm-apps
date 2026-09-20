'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fuel, LoaderCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLang } from '@/lib/i18n/provider';
import { GlassCard, Chip, Muted } from '@/components/ui/glass';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/language-toggle';
import type { Role } from '@/lib/roles';

const ROLE_KEY = {
  dispenser: 'role.dispenser',
  manager: 'role.manager',
  admin: 'role.admin',
  md: 'role.md',
} as const;

const FIELD = 'tap-target w-full rounded-xl border bg-transparent px-3 py-2.5 text-sm outline-none';

export function JoinForm({
  token,
  email,
  role,
  fullName,
}: {
  token: string;
  email: string;
  role: Role;
  fullName: string;
}) {
  const { t, lang } = useLang();
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [phone, setPhone] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Checked here so the person sees it immediately, and again in the
    // database, which is the check that actually decides.
    if (password.length < 10) {
      setError(t('join.tooShort'));
      return;
    }
    if (password !== repeat) {
      setError(t('join.mismatch'));
      return;
    }

    setPending(true);
    const supabase = createClient();

    const { error: rpcError } = await supabase.rpc('accept_invitation', {
      p_token: token,
      p_password: password,
      p_phone: phone || null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setPending(false);
      return;
    }

    setDone(true);

    // The account exists now, so this is an ordinary sign-in. The middleware
    // reads the role off the profile and sends them to their own dashboard.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      // The account was made; only the sign-in failed. Sending them to the
      // login page is a working outcome, not an error worth alarming them with.
      router.replace('/login');
      return;
    }

    router.replace('/');
    router.refresh();
  }

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
      <Muted className="mt-1" lang={lang}>
        {t('app.name')}
      </Muted>

      <div className="mt-4 rounded-xl p-3" style={{ background: 'var(--color-accent-soft)' }}>
        <p className="text-sm font-medium">{fullName}</p>
        <Muted className="truncate">{email}</Muted>
        <Chip className="mt-2" lang={lang}>
          {t(ROLE_KEY[role])}
        </Chip>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="join-password"
            className="text-xs font-medium"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t('join.choosePassword')}
          </label>
          <input
            id="join-password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD}
            style={{ borderColor: 'var(--hairline)' }}
          />
          <Muted lang={lang}>{t('join.rules')}</Muted>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="join-repeat"
            className="text-xs font-medium"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t('join.repeatPassword')}
          </label>
          <input
            id="join-repeat"
            type="password"
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className={FIELD}
            style={{ borderColor: 'var(--hairline)' }}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="join-phone"
            className="text-xs font-medium"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t('join.phone')}
          </label>
          <input
            id="join-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={FIELD}
            style={{ borderColor: 'var(--hairline)' }}
          />
        </div>

        {error ? (
          <p className="state-breach text-xs" role="alert">
            {error}
          </p>
        ) : null}

        {done ? (
          <p className="state-ok text-xs" role="status" lang={lang}>
            {t('join.welcome')}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={pending} lang={lang}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {pending ? t('join.working') : t('join.submit')}
        </Button>
      </form>
    </GlassCard>
  );
}
