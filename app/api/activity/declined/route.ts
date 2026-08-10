import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — carriers Declined within a time range, dated by the status_change audit
// event that set the decline. Only carriers still Declined are returned.
//
// Query params: from, to (YYYY-MM-DD; `to` inclusive). Defaults to last 30 days.
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

    const { data: events, error } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number, detail, actor, created_at')
      .eq('event_type', 'status_change')
      .filter('detail->>carrier_status', 'eq', 'Declined')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) throw error

    // Most recent decline event per carrier.
    const byDot = new Map<string, { at: string; actor: string | null }>()
    for (const e of events ?? []) {
      const dot = e.dot_number ? String(e.dot_number) : null
      if (!dot || byDot.has(dot)) continue
      byDot.set(dot, { at: e.created_at, actor: e.actor ?? null })
    }

    const dots = Array.from(byDot.keys())
    const rows: {
      dot_number: string
      carrier_name: string | null
      declined_at: string
      note: string | null
      actor: string | null
    }[] = []
    for (let i = 0; i < dots.length; i += 500) {
      const { data } = await (supabaseAdmin as any)
        .from('carriers')
        .select('dot_number, legal_name, carrier_status, status_note, do_not_use_reason')
        .in('dot_number', dots.slice(i, i + 500))
      for (const c of data ?? []) {
        // Only carriers still Declined (a later status change drops them).
        if (c.carrier_status !== 'Declined') continue
        const ev = byDot.get(String(c.dot_number))
        if (!ev) continue
        rows.push({
          dot_number: String(c.dot_number),
          carrier_name: c.legal_name ?? null,
          declined_at: ev.at,
          note: c.status_note ?? c.do_not_use_reason ?? null,
          actor: ev.actor,
        })
      }
    }

    rows.sort((a, b) => Date.parse(b.declined_at) - Date.parse(a.declined_at))

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
