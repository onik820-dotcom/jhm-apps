'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLang } from '@/lib/i18n/provider';
import { formatLitres } from '@/lib/format';
import type { CurvePoint } from '@/lib/data/stock';

/**
 * The calibration chart as a curve.
 *
 * Split out from the viewer so it can be loaded on demand. Recharts is about
 * 100 kB and this is behind a tab most people never open — the table is what
 * anybody checking a dip actually reads. Loading a charting library to render
 * a page whose default view is a table is 100 kB spent on nothing.
 */
export function CalibrationCurve({ curve }: { curve: CurvePoint[] }) {
  const { t, lang } = useLang();

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--hairline)" vertical={false} />
          <XAxis
            dataKey="dipMm"
            tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
            stroke="var(--hairline)"
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-faint)' }}
            stroke="var(--hairline)"
            width={56}
            tickFormatter={(v: number) => String(v)}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              backdropFilter: 'blur(12px)',
              color: 'var(--text-strong)',
            }}
            formatter={(v: number) => [formatLitres(String(v), lang), t('tank.litres')]}
            labelFormatter={(v: number) => `${t('tank.dip')} ${v} mm`}
          />
          <Line
            type="monotone"
            dataKey="litres"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
