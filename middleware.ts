import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { canAccess, isRole, ROLE_HOME } from '@/lib/roles';

type CookiesToSet = Array<{ name: string; value: string; options: CookieOptions }>;

/** Reachable without a session. */
/**
 * Paths that answer without a session.
 *
 * `/offline` is the service worker's fallback, and it has to be reachable by
 * somebody with no network at all — a redirect to a login page it also cannot
 * reach is not a fallback. It shows no figures, so there is nothing on it to
 * protect.
 *
 * `/join` is where an invited person sets their password, and they have no
 * session by definition. It shows nothing at all without a valid token, and
 * the token is checked in the database, not here.
 */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/signout', '/offline', '/join'];

/**
 * Of those, the ones a signed-in user has no business sitting on, so they are
 * sent to their own dashboard instead.
 *
 * Sign-out is deliberately not in this list: bouncing a signed-in user away
 * from it is bouncing away the only people who ever use it, and the POST never
 * reaches the route that clears the session.
 */
const REDIRECT_WHEN_SIGNED_IN = ['/login', '/auth/callback'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates the token with Supabase on every request rather than
  // trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /**
   * API routes are left entirely to themselves. Each one authenticates in the
   * way that suits it — a session for the OCR route, a shared secret for the
   * inbound n8n webhooks — and answers in JSON. Redirecting them to a login
   * page would hand the caller an HTML document with a 200 on it, which is how
   * a POST ends up silently doing nothing.
   */
  if (pathname.startsWith('/api/')) return response;

  if (!user) {
    if (isPublic) return response;
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, deleted_at')
    .eq('id', user.id)
    .maybeSingle();

  // A signed-in account with no usable profile gets nothing at all.
  if (!profile || !profile.is_active || profile.deleted_at || !isRole(profile.role)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('error', 'no-profile');
    return NextResponse.redirect(redirect);
  }

  const home = ROLE_HOME[profile.role];

  const shouldBounce = REDIRECT_WHEN_SIGNED_IN.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (pathname === '/' || shouldBounce) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = home;
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  // Sign-out is public but must pass through to its route handler.
  if (isPublic) return response;

  if (!canAccess(profile.role, pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = home;
    redirect.searchParams.set('denied', pathname);
    return NextResponse.redirect(redirect);
  }

  return response;
}

/**
 * What the middleware never touches.
 *
 * `sw.js` and `apple-icon` belong here for the same reason the manifest does:
 * the browser fetches them outside any session, and a 307 to the login page
 * means the service worker never registers and iOS gets no home-screen icon.
 * Both were being redirected until somebody actually requested the URLs.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|apple-icon|icons/.*|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)',
  ],
};
