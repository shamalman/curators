import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

const PUBLIC_ROUTES = new Set([
  '/login',
  '/signup',
  '/onboarding',
  '/onboarding/welcome',
  '/forgot-password',
  '/reset-password',
  '/email/saved',
  '/email/unsubscribed',
  '/pricing',
]);

// Unauthenticated /api/* allowlist (enforced by route handlers, not middleware):
//   /api/auth/callback, /api/auth/signup, /api/waitlist, /api/email-action
// All other /api/* routes must perform their own session check.
export async function middleware(req) {
  try {
    const res = NextResponse.next();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              req.cookies.set(name, value);
              res.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data: { session } } = await supabase.auth.getSession();

    const path = req.nextUrl.pathname;
    const isApiRoute = path.startsWith('/api');

    // Root: authed → /myai, unauthed → splash page
    if (path === '/') {
      if (session) {
        return NextResponse.redirect(new URL('/myai', req.url));
      }
      return res;
    }

    // API routes: public API allowlist short-circuits; everything else passes
    // through middleware and is enforced by the route handler itself.
    if (isApiRoute) {
      return res;
    }

    // Public (non-API) pages: allowed; bounce authed users away from /login & /signup
    if (PUBLIC_ROUTES.has(path)) {
      if (session && (path === '/login' || path === '/signup')) {
        return NextResponse.redirect(new URL('/myai', req.url));
      }
      return res;
    }

    // Everything else requires a session
    if (!session) {
      const loginUrl = new URL('/login', req.url);
      const redirectTo = path + (req.nextUrl.search || '');
      loginUrl.searchParams.set('redirectTo', redirectTo);
      return NextResponse.redirect(loginUrl);
    }

    return res;
  } catch (err) {
    // Never crash — fall through and allow the request
    console.error('Middleware error:', err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
