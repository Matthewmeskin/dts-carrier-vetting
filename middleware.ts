import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Require a signed-in user for the whole portal. Refreshes the Supabase session
// cookie on every request and redirects unauthenticated users to /login.
//
// The matcher below excludes Next internals and the cron/webhook API routes,
// which authenticate with a bearer token / shared secret and are called by
// external systems (n8n, the inbound-email Worker) with no user session.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Master switch — leave unset until the first users exist, so deploying the
  // login code can't lock anyone out. Set AUTH_ENABLED=true to enforce.
  if (process.env.AUTH_ENABLED !== 'true') return response

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return response

  const supabase = createServerClient(url, anon, {
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
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isLogin = path === '/login'
  // The OAuth callback must run without a session (it's what creates one).
  const isAuthFlow = path.startsWith('/auth')

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

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/cron|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
