import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

type CookiesToSet = Array<{ name: string; value: string; options: CookieOptions }>;

/**
 * Sign out, and actually clear the session cookie.
 *
 * The cleared cookies have to be written onto the response that is returned.
 * Setting them through `cookies()` from next/headers and then returning a
 * freshly constructed NextResponse drops them, which leaves the browser signed
 * in — on a phone shared between shift workers, that is somebody else's
 * session still open.
 */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const cookieStore = await cookies();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.signOut();
  return response;
}
