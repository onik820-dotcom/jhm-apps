'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import { dec } from '@/lib/calc/decimal';

/**
 * Errors that the UI can say in the reader's own language. Postgres raises in
 * English, and a forecourt in Jashore should not be reading English exception
 * text, so the cases people actually hit are given a code the component can
 * translate. Anything unrecognised falls back to the database's own wording,
 * which is better than swallowing it.
 */
export type ErrorCode = 'DIP_OUT_OF_RANGE' | 'NO_CHART' | 'NOT_ADMIN';

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  code?: ErrorCode;
  data?: T;
}

function classify(message: string): ErrorCode | undefined {
  if (/outside the certified range/i.test(message)) return 'DIP_OUT_OF_RANGE';
  if (/No calibration chart is in force|has no metadata/i.test(message)) return 'NO_CHART';
  if (/Only an admin|insufficient_privilege|row-level security/i.test(message)) return 'NOT_ADMIN';
  return undefined;
}

function fail(error: unknown, fallback: string): ActionResult<never> {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : fallback;
  return { ok: false, error: message, code: classify(message) };
}

// ---------------------------------------------------------------------------
// Dip → litres, resolved by the database against the certified chart
// ---------------------------------------------------------------------------

const dipSchema = z.object({
  tankId: z.string().uuid(),
  dipMm: z
    .string()
    .trim()
    .min(1, 'Enter a dip in millimetres')
    .refine((v) => /^\d+(\.\d+)?$/.test(v), 'A dip is a number of millimetres'),
});

export interface DipConversion {
  dipMm: string;
  litres: string;
  interpolated: boolean;
}

/**
 * Converts through `public.dip_to_litres`, not through the TypeScript mirror.
 * The database is what the shift close and the stock chain will use, so this is
 * the figure worth showing — and any disagreement between the two shows up here
 * rather than at 6am on a forecourt.
 */
export async function convertDip(tankId: string, dipMm: string): Promise<ActionResult<DipConversion>> {
  const parsed = dipSchema.safeParse({ tankId, dipMm });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid dip' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dip_to_litres', {
    p_tank_id: parsed.data.tankId,
    p_dip_mm: parsed.data.dipMm,
  });

  if (error) return fail(error, 'That dip could not be converted');

  const value = dec(data as string);
  return {
    ok: true,
    data: {
      dipMm: parsed.data.dipMm,
      litres: value.toFixed(3),
      interpolated: !dec(parsed.data.dipMm).isInteger(),
    },
  };
}

// ---------------------------------------------------------------------------
// Equipment: add, pause, resume, remove
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  kind: z.enum(['tank', 'dispenser']),
  id: z.string().uuid(),
  status: z.enum(['active', 'paused', 'removed']),
  reason: z.string().trim().max(500).optional(),
});

export async function setEquipmentStatus(input: {
  kind: 'tank' | 'dispenser';
  id: string;
  status: 'active' | 'paused' | 'removed';
  reason?: string;
}): Promise<ActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' };

  if (parsed.data.status === 'removed' && !parsed.data.reason) {
    return { ok: false, error: 'Removing equipment needs a reason' };
  }

  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Only an admin may add, pause or remove equipment' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_equipment_status', {
    p_kind: parsed.data.kind,
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? '',
  });

  if (error) return fail(error, 'That change could not be saved');

  revalidatePath('/stock');
  revalidatePath('/admin');
  return { ok: true };
}

const addTankSchema = z.object({
  code: z.string().trim().min(1, 'A tank needs a code').max(16),
  capacityLitres: z.string().trim().refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'Capacity must be a positive number of litres'),
  finalDipMm: z.coerce.number().int().min(1, 'The final dip must be at least 1 mm').max(20000),
  validityFrom: z.string().trim().min(1, 'The calibration validity start is required'),
  validityTo: z.string().trim().min(1, 'The calibration validity end is required'),
  calibratedBy: z.string().trim().max(200).optional(),
  calibrationOffice: z.string().trim().max(200).optional(),
});

/**
 * A new tank is created inactive. It has no calibration chart yet, and without
 * one no dip on it can be converted, so letting it go straight into service
 * would only produce errors on the forecourt.
 */
export interface AddTankInput {
  code: string;
  capacityLitres: string;
  /** Sent as a string from the form; coerced and range-checked here. */
  finalDipMm: string;
  validityFrom: string;
  validityTo: string;
  calibratedBy?: string;
  calibrationOffice?: string;
}

export async function addTank(input: AddTankInput): Promise<ActionResult<{ id: string }>> {
  const parsed = addTankSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid tank' };

  if (parsed.data.validityTo <= parsed.data.validityFrom) {
    return { ok: false, error: 'The calibration validity must end after it starts' };
  }

  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') return { ok: false, error: 'Only an admin may add a tank' };

  const supabase = await createClient();

  const { data: station } = await supabase.from('stations').select('id').limit(1).maybeSingle();

  const { data: tank, error } = await supabase
    .from('tanks')
    .insert({
      station_id: station?.id ?? null,
      code: parsed.data.code,
      product: 'diesel',
      capacity_litres: parsed.data.capacityLitres,
      status: 'paused',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !tank) return fail(error, 'The tank could not be added');

  const { error: metaError } = await supabase.from('tank_metadata').insert({
    tank_id: tank.id,
    final_dip_mm: parsed.data.finalDipMm,
    validity_from: parsed.data.validityFrom,
    validity_to: parsed.data.validityTo,
    calibrated_by: parsed.data.calibratedBy || null,
    calibration_office: parsed.data.calibrationOffice || null,
    created_by: profile.id,
  });

  if (metaError) return fail(metaError, 'The tank was added but its calibration details were not');

  revalidatePath('/stock');
  revalidatePath('/admin');
  return { ok: true, data: { id: tank.id } };
}

const addDispenserSchema = z.object({
  code: z.string().trim().min(1, 'A dispenser needs a code').max(16),
  tankId: z.string().uuid('Pick the tank this dispenser draws from'),
  nozzleCount: z.coerce.number().int().min(1).max(8),
  meterDigits: z.coerce.number().int().min(4).max(12),
  maxFlowLpm: z.string().trim().refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Max flow must be a positive number'),
});

export interface AddDispenserInput {
  code: string;
  tankId: string;
  nozzleCount: string;
  meterDigits: string;
  maxFlowLpm: string;
}

export async function addDispenser(input: AddDispenserInput): Promise<ActionResult<{ id: string }>> {
  const parsed = addDispenserSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid dispenser' };

  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') return { ok: false, error: 'Only an admin may add a dispenser' };

  const supabase = await createClient();
  const { data: station } = await supabase.from('stations').select('id').limit(1).maybeSingle();

  const { data: dispenser, error } = await supabase
    .from('dispensers')
    .insert({
      station_id: station?.id ?? null,
      code: parsed.data.code,
      tank_id: parsed.data.tankId,
      nozzle_count: parsed.data.nozzleCount,
      meter_digits: parsed.data.meterDigits,
      max_flow_lpm: parsed.data.maxFlowLpm,
      status: 'active',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !dispenser) return fail(error, 'The dispenser could not be added');

  // Every dispenser needs its nozzles, or no meter reading can be attached.
  const nozzles = Array.from({ length: parsed.data.nozzleCount }, (_, i) => ({
    dispenser_id: dispenser.id,
    nozzle_no: i + 1,
    product: 'diesel',
    created_by: profile.id,
  }));

  const { error: nozzleError } = await supabase.from('nozzles').insert(nozzles);
  if (nozzleError) return fail(nozzleError, 'The dispenser was added but its nozzles were not');

  revalidatePath('/stock');
  revalidatePath('/admin');
  return { ok: true, data: { id: dispenser.id } };
}

// ---------------------------------------------------------------------------
// Correcting a certified calibration row
// ---------------------------------------------------------------------------

const calibrationRowSchema = z.object({
  tankId: z.string().uuid(),
  version: z.coerce.number().int().min(1),
  dipMm: z.coerce.number().int().min(1),
  litres: z.string().trim().refine((v) => /^\d+(\.\d{1,3})?$/.test(v), 'Litres must be a number'),
  reason: z.string().trim().min(3, 'Changing a certified row needs a reason'),
});

export interface CalibrationRowInput {
  tankId: string;
  version: number;
  dipMm: number;
  litres: string;
  reason: string;
}

export async function upsertCalibrationRow(input: CalibrationRowInput): Promise<ActionResult> {
  const parsed = calibrationRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid row' };

  const profile = await getSessionProfile();
  if (profile?.role !== 'admin') return { ok: false, error: 'Only an admin may change a calibration chart' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_calibration_row', {
    p_tank_id: parsed.data.tankId,
    p_version: parsed.data.version,
    p_dip_mm: parsed.data.dipMm,
    p_litres: parsed.data.litres,
    p_reason: parsed.data.reason,
  });

  if (error) return fail(error, 'That calibration row could not be saved');

  revalidatePath(`/stock/${parsed.data.tankId}`);
  return { ok: true };
}
