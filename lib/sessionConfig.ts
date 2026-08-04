// Idle auto-logout configuration, shared by the client IdleLogout component and
// the middleware backstop so both agree on the timeout.
//
// A signed-in user is logged out after IDLE minutes with no activity. The client
// shows a warning WARN seconds before and drives the actual sign-out; the
// middleware independently rejects a stale session cookie so it can't be replayed
// after the idle window even without the client running.

/** Cookie the client refreshes on activity; middleware reads it to detect idle. */
export const IDLE_COOKIE = 'dts_active'

/** Minutes of inactivity before auto-logout (env-overridable, default 30). */
export function idleTimeoutMinutes(): number {
  const raw = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : 30
}

/** Idle timeout in milliseconds. */
export function idleTimeoutMs(): number {
  return idleTimeoutMinutes() * 60 * 1000
}

/** How long before the timeout to show the "you're about to be signed out"
 *  warning, in seconds. Capped so it never exceeds the idle window. */
export function idleWarnSeconds(): number {
  const idleMs = idleTimeoutMs()
  return Math.min(60, Math.max(10, Math.floor(idleMs / 1000 / 4)))
}
