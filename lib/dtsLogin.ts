// One DTS sign-in. Every DTS portal shares one set of accounts (one Supabase
// project), and the operations hub keeps the one login page:
// - a signed-out visit here is sent to the hub's /sso/vetting, which shows the
//   shared login if needed and then hands the session back to /auth/sso;
// - someone already signed in at the hub comes straight through, no second
//   sign-in.
// This portal's own login form is still reachable at /login?local=1, and a
// failed hand-off lands there, so a hub outage never locks anyone out.
export const DTS_LOGIN_ORIGIN =
  process.env.NEXT_PUBLIC_DTS_LOGIN_ORIGIN || 'https://dts-ap-portal.vercel.app'

/** A page in this app: a local path only, never another site. */
export function localPath(raw: string | null | undefined, fallback = '/carriers'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}

/** Sign in through the hub, then come back to `next`. */
export function hubSignInUrl(next: string): string {
  return `${DTS_LOGIN_ORIGIN}/sso/vetting?next=${encodeURIComponent(localPath(next))}`
}
