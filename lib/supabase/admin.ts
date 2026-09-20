import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS, so it is confined to server code that has
 * already established who the caller is and what they may do: the seed script,
 * the n8n inbound routes behind their shared secret, and the outbound sync
 * worker.
 *
 * Importing this from anything that runs in the browser is a bug — the key is
 * read from a server-only environment variable and will be undefined there.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for server-side writes.');
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
