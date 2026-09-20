'use client';

import { createStore, get, set, del, keys } from 'idb-keyval';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The forecourt loses signal. Nothing a dispenser submits may depend on having
 * it: a reading or a dip is written to IndexedDB first, and the queue is
 * flushed whenever the phone can reach the server again.
 *
 * Every item carries a `client_ref` — its own id — and both target tables have
 * a unique index on that column. Re-sending is therefore free: the second
 * attempt collides and is treated as already delivered, so a flaky connection
 * cannot produce two readings for one photograph.
 */

/**
 * Its own database, not a second store inside a shared one: idb-keyval creates
 * a database with exactly the one store it is given, so two stores sharing a
 * database name means whichever one opens second cannot find its store.
 */
const store = createStore('jhm-offline-queue', 'queue');

export type QueueKind = 'meter' | 'dip';

export interface MeterPayload {
  kind: 'meter';
  shiftId: string;
  nozzleId: string;
  readingType: 'open' | 'close';
  reading: string;
  isRollover: boolean;
  aiExtracted: Record<string, unknown> | null;
  aiConfidence: number | null;
}

export interface DipPayload {
  kind: 'dip';
  shiftId: string | null;
  tankId: string;
  dipType: 'open' | 'close' | 'pre_refill' | 'post_refill';
  dipMm: string;
  /** What the cached chart said at capture time; the server recomputes it. */
  localLitres: string | null;
}

export type QueuePayload = MeterPayload | DipPayload;

export interface QueueItem {
  id: string;
  kind: QueueKind;
  payload: QueuePayload;
  photo: Blob | null;
  photoName: string | null;
  recordedAt: string;
  attempts: number;
  lastError: string | null;
  /** Set when the server refused it for a reason retrying will not fix. */
  blocked: boolean;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `q-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function enqueue(item: Omit<QueueItem, 'attempts' | 'lastError' | 'blocked'>): Promise<void> {
  await set(item.id, { ...item, attempts: 0, lastError: null, blocked: false } satisfies QueueItem, store);
}

export async function listQueue(): Promise<QueueItem[]> {
  const ids = await keys(store);
  const items = await Promise.all(ids.map((id) => get<QueueItem>(id as string, store)));
  return items
    .filter((item): item is QueueItem => Boolean(item))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function queueCount(): Promise<{ pending: number; blocked: number }> {
  const items = await listQueue();
  return {
    pending: items.filter((i) => !i.blocked).length,
    blocked: items.filter((i) => i.blocked).length,
  };
}

export async function removeItem(id: string): Promise<void> {
  await del(id, store);
}

async function markFailed(item: QueueItem, message: string, blocked: boolean): Promise<void> {
  await set(item.id, { ...item, attempts: item.attempts + 1, lastError: message, blocked }, store);
}

interface PostgrestError {
  code?: string;
  message?: string;
}

/** 23505 is a unique violation: this row already arrived on an earlier attempt. */
function isDuplicate(error: PostgrestError | null): boolean {
  return error?.code === '23505';
}

/**
 * A policy refusal will not fix itself by retrying — most often the phone was
 * offline across a shift change, and the shift the reading belongs to is closed.
 * That needs a manager, not another attempt.
 */
function isBlocking(error: PostgrestError | null): boolean {
  if (!error) return false;
  return (
    error.code === '42501' ||
    /row-level security|violates row-level security/i.test(error.message ?? '')
  );
}

async function uploadPhoto(
  supabase: SupabaseClient,
  item: QueueItem,
  bucket: string,
  prefix: string,
): Promise<string | null> {
  if (!item.photo) return null;
  const path = `${prefix}/${item.id}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, item.photo, {
    contentType: item.photo.type || 'image/jpeg',
    upsert: true,
  });
  // A photo that will not upload must not hold up the number it belongs to:
  // the reading is the record, the photograph is the evidence beside it.
  if (error) return null;
  return `${bucket}/${path}`;
}

export interface FlushResult {
  sent: number;
  failed: number;
  blocked: number;
  remaining: number;
}

export async function flushQueue(supabase: SupabaseClient, userId: string): Promise<FlushResult> {
  const items = await listQueue();
  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (const item of items) {
    if (item.blocked) {
      blocked += 1;
      continue;
    }

    try {
      if (item.payload.kind === 'meter') {
        const payload = item.payload;
        const photoUrl = await uploadPhoto(supabase, item, 'meter-photos', payload.shiftId);

        const { error } = await supabase.from('meter_readings').insert({
          shift_id: payload.shiftId,
          nozzle_id: payload.nozzleId,
          reading_type: payload.readingType,
          reading: payload.reading,
          photo_url: photoUrl,
          ai_extracted: payload.aiExtracted,
          ai_confidence: payload.aiConfidence,
          is_rollover: payload.isRollover,
          recorded_by: userId,
          created_by: userId,
          client_ref: item.id,
        });

        if (error && !isDuplicate(error)) {
          if (isBlocking(error)) {
            await markFailed(item, error.message, true);
            blocked += 1;
          } else {
            await markFailed(item, error.message, false);
            failed += 1;
          }
          continue;
        }
      } else {
        const payload = item.payload;
        const photoUrl = await uploadPhoto(supabase, item, 'dip-photos', payload.tankId);

        const { error } = await supabase.from('tank_dips').insert({
          shift_id: payload.shiftId,
          tank_id: payload.tankId,
          dip_type: payload.dipType,
          dip_mm: payload.dipMm,
          // The trigger recomputes this from the certified chart; sending zero
          // keeps the NOT NULL happy without ever being the number of record.
          litres: 0,
          photo_url: photoUrl,
          recorded_by: userId,
          created_by: userId,
          recorded_at: item.recordedAt,
          client_ref: item.id,
        });

        if (error && !isDuplicate(error)) {
          if (isBlocking(error)) {
            await markFailed(item, error.message, true);
            blocked += 1;
          } else {
            await markFailed(item, error.message, false);
            failed += 1;
          }
          continue;
        }
      }

      await removeItem(item.id);
      sent += 1;
    } catch (error) {
      // Almost always the network dropping again mid-flush. Leave it queued.
      await markFailed(item, error instanceof Error ? error.message : 'Could not reach the server', false);
      failed += 1;
    }
  }

  const left = await listQueue();
  return { sent, failed, blocked, remaining: left.length };
}
