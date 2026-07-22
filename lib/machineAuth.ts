import { getSessionUser } from '@/lib/authServer'

// Auth for endpoints that are called BOTH by an automation (n8n, with a
// CRON_SECRET bearer token) and, optionally, by a signed-in user. Mirrors the
// check used by /api/upload-scores. Returns true when the caller is authorized.
export async function isMachineOrSessionAuthorized(
  request: Request
): Promise<boolean> {
  if (process.env.AUTH_ENABLED === 'false') return true
  const authHeader = request.headers.get('authorization')
  const hasCron =
    !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (hasCron) return true
  return !!(await getSessionUser())
}
