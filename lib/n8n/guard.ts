import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * The shared secret on the two inbound routes.
 *
 * Compared in constant time. A plain `===` on a secret leaks its prefix
 * through how long the comparison took — a real attack against a public
 * endpoint, and the cheapest possible thing to get right.
 *
 * A request without the header is refused before anything in its body is read,
 * so a malformed or hostile payload never reaches the parser.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

export function guardInbound(request: NextRequest): GuardResult {
  const secret = process.env.N8N_INBOUND_SECRET;
  if (!secret) {
    // Refusing is the safe default. An unset secret must never mean "let
    // everybody in" on a route that can write to the ledger.
    return { ok: false, status: 503, reason: 'N8N_INBOUND_SECRET is not set, so inbound routes are closed' };
  }

  const offered = request.headers.get('x-n8n-secret') ?? '';
  if (!offered || !timingSafeEqual(offered, secret)) {
    return { ok: false, status: 401, reason: 'Bad or missing X-N8N-Secret' };
  }

  return { ok: true };
}
