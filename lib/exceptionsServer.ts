import { supabaseAdmin } from './supabase'
import { eventSetsException } from './exceptions'

/** When each of the given carriers was most recently set to Exception Approved,
 *  read from the activity log. Only carriers with a recorded sign-off appear in
 *  the map. Server-only (uses the admin client). */
export async function fetchExceptionSince(dots: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (dots.length === 0) return out
  const { data } = await (supabaseAdmin as any)
    .from('carrier_events')
    .select('dot_number, detail, created_at')
    .in('dot_number', dots)
    .in('event_type', ['status_change', 'vetting_saved'])
    .order('created_at', { ascending: false })
    .limit(100000)
  for (const e of data ?? []) {
    const d = String(e.dot_number)
    if (out.has(d)) continue
    if (eventSetsException(e)) out.set(d, e.created_at)
  }
  return out
}
