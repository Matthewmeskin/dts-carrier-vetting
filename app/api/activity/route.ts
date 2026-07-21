import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — a cross-carrier audit log: every logged action, filterable by day and by
// user (actor), so you can see who did what on a given date. Reads the shared
// carrier_events table (which every action stamps with an actor + timestamp).
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const dateParam = params.get('date') // YYYY-MM-DD (UTC day)
    const actor = params.get('actor')

    const TZ = 'America/Los_Angeles' // Pacific (PST/PDT)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? '')
      ? (dateParam as string)
      : new Date().toLocaleDateString('en-CA', { timeZone: TZ }) // Pacific "today"

    // Day boundaries are the selected calendar day in Pacific, expressed in UTC
    // (so an 11 PM PT action stays on its Pacific date, not the next UTC day).
    const offsetMs = (utcMs: number) => {
      const dt = new Date(utcMs)
      const asTz = new Date(dt.toLocaleString('en-US', { timeZone: TZ }))
      const asUtc = new Date(dt.toLocaleString('en-US', { timeZone: 'UTC' }))
      return asTz.getTime() - asUtc.getTime()
    }
    const [y, mo, d] = date.split('-').map(Number)
    const startGuess = Date.UTC(y, mo - 1, d, 0, 0, 0, 0)
    const endGuess = Date.UTC(y, mo - 1, d, 23, 59, 59, 999)
    const start = new Date(startGuess - offsetMs(startGuess)).toISOString()
    const end = new Date(endGuess - offsetMs(endGuess)).toISOString()

    let query = (supabaseAdmin as any)
      .from('carrier_events')
      .select('id, dot_number, event_type, summary, actor, created_at')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(3000)
    if (actor) query = query.eq('actor', actor)
    const { data: events, error } = await query
    if (error) throw error

    // Attach carrier names (batch lookup by DOT).
    const dots = Array.from(
      new Set((events ?? []).map((e: any) => e.dot_number).filter(Boolean))
    ) as string[]
    const nameByDot = new Map<string, string>()
    for (let i = 0; i < dots.length; i += 500) {
      const { data } = await (supabaseAdmin as any)
        .from('carriers')
        .select('dot_number, legal_name')
        .in('dot_number', dots.slice(i, i + 500))
      for (const c of data ?? []) {
        nameByDot.set(String(c.dot_number), c.legal_name ?? '')
      }
    }

    // Distinct actors active on this day (for the user filter), independent of
    // the currently-selected actor.
    const { data: actorRows } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('actor')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(5000)
    const actors = Array.from(
      new Set((actorRows ?? []).map((r: any) => r.actor).filter(Boolean))
    ).sort() as string[]

    const rows = (events ?? []).map((e: any) => ({
      id: e.id,
      dot_number: e.dot_number,
      carrier_name: e.dot_number ? nameByDot.get(String(e.dot_number)) ?? null : null,
      event_type: e.event_type,
      summary: e.summary,
      actor: e.actor,
      created_at: e.created_at,
    }))

    return NextResponse.json({ date, actors, events: rows })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
