// A cross-invocation mutex for RMIS calls. RMIS allows only one session per
// client id, so overlapping calls (backfill + delta at once) fail with
// "Password could not be validated". Every RMIS call goes through withRmisLock
// so calls are serialized process-wide via a single lock row in Postgres.

import { supabaseAdmin } from './supabase'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

let seq = 0

async function acquire(token: string, ttlSeconds: number): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any).rpc('acquire_rmis_lock', {
    p_holder: token,
    p_ttl_seconds: ttlSeconds,
  })
  if (error) throw new Error(`RMIS lock acquire failed: ${error.message}`)
  return data === true
}

async function release(token: string): Promise<void> {
  await (supabaseAdmin as any).rpc('release_rmis_lock', { p_holder: token })
}

export interface RmisLockOptions {
  /** Label for the lock holder (aids debugging). */
  label?: string
  /** How long the lock is held before it auto-expires (crash safety). */
  ttlSeconds?: number
  /** Max time to wait to acquire before giving up. */
  maxWaitMs?: number
  /** Poll interval while waiting. */
  pollMs?: number
}

/**
 * Run `fn` while holding the RMIS lock. Waits (polling) for the lock to free up,
 * then releases it when `fn` settles. Throws if the lock can't be acquired
 * within maxWaitMs.
 */
export async function withRmisLock<T>(
  fn: () => Promise<T>,
  opts: RmisLockOptions = {}
): Promise<T> {
  const ttl = opts.ttlSeconds ?? 25
  const maxWait = opts.maxWaitMs ?? 30_000
  const poll = opts.pollMs ?? 400
  const token = `${opts.label ?? 'rmis'}-${Date.now()}-${++seq}`

  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await acquire(token, ttl)) break
    if (Date.now() - start > maxWait) {
      throw new Error('RMIS is busy (another RMIS job holds the lock) — try again')
    }
    await sleep(poll)
  }

  try {
    return await fn()
  } finally {
    try {
      await release(token)
    } catch {
      // Best-effort release; the TTL will free the lock if this fails.
    }
  }
}
