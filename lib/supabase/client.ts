'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client. Carries only the publishable key — every read
 * and write it makes is governed by the RLS policies in
 * supabase/migrations/0006_rls.sql, never by what the UI chooses to show.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.',
    );
  }
  return createBrowserClient(url, key);
}
