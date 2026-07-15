'use client'

import { createBrowserClient } from '@supabase/ssr'

// Auth-aware Supabase client for the browser (login form, sign-out). Uses the
// public anon key; RLS applies.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
