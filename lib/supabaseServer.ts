import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Auth-aware Supabase client for Server Components and Route Handlers. Reads the
// signed-in user from the request cookies (anon key + RLS). This is distinct
// from the service-role admin client in lib/supabase.ts, which bypasses RLS and
// carries no user identity.
export function createSupabaseServerClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component without a response to mutate —
            // safe to ignore; middleware refreshes the session cookie.
          }
        },
      },
    }
  )
}
