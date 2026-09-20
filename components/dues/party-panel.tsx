'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate } from '@/lib/format';
import { dec } from '@/lib/calc/decimal';
import { Chip, EmptyState, Muted, Skeleton } from '@/components/ui/glass';
import type { CreditParty } from '@/lib/data/money';
import {
  adjustBalance,
  checkHeadroom,
  getStatement,
  recordCreditSale,
  recordPayment,
  type HeadroomResult,
  type StatementLine,
} from '@/app/dues/actions';

type Tab = 'statement' | 'payment' | 'sale' | 'adjust';

export function PartyPanel({
  party,
  isAdmin,
  onClose,
  onEdit,
}: {
  party: CreditParty;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('statement');
  const [lines, setLines] = useState<StatementLine[] | null>(null);

  useEffect(() => {
    let live = true;
    getStatement(party.id).then((r) => {
      if (live) setLines(r.lines ?? []);
    });
    return () => {
      live = false;
    };
  }, [party.id]);

  const done = () => {
    router.refresh();
    onClose();
  };

  const balance = dec(party.balance);

  const tabs: Array<[Tab, string]> = [
    ['statement', t('dues.statement')],
    ['payment', t('dues.takePayment')],
    ['sale', t('dues.recordSale')],
    ...(isAdmin ? ([['adjust', t('dues.adjust')]] as Array<[Tab, string]>) : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass max-h-[92vh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {lang === 'bn' && party.nameBn ? party.nameBn : party.name}
            </h2>
            <Muted className="tabular mt-0.5">
              {party.vehicleNumbers.length > 0 ? party.vehicleNumbers.join(' · ') : party.phone ?? ''}
            </Muted>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              aria-label={t('dues.editParty')}
              className="tap-target rounded-lg p-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.cancel')}
              className="tap-target rounded-lg p-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* ---- balance and ageing ---- */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Figure
            label={t('dues.balance')}
            value={formatBDT(balance.abs().toFixed(2), lang)}
            hint={balance.lessThan(0) ? t('dues.inAdvance') : undefined}
            tone={balance.lessThan(0) ? 'ok' : undefined}
          />
          <Figure
            label={t('dues.limit')}
            value={dec(party.creditLimit).greaterThan(0) ? formatBDT(party.creditLimit, lang) : '—'}
            hint={dec(party.creditLimit).greaterThan(0) ? undefined : t('dues.noLimit')}
          />
          <Figure
            label={`${t('dues.ageing')} 0–30`}
            value={formatBDT(party.bucket0to30, lang)}
          />
          <Figure
            label={`${t('dues.ageing')} 90+`}
            value={formatBDT(party.bucket90plus, lang)}
            tone={dec(party.bucket90plus).greaterThan(0) ? 'breach' : undefined}
          />
        </div>

        {!party.openingDated && dec(party.openingBalance).greaterThan(0) ? (
          <Muted className="state-watch mb-3" lang={lang}>
            {t('dues.openingUndated')}
          </Muted>
        ) : null}

        {/* ---- tabs ---- */}
        <div className="mb-3 flex flex-wrap gap-1">
          {tabs.map(([key, label]) => (
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
              {label}
            </button>
          ))}
        </div>

        {tab === 'statement' ? <Statement lines={lines} /> : null}
        {tab === 'payment' ? <PaymentForm party={party} onDone={done} /> : null}
        {tab === 'sale' ? <CreditSaleForm party={party} isAdmin={isAdmin} onDone={done} /> : null}
        {tab === 'adjust' && isAdmin ? <AdjustForm party={party} onDone={done} /> : null}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'watch' | 'breach';
}) {
  const { lang } = useLang();
  return (
    <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--hairline)' }}>
      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }} lang={lang}>
        {label}
      </p>
      <p className={`tabular text-sm font-semibold ${tone ? `state-${tone}` : ''}`}>{value}</p>
      {hint ? <Muted lang={lang}>{hint}</Muted> : null}
    </div>
  );
}

function Statement({ lines }: { lines: StatementLine[] | null }) {
  const { t, lang } = useLang();

  if (lines === null) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }
  if (lines.length === 0) return <EmptyState title={t('common.empty')} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--text-faint)' }}>
            <th className="px-2 py-1.5 text-left font-medium" lang={lang}>
              {lang === 'bn' ? 'তারিখ' : 'Date'}
            </th>
            <th className="px-2 py-1.5 text-left font-medium" lang={lang}>
              {lang === 'bn' ? 'বিবরণ' : 'Particulars'}
            </th>
            <th className="px-2 py-1.5 text-right font-medium" lang={lang}>
              {lang === 'bn' ? 'ডেবিট' : 'Debit'}
            </th>
            <th className="px-2 py-1.5 text-right font-medium" lang={lang}>
              {lang === 'bn' ? 'ক্রেডিট' : 'Credit'}
            </th>
            <th className="px-2 py-1.5 text-right font-medium" lang={lang}>
              {t('dues.balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
              <td className="tabular whitespace-nowrap px-2 py-1.5">{formatDate(l.entryDate, lang)}</td>
              <td className="px-2 py-1.5">
                <Chip tone={l.entryType === 'payment' ? 'ok' : 'neutral'}>{l.entryType}</Chip>
                {l.description ? <span className="ml-1.5">{l.description}</span> : null}
              </td>
              <td className="tabular px-2 py-1.5 text-right">
                {dec(l.debit).isZero() ? '' : formatBDT(l.debit, lang)}
              </td>
              <td className="tabular px-2 py-1.5 text-right">
                {dec(l.credit).isZero() ? '' : formatBDT(l.credit, lang)}
              </td>
              <td className="tabular px-2 py-1.5 text-right font-medium">
                {formatBDT(l.runningBalance, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const { lang } = useLang();
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
        {label}
      </span>
      {children}
      {hint ? <Muted className="mt-1" lang={lang}>{hint}</Muted> : null}
    </label>
  );
}

const INPUT = 'tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none';
const INPUT_STYLE = { borderColor: 'var(--hairline)' } as const;

function PaymentForm({ party, onDone }: { party: CreditParty; onDone: () => void }) {
  const { t, lang } = useLang();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bkash' | 'nagad' | 'bank' | 'cheque'>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await recordPayment({
      customer_id: party.id,
      amount,
      method,
      reference,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('common.error'));
      return;
    }
    // A payment taken with no shift open still reduces the party's balance,
    // but it is not counted in tonight's drawer, and saying so here is
    // cheaper than a manager wondering later why the cash did not agree.
    if (result.data && result.data.inShift === false) {
      setNotice(
        lang === 'bn'
          ? 'কোনো শিফট চালু নেই, তাই এটি আজকের নগদ হিসাবে গণনা হবে না।'
          : 'No shift is open, so this is not counted in tonight’s cash.',
      );
      setTimeout(onDone, 2200);
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dues.amount')}>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
            placeholder="0.00"
          />
        </Field>
        <Field label={t('dues.method')}>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
            className={INPUT}
            style={INPUT_STYLE}
          >
            <option value="cash">Cash</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
      </div>

      <Field
        label={t('dues.reference')}
        hint={
          method === 'cash'
            ? undefined
            : lang === 'bn'
              ? 'এই টাকা ক্যাশ বাক্সে আসেনি, তাই শিফটের নগদ হিসাবে ধরা হবে না।'
              : 'This does not reach the drawer, so it is not counted in the shift’s cash.'
        }
      >
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={INPUT}
          style={INPUT_STYLE}
          placeholder={method === 'cheque' ? 'Cheque no.' : 'TrxID / slip'}
        />
      </Field>

      {error ? <p className="state-breach text-sm">{error}</p> : null}
      {notice ? <p className="state-watch text-sm">{notice}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !amount.trim()}
        className="tap-target w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--color-accent)', color: 'white' }}
        lang={lang}
      >
        {busy ? t('common.loading') : t('dues.takePayment')}
      </button>
    </div>
  );
}

function CreditSaleForm({
  party,
  isAdmin,
  onDone,
}: {
  party: CreditParty;
  isAdmin: boolean;
  onDone: () => void;
}) {
  const { t, lang } = useLang();
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [rate, setRate] = useState('');
  const [vehicle, setVehicle] = useState(party.vehicleNumbers[0] ?? '');
  const [challan, setChallan] = useState('');
  const [reason, setReason] = useState('');
  const [headroom, setHeadroom] = useState<HeadroomResult['headroom'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Ask the database what this sale would do, using the same function the
  // trigger will use a moment later, so the form and the rule cannot disagree.
  useEffect(() => {
    if (!amount.trim()) {
      setHeadroom(null);
      return;
    }
    const timer = setTimeout(() => {
      checkHeadroom(party.id, amount).then((r) => setHeadroom(r.headroom ?? null));
    }, 250);
    return () => clearTimeout(timer);
  }, [party.id, amount]);

  const blocked = headroom?.exceeded && !isAdmin;
  const needsReason = headroom?.exceeded && isAdmin;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await recordCreditSale({
      customer_id: party.id,
      amount,
      litres,
      rate,
      vehicle_no: vehicle,
      challan_no: challan,
      over_limit_reason: needsReason ? reason : undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('common.error'));
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('dues.litres')}>
          <input
            type="text"
            inputMode="decimal"
            value={litres}
            onChange={(e) => setLitres(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
            placeholder="0.000"
          />
        </Field>
        <Field label={t('dues.rate')}>
          <input
            type="text"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
            placeholder="0.00"
          />
        </Field>
        <Field label={t('dues.amount')}>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
            placeholder="0.00"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('dues.vehicle')}>
          <input
            type="text"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </Field>
        <Field label={t('dues.challan')}>
          <input
            type="text"
            value={challan}
            onChange={(e) => setChallan(e.target.value)}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </Field>
      </div>

      {headroom ? (
        <div
          className="rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <p className="tabular" lang={lang}>
            {lang === 'bn' ? 'এই বিক্রির পর বাকি দাঁড়াবে' : 'After this sale the party owes'}{' '}
            <strong>{formatBDT(headroom.projected_balance, lang)}</strong>
            {headroom.limit_set ? (
              <>
                {' '}
                {lang === 'bn' ? 'সীমা' : 'against a limit of'}{' '}
                {formatBDT(headroom.credit_limit, lang)}
                {headroom.available && dec(headroom.available).greaterThanOrEqualTo(0) ? (
                  <>
                    {' — '}
                    {formatBDT(headroom.available, lang)} {t('dues.available')}
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {blocked ? (
        <p className="state-breach text-sm" lang={lang}>
          {t('dues.ownerOnly')}
        </p>
      ) : null}

      {needsReason ? (
        <Field label={t('dues.approveOverLimit')} hint={t('common.reason')}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={`${INPUT} resize-none`}
            style={INPUT_STYLE}
          />
        </Field>
      ) : null}

      {error ? <p className="state-breach text-sm">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !amount.trim() || blocked || (needsReason && !reason.trim())}
        className="tap-target w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--color-accent)', color: 'white' }}
        lang={lang}
      >
        {busy ? t('common.loading') : t('dues.recordSale')}
      </button>
    </div>
  );
}

function AdjustForm({ party, onDone }: { party: CreditParty; onDone: () => void }) {
  const { t, lang } = useLang();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await adjustBalance(party.id, amount, reason);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('common.error'));
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      <Field label={t('dues.amount')} hint={t('dues.adjustHint')}>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={INPUT}
          style={INPUT_STYLE}
          placeholder="-0.00"
        />
      </Field>
      <Field label={t('common.reason')}>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className={`${INPUT} resize-none`}
          style={INPUT_STYLE}
        />
      </Field>

      {error ? <p className="state-breach text-sm">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !amount.trim() || !reason.trim()}
        className="tap-target w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
        style={{ background: 'var(--color-accent)', color: 'white' }}
        lang={lang}
      >
        {busy ? t('common.loading') : t('dues.adjust')}
      </button>
    </div>
  );
}
