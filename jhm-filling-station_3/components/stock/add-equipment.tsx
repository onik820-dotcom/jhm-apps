'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { GlassCard, Muted } from '@/components/ui/glass';
import { addDispenser, addTank } from '@/app/stock/actions';

function Field({
  label,
  value,
  onChange,
  hint,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
        style={{ borderColor: 'var(--hairline)' }}
      />
      {hint ? <Muted>{hint}</Muted> : null}
    </label>
  );
}

/**
 * A new tank starts paused and uncalibrated on purpose: until its certified
 * chart is loaded, no dip on it can be converted, so putting it straight into
 * service would only produce errors at the rod.
 */
export function AddTankForm() {
  const { t, lang } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [capacityLitres, setCapacity] = useState('12000');
  const [finalDipMm, setFinalDip] = useState('');
  const [validityFrom, setFrom] = useState('');
  const [validityTo, setTo] = useState('');
  const [calibratedBy, setCalibratedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addTank({
        code,
        capacityLitres,
        finalDipMm,
        validityFrom,
        validityTo,
        calibratedBy,
      });
      if (result.ok) {
        setOpen(false);
        setCode('');
        setFinalDip('');
        router.refresh();
      } else {
        setError(result.error ?? 'The tank could not be added');
      }
    });
  }

  if (!open) {
    return (
      <Button variant="glass" size="sm" onClick={() => setOpen(true)} lang={lang}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t('stock.addTank')}
      </Button>
    );
  }

  return (
    <GlassCard lift={false} className="w-full space-y-3">
      <h3 className="text-sm font-semibold tracking-tight" lang={lang}>
        {t('stock.addTank')}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={lang === 'bn' ? 'কোড' : 'Code'} value={code} onChange={setCode} hint="T3" />
        <Field
          label={t('tank.capacity')}
          value={capacityLitres}
          onChange={setCapacity}
          inputMode="decimal"
        />
        <Field
          label={t('stock.finalDip')}
          value={finalDipMm}
          onChange={setFinalDip}
          inputMode="numeric"
          hint={lang === 'bn' ? 'এই ট্যাংকের নিজস্ব পূর্ণ ডিপ, মিলিমিটারে' : "This tank's own full dip, in millimetres"}
        />
        <Field label={t('stock.calibratedBy')} value={calibratedBy} onChange={setCalibratedBy} />
        <Field label={`${t('stock.validity')} — ${lang === 'bn' ? 'শুরু' : 'from'}`} value={validityFrom} onChange={setFrom} type="date" />
        <Field label={`${t('stock.validity')} — ${lang === 'bn' ? 'শেষ' : 'to'}`} value={validityTo} onChange={setTo} type="date" />
      </div>

      <Muted lang={lang}>
        {lang === 'bn'
          ? 'নতুন ট্যাংক বিরতি অবস্থায় যোগ হবে। ক্যালিব্রেশন চার্ট না দেওয়া পর্যন্ত ডিপ রূপান্তর সম্ভব নয়।'
          : 'The tank is added paused. No dip on it can be converted until its certified chart is loaded.'}
      </Muted>

      {error ? (
        <p className="state-breach text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending} lang={lang}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} lang={lang}>
          {t('common.cancel')}
        </Button>
      </div>
    </GlassCard>
  );
}

export function AddDispenserForm({ tanks }: { tanks: Array<{ id: string; code: string }> }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [tankId, setTankId] = useState(tanks[0]?.id ?? '');
  const [nozzleCount, setNozzles] = useState('1');
  const [meterDigits, setDigits] = useState('8');
  const [maxFlowLpm, setFlow] = useState('50');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addDispenser({ code, tankId, nozzleCount, meterDigits, maxFlowLpm });
      if (result.ok) {
        setOpen(false);
        setCode('');
        router.refresh();
      } else {
        setError(result.error ?? 'The dispenser could not be added');
      }
    });
  }

  if (!open) {
    return (
      <Button variant="glass" size="sm" onClick={() => setOpen(true)} lang={lang}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {t('stock.addDispenser')}
      </Button>
    );
  }

  return (
    <GlassCard lift={false} className="w-full space-y-3">
      <h3 className="text-sm font-semibold tracking-tight" lang={lang}>
        {t('stock.addDispenser')}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={lang === 'bn' ? 'কোড' : 'Code'} value={code} onChange={setCode} hint="M5" />

        <label className="space-y-1">
          <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('tank.tank')}
          </span>
          <select
            value={tankId}
            onChange={(e) => setTankId(e.target.value)}
            className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--hairline)' }}
          >
            {tanks.map((tank) => (
              <option key={tank.id} value={tank.id}>
                {tank.code}
              </option>
            ))}
          </select>
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'প্রতি মেশিন ঠিক একটি ট্যাংক থেকে টানে — এটি ছাড়া ট্যাংকভিত্তিক গরমিল বের করা যায় না।'
              : 'Every dispenser draws from exactly one tank. Per-tank variance is impossible without it.'}
          </Muted>
        </label>

        <Field label={t('stock.nozzles')} value={nozzleCount} onChange={setNozzles} inputMode="numeric" />
        <Field label={t('stock.digits')} value={meterDigits} onChange={setDigits} inputMode="numeric" />
        <Field label={t('stock.maxFlow')} value={maxFlowLpm} onChange={setFlow} inputMode="decimal" hint="L/min" />
      </div>

      {error ? (
        <p className="state-breach text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !tankId} lang={lang}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} lang={lang}>
          {t('common.cancel')}
        </Button>
      </div>
    </GlassCard>
  );
}
