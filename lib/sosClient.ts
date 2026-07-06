// OpenSOS (opensosdata.com) client — Secretary-of-State business-entity lookup.
//
//   POST https://api.opensosdata.com/v1/lookup
//   header: x-api-key: <OPENSOS_API_KEY>
//   body:   { "entity_name": "...", "state": "TX" }
//   ?fresh=true forces a new scrape (bypasses the 7-day cache).
//
// The response shape varies by state, so we return the raw JSON and let the
// Haiku matcher (lib/sosMatch.ts) extract + normalize the fields we care about.

const BASE_URL = process.env.OPENSOS_BASE_URL || 'https://api.opensosdata.com'
const API_KEY = process.env.OPENSOS_API_KEY

export interface SosLookupResult {
  raw: unknown
  status: number
}

export function sosConfigured(): boolean {
  return Boolean(API_KEY)
}

/**
 * Look up a business entity by name in a state's Secretary-of-State registry.
 * Throws when the API key is missing or the request fails.
 */
export async function lookupEntity(params: {
  entityName: string
  state: string
  fresh?: boolean
  /** Abort the live scrape after this many ms so we never blow the function limit. */
  timeoutMs?: number
}): Promise<SosLookupResult> {
  if (!API_KEY) {
    throw new Error('OpenSOS is not configured (set OPENSOS_API_KEY)')
  }
  if (!params.entityName?.trim()) {
    throw new Error('lookupEntity requires an entity name')
  }
  if (!params.state?.trim()) {
    throw new Error('lookupEntity requires a 2-letter state code')
  }

  const url = `${BASE_URL}/v1/lookup${params.fresh ? '?fresh=true' : ''}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        entity_name: params.entityName.trim(),
        state: params.state.trim().toUpperCase(),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(params.timeoutMs ?? 30_000),
    })
  } catch (e: any) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(
        `OpenSOS timed out looking up "${params.entityName}" (${params.state}) — try again; results cache after the first pull`
      )
    }
    throw e
  }

  const text = await res.text()
  let raw: unknown
  try {
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = { rawText: text }
  }

  if (!res.ok) {
    const detail =
      raw && typeof raw === 'object' && 'message' in (raw as any)
        ? (raw as any).message
        : text.slice(0, 200)
    throw new Error(`OpenSOS API returned ${res.status}: ${detail || res.statusText}`)
  }

  return { raw, status: res.status }
}
