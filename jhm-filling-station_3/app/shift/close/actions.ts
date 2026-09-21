'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getSessionProfile } from '@/lib/supabase/server';

/**
 * The wizard's payload, as the database functions expect it. Every figure
 * travels as a string so nothing passes through a JavaScript float on the way.
 */
export interface ClosePayload {
  rate_per_litre: string;
  readings: Array<{ nozzle_id: string; closing: string; test_litres: string }>;
  dips: Array<{ tank_id: string; dip_mm: string }>;
  credit_sales: Array<{
    customer_id: string;
    litres?: string;
    rate?: string;
    amount: string;
    vehicle_no?: string;
    challan_no?: string;
  }>;
  lubricant_sales: Array<{ sku_id: string; qty: string; rate?: string; amount: string; customer_id?: string }>;
  expenses: Array<{ category_id: string; amount: string; description?: string; paid_by?: string }>;
  cash: {
    /**
     * Read only on the very first close. Once a shift has been closed the
     * database chains the opening from that shift's count and ignores this.
     */
    opening_cash: string;
    bank_deposits: string;
    counted_cash: string;
  };
  variance_reasons?: Record<string, string>;
  cash_variance_reason?: string;
}

export interface CloseSummary {
  readings: Array<{
    nozzle_id: string;
    dispenser_code: string;
    nozzle_no: number;
    tank_id: string;
    opening: number;
    closing: number;
    litres: number;
    test_litres: number;
    is_rollover: boolean;
    implausible: boolean;
    max_possible: number;
  }>;
  sales: {
    gross_litres: string;
    test_litres: string;
    net_litres: string;
    rate_per_litre: string;
    sales_amount: string;
    lubricant_sales: string;
    credit_sales: string;
    total_sales: string;
    cash_sales: string;
  };
  tanks: Array<{
    tank_id: string;
    tank_code: string;
    dip_mm: string;
    book_opening: string;
    refill_litres: string;
    sold_from_tank: string;
    book_closing: string;
    physical_closing: string;
    variance_litres: string;
    variance_pct: string | null;
    variance_flagged: boolean;
  }>;
  expenses: { total: string; cash: string };
  cash: {
    opening_cash: string;
    /** 'previous_shift' once a shift has been closed; 'entered' only for the first. */
    opening_source: 'previous_shift' | 'entered';
    cash_sales: string;
    /** Cash collected from parties during this shift, summed from payment rows. */
    dues_collected: string;
    /** Collected by bKash, bank or cheque — real money, but not in the drawer. */
    dues_non_cash: string;
    dues_payment_count: number;
    expenses_cash: string;
    bank_deposits: string;
    expected_cash: string;
    counted_cash: string;
    cash_variance: string;
    requires_reason: boolean;
  };
  thresholds: { variance_pct: string; cash_tolerance: string };
  closed?: boolean;
}

export interface CloseResult {
  ok: boolean;
  error?: string;
  summary?: CloseSummary;
}

function fail(error: unknown, fallback: string): CloseResult {
  const message =
    typeof error === 'object' && error && 'message' in error ? String(error.message) : fallback;
  return { ok: false, error: message };
}

/**
 * The reconciliation summary, computed by the database and writing nothing.
 * The same function runs again inside close_shift, so what is shown here is
 * what gets stored.
 */
export async function previewClose(shiftId: string, payload: ClosePayload): Promise<CloseResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may close a shift' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('compute_shift_close', {
    p_shift_id: shiftId,
    p_payload: payload,
  });

  if (error) return fail(error, 'The close could not be worked out');
  return { ok: true, summary: data as CloseSummary };
}

/** Sign-off. Refused by the database if a flagged variance has no reason. */
export async function submitClose(shiftId: string, payload: ClosePayload): Promise<CloseResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may close a shift' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('close_shift', {
    p_shift_id: shiftId,
    p_payload: payload,
  });

  if (error) return fail(error, 'The shift could not be closed');

  revalidatePath('/manager');
  revalidatePath('/admin');
  revalidatePath('/stock');
  revalidatePath('/shift/close');
  return { ok: true, summary: data as CloseSummary };
}

export async function reopenShift(shiftId: string, reason: string): Promise<CloseResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an admin may reopen a closed shift' };
  }
  if (reason.trim().length < 3) {
    return { ok: false, error: 'Reopening a shift needs a reason' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('reopen_shift', { p_shift_id: shiftId, p_reason: reason.trim() });
  if (error) return fail(error, 'That shift could not be reopened');

  revalidatePath('/manager');
  revalidatePath('/admin');
  revalidatePath('/shift/close');
  return { ok: true };
}

export interface RecalcRow {
  out_shift_id: string;
  out_tank_id: string;
  out_book_opening: string;
  out_book_closing: string;
  out_variance_litres: string | null;
}

/**
 * Rebuild the book chain from a shift forward. Needed after any correction to
 * a closed shift, because every later shift's opening stock moves with it.
 */
export async function recalculateFrom(shiftId: string): Promise<{ ok: boolean; error?: string; rows?: RecalcRow[] }> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an admin may recalculate the stock chain' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recalculate_from', { p_shift_id: shiftId });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/stock');
  revalidatePath('/admin');
  return { ok: true, rows: (data ?? []) as RecalcRow[] };
}
