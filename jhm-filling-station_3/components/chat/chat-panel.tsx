'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, MessageCircle, Mic, Send, X } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { Chip, Muted } from '@/components/ui/glass';
import { useVoiceInput } from './voice-input';

/**
 * The assistant panel.
 *
 * Bottom-right on a desktop, a full-height sheet on a phone. It carries the
 * one thing that makes a chat safe to put inside an accounts system: a write
 * it proposes never happens until somebody taps the card.
 */

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Proposal {
  kind: 'expense.create' | 'credit_sale.create' | 'payment.receive' | 'shift.close';
  summary: { en: string; bn: string };
  fields: Array<{ label: { en: string; bn: string }; value: string }>;
  payload: Record<string, unknown>;
}

const SUGGESTIONS: Record<'bn' | 'en', string[]> = {
  bn: ['আজ কত বিক্রি হলো?', 'ট্যাংক ২-এ কত আছে?', 'শাহ মামুনের বাকি কত?'],
  en: ['How much did we sell today?', 'What is in tank 2?', 'What does Shah Mamun owe?'],
};

export function ChatPanel() {
  const { lang } = useLang();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // One session per browser tab, kept across reloads so the thread survives a
  // refresh mid-shift.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem('jhm.chat.session');
      if (saved) {
        setSessionId(saved);
        return;
      }
    } catch {
      /* private browsing */
    }
    const fresh = crypto.randomUUID();
    setSessionId(fresh);
    try {
      window.sessionStorage.setItem('jhm.chat.session', fresh);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy, proposal]);

  const say = useCallback(
    async (text: string, spoken = false) => {
      const trimmed = text.trim();
      if (!trimmed || busy || !sessionId) return;

      setDraft('');
      setNotice(null);
      setProposal(null);
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: 'user', content: trimmed }]);
      setBusy(true);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, message: trimmed, lang, spoken }),
        });
        const body = (await response.json()) as { reply?: string; proposal?: Proposal | null };
        setTurns((t) => [
          ...t,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: body.reply ?? (lang === 'bn' ? 'উত্তর পাওয়া যায়নি।' : 'No answer came back.'),
          },
        ]);
        if (body.proposal) setProposal(body.proposal);
      } catch {
        setTurns((t) => [
          ...t,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content:
              lang === 'bn'
                ? 'সংযোগ পাওয়া গেল না। সব হিসাব স্ক্রিনে আছে।'
                : 'I could not reach the server. Every figure is still on the screens.',
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, lang, sessionId],
  );

  const voice = useVoiceInput({
    lang,
    onText: (text) => void say(text, true),
    onError: (message) => setNotice(message),
  });

  async function confirm() {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/chat/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, kind: proposal.kind, payload: proposal.payload }),
      });
      const body = (await response.json()) as { ok: boolean; message: string };
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: 'assistant', content: body.message }]);
      setProposal(null);
      if (body.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const listening = voice.state === 'listening' || voice.state === 'recording';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={lang === 'bn' ? 'সহকারী খুলুন' : 'Open the assistant'}
        className="no-print tap-target fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg sm:bottom-6 sm:right-6"
        style={{ background: 'var(--color-accent)', color: 'white' }}
      >
        <MessageCircle className="h-6 w-6" aria-hidden />
      </button>
    );
  }

  return (
    <div className="no-print fixed inset-0 z-40 flex items-end justify-end sm:inset-auto sm:bottom-6 sm:right-6">
      <div
        className="glass flex h-full w-full flex-col sm:h-[min(34rem,80vh)] sm:w-[24rem] sm:rounded-2xl"
        role="dialog"
        aria-label={lang === 'bn' ? 'সহকারী' : 'Assistant'}
      >
        {/* ---- header ---- */}
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <MessageCircle className="h-4 w-4" style={{ color: 'var(--color-accent)' }} aria-hidden />
          <span className="text-sm font-semibold tracking-tight" lang={lang}>
            {lang === 'bn' ? 'সহকারী' : 'Assistant'}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={lang === 'bn' ? 'বন্ধ' : 'Close'}
            className="tap-target ml-auto rounded-lg p-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* ---- thread ---- */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {turns.length === 0 ? (
            <div className="space-y-2 pt-2">
              <Muted lang={lang}>
                {lang === 'bn'
                  ? 'পাম্পের হিসাব জিজ্ঞাসা করুন — বাংলায় বলতে বা লিখতে পারেন।'
                  : 'Ask about the pump. Speak or type, in Bangla or English.'}
              </Muted>
              {SUGGESTIONS[lang].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void say(s)}
                  lang={lang}
                  className="tap-target block w-full rounded-xl border px-3 py-2 text-left text-xs"
                  style={{ borderColor: 'var(--hairline)', color: 'var(--text-muted)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {turns.map((turn) => (
            <div
              key={turn.id}
              className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <p
                className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
                lang={lang}
                style={
                  turn.role === 'user'
                    ? { background: 'var(--color-accent)', color: 'white' }
                    : { background: 'var(--color-accent-soft)', color: 'var(--text-strong)' }
                }
              >
                {turn.content}
              </p>
            </div>
          ))}

          {busy ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--text-faint)' }} aria-hidden />
              <Muted lang={lang}>{lang === 'bn' ? 'দেখছি…' : 'Looking…'}</Muted>
            </div>
          ) : null}

          {/* ---- the card that has to be tapped ---- */}
          {proposal ? (
            <div
              className="rounded-xl border p-3"
              style={{ borderColor: 'var(--color-accent)' }}
            >
              <p className="text-sm font-semibold" lang={lang}>
                {lang === 'bn' ? proposal.summary.bn : proposal.summary.en}
              </p>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {proposal.fields.map((f) => (
                    <tr key={f.label.en}>
                      <td className="py-0.5 pr-2" style={{ color: 'var(--text-faint)' }} lang={lang}>
                        {lang === 'bn' ? f.label.bn : f.label.en}
                      </td>
                      <td className="tabular py-0.5 text-right font-medium">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Muted className="mt-2" lang={lang}>
                {lang === 'bn'
                  ? 'নিশ্চিত না করা পর্যন্ত কিছুই লেখা হবে না।'
                  : 'Nothing is saved until you confirm.'}
              </Muted>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setProposal(null)}
                  className="tap-target flex-1 rounded-lg border px-3 py-2 text-xs font-medium"
                  style={{ borderColor: 'var(--hairline)' }}
                  lang={lang}
                >
                  {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                {proposal.kind === 'shift.close' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProposal(null);
                      setOpen(false);
                      router.push('/shift/close');
                    }}
                    className="tap-target flex-1 rounded-lg px-3 py-2 text-xs font-medium"
                    style={{ background: 'var(--color-accent)', color: 'white' }}
                    lang={lang}
                  >
                    {lang === 'bn' ? 'বন্ধের পাতায় যান' : 'Go to the close'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={busy}
                    className="tap-target flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
                    style={{ background: 'var(--color-accent)', color: 'white' }}
                    lang={lang}
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {lang === 'bn' ? 'নিশ্চিত করুন' : 'Confirm'}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        {/* ---- input ---- */}
        <div className="shrink-0 border-t px-3 py-2.5" style={{ borderColor: 'var(--hairline)' }}>
          {notice ? (
            <p className="state-watch mb-1.5 text-xs" lang={lang}>
              {notice}
            </p>
          ) : null}
          {listening ? (
            <div className="mb-1.5 flex items-center gap-2">
              <Chip tone="ok" lang={lang}>
                {voice.state === 'recording'
                  ? lang === 'bn'
                    ? 'রেকর্ড হচ্ছে'
                    : 'Recording'
                  : lang === 'bn'
                    ? 'শুনছি'
                    : 'Listening'}
              </Chip>
              <Muted className="truncate">{voice.interim}</Muted>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={voice.start}
              disabled={busy || voice.state === 'transcribing'}
              aria-label={lang === 'bn' ? 'কথা বলুন' : 'Speak'}
              aria-pressed={listening}
              className="tap-target shrink-0 rounded-full p-2.5 disabled:opacity-40"
              style={
                listening
                  ? { background: 'var(--color-breach)', color: 'white' }
                  : { border: '1px solid var(--hairline)', color: 'var(--text-muted)' }
              }
            >
              {voice.state === 'transcribing' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Mic className="h-4 w-4" aria-hidden />
              )}
            </button>

            <textarea
              value={draft}
              aria-label={lang === 'bn' ? 'প্রশ্ন লিখুন' : 'Ask a question'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void say(draft);
                }
              }}
              rows={1}
              lang={lang}
              placeholder={lang === 'bn' ? 'প্রশ্ন লিখুন…' : 'Ask something…'}
              className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
              style={{ borderColor: 'var(--hairline)' }}
            />

            <button
              type="button"
              onClick={() => void say(draft)}
              disabled={busy || !draft.trim()}
              aria-label={lang === 'bn' ? 'পাঠান' : 'Send'}
              className="tap-target shrink-0 rounded-full p-2.5 disabled:opacity-40"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
