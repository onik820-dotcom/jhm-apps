import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import {
  PROPOSAL_TOOLS,
  TOOL_SCHEMAS,
  runTool,
  systemPrompt,
  type Proposal,
  type ToolContext,
} from '@/lib/chat/tools';

/**
 * The chat turn.
 *
 * The key, like the Anthropic key in the meter OCR route, lives only here.
 * The browser never sees it and never talks to OpenAI directly.
 *
 * Two boundaries hold regardless of what the model decides to do:
 *
 *   Reads run on the caller's Supabase client, so RLS answers. A manager
 *   asking for profit gets the same refusal the screen would give them.
 *
 *   Writes do not happen. The model can only *propose*, and a proposal is
 *   returned to the browser as a card. Confirming it goes through the ordinary
 *   server action.
 *
 * Tool results are data, not instructions. A customer called "ignore previous
 * instructions" is a string in a JSON payload, and the model is told in its
 * system prompt that every figure must come from a tool — there is nothing a
 * row could say that would let it write, because no tool here writes.
 */

const Body = z.object({
  session_id: z.string().uuid(),
  message: z.string().min(1).max(2000),
  lang: z.enum(['bn', 'en']).optional(),
  /** Set when the text came from the microphone rather than the keyboard. */
  spoken: z.boolean().optional(),
});

/** Four rounds is enough for "find the party, then read its balance". */
const MAX_ROUNDS = 4;

export async function POST(request: NextRequest) {
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request', detail: parsed.error.issues }, { status: 400 });
  }
  const { session_id, message, lang: bodyLang, spoken } = parsed.data;
  const lang = bodyLang ?? profile.languagePref;

  const supabase = await createClient();

  // The question is kept whether or not the answer works. A conversation with
  // the gaps removed is a conversation nobody can audit.
  await supabase.from('chat_messages').insert({
    session_id,
    user_id: profile.id,
    role: 'user',
    content: message,
    content_lang: lang,
  });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const reply =
      lang === 'bn'
        ? 'চ্যাটের জন্য OPENAI_API_KEY এখনো দেওয়া হয়নি, তাই প্রশ্নের উত্তর দিতে পারছি না। সব হিসাব স্ক্রিনে আছে।'
        : 'No OPENAI_API_KEY is set, so I cannot answer questions yet. Every figure is still on the screens.';
    await supabase.from('chat_messages').insert({
      session_id,
      user_id: profile.id,
      role: 'assistant',
      content: reply,
      content_lang: lang,
    });
    return NextResponse.json({ reply, code: 'NO_API_KEY' }, { status: 200 });
  }

  const ctx: ToolContext = { supabase, role: profile.role, lang };
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  // The last few turns, so "and the other tank?" means something.
  const { data: history } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(12);

  const priorTurns = ((history ?? []) as Array<{ role: string; content: string }>)
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content }));

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt(ctx, profile.fullName) },
    ...priorTurns,
  ];

  let proposal: Proposal | null = null;
  const toolsUsed: string[] = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const completion = await client.chat.completions.create({
        model,
        messages,
        tools: TOOL_SCHEMAS,
        // Enough for a couple of figures and a sentence; this is not an essay.
        max_tokens: 700,
        temperature: 0.2,
      });

      const choice = completion.choices[0]?.message;
      if (!choice) break;

      messages.push(choice);
      const calls = choice.tool_calls ?? [];

      if (calls.length === 0) {
        const reply = choice.content?.trim() || fallbackReply(lang);
        await supabase.from('chat_messages').insert({
          session_id,
          user_id: profile.id,
          role: 'assistant',
          content: reply,
          content_lang: lang,
        });
        return NextResponse.json({ reply, proposal, toolsUsed, spoken: spoken ?? false });
      }

      for (const call of calls) {
        if (call.type !== 'function') continue;
        const name = call.function.name;
        toolsUsed.push(name);

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          // A malformed tool call is the model's mistake, not a crash.
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: 'Arguments were not valid JSON.' }),
          });
          continue;
        }

        const result = await runTool(name, args, ctx);

        if (PROPOSAL_TOOLS.has(name) && 'proposal' in result) {
          proposal = result.proposal;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              prepared: true,
              note: 'A confirmation card has been shown. Nothing is saved until the person taps it.',
              summary: result.proposal.summary,
            }),
          });
        } else {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }
    }

    // Ran out of rounds with the model still calling tools.
    const reply = fallbackReply(lang);
    await supabase.from('chat_messages').insert({
      session_id,
      user_id: profile.id,
      role: 'assistant',
      content: reply,
      content_lang: lang,
    });
    return NextResponse.json({ reply, proposal, toolsUsed });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown';
    const reply =
      lang === 'bn'
        ? 'উত্তর আনতে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন — সব হিসাব স্ক্রিনে আছে।'
        : 'I could not reach the assistant just now. Try again shortly — every figure is still on the screens.';
    await supabase.from('chat_messages').insert({
      session_id,
      user_id: profile.id,
      role: 'assistant',
      content: reply,
      content_lang: lang,
    });
    // The person gets a usable answer; the detail goes to the server log.
    console.error('[chat]', detail);
    return NextResponse.json({ reply, code: 'UPSTREAM_ERROR' }, { status: 200 });
  }
}

function fallbackReply(lang: 'bn' | 'en') {
  return lang === 'bn'
    ? 'এটা বের করতে পারলাম না। প্রশ্নটা একটু অন্যভাবে বলুন।'
    : 'I could not work that out. Try asking it a different way.';
}
