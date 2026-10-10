'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import { POLICY_VERSION, POLICY_URL } from '@/lib/policyVersion'
import { NavIcon, type NavIconName } from './NavIcons'
import { applySidebarCollapsed, setSidebarCollapsed, useSidebarCollapsed } from './sidebarState'
import { memberInitials } from '@/lib/assignments'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { cn } from '@/lib/utils'

// The chrome every signed-in page wears: a sidebar on desktop and a compact
// header with a swipeable menu row on phones — the same shell the Payables
// hub and the other DTS portals use, so this one reads as part of the family.

const HUB_URL = 'https://dts-ap-portal.vercel.app/'

type NavItem = { href: string; label: string; icon: NavIconName; badge?: 'approvals' }
type NavGroup = { label: string; items: NavItem[]; directorOnly?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Carriers',
    items: [
      { href: '/carriers', label: 'Carriers', icon: 'truck' },
      { href: '/changes', label: 'Changes', icon: 'changes' },
      { href: '/activity', label: 'Activity', icon: 'activity' },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/assignments', label: 'Assignments', icon: 'assignments' },
      { href: '/approvals', label: 'Approvals', icon: 'approvals', badge: 'approvals' },
      { href: '/exception-review', label: 'Exception Review', icon: 'approvals' },
      { href: '/policy-check', label: 'Policy Check', icon: 'grid' },
    ],
  },
  {
    label: 'Data',
    items: [
      { href: '/upload', label: 'Upload Scores', icon: 'upload' },
      { href: '/w9-upload', label: 'W-9 Upload', icon: 'document' },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/admin/users', label: 'Users', icon: 'users' }],
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
  const [me, setMe] = useState<{ email: string | null; role: Role; policyAckVersion?: string | null } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const bare = BARE.has(pathname)
  const collapsed = useSidebarCollapsed()
  // Phones: the same sidebar, as a drawer from the left. Closes on navigation.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Re-apply the folded state after React's dev-mode remount resets <html>.
  useLayoutEffect(() => {
    applySidebarCollapsed()
  }, [])

  // Who's signed in — once per page load, not on every navigation (the
  // session can't change underneath a client-side route change).
  useEffect(() => {
    if (bare) return
    let cancelled = false
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d?.user) setMe({ email: d.user.email, role: d.user.role, policyAckVersion: d.user.policyAckVersion ?? null })
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare])

  // Open approval requests — a badge on the Approvals link so a Manager /
  // Director sees work waiting without opening the page.
  const approvalsFetchedAt = useRef(0)
  useEffect(() => {
    if (!me) return
    // Refresh on navigation, but no more than once a minute.
    if (Date.now() - approvalsFetchedAt.current < 60_000) return
    approvalsFetchedAt.current = Date.now()
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

  const badge = (item: NavItem, on: boolean) => {
    if (item.badge !== 'approvals' || pendingApprovals === 0 || !me) return null
    const urgent = me.role !== 'staff'
    return (
      <span
        title={`${pendingApprovals} waiting for approval`}
        className={cn(
          'ml-auto rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums',
          // On the rail it sits on the icon's corner.
          'rail:absolute rail:-right-0.5 rail:-top-0.5 rail:ml-0 rail:px-1 rail:text-[9px] rail:leading-[14px]',
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
    <Link
      href="/carriers"
      // min-w-0 lets the name wrap to two lines when the logo, the name and
      // the collapse chevron do not fit on one; it never runs under the chevron.
      className="flex min-w-0 items-center gap-2.5 font-heading text-[15px] font-bold leading-tight text-maroon rail:justify-center"
      title="Carrier Vetting"
    >
      <Logo className={cn(logoClass, 'w-auto shrink-0 rail:h-7')} />
      <span className="min-w-0 rail:hidden">Carrier Vetting</span>
    </Link>
  )

  // Fold the sidebar to an icon rail, or open it back up.
  const collapseButton = (
    <button
      type="button"
      onClick={() => setSidebarCollapsed(!collapsed)}
      title={collapsed ? 'Open the menu' : 'Collapse the menu'}
      aria-label={collapsed ? 'Open the menu' : 'Collapse the menu'}
      aria-expanded={!collapsed}
      className="hidden h-7 w-7 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-brandblue-50 hover:text-brandblue-700 lg:flex"
    >
      <NavIcon name={collapsed ? 'chevrons-right' : 'chevrons-left'} className="h-4 w-4" />
    </button>
  )

  const closeButton = (
    <button
      type="button"
      onClick={() => setOpen(false)}
      title="Close the menu"
      aria-label="Close the menu"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted transition hover:bg-brandblue-50 hover:text-brandblue-700 lg:hidden"
    >
      <NavIcon name="close" className="h-4 w-4" />
    </button>
  )

  const initials = me?.email ? memberInitials(me.email) : '?'

  return (
    <div className="min-h-screen lg:flex">
      {/* Phones: a backdrop behind the open drawer */}
      <div
        className={cn('fixed inset-0 z-30 bg-black/40 lg:hidden', open ? '' : 'hidden')}
        onClick={() => setOpen(false)}
        aria-hidden
      />
      {/* The sidebar: a drawer from the left on phones, a sticky column on desktop */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-white transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full',
          'lg:sticky lg:top-0 lg:z-auto lg:w-52 lg:translate-x-0 lg:transition-[width] lg:duration-150 rail:w-14'
        )}
        aria-label="Menu"
      >
        <div className="flex items-center justify-between gap-1 border-b border-line px-3 py-2.5 rail:flex-col rail:gap-1.5 rail:px-0">
          {brand('h-9')}
          {collapseButton}
          {closeButton}
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 py-3">
          <a
            href={HUB_URL}
            title="All portals"
            className="mb-3 flex items-center gap-2 rounded px-2.5 py-1 font-heading text-2xs font-medium text-ink-faint transition hover:bg-brandblue-50 hover:text-brandblue-700 rail:justify-center rail:px-0 rail:py-1.5"
          >
            <NavIcon name="grid" className="hidden h-4 w-4 rail:block" />
            <span className="rail:hidden">← All portals</span>
          </a>
          <nav className="flex flex-col gap-4 rail:gap-2">
            {groups.map((g, gi) => (
              <div key={g.label} className={cn(gi > 0 && 'rail:border-t rail:border-line rail:pt-2')}>
                <div className="px-2.5 pb-1 font-heading text-2xs font-semibold uppercase tracking-wider text-ink-faint rail:hidden">
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
                        title={item.label}
                        className={cn(
                          'relative flex items-center gap-2 rounded px-2.5 py-1.5 font-heading text-[13px] font-medium transition rail:justify-center rail:px-0 rail:py-2',
                          on ? 'bg-maroon text-white' : 'text-ink-muted hover:bg-brandblue-50 hover:text-brandblue-700'
                        )}
                      >
                        <NavIcon
                          name={item.icon}
                          className={cn('h-4 w-4 shrink-0 rail:h-[18px] rail:w-[18px]', on ? 'text-white' : 'text-ink-faint')}
                        />
                        <span className="rail:hidden">{item.label}</span>
                        {badge(item, on)}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
        {/* Footer, open: who's signed in, sign out, theme. */}
        <div className="border-t border-line px-3 py-2.5 rail:hidden">
          {userBlock(false)}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wider text-ink-faint">Theme</span>
            <ThemeToggle />
          </div>
        </div>
        {/* Footer, rail: the same three things as icons. */}
        <div className="hidden flex-col items-center gap-2 border-t border-line py-2.5 rail:flex">
          {me ? (
            <>
              <Link
                href="/account"
                title={`${me.email ?? ''} · ${ROLE_LABEL[me.role] ?? me.role} · Account`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon font-heading text-2xs font-semibold text-white transition hover:bg-maroon-700"
              >
                {initials}
              </Link>
              <button
                onClick={signOut}
                title="Sign out"
                aria-label="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded border border-line text-ink-muted transition hover:border-maroon-200 hover:text-maroon"
              >
                <NavIcon name="signout" className="h-4 w-4" />
              </button>
            </>
          ) : loaded ? (
            <Link href="/login" title="Sign in" className="font-heading text-[13px] font-medium text-maroon hover:underline">
              In
            </Link>
          ) : null}
          <ThemeToggle variant="compact" />
        </div>
      </aside>

      {/* The content column fills the viewport, so a page that is still loading
          (or a short one) keeps the footer at the bottom instead of mid-screen. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Phones and tablets: a compact header; the menu button opens the drawer */}
        <header className="sticky top-0 z-20 border-b border-line bg-white lg:hidden">
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              title="Menu"
              aria-label="Open the menu"
              aria-expanded={open}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded border border-line text-ink-muted transition hover:border-maroon-200 hover:text-maroon"
            >
              <NavIcon name="menu" className="h-5 w-5" />
              {me && pendingApprovals > 0 ? (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-maroon ring-2 ring-white" aria-hidden />
              ) : null}
            </button>
            {brand('h-8')}
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle variant="compact" />
              {userBlock(true)}
            </div>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-4 lg:p-5">
          {me && POLICY_VERSION && me.policyAckVersion !== POLICY_VERSION && (
            <PolicyAckBanner onDone={() => setMe({ ...me, policyAckVersion: POLICY_VERSION })} />
          )}
          {children}
        </main>
        <footer className="px-4 py-4 text-2xs text-ink-faint lg:px-5">
          Diversified Transportation Services — Torrance, CA · Internal compliance tool
        </footer>
      </div>
    </div>
  )
}

// Policy Section 11: everyone who selects, tenders, tracks, or pays carriers
// acknowledges the current policy. Shown until they do.
function PolicyAckBanner({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function ack() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/me/policy-ack', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not save')
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span>
        The Carrier Vetting Policy v{POLICY_VERSION} is in effect.{' '}
        {POLICY_URL && (
          <a href={POLICY_URL} target="_blank" rel="noreferrer" className="font-semibold underline">
            Read it
          </a>
        )}{' '}
        and confirm you have read it and will follow it.
      </span>
      <button
        onClick={ack}
        disabled={busy}
        className="rounded bg-maroon px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'I have read and will follow it'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  )
}
