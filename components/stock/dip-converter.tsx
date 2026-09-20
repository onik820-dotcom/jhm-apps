'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Ruler } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatDip, formatLitres, formatNumber } from '@/lib/format';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import { convertDip, type DipConversion, type ErrorCode } from '@/app/stock/actions';

/**
 * Type a dip, see the certified litres. The conversion is done by the database
 * function, so what this shows is exactly what a shift close would record —
 * including the refusal when a dip is outside that tank's own range.
 */
export function DipConverter({
  tankId,
  tankCode,
  finalDipMm,
}: {
  tankId: string;
  tankCode: string;
  finalDipMm: number | null;
}) {
  const { t, lang } = useLang();
  const [value, setValue] = useState('');
  const [result, setResult] = useState<DipConversion | null>(null);
  const [error, setError] = useState<{ message: string; code?: ErrorCode } | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    const trimmed = value.trim();
    if (trimmed === '') {
      setResult(null);
      setError(null);
      return;
    }

    timer.current = setTimeout(() => {
      startTransition(async () => {
        const response = await convertDip(tankId, trimmed);
        if (response.ok && response.data) {
          setResult(response.data);
          setError(null);
        } else {
          setResult(null);
          setError({ message: response.error ?? 'That dip could not be converted', code: response.code });
        }
      });
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, tankId]);

  return (
    <GlassCard lift={false} className="space-y-3">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4" style={{ color: 'var(--color-accent)' }} aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight" lang={lang}>
          {t('stock.convert')} — {tankCode}
        </h3>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
          {t('stock.enterDip')}
          {finalDipMm ? ` (1 – ${formatNumber(finalDipMm, { lang })})` : ''}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={finalDipMm ? String(Math.floor(finalDipMm / 2)) : '1450'}
          className="tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2.5 text-lg outline-none"
          style={{ borderColor: 'var(--hairline)' }}
          aria-describedby={`dip-result-${tankId}`}
        />
      </label>

      <div id={`dip-result-${tankId}`} aria-live="polite" className="min-h-[3.5rem]">
        {error ? (
          <div role="alert">
            {/* Say it in the reader's language when we recognise the failure,
                and keep the database's own wording as the detail line. */}
            <p className="state-breach text-sm font-medium" lang={lang}>
              {error.code === 'DIP_OUT_OF_RANGE'
                ? t('stock.dipOutOfRange')
                : error.code === 'NO_CHART'
                  ? t('stock.noChart')
                  : t('common.error')}
            </p>
            {error.code === 'DIP_OUT_OF_RANGE' && finalDipMm ? (
              <Muted className="tabular">
                {tankCode}: 1 – {formatNumber(finalDipMm, { lang })} {lang === 'bn' ? 'মিমি' : 'mm'}
              </Muted>
            ) : (
              <Muted>{error.message}</Muted>
            )}
          </div>
        ) : result ? (
          <div>
            <p className="tabular text-2xl font-semibold tracking-tight">
              {formatLitres(result.litres, lang)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Muted className="tabular">{formatDip(result.dipMm, lang)}</Muted>
              <Chip tone={result.interpolated ? 'watch' : 'ok'} lang={lang}>
                {t(result.interpolated ? 'stock.interpolated' : 'stock.exact')}
              </Chip>
            </div>
          </div>
        ) : pending ? (
          <div className="skeleton h-8 w-40" />
        ) : null}
      </div>
    </GlassCard>
  );
}
