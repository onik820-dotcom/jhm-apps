'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import { dec, moneyStr } from '@/lib/calc/decimal';

export interface ExpenseResult {
  ok: boolean;
  error?: string;
}

export interface ExpenseInput {
  category_id: string;
  amount: string;
  description?: string;
  paid_by: 'cash' | 'bank' | 'bkash' | 'nagad';
  spent_at?: string;
}

/**
 * An expense paid in cash comes out of the drawer, so the shift it belongs to
 * decides which night's cash it reduces. Stamping the open shift here is what
 * ties the two together; an expense recorded with no shift open still books,
 * but against no particular count.
 */
export async function recordExpense(input: ExpenseInput): Promise<ExpenseResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may record an expense' };
  }
  if (!input.category_id) return { ok: false, error: 'Pick the head this belongs under' };
  if (!input.amount.trim()) return { ok: false, error: 'Enter the amount' };

  const amount = moneyStr(input.amount);
  if (dec(amount).lessThanOrEqualTo(0)) {
    return { ok: false, error: 'An expense must be more than zero' };
  }

  const supabase = await createClient();
  const [{ data: shift }, { data: station }] = await Promise.all([
    supabase.rpc('current_shift_id'),
    supabase.from('stations').select('id').limit(1).single(),
  ]);

  const { error } = await supabase.from('expenses').insert({
    station_id: station?.id ?? null,
    shift_id: shift ?? null,
    category_id: input.category_id,
    amount,
    description: input.description?.trim() || null,
    paid_by: input.paid_by,
    spent_at: input.spent_at?.trim() || new Date().toISOString(),
    // An admin recording their own expense approves it in the same breath; a
    // manager's entry is left unapproved for the owner to look at.
    approved_by: profile.role === 'admin' ? profile.id : null,
    approved_at: profile.role === 'admin' ? new Date().toISOString() : null,
    created_by: profile.id,
  });

  if (error) {
    const message = 'message' in error ? String(error.message) : 'That expense could not be recorded';
    return { ok: false, error: message };
  }

  revalidatePath('/expenses');
  revalidatePath('/cash');
  revalidatePath('/manager');
  revalidatePath('/admin');
  return { ok: true };
}
