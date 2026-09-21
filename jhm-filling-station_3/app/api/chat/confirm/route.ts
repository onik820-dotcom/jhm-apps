import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient, getSessionProfile } from '@/lib/supabase/server';
import { recordExpense } from '@/app/expenses/actions';
import { recordCreditSale } from '@/app/dues/actions';

/**
 * Confirming a proposal.
 *
 * This is where a spoken "log 500 taka for tiffin" finally becomes a row, and
 * it gets there through exactly the same server actions the forms use — same
 * zod validation, same RLS, same triggers, same audit entry. Nothing about
 * having arrived by voice gives it a shortcut.
 *
 * The proposal is re-read from the request rather than trusted from a server
 * session, so the payload is validated here again as if a person had typed it.
 * The model's earlier involvement is irrelevant by this point: this route
 * would behave identically if the payload had been hand-written.
 */

const Body = z.object({
  session_id: z.string().uuid(),
  kind: z.enum(['expense.create', 'credit_sale.create', 'shift.close']),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { session_id, kind, payload } = parsed.data;
  const lang = profile.languagePref;

  const str = (key: string) => (payload[key] === undefined ? '' : String(payload[key]));

  let outcome: { ok: boolean; error?: string };

  switch (kind) {
    case 'expense.create':
      outcome = await recordExpense({
        category_id: str('category_id'),
        amount: str('amount'),
        description: str('description'),
        paid_by: (str('paid_by') || 'cash') as 'cash' | 'bank' | 'bkash' | 'nagad',
      });
      break;

    case 'credit_sale.create':
      outcome = await recordCreditSale({
        customer_id: str('customer_id'),
        amount: str('amount'),
        litres: str('litres'),
        rate: str('rate'),
        vehicle_no: str('vehicle_no'),
      });
      break;

    case 'shift.close':
      // Closing needs meter readings and dips from the forecourt, which the
      // chat has no way to collect. Pretending otherwise would be the one
      // place in this system where a figure appeared without somebody
      // reading it off a machine.
      outcome = {
        ok: false,
        error:
          lang === 'bn'
            ? 'শিফট বন্ধ করতে মিটার রিডিং ও ডিপ লাগে, তাই বন্ধের পাতায় যেতে হবে।'
            : 'Closing a shift needs the meter readings and dips, so it goes through the close wizard.',
      };
      break;
  }

  const supabase = await createClient();
  const note = outcome.ok
    ? lang === 'bn'
      ? 'লেখা হয়েছে।'
      : 'Saved.'
    : (outcome.error ?? (lang === 'bn' ? 'লেখা গেল না।' : 'Could not save that.'));

  await supabase.from('chat_messages').insert({
    session_id,
    user_id: profile.id,
    role: 'assistant',
    content: note,
    content_lang: lang,
  });

  return NextResponse.json({ ok: outcome.ok, message: note });
}
