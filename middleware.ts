import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  IDLE_COOKIE,
  idleTimeoutMs,
  SESSION_START_COOKIE,
  sessionMaxMs,
} from '@/lib/sessionConfig'
import {
  MFA_COOKIE,
  MFA_TRUST_COOKIE,
  mfaEnabled,
  mfaTrustMs,
  verifyMfaCookie,
} from '@/lib/mfa'

// Require a signed-in user for the whole portal. Refreshes the Supabase session
// cookie on every request and redirects unauthenticated users to /login.
//
// The matcher below excludes Next internals and the cron/webhook API routes,
// which authenticate with a bearer token / shared secret and are called by
// external systems (n8n, the inbound-email Worker) with no user session.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Login is enforced by default now that users exist. Kill switch: set
  // AUTH_ENABLED=false to turn the gate back off (e.g. if it ever locks people out).
  if (process.env.AUTH_ENABLED === 'false') return response

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return response

  const supabase = createServerClient(url, anon, {
    // Every Supabase call from here is bounded. Without this, a slow database
    // (an I/O-saturated instance, a long DDL lock) makes the auth check hang
    // until Vercel kills the middleware at 25s and serves its own bare
    // MIDDLEWARE_INVOCATION_TIMEOUT page for every route on the site.
    global: { fetch: timedFetch(SUPABASE_TIMEOUT_MS) },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isApi = path.startsWith('/api')

  // The auth server didn't answer (timed out / 5xx) for a visitor who does hold
  // a session cookie. We can't tell a valid session from a forged one without
  // it, so don't fail open — but don't bounce them to /login either, which
  // would read as "you were signed out" and lose the page they were on. Serve a
  // short 503 that retries itself; once the database recovers they land back on
  // the same URL, still signed in.
  if (!user && isRetryableAuthError(authError) && hasSessionCookie(request)) {
    return unavailable(isApi)
  }
  const isLogin = path === '/login'
  // The OAuth callback must run without a session (it's what creates one), and
  // the SSO exchange from the AP payables portal likewise runs pre-session.
  const isAuthFlow = path.startsWith('/auth') || path === '/api/auth/sso'
  // Where an account without this portal lands. Exempt from the gates below,
  // or a denied user would bounce between here, /mfa and /login forever.
  const isNoAccess = path === '/no-access'

  if (!user && !isLogin && !isAuthFlow) {
    const redirect = request.nextUrl.clone()
    redirect.pathname = '/login'
    redirect.searchParams.set('next', path)
    return NextResponse.redirect(redirect)
  }
  if (user && isLogin) {
    const home = request.nextUrl.clone()
    home.pathname = '/carriers'
    home.search = ''
    return NextResponse.redirect(home)
  }

  // Per-app access. One login spans the DTS portals, so an account can exist
  // for payables or Exemplis without this one; access is granted per app on
  // the Operations Users page and stored as profiles.role, where 'none' means
  // this portal is closed. Deliberately fail-open: only an explicit 'none'
  // denies, so a read error or a missing row behaves exactly as before.
  // A timeout here surfaces as a query error, and an error is treated exactly
  // like a missing row: not denied.
  if (user && !isLogin && !isAuthFlow) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const denied = prof?.role === 'none'
    if (denied && path.startsWith('/api')) {
      return NextResponse.json({ error: 'No access to this portal' }, { status: 403 })
    }
    if (denied && !isNoAccess) {
      const redirect = request.nextUrl.clone()
      redirect.pathname = '/no-access'
      redirect.search = ''
      return NextResponse.redirect(redirect)
    }
    if (denied && isNoAccess) return response
    if (!denied && isNoAccess) {
      const home = request.nextUrl.clone()
      home.pathname = '/carriers'
      home.search = ''
      return NextResponse.redirect(home)
    }
  }

  // Idle backstop: the client refreshes the `dts_active` cookie on activity. If
  // it's older than the idle window, reject a page navigation and clear the
  // Supabase session cookies so a stale session can't be replayed after idle —
  // even if the client-side timer never ran. Only enforced on page navigations;
  // API calls (fetches) are left to return normally so they aren't redirected to
  // an HTML login page mid-request (the client signs out at the same threshold).
  if (user && !isLogin && !isAuthFlow && !isApi) {
    const now = Date.now()
    const secure = request.nextUrl.protocol === 'https:'
    // Build a redirect to the login page that expires every session cookie, used
    // for both idle and absolute-lifetime expiry.
    const expire = (reason: 'timeout' | 'expired') => {
      const redirect = request.nextUrl.clone()
      redirect.pathname = '/login'
      redirect.search = ''
      redirect.searchParams.set(reason, '1')
      redirect.searchParams.set('next', path)
      const res = NextResponse.redirect(redirect)
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith('sb-')) res.cookies.set(c.name, '', { path: '/', maxAge: 0 })
      }
      res.cookies.set(IDLE_COOKIE, '', { path: '/', maxAge: 0 })
      res.cookies.set(SESSION_START_COOKIE, '', { path: '/', maxAge: 0 })
      res.cookies.set(MFA_COOKIE, '', { path: '/', maxAge: 0 })
      return res
    }

    // Idle timeout: the client refreshes dts_active on activity.
    const active = request.cookies.get(IDLE_COOKIE)?.value
    if (active) {
      const last = Number(active)
      if (Number.isFinite(last) && now - last > idleTimeoutMs()) {
        return expire('timeout')
      }
    }

    // Absolute session lifetime: stamp dts_session_start on the first
    // authenticated navigation, then force re-login once it's older than the cap.
    const started = request.cookies.get(SESSION_START_COOKIE)?.value
    if (!started) {
      response.cookies.set(SESSION_START_COOKIE, String(now), {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: Math.ceil(sessionMaxMs() / 1000),
      })
    } else {
      const start = Number(started)
      if (Number.isFinite(start) && now - start > sessionMaxMs()) {
        return expire('expired')
      }
    }
  }

  // Email 2FA: a password-only session must clear the emailed code before it can
  // reach any data. The /mfa page and its API routes are exempt (that's where the
  // code is entered). Page navigations redirect to /mfa; API calls get a 401.
  const isMfaFlow = path === '/mfa' || path.startsWith('/api/auth/mfa')
  if (mfaEnabled() && user && !isLogin && !isAuthFlow && !isMfaFlow) {
    // Pass if the per-session MFA cookie is valid OR this is a remembered device.
    const ok =
      (await verifyMfaCookie(request.cookies.get(MFA_COOKIE)?.value, user.id)) ||
      (await verifyMfaCookie(
        request.cookies.get(MFA_TRUST_COOKIE)?.value,
        user.id,
        mfaTrustMs()
      ))
    if (!ok) {
      if (isApi) {
        return NextResponse.json({ error: 'MFA required' }, { status: 401 })
      }
      const redirect = request.nextUrl.clone()
      redirect.pathname = '/mfa'
      redirect.search = ''
      redirect.searchParams.set('next', path)
      return NextResponse.redirect(redirect)
    }
  }

  return response
}

// Upper bound on any single Supabase request made from the middleware. Two
// requests run per page (auth, then the per-app access row), so the worst case
// stays well inside Vercel's 25s middleware limit.
const SUPABASE_TIMEOUT_MS = 8_000

/** A fetch that aborts after `ms`. Supabase's clients turn the abort into a
 *  regular error result rather than throwing, so callers see `{ error }`. */
function timedFetch(ms: number): typeof fetch {
  return (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}

/** True when auth-js gave up because the auth server was unreachable, timed
 *  out, or answered 5xx — as opposed to a definite "no / invalid session". */
function isRetryableAuthError(error: { name?: string; status?: number } | null): boolean {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true
  return typeof error.status === 'number' && (error.status === 0 || error.status >= 500)
}

/** Whether the request carries a Supabase session cookie at all. Without one
 *  there is nothing to verify and the normal login redirect is correct. */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.value)
}

/** 503 for a database brownout. Pages get a tiny self-refreshing HTML notice;
 *  API calls get JSON so client fetches can show their own message. */
function unavailable(isApi: boolean): NextResponse {
  const headers = { 'Retry-After': '10', 'Cache-Control': 'no-store' }
  if (isApi) {
    return NextResponse.json(
      { error: 'The portal database is busy right now. Please retry in a moment.' },
      { status: 503, headers }
    )
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Portal busy — retrying</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#475569;line-height:1.5;margin:.25rem 0}
a{display:inline-block;margin-top:1rem;padding:.5rem 1rem;border-radius:.5rem;background:#1e3a5f;color:#fff;text-decoration:none}</style></head>
<body><main><h1>The portal database is busy</h1>
<p>Your session is still signed in. This page will retry automatically every 10 seconds.</p>
<p>If it keeps happening, the database is under heavy load from a sync or import job.</p>
<a href="javascript:location.reload()">Retry now</a></main></body></html>`
  return new NextResponse(html, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/cron|api/webhooks|api/carriers/sync|api/upload-scores|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
