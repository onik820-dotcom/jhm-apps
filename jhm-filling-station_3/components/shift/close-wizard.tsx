'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Lock, Plus, Trash2 } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate, formatLitres, formatNumber, formatPercent } from '@/lib/format';
import { litresSold } from '@/lib/calc/meter';
import { CalcError } from '@/lib/calc/decimal';
import { Button } from '@/components/ui/button';
import { Chip, GlassCard, Muted } from '@/components/ui/glass';
import { previewClose, submitClose, type ClosePayload, type CloseSummary } from '@/app/shift/close/actions';
import type { CloseContext } from '@/lib/data/shift-close';

interface Draft {
  rate: string;
  readings: Record<string, { closing: string; test: string }>;
  dips: Record<string, string>;
  creditSales: Array<{ customerId: string; litres: string; rate: string; amount: string; vehicleNo: string; challanNo: string }>;
  lubSales: Array<{ skuId: string; qty: string; rate: string; amount: string }>;
  expenses: Array<{ categoryId: string; amount: string; description: string; paidBy: string }>;
  cash: { openingCash: string; bankDeposits: string; countedCash: string };
  varianceReasons: Record<string, string>;
  cashVarianceReason: string;
}

const STEP_KEYS = [
  ['Meter readings', 'মিটার রিডিং'],
  ['Test / assessment', 'টেস্ট / পরিমাপ'],
  ['Tank dips', 'ট্যাংক ডিপ'],
  ['Rate', 'দর'],
  ['Credit sales', 'বাকি বিক্রি'],
  ['Lubricants', 'লুব্রিকেন্ট'],
  ['Expenses', 'খরচ'],
  ['Cash', 'নগদ'],
  ['Reconciliation', 'মিলকরণ'],
  ['Sign off', 'স্বাক্ষর'],
] as const;

function draftKey(shiftId: string) {
  return `jhm.close.${shiftId}`;
}

export function CloseWizard({ context }: { context: CloseContext }) {
  const { t, lang } = useLang();
  const router = useRouter();
  const shift = context.shift!;

  const [step, setStep] = useState(0);
  const [summary, setSummary] = useState<CloseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<Draft>(() => ({
    rate: shift.ratePerLitre ?? context.lastRate ?? '',
    readings: Object.fromEntries(
      context.nozzles.map((n) => [n.nozzleId, { closing: n.submittedClosing ?? '', test: '0' }]),
    ),
    dips: Object.fromEntries(context.tanks.map((tk) => [tk.id, ''])),
    creditSales: [],
    lubSales: [],
    expenses: [],
    cash: { openingCash: context.openingCash, bankDeposits: '0', countedCash: '' },
    varianceReasons: {},
    cashVarianceReason: '',
  }));

  // A close takes a while to type. Keep it on the device so a dropped
  // connection or a stray refresh does not cost the whole shift's entry.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey(shift.id));
      if (saved) setDraft((d) => ({ ...d, ...(JSON.parse(saved) as Draft) }));
    } catch {
      // A lost draft is a nuisance, not a failure.
    }
  }, [shift.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(draftKey(shift.id), JSON.stringify(draft));
    } catch {
      /* private browsing */
    }
  }, [draft, shift.id]);

  const payload: ClosePayload = useMemo(
    () => ({
      rate_per_litre: draft.rate || '0',
      readings: context.nozzles.map((n) => ({
        nozzle_id: n.nozzleId,
        closing: draft.readings[n.nozzleId]?.closing ?? '',
        test_litres: draft.readings[n.nozzleId]?.test || '0',
      })),
      dips: context.tanks.map((tk) => ({ tank_id: tk.id, dip_mm: draft.dips[tk.id] ?? '' })),
      credit_sales: draft.creditSales
        .filter((r) => r.customerId && r.amount)
        .map((r) => ({
          customer_id: r.customerId,
          litres: r.litres || undefined,
          rate: r.rate || undefined,
          amount: r.amount,
          vehicle_no: r.vehicleNo || undefined,
          challan_no: r.challanNo || undefined,
        })),
      lubricant_sales: draft.lubSales
        .filter((r) => r.skuId && r.amount)
        .map((r) => ({ sku_id: r.skuId, qty: r.qty || '0', rate: r.rate || undefined, amount: r.amount })),
      expenses: draft.expenses
        .filter((r) => r.categoryId && r.amount)
        .map((r) => ({
          category_id: r.categoryId,
          amount: r.amount,
          description: r.description || undefined,
          paid_by: r.paidBy || 'cash',
        })),
      cash: {
        // opening_cash is read only when no previous shift has been closed;
        // after that the database chains it and ignores whatever is sent.
        // dues_collected is not sent at all — it is summed from payment rows.
        opening_cash: draft.cash.openingCash || '0',
        bank_deposits: draft.cash.bankDeposits || '0',
        counted_cash: draft.cash.countedCash || '0',
      },
      variance_reasons: draft.varianceReasons,
      cash_variance_reason: draft.cashVarianceReason,
    }),
    [draft, context.nozzles, context.tanks],
  );

  const runPreview = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await previewClose(shift.id, payload);
      if (result.ok && result.summary) setSummary(result.summary);
      else {
        setSummary(null);
        setError(result.error ?? 'The close could not be worked out');
      }
    });
  }, [shift.id, payload]);

  useEffect(() => {
    if (step === 8) runPreview();
  }, [step, runPreview]);

  // Which reasons the database will insist on before it accepts a sign-off.
  const flaggedTanks = summary?.tanks.filter((tk) => tk.variance_flagged) ?? [];
  const needsCashReason = summary?.cash.requires_reason ?? false;
  const missingReasons =
    flaggedTanks.some((tk) => !(draft.varianceReasons[tk.tank_id] ?? '').trim()) ||
    (needsCashReason && !draft.cashVarianceReason.trim());

  function sign() {
    setError(null);
    startTransition(async () => {
      const result = await submitClose(shift.id, payload);
      if (result.ok) {
        setClosed(true);
        try {
          window.localStorage.removeItem(draftKey(shift.id));
        } catch {
          /* ignore */
        }
        router.refresh();
      } else {
        setError(result.error ?? 'The shift could not be closed');
      }
    });
  }

  if (closed) {
    return (
      <GlassCard lift={false} className="space-y-4 text-center">
        <Lock className="mx-auto h-12 w-12 state-ok" aria-hidden />
        <h2 className="text-lg font-semibold tracking-tight" lang={lang}>
          {lang === 'bn' ? 'শিফট বন্ধ হয়েছে' : 'Shift closed'}
        </h2>
        <Muted lang={lang}>
          {lang === 'bn'
            ? 'বইয়ের সমাপ্তি পরের শিফটের সূচনা হিসেবে চলে গেছে।'
            : 'The book closing has carried forward as the next shift’s opening.'}
        </Muted>
        <Button size="lg" onClick={() => router.push('/manager')} lang={lang}>
          {t('nav.dashboard')}
        </Button>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      <GlassCard lift={false} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <Muted className="tabular">{formatDate(shift.shiftDate, lang)}</Muted>
          <p className="text-base font-semibold tracking-tight" lang={lang}>
            {t(shift.shiftType === 'day' ? 'shift.day' : 'shift.night')}
          </p>
        </div>
        <Chip tone={shift.status === 'reopened' ? 'watch' : 'ok'} lang={lang}>
          {t(shift.status === 'reopened' ? 'shift.reopened' : 'shift.open')}
        </Chip>
        <div className="ml-auto tabular text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatNumber(step + 1, { lang })} / {formatNumber(STEP_KEYS.length, { lang })}
        </div>
      </GlassCard>

      {/* The steps are linear on purpose: a close that can be skipped through
          is a close where a figure goes unentered. */}
      <nav className="flex gap-1 overflow-x-auto pb-1" aria-label="Steps">
        {STEP_KEYS.map(([en, bn], index) => (
          <button
            key={en}
            type="button"
            disabled={index > step}
            onClick={() => setStep(index)}
            lang={lang}
            className="tap-target shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap disabled:opacity-35"
            style={
              index === step
                ? { background: 'var(--color-accent)', color: 'white' }
                : { color: 'var(--text-muted)' }
            }
          >
            {formatNumber(index + 1, { lang })}. {lang === 'bn' ? bn : en}
          </button>
        ))}
      </nav>

      <GlassCard lift={false} className="space-y-4">
        {step === 0 ? <MeterStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 1 ? <TestStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 2 ? <DipStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 3 ? <RateStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 4 ? <CreditStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 5 ? <LubStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 6 ? <ExpenseStep context={context} draft={draft} setDraft={setDraft} /> : null}
        {step === 7 ? <CashStep draft={draft} setDraft={setDraft} summary={summary} /> : null}
        {step >= 8 ? (
          <SummaryStep
            summary={summary}
            pending={pending}
            draft={draft}
            setDraft={setDraft}
            signing={step === 9}
          />
        ) : null}

        {error ? (
          <p className="state-breach text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </GlassCard>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="lg" disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)} lang={lang}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {lang === 'bn' ? 'পিছনে' : 'Back'}
        </Button>

        {step < STEP_KEYS.length - 1 ? (
          <Button size="lg" className="ml-auto" disabled={pending} onClick={() => setStep((s) => s + 1)} lang={lang}>
            {lang === 'bn' ? 'পরবর্তী' : 'Next'}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        ) : (
          <Button
            size="lg"
            className="ml-auto"
            disabled={pending || !summary || missingReasons}
            onClick={sign}
            lang={lang}
          >
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
            {lang === 'bn' ? 'স্বাক্ষর ও বন্ধ' : 'Sign off and close'}
          </Button>
        )}
      </div>

      {step === STEP_KEYS.length - 1 && missingReasons ? (
        <Muted className="state-breach text-center" lang={lang}>
          {lang === 'bn'
            ? 'গরমিলের কারণ না লেখা পর্যন্ত স্বাক্ষর করা যাবে না।'
            : 'Sign-off stays locked until every variance has a written reason.'}
        </Muted>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StepProps = {
  context: CloseContext;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
};

function Field({
  label,
  value,
  onChange,
  hint,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'block space-y-1 sm:col-span-2' : 'block space-y-1'}>
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

/** Live litres for one nozzle, using the same function the tests cover. */
function nozzleLitres(
  opening: string | null,
  closing: string,
  meterDigits: number,
  maxFlowLpm: string,
  shiftMinutes: number,
) {
  if (!opening || !closing.trim()) return null;
  try {
    return litresSold({
      openingReading: opening,
      closingReading: closing,
      spec: { meterDigits, maxFlowLpm },
      shiftMinutes,
    });
  } catch (e) {
    return e instanceof CalcError ? e : null;
  }
}

function MeterStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  const shift = context.shift!;
  const minutes = Math.max(
    1,
    (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 60000,
  );

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {lang === 'bn' ? 'প্রতিটি নজলের সমাপ্তি রিডিং' : 'Closing reading for every nozzle'}
      </h2>

      {context.nozzles.map((n) => {
        const entry = draft.readings[n.nozzleId] ?? { closing: '', test: '0' };
        const result = nozzleLitres(n.openingReading, entry.closing, n.meterDigits, n.maxFlowLpm, minutes);
        const calcError = result instanceof CalcError ? result : null;
        const sold = result && !(result instanceof CalcError) ? result : null;

        return (
          <div key={n.nozzleId} className="rounded-xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">{n.dispenserCode}</span>
              <Muted>
                {n.tankCode}
                {n.nozzleNo > 1 ? ` · ${n.nozzleNo}` : ''}
              </Muted>
              {n.submittedClosing ? (
                <Chip tone="ok" lang={lang}>
                  {lang === 'bn' ? 'ডিসপেনসার জমা দিয়েছে' : 'Dispenser submitted'}
                </Chip>
              ) : null}
              {sold?.isRollover ? (
                <Chip tone="watch" lang={lang}>
                  {lang === 'bn' ? 'মিটার ঘুরে গেছে — যাচাই করুন' : 'Rollover — confirm'}
                </Chip>
              ) : null}
              {sold?.implausible ? (
                <Chip tone="breach" lang={lang}>
                  {lang === 'bn' ? 'অস্বাভাবিক' : 'Implausible'}
                </Chip>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                  {lang === 'bn' ? 'শুরুর রিডিং' : 'Opening'}
                </span>
                <p className="tabular rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--hairline)' }}>
                  {n.openingReading ? formatNumber(n.openingReading, { lang, decimals: 2 }) : '—'}
                </p>
                <Muted lang={lang}>
                  {n.openingSource === 'previous_close'
                    ? lang === 'bn'
                      ? 'গত শিফটের সমাপ্তি'
                      : 'Previous shift’s close'
                    : n.openingSource === 'this_shift_open'
                      ? lang === 'bn'
                        ? 'এই শিফটের শুরু'
                        : 'This shift’s opening'
                      : lang === 'bn'
                        ? 'কোনো শুরুর রিডিং নেই'
                        : 'No opening reading'}
                </Muted>
              </div>

              <Field
                label={lang === 'bn' ? 'সমাপ্তি রিডিং' : 'Closing'}
                value={entry.closing}
                onChange={(v) =>
                  setDraft((d) => ({ ...d, readings: { ...d.readings, [n.nozzleId]: { ...entry, closing: v } } }))
                }
              />

              <div className="space-y-1">
                <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                  {lang === 'bn' ? 'বিক্রি' : 'Sold'}
                </span>
                <p className="tabular px-1 py-2 text-lg font-semibold">
                  {sold ? formatLitres(sold.litresSold.toFixed(3), lang) : '—'}
                </p>
                {sold?.implausible ? (
                  <Muted className="state-breach">{sold.implausible.reason}</Muted>
                ) : calcError ? (
                  <Muted className="state-breach">{calcError.message}</Muted>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TestStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {lang === 'bn' ? 'টেস্ট / পরিমাপে ব্যবহৃত লিটার' : 'Litres pumped into the test measure'}
      </h2>
      <Muted lang={lang}>
        {lang === 'bn'
          ? 'এই তেল মেশিন থেকে বেরিয়ে আবার ট্যাংকে ফেরত যায় — তাই বিক্রি থেকে বাদ, মজুদে যোগ।'
          : 'This fuel leaves the dispenser and goes back into the tank, so it is excluded from sales and stays in stock.'}
      </Muted>

      <div className="grid gap-3 sm:grid-cols-2">
        {context.nozzles.map((n) => {
          const entry = draft.readings[n.nozzleId] ?? { closing: '', test: '0' };
          return (
            <Field
              key={n.nozzleId}
              label={`${n.dispenserCode}${n.nozzleNo > 1 ? ` · ${n.nozzleNo}` : ''}`}
              value={entry.test}
              onChange={(v) =>
                setDraft((d) => ({ ...d, readings: { ...d.readings, [n.nozzleId]: { ...entry, test: v } } }))
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function DipStep({ context, draft, setDraft }: StepProps) {
  const { t, lang } = useLang();
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {lang === 'bn' ? 'সমাপ্তি ডিপ' : 'Closing dip for every tank'}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {context.tanks.map((tk) => (
          <div key={tk.id} className="space-y-1 rounded-xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">
                {t('tank.tank')} {tk.code}
              </span>
              <Muted className="tabular">1 – {formatNumber(tk.finalDipMm, { lang })} mm</Muted>
            </div>
            <Field
              label={lang === 'bn' ? 'ডিপ (মিমি)' : 'Dip (mm)'}
              value={draft.dips[tk.id] ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, dips: { ...d.dips, [tk.id]: v } }))}
            />
            <Muted className="tabular" lang={lang}>
              {lang === 'bn' ? 'বইয়ের শুরু' : 'Book opening'}:{' '}
              {tk.bookOpening ? formatLitres(tk.bookOpening, lang) : '—'}
            </Muted>
          </div>
        ))}
      </div>
    </div>
  );
}

function RateStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {lang === 'bn' ? 'এই শিফটের বিক্রয় দর' : 'Selling rate for this shift'}
      </h2>
      <div className="max-w-xs">
        <Field
          label={lang === 'bn' ? 'দর প্রতি লিটার (৳)' : 'Rate per litre (৳)'}
          value={draft.rate}
          onChange={(v) => setDraft((d) => ({ ...d, rate: v }))}
          hint={
            context.lastRate
              ? `${lang === 'bn' ? 'গত শিফট' : 'Last shift'}: ${formatBDT(context.lastRate, lang)}`
              : undefined
          }
        />
      </div>
    </div>
  );
}

function RowList({
  title,
  hint,
  rows,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  rows: number;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { t, lang } = useLang();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
          {title}
        </h2>
        <Button variant="glass" size="sm" className="ml-auto" onClick={onAdd} lang={lang}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {lang === 'bn' ? 'সারি যোগ' : 'Add row'}
        </Button>
      </div>
      {hint ? <Muted lang={lang}>{hint}</Muted> : null}
      {rows === 0 ? <Muted lang={lang}>{t('common.empty')}</Muted> : children}
    </div>
  );
}

function CreditStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  const active = context.customers.filter((c) => c.isActive);

  return (
    <RowList
      title={lang === 'bn' ? 'পার্টিভিত্তিক বাকি বিক্রি' : 'Credit sales, party by party'}
      hint={
        active.length === 0
          ? lang === 'bn'
            ? 'কোনো সক্রিয় পার্টি নেই — অ্যাডমিন প্রথমে পার্টিগুলো চালু করুন।'
            : 'No active credit party yet. An admin needs to name and activate the real parties first.'
          : undefined
      }
      rows={draft.creditSales.length}
      onAdd={() =>
        setDraft((d) => ({
          ...d,
          creditSales: [...d.creditSales, { customerId: '', litres: '', rate: d.rate, amount: '', vehicleNo: '', challanNo: '' }],
        }))
      }
    >
      <div className="space-y-3">
        {draft.creditSales.map((row, index) => (
          <div key={index} className="rounded-xl border p-3" style={{ borderColor: 'var(--hairline)' }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                  {lang === 'bn' ? 'পার্টি' : 'Party'}
                </span>
                <select
                  value={row.customerId}
                  onChange={(e) =>
                    setDraft((d) => {
                      const next = [...d.creditSales];
                      next[index] = { ...row, customerId: e.target.value };
                      return { ...d, creditSales: next };
                    })
                  }
                  className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                  style={{ borderColor: 'var(--hairline)' }}
                >
                  <option value="">—</option>
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <Field
                label={lang === 'bn' ? 'লিটার' : 'Litres'}
                value={row.litres}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = [...d.creditSales];
                    const amount = v && row.rate ? (Number(v) * Number(row.rate)).toFixed(2) : row.amount;
                    next[index] = { ...row, litres: v, amount };
                    return { ...d, creditSales: next };
                  })
                }
              />
              <Field
                label={lang === 'bn' ? 'দর' : 'Rate'}
                value={row.rate}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = [...d.creditSales];
                    const amount = row.litres && v ? (Number(row.litres) * Number(v)).toFixed(2) : row.amount;
                    next[index] = { ...row, rate: v, amount };
                    return { ...d, creditSales: next };
                  })
                }
              />
              <Field
                label={lang === 'bn' ? 'টাকা' : 'Amount'}
                value={row.amount}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = [...d.creditSales];
                    next[index] = { ...row, amount: v };
                    return { ...d, creditSales: next };
                  })
                }
              />
              <Field
                label={lang === 'bn' ? 'গাড়ি নম্বর' : 'Vehicle'}
                value={row.vehicleNo}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = [...d.creditSales];
                    next[index] = { ...row, vehicleNo: v };
                    return { ...d, creditSales: next };
                  })
                }
              />
              <Field
                label={lang === 'bn' ? 'চালান নম্বর' : 'Challan'}
                value={row.challanNo}
                onChange={(v) =>
                  setDraft((d) => {
                    const next = [...d.creditSales];
                    next[index] = { ...row, challanNo: v };
                    return { ...d, creditSales: next };
                  })
                }
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setDraft((d) => ({ ...d, creditSales: d.creditSales.filter((_, x) => x !== index) }))}
              lang={lang}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {lang === 'bn' ? 'সরান' : 'Remove'}
            </Button>
          </div>
        ))}
      </div>
    </RowList>
  );
}

function LubStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  return (
    <RowList
      title={lang === 'bn' ? 'মবিল ও লুব্রিকেন্ট বিক্রি' : 'Lubricant and Mobil sales'}
      rows={draft.lubSales.length}
      onAdd={() => setDraft((d) => ({ ...d, lubSales: [...d.lubSales, { skuId: '', qty: '', rate: '', amount: '' }] }))}
    >
      <div className="space-y-3">
        {draft.lubSales.map((row, index) => (
          <div key={index} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-4" style={{ borderColor: 'var(--hairline)' }}>
            <label className="space-y-1">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                SKU
              </span>
              <select
                value={row.skuId}
                onChange={(e) => {
                  const sku = context.lubSkus.find((s) => s.id === e.target.value);
                  setDraft((d) => {
                    const next = [...d.lubSales];
                    next[index] = { ...row, skuId: e.target.value, rate: sku?.saleRate ?? row.rate };
                    return { ...d, lubSales: next };
                  });
                }}
                className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--hairline)' }}
              >
                <option value="">—</option>
                {context.lubSkus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={lang === 'bn' ? 'পরিমাণ' : 'Qty'}
              value={row.qty}
              onChange={(v) =>
                setDraft((d) => {
                  const next = [...d.lubSales];
                  const amount = v && row.rate ? (Number(v) * Number(row.rate)).toFixed(2) : row.amount;
                  next[index] = { ...row, qty: v, amount };
                  return { ...d, lubSales: next };
                })
              }
            />
            <Field
              label={lang === 'bn' ? 'দর' : 'Rate'}
              value={row.rate}
              onChange={(v) =>
                setDraft((d) => {
                  const next = [...d.lubSales];
                  const amount = row.qty && v ? (Number(row.qty) * Number(v)).toFixed(2) : row.amount;
                  next[index] = { ...row, rate: v, amount };
                  return { ...d, lubSales: next };
                })
              }
            />
            <Field
              label={lang === 'bn' ? 'টাকা' : 'Amount'}
              value={row.amount}
              onChange={(v) =>
                setDraft((d) => {
                  const next = [...d.lubSales];
                  next[index] = { ...row, amount: v };
                  return { ...d, lubSales: next };
                })
              }
            />
          </div>
        ))}
      </div>
    </RowList>
  );
}

function ExpenseStep({ context, draft, setDraft }: StepProps) {
  const { lang } = useLang();
  return (
    <RowList
      title={lang === 'bn' ? 'শিফটের খরচ' : 'Expenses for this shift'}
      rows={draft.expenses.length}
      onAdd={() =>
        setDraft((d) => ({ ...d, expenses: [...d.expenses, { categoryId: '', amount: '', description: '', paidBy: 'cash' }] }))
      }
    >
      <div className="space-y-3">
        {draft.expenses.map((row, index) => (
          <div key={index} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-4" style={{ borderColor: 'var(--hairline)' }}>
            <label className="space-y-1 sm:col-span-2">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                {lang === 'bn' ? 'খাত' : 'Category'}
              </span>
              <select
                value={row.categoryId}
                onChange={(e) =>
                  setDraft((d) => {
                    const next = [...d.expenses];
                    next[index] = { ...row, categoryId: e.target.value };
                    return { ...d, expenses: next };
                  })
                }
                className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--hairline)' }}
              >
                <option value="">—</option>
                {context.expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {lang === 'bn' && c.nameBn ? c.nameBn : c.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={lang === 'bn' ? 'টাকা' : 'Amount'}
              value={row.amount}
              onChange={(v) =>
                setDraft((d) => {
                  const next = [...d.expenses];
                  next[index] = { ...row, amount: v };
                  return { ...d, expenses: next };
                })
              }
            />
            <label className="space-y-1">
              <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
                {lang === 'bn' ? 'পরিশোধ' : 'Paid by'}
              </span>
              <select
                value={row.paidBy}
                onChange={(e) =>
                  setDraft((d) => {
                    const next = [...d.expenses];
                    next[index] = { ...row, paidBy: e.target.value };
                    return { ...d, expenses: next };
                  })
                }
                className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--hairline)' }}
              >
                {['cash', 'bank', 'bkash', 'nagad'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label={lang === 'bn' ? 'বিবরণ' : 'Description'}
              value={row.description}
              wide
              onChange={(v) =>
                setDraft((d) => {
                  const next = [...d.expenses];
                  next[index] = { ...row, description: v };
                  return { ...d, expenses: next };
                })
              }
            />
          </div>
        ))}
      </div>
    </RowList>
  );
}

/**
 * Two of these five figures are no longer typed.
 *
 * Opening cash chains from whatever the last shift counted — the drawer is not
 * emptied between shifts, so a manager choosing its opening figure could carry
 * a shortage forward until it disappeared. It is only enterable on the very
 * first close, when there is no previous count to chain from.
 *
 * Dues collected is summed from the payments actually recorded against parties
 * during the shift, and only the ones taken in cash. A typed figure balanced
 * the drawer without any party's ledger moving, and counted a bKash collection
 * as if the notes were in the till.
 */
function CashStep({
  draft,
  setDraft,
  summary,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  summary: CloseSummary | null;
}) {
  const { lang } = useLang();
  const cash = summary?.cash;
  const chained = cash?.opening_source === 'previous_shift';

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {lang === 'bn' ? 'নগদ' : 'Cash'}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        {chained ? (
          <Derived
            label={lang === 'bn' ? 'শুরুর নগদ' : 'Opening cash'}
            value={formatBDT(cash?.opening_cash ?? '0', lang)}
            hint={lang === 'bn' ? 'গত শিফটে যা গোনা হয়েছিল' : 'What the last shift counted'}
          />
        ) : (
          <Field
            label={lang === 'bn' ? 'শুরুর নগদ' : 'Opening cash'}
            value={draft.cash.openingCash}
            onChange={(v) => setDraft((d) => ({ ...d, cash: { ...d.cash, openingCash: v } }))}
            hint={
              lang === 'bn'
                ? 'প্রথম শিফট — প্রারম্ভিক তহবিল একবারই দিতে হবে'
                : 'The first shift: the opening float is typed once, then it chains'
            }
          />
        )}

        <Derived
          label={lang === 'bn' ? 'বাকি আদায় (নগদ)' : 'Dues collected in cash'}
          value={formatBDT(cash?.dues_collected ?? '0', lang)}
          hint={
            lang === 'bn'
              ? 'বাকি পাতায় লেখা আদায় থেকে'
              : 'From the payments recorded on the Dues screen'
          }
        />

        <Field
          label={lang === 'bn' ? 'ব্যাংকে জমা' : 'Bank deposits'}
          value={draft.cash.bankDeposits}
          onChange={(v) => setDraft((d) => ({ ...d, cash: { ...d.cash, bankDeposits: v } }))}
        />
        <Field
          label={lang === 'bn' ? 'গোনা নগদ' : 'Cash counted'}
          value={draft.cash.countedCash}
          onChange={(v) => setDraft((d) => ({ ...d, cash: { ...d.cash, countedCash: v } }))}
        />
      </div>

      {cash && Number(cash.dues_non_cash) > 0 ? (
        <Muted lang={lang}>
          {lang === 'bn'
            ? `আরও ${formatBDT(cash.dues_non_cash, lang)} বিকাশ/ব্যাংকে আদায় হয়েছে — পার্টির বাকি কমেছে, কিন্তু ক্যাশে আসেনি।`
            : `A further ${formatBDT(cash.dues_non_cash, lang)} came in by bKash, bank or cheque. It reduced what those parties owe but never reached the drawer, so it is not counted here.`}
        </Muted>
      ) : null}

      {cash && cash.dues_payment_count === 0 ? (
        <Muted lang={lang}>
          {lang === 'bn'
            ? 'এই শিফটে কোনো আদায় লেখা হয়নি। কেউ টাকা দিয়ে থাকলে বাকি পাতায় আগে লিখুন।'
            : 'No collections were recorded this shift. If a party paid, record it on the Dues screen first — it cannot be entered here.'}
        </Muted>
      ) : null}
    </div>
  );
}

/** A figure the database worked out, shown where a field used to be. */
function Derived({ label, value, hint }: { label: string; value: string; hint: string }) {
  const { lang } = useLang();
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
        {label}
      </span>
      <div
        className="tabular rounded-xl border px-3 py-2 text-sm"
        style={{ borderColor: 'var(--hairline)', color: 'var(--text-muted)' }}
      >
        {value}
      </div>
      <Muted lang={lang}>{hint}</Muted>
    </div>
  );
}

function SummaryStep({
  summary,
  pending,
  draft,
  setDraft,
  signing,
}: {
  summary: CloseSummary | null;
  pending: boolean;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  signing: boolean;
}) {
  const { t, lang } = useLang();

  if (pending && !summary) {
    return (
      <div className="space-y-2">
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-24 w-full" />
      </div>
    );
  }
  if (!summary) return null;

  const s = summary.sales;

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold tracking-tight" lang={lang}>
        {signing ? (lang === 'bn' ? 'স্বাক্ষরের আগে শেষবার দেখুন' : 'Last look before you sign') : t('nav.shiftClose')}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={lang === 'bn' ? 'মোট লিটার' : 'Gross litres'} value={formatLitres(s.gross_litres, lang)} />
        <Stat label={lang === 'bn' ? 'টেস্ট' : 'Test'} value={formatLitres(s.test_litres, lang)} />
        <Stat label={lang === 'bn' ? 'নিট লিটার' : 'Net litres'} value={formatLitres(s.net_litres, lang)} />
        <Stat label={lang === 'bn' ? 'ডিজেল বিক্রি' : 'Diesel sales'} value={formatBDT(s.sales_amount, lang)} />
        <Stat label={lang === 'bn' ? 'লুব্রিকেন্ট' : 'Lubricants'} value={formatBDT(s.lubricant_sales, lang)} />
        <Stat label={lang === 'bn' ? 'বাকি বিক্রি' : 'Credit sales'} value={formatBDT(s.credit_sales, lang)} />
        <Stat label={lang === 'bn' ? 'নগদ বিক্রি' : 'Cash sales'} value={formatBDT(s.cash_sales, lang)} />
        <Stat label={lang === 'bn' ? 'মোট বিক্রি' : 'Total sales'} value={formatBDT(s.total_sales, lang)} />
      </div>

      {/* Per tank: the book chain, the rod, and the gap between them. */}
      <div className="space-y-2">
        {summary.tanks.map((tk) => (
          <div
            key={tk.tank_id}
            className="rounded-xl border p-3"
            style={{ borderColor: tk.variance_flagged ? 'var(--color-breach)' : 'var(--hairline)' }}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">
                {t('tank.tank')} {tk.tank_code}
              </span>
              <Chip tone={tk.variance_flagged ? 'breach' : 'ok'} className="tabular">
                {formatLitres(tk.variance_litres, lang, true)} · {formatPercent(tk.variance_pct, lang)}
              </Chip>
            </div>

            <p className="tabular text-xs" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {formatLitres(tk.book_opening, lang)} {lang === 'bn' ? 'শুরু' : 'opening'} +{' '}
              {formatLitres(tk.refill_litres, lang)} {lang === 'bn' ? 'রিফিল' : 'refill'} −{' '}
              {formatLitres(tk.sold_from_tank, lang)} {lang === 'bn' ? 'বিক্রি' : 'sold'} ={' '}
              <strong>{formatLitres(tk.book_closing, lang)}</strong> {lang === 'bn' ? 'বইয়ে' : 'on the book'} ·{' '}
              <strong>{formatLitres(tk.physical_closing, lang)}</strong> {lang === 'bn' ? 'রডে' : 'on the rod'}
            </p>

            {tk.variance_flagged ? (
              <label className="mt-2 block space-y-1">
                <span className="state-breach flex items-center gap-1 text-xs font-medium" lang={lang}>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {lang === 'bn' ? 'কারণ লিখুন — ছাড়া স্বাক্ষর হবে না' : 'Reason required before sign-off'}
                </span>
                <input
                  value={draft.varianceReasons[tk.tank_id] ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      varianceReasons: { ...d.varianceReasons, [tk.tank_id]: e.target.value },
                    }))
                  }
                  className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                  style={{ borderColor: 'var(--color-breach)' }}
                />
              </label>
            ) : null}
          </div>
        ))}
      </div>

      {/* Cash */}
      <div
        className="rounded-xl border p-3"
        style={{ borderColor: summary.cash.requires_reason ? 'var(--color-breach)' : 'var(--hairline)' }}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'নগদ মিলকরণ' : 'Cash reconciliation'}
          </span>
          <Chip tone={summary.cash.requires_reason ? 'breach' : 'ok'} className="tabular">
            {formatBDT(summary.cash.cash_variance, lang, true)}
          </Chip>
        </div>
        <p className="tabular text-xs" style={{ color: 'var(--text-muted)' }} lang={lang}>
          {formatBDT(summary.cash.opening_cash, lang)} + {formatBDT(summary.cash.cash_sales, lang)} +{' '}
          {formatBDT(summary.cash.dues_collected, lang)} − {formatBDT(summary.cash.expenses_cash, lang)} −{' '}
          {formatBDT(summary.cash.bank_deposits, lang)} = <strong>{formatBDT(summary.cash.expected_cash, lang)}</strong>{' '}
          {lang === 'bn' ? 'প্রত্যাশিত' : 'expected'} · <strong>{formatBDT(summary.cash.counted_cash, lang)}</strong>{' '}
          {lang === 'bn' ? 'গোনা' : 'counted'}
        </p>

        {summary.cash.requires_reason ? (
          <label className="mt-2 block space-y-1">
            <span className="state-breach flex items-center gap-1 text-xs font-medium" lang={lang}>
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {lang === 'bn' ? 'কারণ লিখুন' : 'Reason required'}
            </span>
            <input
              value={draft.cashVarianceReason}
              onChange={(e) => setDraft((d) => ({ ...d, cashVarianceReason: e.target.value }))}
              className="tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--color-breach)' }}
            />
          </label>
        ) : null}
      </div>

      {summary.readings.some((r) => r.is_rollover || r.implausible) ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 state-watch" aria-hidden />
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'একটি বা একাধিক মিটার ঘুরে গেছে বা অস্বাভাবিক — ফিরে গিয়ে যাচাই করুন।'
              : 'One or more meters rolled over or read implausibly. Go back and check them.'}
          </Muted>
        </div>
      ) : null}

      {signing ? (
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'স্বাক্ষরের পর শিফট বন্ধ হয়ে যাবে। কেবল অ্যাডমিন কারণসহ আবার খুলতে পারবেন।'
              : 'Signing off locks the shift. Only an admin can reopen it, with a reason.'}
          </Muted>
        </div>
      ) : null}
    </div>
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
