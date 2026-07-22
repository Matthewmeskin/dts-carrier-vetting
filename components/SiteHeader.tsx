'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from './Logo'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/carriers', label: 'Carriers' },
  { href: '/changes', label: 'Changes' },
  { href: '/activity', label: 'Activity' },
  { href: '/factors', label: 'Factors' },
  { href: '/upload', label: 'Upload Scores' },
  { href: '/w9-upload', label: 'W-9 Upload' },
]

export function SiteHeader() {
  const pathname = usePathname()
  const [me, setMe] = useState<{ email: string | null; role: Role } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (pathname === '/login') return
    let cancelled = false
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.user) setMe({ email: d.user.email, role: d.user.role })
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  // The login page renders its own standalone screen.
  if (pathname === '/login') return null

  async function signOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
        <Link href="/carriers" className="flex items-center gap-3">
          <Logo className="h-8 w-auto sm:h-10" />
          <span className="hidden border-l border-gray-200 pl-3 text-sm font-medium text-gray-500 sm:inline">
            Carrier Compliance Portal
          </span>
        </Link>
        <nav className="-mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 text-sm sm:w-auto sm:justify-end sm:gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'whitespace-nowrap rounded px-2.5 py-1.5 transition hover:bg-gray-100 sm:px-3',
                pathname.startsWith(n.href) ? 'font-medium text-dts-blue' : 'text-gray-700'
              )}
            >
              {n.label}
            </Link>
          ))}
          {me?.role === 'director' && (
            <Link
              href="/admin/users"
              className={cn(
                'whitespace-nowrap rounded px-2.5 py-1.5 transition hover:bg-gray-100 sm:px-3',
                pathname.startsWith('/admin') ? 'font-medium text-dts-blue' : 'text-gray-700'
              )}
            >
              Users
            </Link>
          )}
          {me && (
            <div className="ml-1 flex items-center gap-2 border-l border-gray-200 pl-2">
              <div className="hidden text-right sm:block">
                <div className="max-w-[160px] truncate text-xs text-gray-600" title={me.email ?? ''}>
                  {me.email}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">
                  {ROLE_LABEL[me.role] ?? me.role}
                </div>
              </div>
              <button
                onClick={signOut}
                className="whitespace-nowrap rounded px-2.5 py-1.5 text-gray-600 hover:bg-gray-100"
              >
                Sign out
              </button>
            </div>
          )}
          {loaded && !me && (
            <Link
              href="/login"
              className="ml-1 whitespace-nowrap rounded border-l border-gray-200 pl-3 py-1.5 pr-2.5 font-medium text-dts-blue hover:bg-gray-100"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
