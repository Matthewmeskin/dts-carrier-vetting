import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { Database } from './database.types'

type DB = SupabaseClient<Database>

// Clients are created lazily on first use so that importing this module
// (e.g. during Next.js build-time page-data collection) does not require
// environment variables to be present. At runtime the real env vars are read.

let _admin: DB | null = null
let _browser: DB | null = null

function getAdminClient(): DB {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    )
  }
  _admin = createClient(url, key)
  return _admin
}

function getBrowserClient(): DB {
  if (_browser) return _browser
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase browser client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }
  _browser = createClient(url, key)
  return _browser
}

function lazyProxy(getter: () => DB): DB {
  return new Proxy({} as DB, {
    get(_target, prop) {
      const client = getter()
      const value = (client as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? value.bind(client) : value
    },
  })
}

// Server-side client with service role (for API routes)
export const supabaseAdmin = lazyProxy(getAdminClient)

// Browser client (for client components)
export const supabase = lazyProxy(getBrowserClient)
