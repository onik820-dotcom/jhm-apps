'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, Delete } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatLitres, formatNumber } from '@/lib/format';
import { preparePhoto, type PreparedImage } from '@/lib/image';
import { enqueue, newId } from '@/lib/offline/queue';
import { cacheChart, convertLocally, getCachedChart, type CachedChart } from '@/lib/offline/charts';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';

export interface TankOption {
  id: string;
  code: string;
  finalDipMm: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const;

export function DipEntry({
  shiftId,
  tanks,
  userId,
  dipType,
  onQueued,
}: {
  shiftId: string | null;
  tanks: TankOption[];
  userId: string;
  dipType: 'close' | 'pre_refill' | 'post_refill';
  onQueued: () => void;
}) {
  const { t, lang } = useLang();
  const router = useRouter();

  const [tank, setTank] = useState<TankOption | null>(tanks.length === 1 ? tanks[0]! : null);
  const [chart, setChart] = useState<CachedChart | null>(null);
  const [value, setValue] = useState('');
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ offline: boolean } | null>(null);

  // Pull the chart onto the phone the first time a tank is picked, so the rod
  // reading still converts when the signal goes.
  useEffect(() => {
    if (!tank) return;
    let cancelled = false;

    void (async () => {
      const cached = await getCachedChart(tank.id);
      if (!cancelled && cached) setChart(cached);
      if (cached || !navigator.onLine) return;

      const fetched = await cacheChart(createClient(), {
        id: tank.id,
        code: tank.code,
        finalDipMm: tank.finalDipMm,
      });
      if (!cancelled && fetched) setChart(fetched);
    })();

    return () => {
      cancelled = true;
    };
  }, [tank]);

  const dipMm = Number(value);
  const valid = value !== '' && Number.isFinite(dipMm) && tank !== null && dipMm >= 1 && dipMm <= tank.finalDipMm;
  const conversion = chart && valid ? convertLocally(chart, dipMm) : null;
  const outOfRange = value !== '' && tank !== null && (dipMm < 1 || dipMm > tank.finalDipMm);

  function press(key: string) {
    if (key === 'del') {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key === '.' && value.includes('.')) return;
    if (value.length >= 7) return;
    setValue((v) => v + key);
  }

  async function save() {
    if (!tank || !valid) return;
    setBusy(true);

    const id = newId();
    await enqueue({
      id,
      kind: 'dip',
      payload: {
        kind: 'dip',
        shiftId,
        tankId: tank.id,
        dipType,
        dipMm: value,
        localLitres: conversion ? conversion.litres.toFixed(3) : null,
      },
      photo: photo?.blob ?? null,
      photoName: `${id}.jpg`,
      recordedAt: new Date().toISOString(),
    });

    setSaved({ offline: !navigator.onLine });
    setBusy(false);
    onQueued();

    if (navigator.onLine) {
      const { flushQueue } = await import('@/lib/offline/queue');
      await flushQueue(createClient(), userId);
      onQueued();
      router.refresh();
    }
  }

  if (saved) {
    return (
      <GlassCard lift={false} className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 state-ok" aria-hidden />
        <p className="text-lg font-semibold tracking-tight" lang={lang}>
          {saved.offline ? t('dispenser.willSync') : lang === 'bn' ? 'জমা হয়েছে' : 'Submitted'}
        </p>
        <p className="tabular text-2xl font-semibold">
          {formatNumber(value, { lang })} {lang === 'bn' ? 'মিমি' : 'mm'}
        </p>
        {conversion ? <Muted className="tabular">{formatLitres(conversion.litres.toFixed(3), lang)}</Muted> : null}

        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => {
              setSaved(null);
              setValue('');
              setPhoto(null);
            }}
            lang={lang}
          >
            {lang === 'bn' ? 'আরেকটি' : 'Another'}
          </Button>
          <Button variant="ghost" size="lg" className="flex-1" onClick={() => router.push('/dispenser')} lang={lang}>
            {lang === 'bn' ? 'শেষ' : 'Done'}
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {tanks.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setTank(option);
              setChart(null);
              setValue('');
            }}
            className="glass tap-target rounded-2xl px-4 py-5 text-center"
            style={tank?.id === option.id ? { borderColor: 'var(--color-accent)', borderWidth: 2 } : undefined}
          >
            <span className="block text-xl font-semibold tracking-tight">
              {t('tank.tank')} {option.code}
            </span>
            <Muted className="tabular">1 – {formatNumber(option.finalDipMm, { lang })} mm</Muted>
          </button>
        ))}
      </div>

      {tank ? (
        <>
          <GlassCard lift={false} className="text-center">
            <p className="tabular text-4xl font-semibold tracking-tight">
              {value === '' ? '—' : formatNumber(value, { lang })}
              <span className="ml-1 text-lg font-normal" style={{ color: 'var(--text-faint)' }}>
                {lang === 'bn' ? 'মিমি' : 'mm'}
              </span>
            </p>

            <div className="mt-2 min-h-[2rem]" aria-live="polite">
              {outOfRange ? (
                <p className="state-breach text-sm" lang={lang}>
                  {lang === 'bn' ? 'সীমার বাইরে' : 'Outside this tank’s range'}
                </p>
              ) : conversion ? (
                <>
                  <p className="tabular text-2xl font-semibold" style={{ color: 'var(--color-accent)' }}>
                    {formatLitres(conversion.litres.toFixed(3), lang)}
                  </p>
                  {conversion.interpolated ? (
                    <Chip tone="watch" lang={lang}>
                      {t('stock.interpolated')}
                    </Chip>
                  ) : null}
                </>
              ) : value !== '' && !chart ? (
                <Muted lang={lang}>
                  {lang === 'bn' ? 'চার্ট এখনো আসেনি' : 'Chart not on this phone yet'}
                </Muted>
              ) : null}
            </div>
          </GlassCard>

          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => press(key)}
                className="glass tap-target rounded-xl py-5 text-2xl font-semibold"
                aria-label={key === 'del' ? (lang === 'bn' ? 'মুছুন' : 'Delete') : key}
              >
                {key === 'del' ? (
                  <Delete className="mx-auto h-5 w-5" aria-hidden />
                ) : key === '.' ? (
                  '.'
                ) : (
                  formatNumber(key, { lang })
                )}
              </button>
            ))}
          </div>

          <label className="block">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setPhoto(await preparePhoto(file));
                e.target.value = '';
              }}
            />
            <span className="glass tap-target flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium" lang={lang}>
              <Camera className="h-4 w-4" aria-hidden />
              {photo
                ? lang === 'bn'
                  ? 'ছবি যুক্ত হয়েছে'
                  : 'Photo attached'
                : lang === 'bn'
                  ? 'ডিপ রডের ছবি (ঐচ্ছিক)'
                  : 'Photo of the dip rod (optional)'}
            </span>
          </label>

          <Button size="lg" className="w-full" disabled={!valid || busy} onClick={save} lang={lang}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t('common.save')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
