'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { AlertTriangle, Pencil, Search } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber, localiseDigits } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import { upsertCalibrationRow } from '@/app/stock/actions';
import type { CalibrationRow, CurvePoint } from '@/lib/data/stock';

/**
 * Recharts is about 100 kB and the curve sits behind a tab. The table is the
 * default view and the one people actually read a dip from, so the charting
 * library is fetched only if somebody asks for the curve.
 *
 * ssr: false because it measures its container to size itself, and there is no
 * container on the server.
 */
const CalibrationCurve = dynamic(
  () => import('./calibration-curve').then((m) => m.CalibrationCurve),
  {
    ssr: false,
    loading: () => <div className="skeleton h-72 w-full" />,
  },
);

const WINDOW = 40;

export function CalibrationViewer({
  tankId,
  tankCode,
  version,
  finalDipMm,
  totalRows,
  initialRows,
  initialFrom,
  curve,
  isAdmin,
}: {
  tankId: string;
  tankCode: string;
  version: number;
  finalDipMm: number;
  totalRows: number;
  initialRows: CalibrationRow[];
  initialFrom: number;
  curve: CurvePoint[];
  isAdmin: boolean;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<'table' | 'curve'>('table');
  const [jump, setJump] = useState(String(initialFrom));

  const visible = useMemo(() => initialRows, [initialRows]);

  function goTo(dip: number) {
    const clamped = Math.min(Math.max(1, dip), Math.max(1, finalDipMm - WINDOW + 1));
    router.push(`/stock/${tankId}?from=${clamped}`);
  }

  return (
    <GlassCard lift={false} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
          {t('stock.calibrationViewer')} — {tankCode}
        </h2>
        <Chip lang={lang}>
          {t('stock.version')} {formatNumber(version, { lang })}
        </Chip>
        <Chip lang={lang}>
          {formatNumber(totalRows, { lang })} {t('stock.chartRows')}
        </Chip>

        <div className="ml-auto flex gap-1">
          {(['table', 'curve'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              lang={lang}
              className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
              style={
                tab === key
                  ? { background: 'var(--color-accent)', color: 'white' }
                  : { color: 'var(--text-muted)' }
              }
            >
              {t(key === 'table' ? 'stock.table' : 'stock.curve')}
            </button>
          ))}
        </div>
      </div>

      {tab === 'table' ? (
        <>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(jump);
              if (Number.isFinite(parsed)) goTo(Math.floor(parsed));
            }}
          >
            <label className="space-y-1.5">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                {t('stock.searchDip')} (1 – {formatNumber(finalDipMm, { lang })})
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                className="tabular tap-target w-32 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--hairline)' }}
              />
            </label>
            <Button type="submit" variant="glass" size="sm" lang={lang}>
              <Search className="h-3.5 w-3.5" aria-hidden />
              {t('stock.searchDip')}
            </Button>
          </form>

          <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--hairline)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-faint)' }}>
                  <th className="px-3 py-2 text-left text-xs font-medium" lang={lang}>
                    {t('tank.dip')}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium" lang={lang}>
                    {t('tank.litres')}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium" lang={lang}>
                    {t('stock.step')}
                  </th>
                  {isAdmin ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <CalibrationTableRow
                    key={row.dipMm}
                    row={row}
                    tankId={tankId}
                    version={version}
                    isAdmin={isAdmin}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => goTo(initialFrom - WINDOW)} disabled={initialFrom <= 1}>
              ←
            </Button>
            <Muted className="tabular">
              {localiseDigits(`${initialFrom}–${Math.min(finalDipMm, initialFrom + WINDOW - 1)}`, lang)} mm
            </Muted>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goTo(initialFrom + WINDOW)}
              disabled={initialFrom + WINDOW > finalDipMm}
            >
              →
            </Button>
          </div>
        </>
      ) : (
        <CalibrationCurve curve={curve} />
      )}
    </GlassCard>
  );
}

function CalibrationTableRow({
  row,
  tankId,
  version,
  isAdmin,
}: {
  row: CalibrationRow;
  tankId: string;
  version: number;
  isAdmin: boolean;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [litres, setLitres] = useState(row.litres);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await upsertCalibrationRow({ tankId, version, dipMm: row.dipMm, litres, reason });
      if (result.ok) {
        setEditing(false);
        setReason('');
        router.refresh();
      } else {
        setError(result.error ?? 'That row could not be saved');
      }
    });
  }

  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
        <td className="tabular px-3 py-1.5">{formatNumber(row.dipMm, { lang })}</td>
        <td className="tabular px-3 py-1.5 text-right font-medium">
          {formatNumber(row.litres, { lang, decimals: 3 })}
        </td>
        <td className="tabular px-3 py-1.5 text-right" style={{ color: 'var(--text-faint)' }}>
          {row.stepLitres === null ? '—' : formatNumber(row.stepLitres, { lang, decimals: 3 })}
        </td>
        {isAdmin ? (
          <td className="px-2 py-1.5 text-right">
            <button
              type="button"
              onClick={() => setEditing((open) => !open)}
              className="tap-target rounded-lg px-2 py-1"
              aria-label={`${t('stock.editRow')} ${row.dipMm}`}
            >
              <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} aria-hidden />
            </button>
          </td>
        ) : null}
      </tr>

      {editing ? (
        <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
          <td colSpan={isAdmin ? 4 : 3} className="px-3 py-3">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 state-watch" aria-hidden />
                <Muted lang={lang}>{t('stock.certifiedWarning')}</Muted>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1">
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }} lang={lang}>
                    {t('tank.litres')}
                  </span>
                  <input
                    value={litres}
                    onChange={(e) => setLitres(e.target.value)}
                    inputMode="decimal"
                    className="tabular tap-target w-32 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--hairline)' }}
                  />
                </label>
                <label className="min-w-[12rem] flex-1 space-y-1">
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }} lang={lang}>
                    {t('stock.reasonForChange')}
                  </span>
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="tap-target w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--hairline)' }}
                  />
                </label>
                <Button size="sm" disabled={pending || reason.trim().length < 3} onClick={save} lang={lang}>
                  {t('common.save')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)} lang={lang}>
                  {t('common.cancel')}
                </Button>
              </div>

              {error ? (
                <p className="state-breach text-xs" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
