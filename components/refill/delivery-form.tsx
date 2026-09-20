'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Truck } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatLitres, formatNumber, formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import {
  previewDelivery,
  recordDelivery,
  type DeliveryInput,
  type DeliveryPreview,
} from '@/app/refill/actions';
import type { RefillTank } from '@/lib/data/refill';

/** A road tanker arrives with four compartments of 4,500 L. */
const COMPARTMENTS = [1, 2, 3, 4];
const DECLARED_DEFAULT = '4500';

interface Row {
  tankId: string;
  declared: string;
  dipBefore: string;
  dipAfter: string;
}

export function DeliveryForm({ tanks, canSeeCost }: { tanks: RefillTank[]; canSeeCost: boolean }) {
  const { t, lang } = useLang();
  const router = useRouter();

  const [challan, setChallan] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [truck, setTruck] = useState('');
  const [driver, setDriver] = useState('');
  const [rate, setRate] = useState('');
  const [rows, setRows] = useState<Row[]>(() =>
    COMPARTMENTS.map(() => ({
      tankId: tanks[0]?.id ?? '',
      declared: DECLARED_DEFAULT,
      dipBefore: '',
      dipAfter: '',
    })),
  );

  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DeliveryPreview | null>(null);
  const [pending, startTransition] = useTransition();

  const input: DeliveryInput = useMemo(
    () => ({
      po_number: poNumber || undefined,
      challan_no: challan || undefined,
      truck_reg: truck || undefined,
      driver_name: driver || undefined,
      depot_rate: rate || '0',
      compartments: rows.map((r, i) => ({
        compartment_no: i + 1,
        declared_litres: r.declared || DECLARED_DEFAULT,
        tank_id: r.tankId,
        dip_before_mm: r.dipBefore,
        dip_after_mm: r.dipAfter,
      })),
    }),
    [poNumber, challan, truck, driver, rate, rows],
  );

  const ready = Boolean(rate.trim()) && rows.some((r) => r.tankId && r.dipBefore && r.dipAfter);

  // Recompute as the dips are typed, debounced so a keystroke is not a query.
  const refresh = useCallback(() => {
    if (!ready) {
      setPreview(null);
      return;
    }
    startTransition(async () => {
      const result = await previewDelivery(input);
      if (result.ok && result.preview) {
        setPreview(result.preview);
        setError(null);
      } else {
        setPreview(null);
        setError(result.error ?? null);
      }
    });
  }, [input, ready]);

  useEffect(() => {
    const timer = setTimeout(refresh, 400);
    return () => clearTimeout(timer);
  }, [refresh]);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await recordDelivery(input);
      if (result.ok && result.preview) {
        setSaved(result.preview);
        router.refresh();
      } else {
        setError(result.error ?? 'That delivery could not be recorded');
      }
    });
  }

  if (saved) {
    return (
      <GlassCard lift={false} className="space-y-3 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 state-ok" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight" lang={lang}>
          {lang === 'bn' ? 'ডেলিভারি লিপিবদ্ধ হয়েছে' : 'Delivery recorded'}
        </h2>
        <p className="tabular text-lg font-semibold">{formatLitres(saved.totals.received, lang)}</p>
        <Muted className="tabular" lang={lang}>
          {lang === 'bn' ? 'ঘাটতি' : 'Shortage'} {formatLitres(saved.totals.shortage, lang)}
        </Muted>
        <Button
          size="lg"
          onClick={() => {
            setSaved(null);
            setPreview(null);
            setChallan('');
            setRows(COMPARTMENTS.map(() => ({ tankId: tanks[0]?.id ?? '', declared: DECLARED_DEFAULT, dipBefore: '', dipAfter: '' })));
          }}
          lang={lang}
        >
          {lang === 'bn' ? 'আরেকটি ডেলিভারি' : 'Another delivery'}
        </Button>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      <GlassCard lift={false} className="space-y-3">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'নতুন ট্যাংকার ডেলিভারি' : 'New tanker delivery'}
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={lang === 'bn' ? 'চালান নম্বর' : 'Challan no.'} value={challan} onChange={setChallan} />
          <Field label={lang === 'bn' ? 'পি.ও. নম্বর' : 'PO number'} value={poNumber} onChange={setPoNumber} />
          <Field
            label={lang === 'bn' ? 'ডিপো দর (৳/লিটার)' : 'Depot rate (৳/litre)'}
            value={rate}
            onChange={setRate}
          />
          <Field label={lang === 'bn' ? 'ট্রাক নম্বর' : 'Truck registration'} value={truck} onChange={setTruck} />
          <Field label={lang === 'bn' ? 'চালকের নাম' : 'Driver'} value={driver} onChange={setDriver} />
        </div>
      </GlassCard>

      {/* Four compartments, each discharged into one tank. */}
      <div className="space-y-3">
        {rows.map((row, index) => {
          const line = preview?.compartments.find((c) => c.compartment_no === index + 1);
          const tank = tanks.find((tk) => tk.id === row.tankId);

          return (
            <GlassCard
              key={index}
              lift={false}
              className="space-y-3"
              style={
                line?.over_safe_limit
                  ? { borderColor: 'var(--color-breach)' }
                  : line?.shortage_flagged
                    ? { borderColor: 'var(--color-watch)' }
                    : undefined
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tracking-tight" lang={lang}>
                  {lang === 'bn' ? 'কম্পার্টমেন্ট' : 'Compartment'} {formatNumber(index + 1, { lang })}
                </span>
                {line?.shortage_flagged ? (
                  <Chip tone="watch" className="tabular" lang={lang}>
                    {lang === 'bn' ? 'ঘাটতি' : 'Short'} {formatLitres(line.shortage_litres, lang)}
                  </Chip>
                ) : null}
                {line?.over_safe_limit ? (
                  <Chip tone="breach" lang={lang}>
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {lang === 'bn' ? 'নিরাপদ সীমার উপরে' : 'Past the safe limit'}
                  </Chip>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <label className="space-y-1">
                  <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                    {t('tank.tank')}
                  </span>
                  <select
                    value={row.tankId}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, i) => (i === index ? { ...r, tankId: e.target.value } : r)))
                    }
                    className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                    style={{ borderColor: 'var(--hairline)' }}
                  >
                    {tanks.map((tk) => (
                      <option key={tk.id} value={tk.id}>
                        {tk.code}
                      </option>
                    ))}
                  </select>
                </label>

                <Field
                  label={lang === 'bn' ? 'ঘোষিত লিটার' : 'Declared litres'}
                  value={row.declared}
                  onChange={(v) => setRows((rs) => rs.map((r, i) => (i === index ? { ...r, declared: v } : r)))}
                />
                <Field
                  label={lang === 'bn' ? 'আগের ডিপ (মিমি)' : 'Dip before (mm)'}
                  value={row.dipBefore}
                  onChange={(v) => setRows((rs) => rs.map((r, i) => (i === index ? { ...r, dipBefore: v } : r)))}
                  hint={
                    tank?.currentDipMm && !row.dipBefore
                      ? `${lang === 'bn' ? 'এখন' : 'now'} ${formatNumber(tank.currentDipMm, { lang })}`
                      : undefined
                  }
                />
                <Field
                  label={lang === 'bn' ? 'পরের ডিপ (মিমি)' : 'Dip after (mm)'}
                  value={row.dipAfter}
                  onChange={(v) => setRows((rs) => rs.map((r, i) => (i === index ? { ...r, dipAfter: v } : r)))}
                />
              </div>

              {line ? (
                <p className="tabular text-xs" style={{ color: 'var(--text-muted)' }} lang={lang}>
                  {formatLitres(line.litres_before, lang)} → {formatLitres(line.litres_after, lang)} ={' '}
                  <strong>{formatLitres(line.received_litres, lang)}</strong>{' '}
                  {lang === 'bn' ? 'পাওয়া গেছে' : 'received'} ·{' '}
                  {lang === 'bn' ? 'ঘাটতি' : 'short'} {formatLitres(line.shortage_litres, lang)}{' '}
                  {formatPercent(line.shortage_pct, lang)}
                </p>
              ) : null}
            </GlassCard>
          );
        })}
      </div>

      {preview ? (
        <GlassCard lift={false} className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'সারসংক্ষেপ' : 'Delivery summary'}
          </h3>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label={lang === 'bn' ? 'ঘোষিত' : 'Declared'} value={formatLitres(preview.totals.declared, lang)} />
            <Stat label={lang === 'bn' ? 'পাওয়া গেছে' : 'Received'} value={formatLitres(preview.totals.received, lang)} />
            <Stat
              label={lang === 'bn' ? 'ঘাটতি' : 'Shortage'}
              value={`${formatLitres(preview.totals.shortage, lang)} · ${formatPercent(preview.totals.shortage_pct, lang)}`}
            />
            <Stat
              label={lang === 'bn' ? 'ক্রয়মূল্য' : 'Purchase value'}
              value={formatBDT(preview.totals.purchase_value, lang)}
            />
          </div>

          <Muted lang={lang}>
            {lang === 'bn'
              ? 'ক্রয়মূল্য রডে মাপা লিটারের উপর — চালানের ঘোষিত লিটারের উপর নয়।'
              : 'Valued on the litres the rods measured, not the litres the challan declared.'}
          </Muted>

          <div className="space-y-1">
            {preview.tanks.map((tk) => (
              <p key={tk.tank_id} className="tabular text-xs" style={{ color: 'var(--text-muted)' }}>
                <strong>{tk.tank_code}</strong>: {formatLitres(tk.stock_before, lang)} +{' '}
                {formatLitres(tk.received_litres, lang)} = {formatLitres(tk.stock_after, lang)}
                {canSeeCost && tk.new_avg_cost ? (
                  <>
                    {' · '}
                    {lang === 'bn' ? 'গড় ক্রয়মূল্য' : 'average cost'}{' '}
                    <strong>{formatBDT(tk.new_avg_cost, lang)}</strong>
                    {tk.cost_basis === 'first_delivery_depot_rate' ? (
                      <>
                        {' '}
                        <span className="state-watch">
                          ({lang === 'bn' ? 'প্রথম মূল্যায়ন' : 'first valuation'})
                        </span>
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>
            ))}
          </div>
        </GlassCard>
      ) : null}

      {error ? (
        <p className="state-breach text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <Button size="lg" className="w-full" disabled={!preview || pending} onClick={save} lang={lang}>
        {t('common.save')}
      </Button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <input
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
        style={{ borderColor: 'var(--hairline)' }}
      />
      {hint ? <Muted>{hint}</Muted> : null}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p className="tabular mt-0.5 text-sm font-semibold tracking-tight">{value}</p>
    </div>
  );
}
