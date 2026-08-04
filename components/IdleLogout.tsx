'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabaseBrowser'
import {
  IDLE_COOKIE,
  idleTimeoutMs,
  idleWarnSeconds,
} from '@/lib/sessionConfig'

// Auto-logout on inactivity. Tracks user activity, warns shortly before the
// timeout, and signs the user out when the idle window elapses. Activity and
// logout are synced across tabs via localStorage, and the `dts_active` cookie
// lets the middleware reject a stale session even if this component isn't running.
//
// Mounted once in the root layout. It no-ops on the /login page (no session).

const LS_ACTIVITY = 'dts_last_activity'
const LS_LOGOUT = 'dts_logout'
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
] as const

function writeActivityCookie(ts: number) {
  const maxAge = Math.ceil(idleTimeoutMs() / 1000) + 60
  const secure = typeof location !== 'undefined' && location.protocol === 'https:'
  document.cookie =
    `${IDLE_COOKIE}=${ts}; path=/; max-age=${maxAge}; samesite=lax` +
    (secure ? '; secure' : '')
}

export function IdleLogout() {
  const pathname = usePathname()
  const enabled = pathname !== '/login' && !pathname.startsWith('/auth')

  const lastActivity = useRef<number>(Date.now())
  const cookieWrittenAt = useRef<number>(0)
  const loggingOut = useRef<boolean>(false)
  const [warnLeft, setWarnLeft] = useState<number | null>(null)

  const doLogout = useCallback(async () => {
    if (loggingOut.current) return
    loggingOut.current = true
    try {
      // Tell other tabs to log out too.
      localStorage.setItem(LS_LOGOUT, String(Date.now()))
    } catch {
      /* ignore */
    }
    try {
      const supabase = createSupabaseBrowserClient()
      await supabase.auth.signOut()
    } catch {
      /* ignore — still redirect */
    }
    writeActivityCookie(0)
    document.cookie = 'dts_session_start=; path=/; max-age=0'
    document.cookie = 'dts_mfa=; path=/; max-age=0'
    window.location.href = '/login?timeout=1'
  }, [])

  const bump = useCallback(() => {
    const now = Date.now()
    lastActivity.current = now
    if (warnLeft !== null) setWarnLeft(null)
    // Throttle cross-tab + cookie writes to at most once every 5s.
    if (now - cookieWrittenAt.current > 5000) {
      cookieWrittenAt.current = now
      writeActivityCookie(now)
      try {
        localStorage.setItem(LS_ACTIVITY, String(now))
      } catch {
        /* ignore */
      }
    }
  }, [warnLeft])

  useEffect(() => {
    if (!enabled) return
    const idleMs = idleTimeoutMs()
    const warnMs = idleWarnSeconds() * 1000

    // Seed activity now (covers a fresh login / full navigation).
    lastActivity.current = Date.now()
    writeActivityCookie(lastActivity.current)

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, bump, { passive: true })
    )

    // Cross-tab: activity in another tab keeps this one alive; logout in another
    // tab redirects this one.
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_ACTIVITY && e.newValue) {
        const ts = Number(e.newValue)
        if (Number.isFinite(ts) && ts > lastActivity.current) {
          lastActivity.current = ts
          setWarnLeft(null)
        }
      } else if (e.key === LS_LOGOUT) {
        if (!loggingOut.current) {
          loggingOut.current = true
          window.location.href = '/login?timeout=1'
        }
      }
    }
    window.addEventListener('storage', onStorage)

    const tick = setInterval(() => {
      const idle = Date.now() - lastActivity.current
      if (idle >= idleMs) {
        void doLogout()
      } else if (idle >= idleMs - warnMs) {
        setWarnLeft(Math.max(0, Math.ceil((idleMs - idle) / 1000)))
      } else if (warnLeft !== null) {
        setWarnLeft(null)
      }
    }, 1000)

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump))
      window.removeEventListener('storage', onStorage)
      clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bump, doLogout])

  if (!enabled || warnLeft === null) return null

  const mm = Math.floor(warnLeft / 60)
  const ss = String(warnLeft % 60).padStart(2, '0')
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-gray-900">
          Still there?
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          You’ll be signed out in{' '}
          <span className="font-semibold text-gray-900">
            {mm}:{ss}
          </span>{' '}
          due to inactivity.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void doLogout()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={bump}
            className="rounded-md bg-dts-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00547f]"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  )
}
