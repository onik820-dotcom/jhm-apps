'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { dec } from '@/lib/calc/decimal';
import { Muted } from '@/components/ui/glass';
import type { CreditParty } from '@/lib/data/money';
import { saveParty } from '@/app/dues/actions';

const INPUT = 'tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none';
const BORDER = { borderColor: 'var(--hairline)' } as const;

/**
 * Adding a party, or turning one of the 21 seeded placeholders into a real
 * one. The opening balance is the figure from the paper ledger at go-live, and
 * the date beside it is what makes ageing mean anything — without it, a debt
 * carried for a year looks the same as one from last Tuesday.
 */
export function PartyForm({ party, onClose }: { party: CreditParty | null; onClose: () => void }) {
  const { t, lang } = useLang();
  const router = useRouter();

  const [name, setName] = useState(party?.name ?? '');
  const [nameBn, setNameBn] = useState(party?.nameBn ?? '');
  const [type, setType] = useState<'company' | 'individual' | 'govt'>(
    (party?.type as 'company' | 'individual' | 'govt') ?? 'company',
  );
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [vehicles, setVehicles] = useState((party?.vehicleNumbers ?? []).join(', '));
  const [limit, setLimit] = useState(party?.creditLimit ?? '0');
  const [opening, setOpening] = useState(party?.openingBalance ?? '0');
  const [openingAsOf, setOpeningAsOf] = useState(party?.openingBalanceAsOf ?? '');
  const [active, setActive] = useState(party?.isActive ?? true);
  const [notes, setNotes] = useState(party?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Once a party has moved, its opening balance is the foot of a chain that
  // has already been built on. The database refuses to change it; the form
  // says so rather than letting someone type into a field that will throw.
  const openingLocked = Boolean(party) && !dec(party?.balance ?? '0').equals(dec(party?.openingBalance ?? '0'));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await saveParty({
      id: party?.id,
      name,
      name_bn: nameBn,
      type,
      phone,
      vehicle_numbers: vehicles,
      credit_limit: limit,
      opening_balance: openingLocked ? (party?.openingBalance ?? '0') : opening,
      opening_balance_as_of: openingAsOf,
      is_active: active,
      notes,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t('common.error'));
      return;
    }
    router.refresh();
    onClose();
  };

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
      <div className="glass max-h-[92vh] w-full max-w-xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight" lang={lang}>
            {party ? t('dues.editParty') : t('dues.newParty')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="tap-target ml-auto rounded-lg p-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={lang === 'bn' ? 'নাম (ইংরেজি)' : 'Name'}>
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} style={BORDER} />
            </Field>
            <Field label={lang === 'bn' ? 'নাম (বাংলা)' : 'Name in Bangla'}>
              <input value={nameBn} onChange={(e) => setNameBn(e.target.value)} className={INPUT} style={BORDER} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={lang === 'bn' ? 'ধরন' : 'Type'}>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className={INPUT}
                style={BORDER}
              >
                <option value="company">{lang === 'bn' ? 'কোম্পানি' : 'Company'}</option>
                <option value="individual">{lang === 'bn' ? 'ব্যক্তি' : 'Individual'}</option>
                <option value="govt">{lang === 'bn' ? 'সরকারি' : 'Government'}</option>
              </select>
            </Field>
            <Field label={lang === 'bn' ? 'ফোন' : 'Phone'}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} style={BORDER} />
            </Field>
          </div>

          <Field
            label={lang === 'bn' ? 'গাড়ির নম্বর' : 'Vehicle numbers'}
            hint={lang === 'bn' ? 'কমা দিয়ে আলাদা করুন' : 'Separated by commas'}
          >
            <input value={vehicles} onChange={(e) => setVehicles(e.target.value)} className={INPUT} style={BORDER} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label={t('dues.limit')}
              hint={dec(limit || '0').isZero() ? t('dues.noLimit') : undefined}
            >
              <input
                value={limit}
                inputMode="decimal"
                onChange={(e) => setLimit(e.target.value)}
                className={INPUT}
                style={BORDER}
              />
            </Field>
            <Field
              label={t('dues.openingBalance')}
              hint={openingLocked ? t('dues.openingFixed') : undefined}
            >
              <input
                value={opening}
                inputMode="decimal"
                disabled={openingLocked}
                onChange={(e) => setOpening(e.target.value)}
                className={`${INPUT} disabled:opacity-50`}
                style={BORDER}
              />
            </Field>
            <Field
              label={t('dues.openingAsOf')}
              hint={
                !openingAsOf && !dec(opening || '0').isZero()
                  ? lang === 'bn'
                    ? 'না দিলে বয়স অনুমান হবে'
                    : 'Without this the ageing is a guess'
                  : undefined
              }
            >
              <input
                type="date"
                value={openingAsOf}
                onChange={(e) => setOpeningAsOf(e.target.value)}
                className={INPUT}
                style={BORDER}
              />
            </Field>
          </div>

          <Field label={lang === 'bn' ? 'মন্তব্য' : 'Notes'}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`${INPUT} resize-none`}
              style={BORDER}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span lang={lang}>
              {lang === 'bn'
                ? 'সক্রিয় — বাকিতে বিক্রি করা যাবে'
                : 'Active — credit sales may be booked against this party'}
            </span>
          </label>

          {error ? <p className="state-breach text-sm">{error}</p> : null}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="tap-target w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            lang={lang}
          >
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const { lang } = useLang();
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
        {label}
      </span>
      {children}
      {hint ? <Muted lang={lang}>{hint}</Muted> : null}
    </label>
  );
}
