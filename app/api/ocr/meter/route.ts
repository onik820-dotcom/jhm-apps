import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getSessionProfile } from '@/lib/supabase/server';

/**
 * Reads a dispenser totalizer from a photograph.
 *
 * The Anthropic key is read here and nowhere else. This route never returns it,
 * never echoes the request, and refuses anyone who is not signed in — an open
 * vision endpoint is somebody else's bill.
 *
 * What comes back is a suggestion, not a fact. The employee sees the photo and
 * the extracted number side by side and confirms or retypes it before anything
 * is saved, and `ai_extracted` keeps the original suggestion next to whatever
 * they confirmed.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

/** A phone photo downscaled client-side lands well under this. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const requestSchema = z.object({
  imageBase64: z.string().min(64, 'No image was sent'),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Machine codes on this forecourt, so the model names one of them or none. */
  knownMachines: z.array(z.string().max(16)).max(24).optional(),
});

const READING_TOOL: Anthropic.Tool = {
  name: 'record_meter_reading',
  description:
    'Record what the mechanical totalizer on the dispenser face actually reads, and which machine it belongs to.',
  input_schema: {
    type: 'object',
    properties: {
      machine_no: {
        type: ['string', 'null'],
        description:
          'The dispenser or machine identifier shown on the unit, for example M1 or M3. Null if no identifier is legible in the photo.',
      },
      reading: {
        type: ['string', 'null'],
        description:
          'The totalizer reading exactly as displayed, digits only, using a full stop for any decimal point. No thousands separators, no units. Null if the digits cannot be read.',
      },
      confidence: {
        type: 'number',
        description:
          'How confident you are in the reading, from 0 to 1. Be strict: glare, motion blur, a half-rolled digit or a cropped frame should all pull this down.',
      },
      notes: {
        type: ['string', 'null'],
        description:
          'A short note if something is wrong with the photo — blurred, cut off, glare on the glass, digit mid-roll.',
      },
    },
    required: ['machine_no', 'reading', 'confidence', 'notes'],
    additionalProperties: false,
  },
  strict: true,
};

const SYSTEM = `You read mechanical totalizers on fuel dispensers at a filling station in Bangladesh.

A totalizer is the cumulative litre counter on the dispenser face. It is a mechanical odometer-style row of digits — not the per-sale price or volume display, which is usually a brighter electronic panel showing a much smaller number.

Rules:
- Report the totalizer exactly as shown, digit for digit. Do not round, reformat, or add thousands separators.
- A totalizer counts up over the life of the pump, so it is usually a large number, often with one or two decimal places in a differently coloured section.
- If a digit is mid-roll between two values, report the lower one and say so in notes.
- If you cannot read it, return null rather than a guess. A wrong number here becomes a wrong litre count in a shift reconciliation.
- Be conservative with confidence. Only go above 0.9 when every digit is sharp and unambiguous.`;

export async function POST(request: Request) {
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Meter reading is not configured on this server', code: 'NO_API_KEY' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const { imageBase64, mediaType, knownMachines } = parsed.data;

  // base64 is about 4/3 of the bytes it encodes.
  if ((imageBase64.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'That photo is too large. Take it again.', code: 'IMAGE_TOO_LARGE' },
      { status: 413 },
    );
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

  const machineHint =
    knownMachines && knownMachines.length > 0
      ? `\n\nThe machines on this forecourt are: ${knownMachines.join(', ')}. If the photo shows one of these, use that exact code.`
      : '';

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [READING_TOOL],
      // The only useful outcome is a filled-in reading, so ask for it directly.
      tool_choice: { type: 'tool', name: 'record_meter_reading' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            {
              type: 'text',
              text: `Read the totalizer on this dispenser.${machineHint}`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      return NextResponse.json(
        { error: 'The photo could not be read. Enter the reading by hand.', code: 'NO_READING' },
        { status: 422 },
      );
    }

    // Tool input is JSON from the model: parse it, never string-match it.
    const extracted = toolUse.input as {
      machine_no: string | null;
      reading: string | null;
      confidence: number;
      notes: string | null;
    };

    // A reading must be digits with at most one decimal point before it goes
    // anywhere near a litre calculation.
    const reading =
      extracted.reading && /^\d{1,12}(\.\d{1,2})?$/.test(extracted.reading.trim())
        ? extracted.reading.trim()
        : null;

    return NextResponse.json({
      machineNo: extracted.machine_no,
      reading,
      confidence: Math.max(0, Math.min(1, Number(extracted.confidence) || 0)),
      notes: extracted.notes,
      model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: 'Meter reading is not configured correctly on this server', code: 'BAD_API_KEY' },
        { status: 503 },
      );
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'Too many readings at once. Wait a moment and try again.', code: 'RATE_LIMITED' },
        { status: 429 },
      );
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: 'The photo could not be read. Enter the reading by hand.', code: 'OCR_FAILED' },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'The photo could not be read. Enter the reading by hand.', code: 'OCR_FAILED' },
      { status: 502 },
    );
  }
}
