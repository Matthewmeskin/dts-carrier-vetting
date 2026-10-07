'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from './Logo'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { cn } from '@/lib/utils'

// The chrome every signed-in page wears: a sidebar on desktop and a compact
// header with a swipeable menu row on phones — the same shell the Payables
// hub and the other DTS portals use, so this one reads as part of the family.

const HUB_URL = 'https://dts-ap-portal.vercel.app/'

type NavItem = { href: string; label: string; badge?: 'approvals' }
type NavGroup = { label: string; items: NavItem[]; directorOnly?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Carriers',
    items: [
      { href: '/carriers', label: 'Carriers' },
      { href: '/changes', label: 'Changes' },
      { href: '/activity', label: 'Activity' },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/assignments', label: 'Assignments' },
      { href: '/approvals', label: 'Approvals', badge: 'approvals' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/factors', label: 'Factors' },
      { href: '/upload', label: 'Upload Scores' },
      { href: '/w9-upload', label: 'W-9 Upload' },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/admin/users', label: 'Users' }],
    directorOnly: true,
  },
]

// Pages that draw their own full screen and must not get the shell.
const BARE = new Set(['/login', '/mfa', '/reset-password', '/no-access'])

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [me, setMe] = useState<{ email: string | null; role: Role } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const bare = BARE.has(pathname)

  useEffect(() => {
    if (bare) return
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
  }, [pathname, bare])

  // Open approval requests — a badge on the Approvals link so a Manager /
  // Director sees work waiting without opening the page.
  useEffect(() => {
    if (!me) return
    let cancelled = false
    fetch('/api/approvals?count=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && typeof d?.pending === 'number') setPendingApprovals(d.pending)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [me, pathname])

  if (bare) return <>{children}</>

  async function signOut() {
    const supabase = createSupabaseBrowserClient()
    // Every DTS portal: they share one sign-in (lib/dtsLogin.ts).
    await supabase.auth.signOut({ scope: 'global' })
    // Also clear our session-tracking cookies so a fresh login starts clean.
    document.cookie = 'dts_active=; path=/; max-age=0'
    document.cookie = 'dts_session_start=; path=/; max-age=0'
    document.cookie = 'dts_mfa=; path=/; max-age=0'
    window.location.assign('/login')
  }

  const groups = NAV_GROUPS.filter((g) => !g.directorOnly || me?.role === 'director')
  const flat = groups.flatMap((g) => g.items)

  const badge = (item: NavItem, on: boolean) => {
    if (item.badge !== 'approvals' || pendingApprovals === 0 || !me) return null
    const urgent = me.role !== 'staff'
    return (
      <span
        title={`${pendingApprovals} waiting for approval`}
        className={cn(
          'ml-auto rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums',
          on ? 'bg-white text-maroon' : urgent ? 'bg-maroon text-white' : 'bg-gray-200 text-gray-700'
        )}
      >
        {pendingApprovals}
      </span>
    )
  }

  const userBlock = (compact: boolean) =>
    me ? (
      <div className={cn('flex items-center gap-3', compact ? '' : 'justify-between')}>
        <div className={cn('min-w-0 leading-tight', compact ? 'hidden text-right sm:block' : '')}>
          <Link
            href="/account"
            title="Account · change password"
            className="block truncate text-2xs text-ink transition hover:text-brandblue-700"
          >
            {me.email}
          </Link>
          <div className="text-2xs uppercase tracking-wider text-ink-faint">{ROLE_LABEL[me.role] ?? me.role}</div>
        </div>
        <button
          onClick={signOut}
          className="shrink-0 rounded border border-line px-2.5 py-1.5 font-heading text-[13px] font-medium text-ink-muted transition hover:border-maroon-200 hover:text-maroon"
        >
          Sign out
        </button>
      </div>
    ) : loaded ? (
      <Link href="/login" className="font-heading text-[13px] font-medium text-maroon hover:underline">
        Sign in
      </Link>
    ) : null

  const brand = (logoClass: string) => (
    <Link href="/carriers" className="flex items-center gap-2.5 whitespace-nowrap font-heading text-[15px] font-bold text-maroon">
      <Logo className={cn(logoClass, 'w-auto shrink-0')} />
      <span className="leading-tight">Carrier Vetting</span>
    </Link>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="border-b border-line px-3 py-2.5">{brand('h-9')}</div>
        <div className="flex-1 overflow-y-auto px-1.5 py-3">
          <a
            href={HUB_URL}
            className="mb-3 block rounded px-2.5 py-1 font-heading text-2xs font-medium text-ink-faint transition hover:bg-brandblue-50 hover:text-brandblue-700"
          >
            ← All portals
          </a>
          <nav className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-2.5 pb-1 font-heading text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                  {g.label}
                </div>
                <div className="flex flex-col gap-0.5">
                  {g.items.map((item) => {
                    const on = isActive(pathname, item.href)
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={on ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2 rounded px-2.5 py-1.5 font-heading text-[13px] font-medium transition',
                          on ? 'bg-maroon text-white' : 'text-ink-muted hover:bg-brandblue-50 hover:text-brandblue-700'
                        )}
                      >
                        {item.label}
                        {badge(item, on)}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-t border-line px-3 py-2.5">{userBlock(false)}</div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Phones and tablets: compact header with a swipeable menu row */}
        <header className="sticky top-0 z-20 border-b border-line bg-white lg:hidden">
          <div className="flex items-center gap-3 px-3 py-2">
            {brand('h-8')}
            <div className="ml-auto">{userBlock(true)}</div>
          </div>
          <div className="overflow-x-auto border-t border-line px-3 py-1.5 [-webkit-overflow-scrolling:touch]">
            <nav className="flex w-max items-center gap-1">
              <a
                href={HUB_URL}
                className="rounded px-2 py-1.5 font-heading text-[13px] font-medium text-ink-faint hover:bg-brandblue-50 hover:text-brandblue-700"
              >
                ← Portals
              </a>
              {flat.map((item) => {
                const on = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 font-heading text-[13px] font-medium transition',
                      on ? 'bg-maroon text-white' : 'text-ink-muted hover:bg-brandblue-50 hover:text-brandblue-700'
                    )}
                  >
                    {item.label}
                    {badge(item, on)}
                  </Link>
                )
              })}
            </nav>
          </div>
        </header>

        <main className="p-3 sm:p-4 lg:p-5">{children}</main>
        <footer className="px-4 py-4 text-2xs text-ink-faint lg:px-5">
          Diversified Transportation Services — Torrance, CA · Internal compliance tool
        </footer>
      </div>
    </div>
  )
}
