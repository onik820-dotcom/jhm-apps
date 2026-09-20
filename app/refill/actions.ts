'use server';

import { revalidatePath } from 'next/cache';
import { createClient, getSessionProfile } from '@/lib/supabase/server';

export interface DeliveryCompartmentInput {
  compartment_no: number;
  declared_litres: string;
  tank_id: string;
  dip_before_mm: string;
  dip_after_mm: string;
}

export interface DeliveryInput {
  po_number?: string;
  challan_no?: string;
  truck_reg?: string;
  driver_name?: string;
  depot_rate: string;
  arrived_at?: string;
  notes?: string;
  compartments: DeliveryCompartmentInput[];
}

export interface DeliveryPreview {
  depot_rate: string;
  arrived_at: string;
  compartments: Array<{
    compartment_no: number;
    tank_id: string;
    tank_code: string;
    declared_litres: string;
    litres_before: string;
    litres_after: string;
    received_litres: string;
    shortage_litres: string;
    shortage_pct: string | null;
    shortage_flagged: boolean;
    safe_limit_litres: string;
    over_safe_limit: boolean;
    headroom_before: string;
  }>;
  tanks: Array<{
    tank_id: string;
    tank_code: string;
    stock_before: string;
    received_litres: string;
    stock_after: string;
    /** Present only for admin and MD; a manager is not shown cost. */
    old_avg_cost?: string;
    new_avg_cost?: string;
    cost_basis?: 'moving_average' | 'first_delivery_depot_rate';
    depot_rate?: string;
  }>;
  totals: {
    declared: string;
    received: string;
    shortage: string;
    shortage_pct: string | null;
    purchase_value: string;
  };
  thresholds: { shortage_pct: string; overfill_pct: string };
  delivery_id?: string;
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
  preview?: DeliveryPreview;
}

function fail(error: unknown, fallback: string): DeliveryResult {
  const message =
    typeof error === 'object' && error && 'message' in error ? String(error.message) : fallback;
  return { ok: false, error: message };
}

function usable(input: DeliveryInput) {
  return {
    ...input,
    compartments: input.compartments.filter(
      (c) => c.tank_id && c.dip_before_mm.trim() && c.dip_after_mm.trim(),
    ),
  };
}

/**
 * Live figures as the dips are typed, computed by the database and writing
 * nothing. record runs the same function first, so what the form shows is what
 * gets stored.
 */
export async function previewDelivery(input: DeliveryInput): Promise<DeliveryResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may record a delivery' };
  }

  const payload = usable(input);
  if (payload.compartments.length === 0) {
    return { ok: false, error: 'Enter the dips for at least one compartment' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('compute_tanker_delivery', { p_payload: payload });
  if (error) return fail(error, 'That delivery could not be worked out');
  return { ok: true, preview: data as DeliveryPreview };
}

export async function recordDelivery(input: DeliveryInput): Promise<DeliveryResult> {
  const profile = await getSessionProfile();
  if (profile?.role !== 'manager' && profile?.role !== 'admin') {
    return { ok: false, error: 'Only a manager or an admin may record a delivery' };
  }

  const payload = usable(input);
  if (payload.compartments.length === 0) {
    return { ok: false, error: 'Enter the dips for at least one compartment' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('record_tanker_delivery', { p_payload: payload });
  if (error) return fail(error, 'That delivery could not be recorded');

  revalidatePath('/refill');
  revalidatePath('/stock');
  revalidatePath('/manager');
  revalidatePath('/admin');
  return { ok: true, preview: data as DeliveryPreview };
}
