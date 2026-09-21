import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { timingSafeEqual } from '@/lib/n8n/guard';

/**
 * Pushing the outbound queue to n8n.
 *
 * The app is the system of record and Google Sheets is a mirror. That ordering
 * is the whole design: a shift closes locally in one transaction, an event row
 * lands in `sync_queue`, and this route carries it onward afterwards. If n8n is
 * down the shift is still closed, the money is still right, and the row waits.
 * Nothing here can roll back a local write, because nothing here touches one.
 *
 * Vercel cron calls it every five minutes with a GET. Safe to run twice at
 * once: claim_sync_batch takes its rows FOR UPDATE SKIP LOCKED, so two passes
 * never fight over the same event, and every payload carries the idempotency
 * key n8n dedupes on.
 */

export const maxDuration = 60;

interface QueueRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
}

function authorised(request: NextRequest): boolean {
  // Vercel signs its own cron calls with a header no outside caller can set.
  if (request.headers.get('x-vercel-cron')) return true;

  const secret = process.env.SYNC_DRAIN_SECRET ?? process.env.N8N_INBOUND_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  return offered.length > 0 && timingSafeEqual(offered, secret);
}

async function drain() {
  const webhook = process.env.N8N_EVENT_WEBHOOK;
  if (!webhook) {
    // Not an error. Until the mirror is wired the queue simply fills, and
    // nothing about the station's own records depends on it.
    return NextResponse.json({
      ok: true,
      skipped: 'N8N_EVENT_WEBHOOK is not set, so there is nowhere to mirror to',
    });
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set, so the queue cannot be drained' },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc('claim_sync_batch', { p_limit: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as QueueRow[];
  let sent = 0;
  let failed = 0;
  let gaveUp = 0;

  for (const row of rows) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': row.idempotency_key,
          ...(process.env.N8N_INBOUND_SECRET
            ? { 'X-JHM-Secret': process.env.N8N_INBOUND_SECRET }
            : {}),
        },
        body: JSON.stringify({
          event: row.event_type,
          occurred_at: new Date().toISOString(),
          idempotency_key: row.idempotency_key,
          attempt: row.attempts,
          data: row.payload,
        }),
        // A hung webhook must not hold the whole batch.
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error(`n8n answered ${response.status}`);

      await supabase.rpc('mark_sync_sent', { p_id: row.id });
      sent += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      const { data: outcome } = await supabase.rpc('mark_sync_failed', {
        p_id: row.id,
        p_error: detail,
      });
      failed += 1;
      if ((outcome as { gave_up?: boolean } | null)?.gave_up) gaveUp += 1;
    }
  }

  const { data: health } = await supabase.rpc('sync_health');
  return NextResponse.json({ ok: true, claimed: rows.length, sent, failed, gaveUp, health });
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  return drain();
}

/**
 * The cron path. A GET from anywhere else reports the mirror's health without
 * draining, which is what you want when checking on it from a browser.
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  if (request.headers.get('x-vercel-cron')) return drain();

  try {
    const supabase = createAdminClient();
    const { data } = await supabase.rpc('sync_health');
    return NextResponse.json({ ok: true, health: data });
  } catch {
    return NextResponse.json({ error: 'Service role key is not set' }, { status: 503 });
  }
}
