'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Plus } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { formatBDT, formatDate } from '@/lib/format';
import { Chip, EmptyState, GlassCard, Muted } from '@/components/ui/glass';
import type { ExpenseBook, ExpenseCategory, ExpenseRow } from '@/lib/data/money';
import { recordExpense } from './actions';

type Period = 'day' | 'month' | 'year';
type Book = 'pump' | 'own_use' | 'chairman';

const INPUT = 'tabular tap-target w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none';
const BORDER = { borderColor: 'var(--hairline)' } as const;

/**
 * Three books, kept apart.
 *
 * The Pump book is what the station spends to run: salaries, electricity,
 * repairs. The Chairman book is what the owner draws out. Own use is oil the
 * station put into its own lorries — neither a cost the manager answers for
 * nor money the owner took, so it stands on its own.
 *
 * They are never added into a single "expenses" total. Only the first is what
 * it costs to run the pump, and mixing them would quietly change what the
 * station appears to earn.
 *
 * The Own use book is read-only: those rows are written by the lubricant
 * module when oil is issued, so the form never offers that head. An expense
 * typed there would be oil nobody actually issued.
 */
export function ExpensesScreen({
  book,
  categories,
}: {
  book: ExpenseBook;
  categories: ExpenseCategory[];
}) {
  const { t, lang } = useLang();
  const [period, setPeriod] = useState<Period>('month');
  const [which, setWhich] = useState<Book>('pump');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(
    () =>
      book.rows.filter((r) =>
        which === 'chairman'
          ? r.group === 'chairman'
          : which === 'own_use'
            ? r.group === 'own_use'
            : r.group !== 'chairman' && r.group !== 'own_use',
      ),
    [book.rows, which],
  );

  const periodLabels: Record<Period, string> = {
    day: lang === 'bn' ? 'আজ' : 'Day',
    month: lang === 'bn' ? 'এ মাস' : 'Month',
    year: lang === 'bn' ? 'এ বছর' : 'Year',
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-3">
        {(['pump', 'own_use', 'chairman'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setWhich(key)}
            className="glass glass-lift w-full p-4 text-left sm:p-5"
            style={which === key ? { outline: '2px solid var(--color-accent)' } : undefined}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t(
                key === 'pump'
                  ? 'expenses.pumpBook'
                  : key === 'own_use'
                    ? 'expenses.ownUseBook'
                    : 'expenses.chairmanBook',
              )}
            </p>
            <p className="tabular mt-1 text-2xl font-semibold tracking-tight">
              {formatBDT(book.totals[period][key] ?? '0', lang)}
            </p>
            <Muted className="mt-1" lang={lang}>
              {periodLabels[period]}
            </Muted>
          </button>
        ))}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--text-muted)' }}
            lang={lang}
          >
            {t(
              which === 'pump'
                ? 'expenses.pumpBook'
                : which === 'own_use'
                  ? 'expenses.ownUseBook'
                  : 'expenses.chairmanBook',
            )}
          </h2>

          <div className="ml-auto flex gap-1">
            {(['day', 'month', 'year'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                lang={lang}
                className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
                style={
                  period === key
                    ? { background: 'var(--color-accent)', color: 'white' }
                    : { color: 'var(--text-muted)' }
                }
              >
                {periodLabels[key]}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="tap-target flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            lang={lang}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('expenses.record')}
          </button>
        </div>

        <GlassCard lift={false}>
          {rows.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r) => (
                    <ExpenseLine key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </section>

      {adding ? (
        <ExpenseForm
          categories={categories.filter((c) =>
            which === 'chairman'
              ? c.group === 'chairman'
              : c.group !== 'chairman' && c.group !== 'own_use',
          )}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function ExpenseLine({ row }: { row: ExpenseRow }) {
  const { t, lang } = useLang();
  return (
    <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
      <td className="px-2 py-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">
            {lang === 'bn' && row.categoryNameBn ? row.categoryNameBn : row.categoryName}
          </span>
          {row.isDerived ? (
            <span title={t('expenses.derivedHint')}>
              <Chip>
                <Lock className="mr-1 inline h-3 w-3" aria-hidden />
                {t('expenses.derived')}
              </Chip>
            </span>
          ) : null}
        </span>
        {row.description ? (
          <Muted className="mt-0.5">
            {lang === 'bn' && row.descriptionBn ? row.descriptionBn : row.description}
          </Muted>
        ) : null}
      </td>
      <td className="px-2 py-2">
        <Chip tone={row.paidBy === 'cash' ? 'ok' : 'neutral'}>{row.paidBy}</Chip>
      </td>
      <td className="tabular whitespace-nowrap px-2 py-2 text-right" style={{ color: 'var(--text-faint)' }}>
        {formatDate(row.spentAt, lang)}
      </td>
      <td className="tabular px-2 py-2 text-right font-medium">{formatBDT(row.amount, lang)}</td>
    </tr>
  );
}

function ExpenseForm({
  categories,
  onClose,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paidBy, setPaidBy] = useState<'cash' | 'bank' | 'bkash' | 'nagad'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await recordExpense({
      category_id: categoryId,
      amount,
      description,
      paid_by: paidBy,
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
      <div className="glass w-full max-w-lg space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold tracking-tight" lang={lang}>
          {t('expenses.record')}
        </h2>

        <label className="block space-y-1">
          <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('expenses.category')}
          </span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={INPUT}
            style={BORDER}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {lang === 'bn' && c.nameBn ? c.nameBn : c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('dues.amount')}
            </span>
            <input
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              className={INPUT}
              style={BORDER}
              placeholder="0.00"
            />
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
              {t('expenses.paidBy')}
            </span>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value as typeof paidBy)}
              className={INPUT}
              style={BORDER}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="bkash">bKash</option>
              <option value="nagad">Nagad</option>
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }} lang={lang}>
            {t('expenses.description')}
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={INPUT}
            style={BORDER}
          />
        </label>

        {paidBy === 'cash' ? (
          <Muted lang={lang}>
            {lang === 'bn'
              ? 'নগদ খরচ চালু শিফটের ক্যাশ থেকে বাদ যাবে।'
              : 'A cash expense comes out of the open shift’s drawer.'}
          </Muted>
        ) : null}

        {error ? <p className="state-breach text-sm">{error}</p> : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-target flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={BORDER}
            lang={lang}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !amount.trim() || !categoryId}
            className="tap-target flex-1 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40"
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
