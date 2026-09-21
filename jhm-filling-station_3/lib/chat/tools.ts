import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@/lib/roles';
import { businessDate } from '@/lib/format';

/**
 * What the assistant is allowed to ask, and what it is allowed to propose.
 *
 * Two rules hold this together, and both are structural rather than a matter
 * of prompting.
 *
 * **The assistant has no privileges of its own.** Every read below runs on the
 * signed-in user's Supabase client, so Row Level Security answers exactly as
 * it would if the person had opened the screen. A manager who cannot open the
 * Profit & Loss page cannot get the figure by asking for it either: the
 * function raises, and the refusal is handed back to the model as the tool
 * result. Prompting a model not to reveal something is a wish; letting the
 * database refuse is a rule.
 *
 * **The assistant cannot write.** There is no mutating tool here. A spoken
 * "log 500 taka for tiffin" resolves to a *proposal* — a description of what
 * would be written — which the panel renders as a card the person has to tap.
 * The write then goes through the ordinary server action, with the ordinary
 * triggers, the ordinary RLS and the ordinary audit row. The model's output is
 * never the write.
 */

export interface ToolContext {
  supabase: SupabaseClient;
  role: Role;
  lang: 'bn' | 'en';
}

export interface ToolResult {
  ok: boolean;
  /** Handed back to the model verbatim. Data, never instructions. */
  data?: unknown;
  /** A refusal the model should relay plainly rather than work around. */
  refused?: string;
  error?: string;
}

/** A write the model wants to make, which only a human tap can authorise. */
export interface Proposal {
  kind: 'expense.create' | 'credit_sale.create' | 'payment.receive' | 'shift.close';
  summary: { en: string; bn: string };
  /** Shown on the card, field by field, so nothing is confirmed unseen. */
  fields: Array<{ label: { en: string; bn: string }; value: string }>;
  payload: Record<string, unknown>;
}

export const TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_kpis',
      description:
        'Headline figures for the station: sales and litres today and month to date, ' +
        'cash in the drawer, dues outstanding, days of cover, open variances, and — ' +
        'only for the owner and the MD — profit for the month. Use this for "how much ' +
        'did we sell today", "how much cash is there", "how much is owed".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_customer',
      description:
        'Find a credit party by name, Bangla name, or vehicle registration. Handles ' +
        'misspellings and transliteration — "shah mamun" finds "Shah Mamun Transport". ' +
        'Returns what each one owes, its credit limit, and how old the oldest unpaid ' +
        'bill is. Use this for any question about what a party owes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A name, part of a name, or a vehicle number.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tanks',
      description:
        'Current stock in each tank: last dip in millimetres, litres from the certified ' +
        'calibration chart, and the variance from the most recent shift close with its ' +
        'reason. Use this for "how much is in tank 2", "what was the variance".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_shifts',
      description:
        'The currently open shift if there is one, and the recent closed shifts with ' +
        'their litres, sales, cash counted and cash variance.',
      parameters: {
        type: 'object',
        properties: {
          recent: { type: 'integer', description: 'How many closed shifts to return, 1 to 20.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_profit',
      description:
        'Profit and loss over a range of business days: fuel and lubricant margin, pump ' +
        'expenses, operating profit, and the Chairman book shown separately. Only the ' +
        'owner and the MD may see this; for anyone else it refuses, and you must say so ' +
        'plainly rather than estimating.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start date, YYYY-MM-DD.' },
          to: { type: 'string', description: 'End date, YYYY-MM-DD.' },
        },
        required: ['from', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_daily_sheet',
      description:
        'Everything recorded on one business day: meter readings, tank movement, sales, ' +
        'party-wise credit, lubricants, expenses and the cash account.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'Business day, YYYY-MM-DD.' } },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_expense_heads',
      description:
        'The expense categories money can be booked against, and which book each sits ' +
        'in. Call this before proposing an expense so the head is a real one.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_expense',
      description:
        'Propose recording an expense. This does NOT write anything — it produces a ' +
        'card the person must tap to confirm. Call list_expense_heads first so the ' +
        'category is real.',
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string' },
          amount: { type: 'string', description: 'Taka, as digits. No currency symbol.' },
          description: { type: 'string' },
          paid_by: { type: 'string', enum: ['cash', 'bank', 'bkash', 'nagad'] },
        },
        required: ['category_id', 'amount', 'paid_by'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_credit_sale',
      description:
        'Propose booking a credit sale against a party. Does NOT write — produces a card ' +
        'to confirm. Find the party first so the id is real.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'string' },
          amount: { type: 'string' },
          litres: { type: 'string' },
          rate: { type: 'string' },
          vehicle_no: { type: 'string' },
        },
        required: ['customer_id', 'amount'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_close_shift',
      description:
        'Propose closing the currently open shift. Does NOT close it — produces a card. ' +
        'Closing needs meter readings and dips that the chat cannot collect, so the card ' +
        'takes the person to the close wizard rather than pretending to do it here.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

/** Tool names that produce a proposal rather than reading anything. */
export const PROPOSAL_TOOLS = new Set([
  'propose_expense',
  'propose_credit_sale',
  'propose_close_shift',
]);

function refusalFrom(error: { message?: string; code?: string } | null): ToolResult | null {
  if (!error) return null;
  const message = error.message ?? '';
  // The database's own refusals are meaningful sentences; pass them through so
  // the assistant repeats the real reason rather than inventing one.
  if (
    error.code === '42501' ||
    /permission|privilege|not open to your role|owner and the MD/i.test(message)
  ) {
    return { ok: false, refused: message };
  }
  return { ok: false, error: message };
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult | { proposal: Proposal }> {
  const { supabase } = ctx;

  switch (name) {
    case 'get_kpis': {
      const { data, error } = await supabase.rpc('dashboard_kpis');
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'find_customer': {
      const { data, error } = await supabase.rpc('chat_customer_lookup', {
        p_query: String(args.query ?? ''),
        p_limit: 5,
      });
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'get_tanks': {
      const { data, error } = await supabase.rpc('chat_tank_status');
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'get_shifts': {
      const { data, error } = await supabase.rpc('chat_shift_status', {
        p_recent: Number(args.recent ?? 4),
      });
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'get_profit': {
      const { data, error } = await supabase.rpc('profit_and_loss', {
        p_from: String(args.from ?? businessDate()),
        p_to: String(args.to ?? businessDate()),
      });
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'get_daily_sheet': {
      const { data, error } = await supabase.rpc('daily_sheet', {
        p_date: String(args.date ?? businessDate()),
      });
      return refusalFrom(error) ?? { ok: true, data };
    }

    case 'list_expense_heads': {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, name, name_bn, group')
        .eq('is_active', true)
        .order('sort_order');
      return refusalFrom(error) ?? { ok: true, data };
    }

    // ---- proposals: nothing below this line touches a record --------------
    case 'propose_expense': {
      const { data } = await supabase
        .from('expense_categories')
        .select('name, name_bn, group')
        .eq('id', String(args.category_id ?? ''))
        .maybeSingle();

      if (!data) {
        return { ok: false, error: 'That expense head does not exist. Call list_expense_heads.' };
      }
      const head = data as { name: string; name_bn: string | null; group: string };

      return {
        proposal: {
          kind: 'expense.create',
          summary: {
            en: `Record ৳${args.amount} against ${head.name}`,
            bn: `${head.name_bn ?? head.name} খাতে ৳${args.amount} খরচ লিখুন`,
          },
          fields: [
            { label: { en: 'Head', bn: 'খাত' }, value: head.name_bn ?? head.name },
            { label: { en: 'Book', bn: 'খাতা' }, value: head.group === 'chairman' ? 'Chairman' : 'Pump' },
            { label: { en: 'Amount', bn: 'পরিমাণ' }, value: String(args.amount ?? '') },
            { label: { en: 'Paid by', bn: 'যেভাবে' }, value: String(args.paid_by ?? 'cash') },
            ...(args.description
              ? [{ label: { en: 'For', bn: 'বাবদ' }, value: String(args.description) }]
              : []),
          ],
          payload: {
            category_id: args.category_id,
            amount: args.amount,
            description: args.description ?? '',
            paid_by: args.paid_by ?? 'cash',
          },
        },
      };
    }

    case 'propose_credit_sale': {
      const { data } = await supabase
        .from('customers')
        .select('name, name_bn, credit_limit, is_active')
        .eq('id', String(args.customer_id ?? ''))
        .maybeSingle();

      if (!data) {
        return { ok: false, error: 'That party does not exist. Call find_customer first.' };
      }
      const party = data as { name: string; name_bn: string | null; is_active: boolean };

      // The headroom check is read-only and uses the same function the trigger
      // will use, so the card can say up front if this will be refused.
      const { data: headroom } = await supabase.rpc('check_credit_headroom', {
        p_customer_id: String(args.customer_id),
        p_amount: String(args.amount ?? '0'),
      });
      const h = headroom as { exceeded?: boolean; projected_balance?: number } | null;

      return {
        proposal: {
          kind: 'credit_sale.create',
          summary: {
            en: `Book ৳${args.amount} to ${party.name}`,
            bn: `${party.name_bn ?? party.name}-এর নামে ৳${args.amount} বাকি লিখুন`,
          },
          fields: [
            { label: { en: 'Party', bn: 'পার্টি' }, value: party.name_bn ?? party.name },
            { label: { en: 'Amount', bn: 'পরিমাণ' }, value: String(args.amount ?? '') },
            ...(args.litres
              ? [{ label: { en: 'Litres', bn: 'লিটার' }, value: String(args.litres) }]
              : []),
            ...(args.vehicle_no
              ? [{ label: { en: 'Vehicle', bn: 'গাড়ি' }, value: String(args.vehicle_no) }]
              : []),
            ...(h?.exceeded
              ? [
                  {
                    label: { en: 'Warning', bn: 'সতর্কতা' },
                    value:
                      ctx.lang === 'bn'
                        ? 'এই বিক্রি ঋণসীমা ছাড়িয়ে যাবে'
                        : 'This would take the party past its credit limit',
                  },
                ]
              : []),
          ],
          payload: {
            customer_id: args.customer_id,
            amount: args.amount,
            litres: args.litres ?? '',
            rate: args.rate ?? '',
            vehicle_no: args.vehicle_no ?? '',
          },
        },
      };
    }

    case 'propose_close_shift': {
      const { data } = await supabase.rpc('chat_shift_status', { p_recent: 1 });
      const status = data as { open?: { shift_date: string; shift_type: string } | null } | null;

      if (!status?.open) {
        return { ok: false, error: 'No shift is open, so there is nothing to close.' };
      }

      return {
        proposal: {
          kind: 'shift.close',
          summary: {
            en: `Close the ${status.open.shift_type} shift of ${status.open.shift_date}`,
            bn: `${status.open.shift_date} তারিখের ${status.open.shift_type === 'night' ? 'রাতের' : 'দিনের'} শিফট বন্ধ করুন`,
          },
          fields: [
            { label: { en: 'Date', bn: 'তারিখ' }, value: status.open.shift_date },
            { label: { en: 'Shift', bn: 'শিফট' }, value: status.open.shift_type },
          ],
          payload: {},
        },
      };
    }

    default:
      return { ok: false, error: `No tool called ${name}` };
  }
}

/**
 * The system prompt.
 *
 * The hard rules are the ones about numbers. A model that guesses a figure in
 * an accounting system is worse than a model that says it does not know, so it
 * is told plainly: every number comes from a tool, and a refusal gets repeated
 * rather than worked around.
 */
export function systemPrompt(ctx: ToolContext, fullName: string): string {
  const today = businessDate();
  return [
    'You are the assistant inside the accounts system of M/S. J.H.M. Filling Station,',
    'a Padma Oil dealer on the Jashore–Khulna highway at Chengutia, Abhaynagar, Jashore.',
    '',
    `You are speaking to ${fullName}, whose role is "${ctx.role}".`,
    `Today's business day is ${today}. A business day runs 06:00 to 06:00, Asia/Dhaka,`,
    'so a night shift belongs to the date it opened on.',
    '',
    'LANGUAGE',
    `Reply in ${ctx.lang === 'bn' ? 'Bangla' : 'English'} unless the person clearly writes in the other one.`,
    'Many people here write Bangla in Latin letters ("baki koto", "aajke koto bikri holo").',
    'Understand that and answer naturally; do not correct their spelling.',
    '',
    'NUMBERS — THE RULES THAT MATTER',
    'Every figure you give must come from a tool call in this conversation.',
    'Never estimate, never infer a total by doing your own arithmetic on figures',
    'from different tools, and never carry a number over from memory of an earlier',
    'answer. If you have not called a tool for it, say you need to look it up.',
    'Money is Bangladeshi taka. Write amounts the way the country does, in lakh and',
    'crore grouping: ৳১,২৩,৪৫৬.৭৮ style when replying in Bangla.',
    '',
    'WHAT YOU MAY NOT SEE',
    'The database decides, not you. If a tool comes back refused, tell the person',
    'plainly that the figure is not open to their role, and do not try another route',
    'to it, do not approximate it, and do not speculate about what it might be.',
    'Cost and profit are for the owner and the MD only.',
    '',
    'WRITING THINGS DOWN',
    'You cannot write to the system. To record an expense, a credit sale, or to close',
    'a shift, call the matching propose_* tool. That produces a card the person taps',
    'to confirm, and only then is anything saved. Say clearly that you have prepared',
    'it and are waiting for them to confirm. Never claim something has been saved.',
    '',
    'TONE',
    'Short, direct, and specific. This is a working tool for people mid-shift on a',
    'forecourt, not a chat companion. Give the number and the one line of context',
    'that makes it useful. No preamble.',
  ].join('\n');
}
