'use client';

import { createStore, get, set } from 'idb-keyval';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The certified chart, cached on the phone.
 *
 * A dispenser needs to see the litres for a dip while standing at the rod, and
 * the forecourt is exactly where the signal goes. The chart is small — about
 * 2,000 integers per tank — and it only changes when a tank is re-calibrated,
 * so it is fetched once and kept.
 *
 * What the phone shows is a local convenience. The figure of record is always
 * the one the database computes when the dip syncs, from the chart version in
 * force at the moment the dip was taken.
 */

/** Its own database — see the note in queue.ts on idb-keyval and store names. */
const store = createStore('jhm-offline-charts', 'charts');

export interface CachedChart {
  tankId: string;
  tankCode: string;
  version: number;
  finalDipMm: number;
  /** Index i holds the litres at dip (i + 1) mm. */
  litres: number[];
  cachedAt: string;
}

const key = (tankId: string) => `chart:${tankId}`;

export async function getCachedChart(tankId: string): Promise<CachedChart | null> {
  return (await get<CachedChart>(key(tankId), store)) ?? null;
}

/**
 * Fetch and cache a tank's chart. Rows come back in pages because PostgREST
 * caps a response at 1,000 rows by default, and a chart is twice that.
 */
export async function cacheChart(
  supabase: SupabaseClient,
  tank: { id: string; code: string; finalDipMm: number },
): Promise<CachedChart | null> {
  const { data: versionRow } = await supabase
    .from('tank_calibration')
    .select('version')
    .eq('tank_id', tank.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = versionRow?.version ?? 1;
  const litres = new Array<number>(tank.finalDipMm);
  const PAGE = 1000;

  for (let from = 0; from < tank.finalDipMm; from += PAGE) {
    const { data, error } = await supabase
      .from('tank_calibration')
      .select('dip_mm, litres')
      .eq('tank_id', tank.id)
      .eq('version', version)
      .order('dip_mm')
      .range(from, Math.min(from + PAGE - 1, tank.finalDipMm - 1));

    if (error || !data) return null;

    for (const row of data as Array<{ dip_mm: number; litres: string }>) {
      litres[row.dip_mm - 1] = Number(row.litres);
    }
  }

  // Refuse to cache a chart with a hole in it — a missing millimetre would
  // read as zero litres at the rod.
  for (let i = 0; i < tank.finalDipMm; i++) {
    if (typeof litres[i] !== 'number' || Number.isNaN(litres[i])) return null;
  }

  const chart: CachedChart = {
    tankId: tank.id,
    tankCode: tank.code,
    version,
    finalDipMm: tank.finalDipMm,
    litres,
    cachedAt: new Date().toISOString(),
  };

  await set(key(tank.id), chart, store);
  return chart;
}

export interface LocalConversion {
  litres: number;
  interpolated: boolean;
}

/**
 * Dip to litres from the cached chart, matching the rules the database uses:
 * an exact lookup on a whole millimetre, linear interpolation between the two
 * bracketing rows otherwise, and a refusal outside this tank's own range.
 */
export function convertLocally(chart: CachedChart, dipMm: number): LocalConversion | null {
  if (!Number.isFinite(dipMm) || dipMm < 1 || dipMm > chart.finalDipMm) return null;

  if (Number.isInteger(dipMm)) {
    const exact = chart.litres[dipMm - 1];
    return typeof exact === 'number' ? { litres: exact, interpolated: false } : null;
  }

  const lower = Math.floor(dipMm);
  const upper = Math.ceil(dipMm);
  const lo = chart.litres[lower - 1];
  const hi = chart.litres[upper - 1];
  if (typeof lo !== 'number' || typeof hi !== 'number') return null;

  return { litres: lo + (hi - lo) * (dipMm - lower), interpolated: true };
}
