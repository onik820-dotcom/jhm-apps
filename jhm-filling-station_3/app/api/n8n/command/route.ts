import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { guardInbound } from '@/lib/n8n/guard';
import { moneyStr, litresStr, dec } from '@/lib/calc/decimal';

/**
 * A write arriving from an n8n flow — an expense logged over WhatsApp, say.
 *
 * THE POINT OF THIS ROUTE IS WHAT IT REFUSES TO DO.
 *
 * It holds a service-role key, which bypasses RLS entirely. Using that key to
 * perform the write would mean a flow could book an expense as nobody, against
 * no role, with none of the rules that apply to a person doing the same thing
 * on a screen. So the key is used for exactly one thing — resolving who the
 * actor is — and then the route mints a token for *that person* and does the
 * write as them. Every policy, trigger and audit row behaves as if they had
 * typed it, because as far as the database is concerned they did.
 *
 * The consequence is worth stating plainly: a flow cannot make a dispenser
 * book an expense, because a dispenser may not. A flow cannot push a party
 * past its credit limit, because the trigger still fires. The shared secret
 * gets you to the door, not past the rules.
 */

const Body = z.object({
  command: z.enum(['expense.create', 'credit_sale.create', 'payment.receive']),
  actor_id: z.string().uuid(),
  idempotency_key: z.string().min(8).max(200),
  data: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const guard = guardInbound(request);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request', detail: parsed.error.issues }, { status: 400 });
  }
  const { command, actor_id, idempotency_key, data } = parsed.data;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Service role key is not set' }, { status: 503 });
  }

  // ---- already done? ------------------------------------------------------
  const { data: seen } = await admin
    .from('idempotency_keys')
    .select('response')
    .eq('key', idempotency_key)
    .maybeSingle();

  if (seen) {
    return NextResponse.json({ ...(seen as { response: object }).response, replayed: true });
  }

  // ---- who is asking ------------------------------------------------------
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, is_active, deleted_at')
    .eq('id', actor_id)
    .maybeSingle();

  const actor = profile as { id: string; role: string; is_active: boolean; deleted_at: string | null } | null;
  if (!actor || !actor.is_active || actor.deleted_at) {
    return NextResponse.json({ error: 'That actor has no active profile' }, { status: 403 });
  }

  // ---- become them --------------------------------------------------------
  // A one-off session for the actor, so the write goes through RLS as theirs.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: await emailFor(admin, actor.id),
  });

  if (linkError || !link) {
    return NextResponse.json({ error: 'Could not act as that user' }, { status: 500 });
  }

  const asUser = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { error: verifyError } = await asUser.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError) {
    return NextResponse.json({ error: 'Could not act as that user' }, { status: 500 });
  }

  // ---- do the thing, as them ---------------------------------------------
  let result: { ok: boolean; error?: string; id?: string };

  try {
    switch (command) {
      case 'expense.create': {
        const { data: station } = await asUser.from('stations').select('id').limit(1).single();
        const { data: shift } = await asUser.rpc('current_shift_id');
        const { data: row, error } = await asUser
          .from('expenses')
          .insert({
            station_id: (station as { id: string } | null)?.id ?? null,
            shift_id: shift ?? null,
            category_id: String(data.category_id ?? ''),
            amount: moneyStr(String(data.amount ?? '0')),
            description: data.description ? String(data.description) : null,
            paid_by: String(data.paid_by ?? 'cash'),
            created_by: actor.id,
          })
          .select('id')
          .single();
        result = error ? { ok: false, error: error.message } : { ok: true, id: (row as { id: string }).id };
        break;
      }

      case 'credit_sale.create': {
        const { data: shift } = await asUser.rpc('current_shift_id');
        if (!shift) {
          result = { ok: false, error: 'No shift is open, so there is nothing to book this against' };
          break;
        }
        const { data: row, error } = await asUser
          .from('credit_sales')
          .insert({
            shift_id: shift,
            customer_id: String(data.customer_id ?? ''),
            amount: moneyStr(String(data.amount ?? '0')),
            litres: data.litres ? litresStr(String(data.litres)) : null,
            rate: data.rate ? moneyStr(String(data.rate)) : null,
            vehicle_no: data.vehicle_no ? String(data.vehicle_no) : null,
            challan_no: data.challan_no ? String(data.challan_no) : null,
            created_by: actor.id,
          })
          .select('id')
          .single();
        result = error ? { ok: false, error: error.message } : { ok: true, id: (row as { id: string }).id };
        break;
      }

      case 'payment.receive': {
        const amount = moneyStr(String(data.amount ?? '0'));
        if (dec(amount).lessThanOrEqualTo(0)) {
          result = { ok: false, error: 'A payment must be more than zero' };
          break;
        }
        const { data: shift } = await asUser.rpc('current_shift_id');
        const { data: row, error } = await asUser
          .from('payments')
          .insert({
            customer_id: String(data.customer_id ?? ''),
            amount,
            method: String(data.method ?? 'cash'),
            reference: data.reference ? String(data.reference) : null,
            shift_id: shift ?? null,
            received_by: actor.id,
            created_by: actor.id,
          })
          .select('id')
          .single();
        result = error ? { ok: false, error: error.message } : { ok: true, id: (row as { id: string }).id };
        break;
      }
    }
  } finally {
    await asUser.auth.signOut();
  }

  // ---- remember the answer, so a retry returns it rather than writing twice
  await admin.from('idempotency_keys').insert({
    key: idempotency_key,
    route: '/api/n8n/command',
    user_id: actor.id,
    request_hash: await hashOf(JSON.stringify({ command, data })),
    response: result,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

async function emailFor(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data.user?.email ?? '';
}

async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
