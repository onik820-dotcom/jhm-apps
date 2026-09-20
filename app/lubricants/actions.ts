'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import { dec, litresStr, moneyStr } from '@/lib/calc/decimal';

export interface LubResult {
  ok: boolean;
  error?: string;
}

export interface LubMovementInput {
  sku_id: string;
  txn_type: 'purchase' | 'sale' | 'own_use' | 'adjustment';
  qty: string;
  /** Ignored for own use: the database prices that at the shelf's cost. */
  rate?: string;
  customer_id?: string;
  vehicle_ref?: string;
  note?: string;
}

/**
 * One entry point for all four kinds of movement, because they all land in the
 * same table and the database is what decides what each one is worth. Own use
 * in particular is priced by the trigger at the moving average on the shelf —
 * sending a rate from here would let the browser decide what the station's own
 * oil cost it.
 */
export async function recordLubMovement(input: LubMovementInput): Promise<LubResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may move lubricant stock' };
  }
  if (!input.sku_id) return { ok: false, error: 'Pick a product' };
  if (!input.qty.trim()) return { ok: false, error: 'Enter the quantity' };

  const qty = litresStr(input.qty);
  if (input.txn_type !== 'adjustment' && dec(qty).lessThanOrEqualTo(0)) {
    return { ok: false, error: 'The quantity must be more than zero' };
  }
  if (input.txn_type === 'adjustment' && dec(qty).isZero()) {
    return { ok: false, error: 'An adjustment of zero changes nothing' };
  }

  const supabase = await createClient();
  const { data: shift } = await supabase.rpc('current_shift_id');

  const rate =
    input.txn_type === 'own_use' || !input.rate?.trim() ? null : moneyStr(input.rate);

  const { error } = await supabase.from('lub_transactions').insert({
    sku_id: input.sku_id,
    txn_type: input.txn_type,
    qty,
    // Left at zero, the valuing trigger fills in rate and amount from the SKU
    // or from the shelf's cost, whichever is right for this kind of movement.
    rate: rate ?? 0,
    amount: 0,
    shift_id: shift ?? null,
    customer_id: input.txn_type === 'sale' ? input.customer_id || null : null,
    vehicle_ref: input.vehicle_ref?.trim() || null,
    note: input.note?.trim() || null,
    created_by: profile.id,
  });

  if (error) {
    const message = 'message' in error ? String(error.message) : 'That movement could not be recorded';
    return { ok: false, error: message };
  }

  revalidatePath('/lubricants');
  revalidatePath('/expenses');
  revalidatePath('/manager');
  revalidatePath('/admin');
  return { ok: true };
}

export interface SkuRatesInput {
  sku_id: string;
  purchase_rate: string;
  sale_rate: string;
  reorder_level: string;
}

export async function updateSkuRates(input: SkuRatesInput): Promise<LubResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may change a rate' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('lub_skus')
    .update({
      current_purchase_rate: moneyStr(input.purchase_rate || '0'),
      current_sale_rate: moneyStr(input.sale_rate || '0'),
      reorder_level: litresStr(input.reorder_level || '0'),
      updated_by: profile.id,
    })
    .eq('id', input.sku_id);

  if (error) {
    const message = 'message' in error ? String(error.message) : 'Those rates could not be saved';
    return { ok: false, error: message };
  }

  revalidatePath('/lubricants');
  return { ok: true };
}
