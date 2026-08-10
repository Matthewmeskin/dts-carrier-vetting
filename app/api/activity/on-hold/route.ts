import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — carriers placed On Hold within a time range, dated by the status_change
// audit event that set the hold. Only carriers still On Hold are returned (a
// later "take off hold" removes them).
//
// Query params:
//   from, to  — ISO dates (YYYY-MM-DD). `to` is inclusive of the whole day.
//   Defaults to the last 30 days when neither is given.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const fromParam = params.get('from')
    const toParam = params.get('to')

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const parseDay = (v: string | null, endOfDay: boolean): number | null => {
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
      const [y, mo, d] = v.split('-').map(Number)
      return endOfDay
        ? Date.UTC(y, mo - 1, d, 23, 59, 59, 999)
        : Date.UTC(y, mo - 1, d, 0, 0, 0, 0)
    }
    const fromMs = parseDay(fromParam, false) ?? now - 30 * dayMs
    const toMs = parseDay(toParam, true) ?? now
    const fromIso = new Date(fromMs).toISOString()
    const toIso = new Date(toMs).toISOString()

    // status_change events that set On Hold within the range (bulk + single both
    // stamp detail.carrier_status = 'On Hold').
    const { data: events, error } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number, summary, detail, actor, created_at')
      .eq('event_type', 'status_change')
      .filter('detail->>carrier_status', 'eq', 'On Hold')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    // Keep the most recent hold event per carrier.
    const heldByDot = new Map<string, { at: string; actor: string | null }>()
    for (const e of events ?? []) {
      const dot = e.dot_number ? String(e.dot_number) : null
      if (!dot || heldByDot.has(dot)) continue
      heldByDot.set(dot, { at: e.created_at, actor: e.actor ?? null })
    }

    const dots = Array.from(heldByDot.keys())
    const rows: {
      dot_number: string
      carrier_name: string | null
      held_at: string
      note: string | null
      actor: string | null
    }[] = []
    for (let i = 0; i < dots.length; i += 500) {
      const { data } = await (supabaseAdmin as any)
        .from('carriers')
        .select('dot_number, legal_name, carrier_status, status_note')
        .in('dot_number', dots.slice(i, i + 500))
      for (const c of data ?? []) {
        // Only carriers still On Hold (a later un-hold drops them).
        if (c.carrier_status !== 'On Hold') continue
        const ev = heldByDot.get(String(c.dot_number))
        if (!ev) continue
        rows.push({
          dot_number: String(c.dot_number),
          carrier_name: c.legal_name ?? null,
          held_at: ev.at,
          note: c.status_note ?? null,
          actor: ev.actor,
        })
      }
    }

    rows.sort((a, b) => Date.parse(b.held_at) - Date.parse(a.held_at))

    return NextResponse.json({
      from: fromIso,
      to: toIso,
      count: rows.length,
      carriers: rows,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
