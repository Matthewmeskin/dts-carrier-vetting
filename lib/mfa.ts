// Email-code two-factor auth (2FA) on top of Supabase password login.
//
// Supabase's native MFA is authenticator-app / SMS only, so email codes are
// implemented here: after a password login the user must enter a 6-digit code
// we email (via Resend). A verified session carries a signed, httpOnly cookie
// that the middleware checks on every request. Uses Web Crypto (HMAC) so the
// same verify runs in both the Edge middleware and the Node API routes.

/** Cookie marking a session as MFA-verified (signed, httpOnly). */
export const MFA_COOKIE = 'dts_mfa'

/** Enforcement is opt-in via env so enabling it is a deliberate, reversible
 *  switch (set MFA_ENABLED=true once email delivery is confirmed). */
export function mfaEnabled(): boolean {
  return process.env.MFA_ENABLED === 'true'
}

/** How long a login code is valid, in minutes. */
export const MFA_CODE_TTL_MIN = 10
/** Max verify attempts per code before it's dead. */
export const MFA_MAX_ATTEMPTS = 5
/** Max codes a user can request per window. */
export const MFA_MAX_SENDS = 5
export const MFA_SEND_WINDOW_MIN = 15
/** How long an MFA-verified cookie stays valid (align to the session cap). */
export const MFA_COOKIE_TTL_MS = 12 * 60 * 60 * 1000

function secret(): string {
  return (
    process.env.MFA_COOKIE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'dts-mfa-fallback-secret'
  )
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** SHA-256 hex of a value (used to store code hashes, never the raw code). */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Hash a login code bound to the user so a leaked hash can't be reused. */
export function hashCode(code: string, userId: string): Promise<string> {
  return sha256Hex(`${code}:${userId}`)
}

/** Mint the signed cookie value proving this session cleared MFA. */
export async function signMfaCookie(userId: string): Promise<string> {
  const issued = Date.now()
  const mac = await hmacHex(secret(), `${userId}.${issued}`)
  return `v1.${issued}.${mac}`
}

/** Constant-time-ish verify of the MFA cookie for a given user. */
export async function verifyMfaCookie(
  value: string | undefined | null,
  userId: string
): Promise<boolean> {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return false
  const issued = Number(parts[1])
  if (!Number.isFinite(issued)) return false
  if (Date.now() - issued > MFA_COOKIE_TTL_MS) return false
  const expected = await hmacHex(secret(), `${userId}.${issued}`)
  const got = parts[2]
  if (expected.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ got.charCodeAt(i)
  }
  return diff === 0
}
