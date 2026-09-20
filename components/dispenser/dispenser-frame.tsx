'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, CloudOff, LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber } from '@/lib/format';
import { useSync } from '@/lib/offline/use-sync';
import { Chip, Muted } from '@/components/ui/glass';
import { LanguageToggle } from '@/components/language-toggle';

/**
 * The shell every dispenser sub-screen sits in: a way back, the language
 * toggle, and an honest statement of whether anything is still sitting on this
 * phone waiting for signal.
 */
export function DispenserFrame({
  title,
  userId,
  children,
  refreshKey,
}: {
  title: string;
  userId: string;
  children: React.ReactNode;
  refreshKey?: number;
}) {
  const { lang, t } = useLang();
  const sync = useSync(userId);

  // A save bumps refreshKey so the queued count updates immediately rather
  // than waiting for the next poll. It must not be used as a React key here —
  // that would remount the children and throw away the confirmation screen.
  const { refreshCounts } = sync;
  useEffect(() => {
    if (refreshKey !== undefined) void refreshCounts();
  }, [refreshKey, refreshCounts]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-4">
      <header className="mb-4 flex items-center gap-2">
        <Link
          href="/dispenser"
          className="tap-target -ml-2 flex items-center rounded-xl px-2 py-2"
          aria-label={lang === 'bn' ? 'পিছনে' : 'Back'}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: 'var(--text-muted)' }} aria-hidden />
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold tracking-tight" lang={lang}>
          {title}
        </h1>
        <LanguageToggle />
      </header>

      {!sync.online || sync.pending > 0 || sync.blocked > 0 ? (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: 'rgba(180, 83, 9, 0.12)' }}
          role="status"
        >
          {!sync.online ? (
            <>
              <CloudOff className="h-4 w-4 state-watch" aria-hidden />
              <span className="text-xs font-medium state-watch" lang={lang}>
                {t('common.offline')}
              </span>
            </>
          ) : sync.syncing ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin state-watch" aria-hidden />
              <span className="text-xs font-medium state-watch" lang={lang}>
                {lang === 'bn' ? 'পাঠানো হচ্ছে' : 'Sending'}
              </span>
            </>
          ) : (
            <RefreshCw className="h-4 w-4 state-watch" aria-hidden />
          )}

          {sync.pending > 0 ? (
            <span className="tabular text-xs state-watch" lang={lang}>
              {formatNumber(sync.pending, { lang })} {t('common.queued')}
            </span>
          ) : null}

          {sync.blocked > 0 ? (
            <Chip tone="breach" lang={lang}>
              <TriangleAlert className="h-3 w-3" aria-hidden />
              {formatNumber(sync.blocked, { lang })}{' '}
              {lang === 'bn' ? 'ম্যানেজারকে দেখান' : 'need the manager'}
            </Chip>
          ) : null}

          {sync.online && sync.pending > 0 && !sync.syncing ? (
            <button
              type="button"
              onClick={() => void sync.sync()}
              className="tap-target ml-auto rounded-lg px-2 py-1 text-xs font-medium state-watch"
              lang={lang}
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1">{children}</div>

      {sync.lastSyncAt ? (
        <Muted className="mt-3 text-center tabular" lang={lang}>
          {t('common.updated')} {sync.lastSyncAt.toLocaleTimeString()}
        </Muted>
      ) : null}
    </div>
  );
}
