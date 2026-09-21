import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Role } from '@/lib/roles';

type CookiesToSet = Array<{ name: string; value: string; options: CookieOptions }>;

export async function createClient() {
  // Read cookies first: it establishes the request context, which is what
  // tells Next this route is per-request rather than prerenderable.
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.');
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

export interface SessionProfile {
  id: string;
  fullName: string;
  fullNameBn: string | null;
  role: Role;
  languagePref: 'bn' | 'en';
  stationId: string | null;
}

/**
 * The signed-in user's profile, or null. Every page that shows anything at all
 * calls this — the role it returns decides what the page may render, and the
 * same role is enforced again in RLS for every query the page makes.
 */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, full_name_bn, role, language_pref, station_id, is_active, deleted_at')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error || !data || !data.is_active || data.deleted_at) return null;

  return {
    id: data.id,
    fullName: data.full_name,
    fullNameBn: data.full_name_bn,
    role: data.role as Role,
    languagePref: data.language_pref as 'bn' | 'en',
    stationId: data.station_id,
  };
}
