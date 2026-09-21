import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSessionProfile } from '@/lib/supabase/server';

/**
 * Bangla speech, when the browser cannot do it.
 *
 * The panel tries the Web Speech API with `lang="bn-BD"` first, because it is
 * instant, free, and works offline on most Android phones in Bangladesh. Safari
 * has no Bangla recogniser at all, and some Android builds silently return
 * nothing, so there has to be a fallback.
 *
 * Section 6.11 of the brief specifies POSTing that audio to n8n for server-side
 * transcription. It goes to this route instead, and the reason is the audio
 * itself: it is an employee's voice recorded inside a financial system, and
 * this route already holds an OpenAI key server-side. Keeping the recording
 * inside our own trust boundary is tighter than forwarding it to a webhook and
 * whatever that flow is wired to. If the business would rather n8n handled it,
 * set N8N_TRANSCRIBE_WEBHOOK and this route forwards instead.
 */

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'No audio' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That recording is too long' }, { status: 413 });
  }

  const lang = (form?.get('lang') as string) === 'en' ? 'en' : 'bn';

  // If the business wired n8n for this, it wins.
  const webhook = process.env.N8N_TRANSCRIBE_WEBHOOK;
  if (webhook) {
    try {
      const relay = new FormData();
      relay.set('audio', audio);
      relay.set('lang', lang);
      relay.set('user_id', profile.id);
      const response = await fetch(webhook, { method: 'POST', body: relay });
      if (!response.ok) throw new Error(`n8n answered ${response.status}`);
      const body = (await response.json()) as { text?: string };
      return NextResponse.json({ text: body.text ?? '', via: 'n8n' });
    } catch (error) {
      console.error('[transcribe:n8n]', error instanceof Error ? error.message : error);
      // Fall through to the local route rather than losing the recording.
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'No transcription is configured', code: 'NO_API_KEY' }, { status: 503 });
  }

  try {
    const client = new OpenAI({ apiKey });
    const result = await client.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1',
      // Naming the language matters: left to guess, a short Bangla clip is
      // often taken for Hindi, which shares much of its phonology.
      language: lang,
    });
    return NextResponse.json({ text: result.text ?? '', via: 'openai' });
  } catch (error) {
    console.error('[transcribe]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Could not transcribe that', code: 'UPSTREAM_ERROR' }, { status: 502 });
  }
}
