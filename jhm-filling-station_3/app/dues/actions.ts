'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import { dec, moneyStr, litresStr } from '@/lib/calc/decimal';

/**
 * Credit parties, payments and credit sales.
 *
 * Every amount crosses into the database as a fixed-point string. The forms
 * hand over strings, decimal.js rounds them to the column's scale, and nothing
 * here is ever a JavaScript number — the moment one is, a paisa can go missing
 * and nothing will say so.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

function fail(error: unknown, fallback: string): ActionResult {
  const message =
    typeof error === 'object' && error && 'message' in error ? String(error.message) : fallback;
  return { ok: false, error: message };
}

function refresh() {
  revalidatePath('/dues');
  revalidatePath('/cash');
  revalidatePath('/manager');
  revalidatePath('/admin');
  revalidatePath('/md');
}

async function requireOps() {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') return null;
  return profile;
}

// ---------------------------------------------------------------------------
// Live headroom, so the form can say what will happen before it happens
// ---------------------------------------------------------------------------

export interface HeadroomResult {
  ok: boolean;
  error?: string;
  headroom?: {
    customer_id: string;
    name: string;
    is_active: boolean;
    credit_limit: string;
    limit_set: boolean;
    balance: string;
    projected_balance: string;
    available: string | null;
    utilisation_pct: string | null;
    exceeded: boolean;
    needs_owner_approval: boolean;
  };
}

export async function checkHeadroom(customerId: string, amount: string): Promise<HeadroomResult> {
  if (!(await requireOps())) return { ok: false, error: 'Not allowed' };
  if (!customerId) return { ok: false, error: 'Pick a party first' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('check_credit_headroom', {
    p_customer_id: customerId,
    p_amount: amount.trim() === '' ? '0' : moneyStr(amount),
  });
  if (error) return fail(error, 'Could not work out the credit headroom');
  return { ok: true, headroom: data as HeadroomResult['headroom'] };
}

// ---------------------------------------------------------------------------
// The statement, fetched when a party is opened rather than for all 21 at once
// ---------------------------------------------------------------------------

export interface StatementLine {
  id: string;
  entryDate: string;
  entryType: string;
  description: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

export async function getStatement(
  customerId: string,
): Promise<{ ok: boolean; error?: string; lines?: StatementLine[] }> {
  if (!(await requireOps())) return { ok: false, error: 'Not allowed' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_ledger')
    .select('id, entry_date, entry_type, description, debit, credit, running_balance, entry_seq')
    .eq('customer_id', customerId)
    .order('entry_seq', { ascending: false })
    .limit(200);

  if (error) return fail(error, 'That statement could not be read');

  return {
    ok: true,
    lines: (data ?? [])
      .map((r) => ({
        id: r.id,
        entryDate: r.entry_date,
        entryType: r.entry_type,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        runningBalance: r.running_balance,
      }))
      .reverse(),
  };
}

// ---------------------------------------------------------------------------
// Taking money in
// ---------------------------------------------------------------------------

export interface PaymentInput {
  customer_id: string;
  amount: string;
  method: 'cash' | 'bkash' | 'nagad' | 'bank' | 'cheque' | 'adjustment';
  reference?: string;
  note?: string;
}

export async function recordPayment(input: PaymentInput): Promise<ActionResult> {
  const profile = await requireOps();
  if (!profile) return { ok: false, error: 'Only a manager or an admin may take a payment' };
  if (!input.customer_id) return { ok: false, error: 'Pick a party' };
  if (!input.amount.trim()) return { ok: false, error: 'Enter the amount received' };

  const amount = moneyStr(input.amount);
  if (dec(amount).lessThanOrEqualTo(0)) {
    return { ok: false, error: 'A payment must be more than zero' };
  }

  const supabase = await createClient();

  // Stamping the open shift is what lets the cash reconciliation count this
  // against the drawer. A payment with no shift still reduces the party's
  // balance but is not claimed as cash counted tonight.
  const { data: shift } = await supabase.rpc('current_shift_id');

  const { data, error } = await supabase
    .from('payments')
    .insert({
      customer_id: input.customer_id,
      amount,
      method: input.method,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      shift_id: shift ?? null,
      received_by: profile.id,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error) return fail(error, 'That payment could not be recorded');

  refresh();
  return { ok: true, data: { id: data.id, inShift: Boolean(shift) } };
}

// ---------------------------------------------------------------------------
// Selling on credit
// ---------------------------------------------------------------------------

export interface CreditSaleInput {
  customer_id: string;
  amount: string;
  litres?: string;
  rate?: string;
  vehicle_no?: string;
  challan_no?: string;
  /** Only an admin may set these, and the database checks that again. */
  over_limit_reason?: string;
}

export async function recordCreditSale(input: CreditSaleInput): Promise<ActionResult> {
  const profile = await requireOps();
  if (!profile) return { ok: false, error: 'Only a manager or an admin may record a credit sale' };
  if (!input.customer_id) return { ok: false, error: 'Pick a party' };
  if (!input.amount.trim()) return { ok: false, error: 'Enter the amount' };

  const supabase = await createClient();
  const { data: shift } = await supabase.rpc('current_shift_id');
  if (!shift) {
    return {
      ok: false,
      error: 'No shift is open, so there is nothing to book this sale against. Open a shift first.',
    };
  }

  const approving = Boolean(input.over_limit_reason?.trim()) && profile.role === 'admin';

  const { data, error } = await supabase
    .from('credit_sales')
    .insert({
      shift_id: shift,
      customer_id: input.customer_id,
      amount: moneyStr(input.amount),
      litres: input.litres?.trim() ? litresStr(input.litres) : null,
      rate: input.rate?.trim() ? moneyStr(input.rate) : null,
      vehicle_no: input.vehicle_no?.trim() || null,
      challan_no: input.challan_no?.trim() || null,
      over_limit_approved_by: approving ? profile.id : null,
      over_limit_reason: approving ? input.over_limit_reason?.trim() : null,
      created_by: profile.id,
    })
    .select('id, balance_before, balance_after')
    .single();

  if (error) return fail(error, 'That sale could not be recorded');

  refresh();
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// The parties themselves
// ---------------------------------------------------------------------------

export interface PartyInput {
  id?: string;
  name: string;
  name_bn?: string;
  type: 'company' | 'individual' | 'govt';
  phone?: string;
  address?: string;
  vehicle_numbers?: string;
  credit_limit: string;
  opening_balance: string;
  opening_balance_as_of?: string;
  is_active: boolean;
  notes?: string;
}

export async function saveParty(input: PartyInput): Promise<ActionResult> {
  const profile = await requireOps();
  if (!profile) return { ok: false, error: 'Only a manager or an admin may edit a party' };
  if (!input.name.trim()) return { ok: false, error: 'A party needs a name' };

  const supabase = await createClient();
  const row = {
    name: input.name.trim(),
    name_bn: input.name_bn?.trim() || null,
    type: input.type,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    vehicle_numbers: (input.vehicle_numbers ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    credit_limit: moneyStr(input.credit_limit || '0'),
    opening_balance: moneyStr(input.opening_balance || '0'),
    opening_balance_as_of: input.opening_balance_as_of?.trim() || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
  };

  if (input.id) {
    const { error } = await supabase
      .from('customers')
      .update({ ...row, updated_by: profile.id })
      .eq('id', input.id);
    if (error) return fail(error, 'That party could not be saved');
  } else {
    const { data: station } = await supabase.from('stations').select('id').limit(1).single();
    const { error } = await supabase
      .from('customers')
      .insert({ ...row, station_id: station?.id ?? null, created_by: profile.id });
    if (error) return fail(error, 'That party could not be created');
  }

  refresh();
  return { ok: true };
}

export async function adjustBalance(
  customerId: string,
  amount: string,
  reason: string,
): Promise<ActionResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') return { ok: false, error: 'Only the owner may adjust a balance' };
  if (!reason.trim()) return { ok: false, error: 'Write why this balance is being adjusted' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('post_customer_adjustment', {
    p_customer_id: customerId,
    p_amount: moneyStr(amount),
    p_reason: reason.trim(),
  });
  if (error) return fail(error, 'That adjustment could not be posted');

  refresh();
  return { ok: true, data: data as Record<string, unknown> };
}
