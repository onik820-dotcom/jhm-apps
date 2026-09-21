import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { guardInbound } from '@/lib/n8n/guard';

/**
 * An assistant reply arriving from an n8n flow.
 *
 * Used when a conversation started somewhere the app is not — a WhatsApp
 * message, say — and the answer has to land in the right chat session so the
 * person sees it next time they open the panel.
 *
 * It writes one `chat_messages` row and nothing else. A route that could be
 * called by anything holding a shared secret is not a route that should be
 * able to touch money.
 */

const Body = z.object({
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  content: z.string().min(1).max(4000),
  content_lang: z.enum(['bn', 'en']).optional(),
  n8n_request_id: z.string().max(200).optional(),
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
  const body = parsed.data;

  let supabase;
  try {
    supabase = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Service role key is not set' }, { status: 503 });
  }

  // The user has to exist. A reply addressed to nobody is a reply that would
  // sit in the table forever with no way to read it.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', body.user_id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: 'No such user' }, { status: 404 });
  }

  // n8n_request_id is how a flow avoids delivering the same reply twice.
  if (body.n8n_request_id) {
    const { data: existing } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('n8n_request_id', body.n8n_request_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, deduped: true, id: (existing as { id: string }).id });
    }
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: body.session_id,
      user_id: body.user_id,
      role: 'assistant',
      content: body.content,
      content_lang: body.content_lang ?? 'bn',
      n8n_request_id: body.n8n_request_id ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}
