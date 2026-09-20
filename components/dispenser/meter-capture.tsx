'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, CheckCircle2, LoaderCircle, RotateCcw, WifiOff } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatNumber } from '@/lib/format';
import { preparePhoto, type PreparedImage } from '@/lib/image';
import { enqueue, newId } from '@/lib/offline/queue';
import { Button } from '@/components/ui/button';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';

export interface NozzleOption {
  nozzleId: string;
  dispenserCode: string;
  nozzleNo: number;
  tankCode: string;
}

interface OcrResult {
  machineNo: string | null;
  reading: string | null;
  confidence: number;
  notes: string | null;
}

type Step = 'pick' | 'capture' | 'confirm' | 'done';

export function MeterCapture({
  shiftId,
  nozzles,
  userId,
  onQueued,
}: {
  shiftId: string;
  nozzles: NozzleOption[];
  userId: string;
  onQueued: () => void;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('pick');
  const [nozzle, setNozzle] = useState<NozzleOption | null>(nozzles.length === 1 ? nozzles[0]! : null);
  const [readingType, setReadingType] = useState<'open' | 'close'>('close');
  const [photo, setPhoto] = useState<PreparedImage | null>(null);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const prepared = await preparePhoto(file);
      setPhoto(prepared);
      setStep('confirm');

      // Offline is a normal state here, not a failure: the employee simply
      // types the number and the photo travels with it when signal returns.
      if (!navigator.onLine) {
        setOcr(null);
        setBusy(false);
        return;
      }

      const response = await fetch('/api/ocr/meter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: prepared.base64,
          mediaType: 'image/jpeg',
          knownMachines: [...new Set(nozzles.map((n) => n.dispenserCode))],
        }),
      });

      // A failed read must never cost the photograph. Anything other than a
      // well-formed answer just means the number gets typed in by hand, which
      // is the same path the employee takes when the forecourt has no signal.
      let result: OcrResult | null = null;
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        try {
          result = (await response.json()) as OcrResult;
        } catch {
          result = null;
        }
      }

      setOcr(result);
      if (result?.reading) setReading(result.reading);

      // If the model named a machine we know, jump to it.
      const matched = result
        ? nozzles.find(
            (n) => n.dispenserCode.toLowerCase() === (result.machineNo ?? '').trim().toLowerCase(),
          )
        : undefined;
      if (matched) setNozzle(matched);
    } catch {
      // Only a failure to process the image itself lands here; the photo is
      // unusable, so the employee has to take another.
      setError(lang === 'bn' ? 'ছবিটি নেওয়া গেল না' : 'That photo could not be used');
      setStep('capture');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!nozzle || !reading.trim()) return;
    setBusy(true);
    setError(null);

    const id = newId();
    await enqueue({
      id,
      kind: 'meter',
      payload: {
        kind: 'meter',
        shiftId,
        nozzleId: nozzle.nozzleId,
        readingType,
        reading: reading.trim(),
        isRollover: false,
        aiExtracted: ocr ? { ...ocr, confirmedReading: reading.trim() } : null,
        aiConfidence: ocr ? ocr.confidence : null,
      },
      photo: photo?.blob ?? null,
      photoName: `${id}.jpg`,
      recordedAt: new Date().toISOString(),
    });

    setSavedOffline(!navigator.onLine);
    setStep('done');
    setBusy(false);
    onQueued();

    // Online, the sync loop picks it up within moments.
    if (navigator.onLine) {
      const { flushQueue } = await import('@/lib/offline/queue');
      const { createClient } = await import('@/lib/supabase/client');
      await flushQueue(createClient(), userId);
      onQueued();
      router.refresh();
    }
  }

  function restart() {
    setStep('pick');
    setPhoto(null);
    setOcr(null);
    setReading('');
    setError(null);
    setSavedOffline(false);
  }

  // ---- step: which nozzle, and is this the start or end of the shift -------
  if (step === 'pick') {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'কোন মেশিন?' : 'Which machine?'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {nozzles.map((option) => (
              <button
                key={option.nozzleId}
                type="button"
                onClick={() => setNozzle(option)}
                className="glass tap-target rounded-2xl px-4 py-6 text-center"
                style={
                  nozzle?.nozzleId === option.nozzleId
                    ? { borderColor: 'var(--color-accent)', borderWidth: 2 }
                    : undefined
                }
              >
                <span className="block text-2xl font-semibold tracking-tight">{option.dispenserCode}</span>
                <Muted>
                  {option.tankCode}
                  {option.nozzleNo > 1 ? ` · ${option.nozzleNo}` : ''}
                </Muted>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'কখনকার রিডিং?' : 'Which reading?'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(['open', 'close'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setReadingType(type)}
                className="glass tap-target rounded-2xl px-4 py-5 text-center text-base font-medium"
                style={
                  readingType === type ? { borderColor: 'var(--color-accent)', borderWidth: 2 } : undefined
                }
                lang={lang}
              >
                {type === 'open'
                  ? lang === 'bn'
                    ? 'শিফট শুরু'
                    : 'Shift start'
                  : lang === 'bn'
                    ? 'শিফট শেষ'
                    : 'Shift end'}
              </button>
            ))}
          </div>
        </div>

        <Button size="lg" className="w-full" disabled={!nozzle} onClick={() => setStep('capture')} lang={lang}>
          {t('common.confirm')}
        </Button>
      </div>
    );
  }

  // ---- step: take the photograph -------------------------------------------
  if (step === 'capture') {
    return (
      <div className="space-y-4">
        <GlassCard lift={false} className="text-center">
          <p className="text-lg font-semibold tracking-tight">{nozzle?.dispenserCode}</p>
          <Muted lang={lang}>
            {readingType === 'open'
              ? lang === 'bn'
                ? 'শিফট শুরুর রিডিং'
                : 'Shift start reading'
              : lang === 'bn'
                ? 'শিফট শেষের রিডিং'
                : 'Shift end reading'}
          </Muted>
        </GlassCard>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />

        <Button
          variant="glass"
          size="forecourt"
          className="w-full items-center"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          lang={lang}
        >
          {busy ? (
            <LoaderCircle className="mb-2 h-8 w-8 animate-spin" style={{ color: 'var(--color-accent)' }} aria-hidden />
          ) : (
            <Camera className="mb-2 h-8 w-8" style={{ color: 'var(--color-accent)' }} aria-hidden />
          )}
          {t('dispenser.takeReading')}
        </Button>

        {error ? (
          <p className="state-breach text-center text-sm" role="alert">
            {error}
          </p>
        ) : null}

        <Button variant="ghost" size="md" className="w-full" onClick={restart} lang={lang}>
          {t('common.cancel')}
        </Button>
      </div>
    );
  }

  // ---- step: photo and number, side by side, confirm or retype -------------
  if (step === 'confirm') {
    const lowConfidence = ocr !== null && ocr.confidence < 0.9;

    return (
      <div className="space-y-4">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.dataUrl}
            alt={lang === 'bn' ? 'মিটারের ছবি' : 'Meter photo'}
            className="w-full rounded-2xl border"
            style={{ borderColor: 'var(--hairline)' }}
          />
        ) : null}

        <GlassCard lift={false} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold tracking-tight">{nozzle?.dispenserCode}</span>
            {busy ? (
              <Chip lang={lang}>
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
                {t('common.loading')}
              </Chip>
            ) : ocr ? (
              <Chip tone={lowConfidence ? 'watch' : 'ok'} lang={lang}>
                {lang === 'bn' ? 'এআই পড়েছে' : 'AI read'} {formatNumber(Math.round(ocr.confidence * 100), { lang })}%
              </Chip>
            ) : (
              <Chip tone="watch" lang={lang}>
                <WifiOff className="h-3 w-3" aria-hidden />
                {lang === 'bn' ? 'হাতে লিখুন' : 'Type it in'}
              </Chip>
            )}
          </div>

          {ocr?.notes ? <Muted>{ocr.notes}</Muted> : null}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {lang === 'bn' ? 'মিটার রিডিং' : 'Meter reading'}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              className="tabular tap-target w-full rounded-xl border bg-transparent px-4 py-4 text-3xl font-semibold outline-none"
              style={{ borderColor: lowConfidence ? 'var(--color-watch)' : 'var(--hairline)' }}
              autoFocus
            />
          </label>

          <Muted lang={lang}>
            {lang === 'bn'
              ? 'সংখ্যাটি মিটারের সাথে মিলিয়ে দেখুন। ভুল হলে এখানেই ঠিক করুন।'
              : 'Check the number against the meter. Correct it here if it is wrong.'}
          </Muted>

          {error ? (
            <p className="state-breach text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button size="lg" className="flex-1" disabled={busy || !reading.trim()} onClick={save} lang={lang}>
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t('common.confirm')}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStep('capture')} lang={lang}>
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ---- step: saved ---------------------------------------------------------
  return (
    <GlassCard lift={false} className="space-y-4 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 state-ok" aria-hidden />
      <p className="text-lg font-semibold tracking-tight" lang={lang}>
        {savedOffline ? t('dispenser.willSync') : lang === 'bn' ? 'জমা হয়েছে' : 'Submitted'}
      </p>
      <p className="tabular text-2xl font-semibold">{reading}</p>
      <Muted>{nozzle?.dispenserCode}</Muted>

      <div className="flex gap-2">
        <Button size="lg" className="flex-1" onClick={restart} lang={lang}>
          {lang === 'bn' ? 'আরেকটি' : 'Another'}
        </Button>
        <Button variant="ghost" size="lg" className="flex-1" onClick={() => router.push('/dispenser')} lang={lang}>
          {lang === 'bn' ? 'শেষ' : 'Done'}
        </Button>
      </div>
    </GlassCard>
  );
}
