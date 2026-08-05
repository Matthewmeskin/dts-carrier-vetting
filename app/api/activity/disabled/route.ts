import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isBrokerwareDisabled } from '@/lib/revet'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — carriers that became disabled within a time range. Two sources are
// unioned so both kinds of "disabled" show up:
//   • Brokerware disables — carriers whose Brokerware status went non-Active,
//     dated by `brokerware_disabled_at` (stamped by the sync at transition).
//   • Manual "do-not-use" — dated by the status_change audit event that turned
//     do_not_use on, for carriers still flagged do_not_use.
//
// Query params:
//   from, to  — ISO dates (YYYY-MM-DD). `to` is inclusive of the whole day.
//   If neither is given, defaults to the last 30 days.
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

    type Item = {
      dot_number: string | null
      carrier_name: string | null
      disabled_at: string | null
      source: 'brokerware' | 'manual'
      status: string | null
      reason: string | null
    }
    const byDot = new Map<string, Item>()

    // Source A — Brokerware-disabled carriers with a transition date in range.
    const { data: bwRows, error: bwErr } = await (supabaseAdmin as any)
      .from('carriers')
      .select(
        'dot_number, legal_name, brokerware_status, brokerware_disabled_at, do_not_use'
      )
      .gte('brokerware_disabled_at', fromIso)
      .lte('brokerware_disabled_at', toIso)
      .order('brokerware_disabled_at', { ascending: false })
      .limit(2000)
    if (bwErr) throw bwErr
    for (const c of bwRows ?? []) {
      // Only keep the ones still disabled (a later re-enable clears the stamp,
      // but guard anyway).
      if (!isBrokerwareDisabled(c.brokerware_status)) continue
      byDot.set(String(c.dot_number), {
        dot_number: c.dot_number,
        carrier_name: c.legal_name ?? null,
        disabled_at: c.brokerware_disabled_at,
        source: 'brokerware',
        status: c.brokerware_status,
        reason: null,
      })
    }

    // Source B — manual do-not-use flips logged in the audit trail within range.
    const { data: events, error: evErr } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number, summary, detail, created_at')
      .eq('event_type', 'status_change')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(3000)
    if (evErr) throw evErr

    const manualDots = new Set<string>()
    const manualEventByDot = new Map<string, { at: string; reason: string | null }>()
    for (const e of events ?? []) {
      const dot = e.dot_number ? String(e.dot_number) : null
      if (!dot) continue
      const detail = (e.detail ?? {}) as Record<string, unknown>
      if (detail.do_not_use === true) {
        manualDots.add(dot)
        // Keep the most recent flip (rows are already newest-first).
        if (!manualEventByDot.has(dot)) {
          manualEventByDot.set(dot, {
            at: e.created_at,
            reason: (detail.do_not_use_reason as string) ?? null,
          })
        }
      }
    }
    if (manualDots.size > 0) {
      const dots = Array.from(manualDots)
      const stillFlagged = new Map<string, { legal_name: string | null; reason: string | null }>()
      for (let i = 0; i < dots.length; i += 500) {
        const { data } = await (supabaseAdmin as any)
          .from('carriers')
          .select('dot_number, legal_name, do_not_use, do_not_use_reason')
          .in('dot_number', dots.slice(i, i + 500))
        for (const c of data ?? []) {
          if (c.do_not_use === true) {
            stillFlagged.set(String(c.dot_number), {
              legal_name: c.legal_name ?? null,
              reason: c.do_not_use_reason ?? null,
            })
          }
        }
      }
      for (const dot of Array.from(manualDots)) {
        const car = stillFlagged.get(dot)
        if (!car) continue // no longer flagged do-not-use
        const ev = manualEventByDot.get(dot)
        // Don't clobber a Brokerware entry already recorded for this DOT.
        if (byDot.has(dot)) continue
        byDot.set(dot, {
          dot_number: dot,
          carrier_name: car.legal_name,
          disabled_at: ev?.at ?? null,
          source: 'manual',
          status: null,
          reason: car.reason ?? ev?.reason ?? null,
        })
      }
    }

    const rows = Array.from(byDot.values()).sort((a, b) => {
      const av = a.disabled_at ? Date.parse(a.disabled_at) : 0
      const bv = b.disabled_at ? Date.parse(b.disabled_at) : 0
      return bv - av
    })

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
