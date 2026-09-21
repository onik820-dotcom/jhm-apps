'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Trash2 } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Muted } from '@/components/ui/glass';
import { setEquipmentStatus } from '@/app/stock/actions';

/**
 * Pause, resume and remove, admin only.
 *
 * Removal is a soft delete and always asks for a reason before the button does
 * anything — the reason is what the audit log will carry, and it is the only
 * record of why a tank left service.
 */
export function EquipmentControls({
  kind,
  id,
  code,
  status,
}: {
  kind: 'tank' | 'dispenser';
  id: string;
  code: string;
  status: 'active' | 'paused' | 'removed';
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [askingRemoval, setAskingRemoval] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function apply(next: 'active' | 'paused' | 'removed', why?: string) {
    setError(null);
    startTransition(async () => {
      const result = await setEquipmentStatus({ kind, id, status: next, reason: why });
      if (result.ok) {
        setAskingRemoval(false);
        setReason('');
        router.refresh();
      } else {
        setError(result.error ?? 'That change could not be saved');
      }
    });
  }

  if (status === 'removed') {
    return <Muted lang={lang}>{t('stock.remove')}</Muted>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {status === 'active' ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => apply('paused')} lang={lang}>
            <Pause className="h-3.5 w-3.5" aria-hidden />
            {t('stock.pause')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => apply('active')} lang={lang}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t('stock.resume')}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setAskingRemoval((open) => !open)}
          lang={lang}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t('stock.remove')}
        </Button>
      </div>

      {askingRemoval ? (
        <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('stock.reasonForRemoval')} — {code}
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="tap-target w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--hairline)' }}
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={pending || reason.trim().length < 3}
              onClick={() => apply('removed', reason.trim())}
              lang={lang}
            >
              {t('common.confirm')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAskingRemoval(false)} lang={lang}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="state-breach text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
