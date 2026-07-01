import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { computeRevetStatus, isBrokerwareActive } from '@/lib/revet'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Dashboard summary metrics for the carrier list page. Every count is scoped to
// carriers Brokerware reports as Active — disabled/inactive carriers are kept in
// the DB for history but excluded from vetting, so the dashboard matches the
// (active-only) list.
export async function GET() {
  try {
    const { data: carriers } = await supabaseAdmin
      .from('carriers')
      .select('dot_number, created_at, revet_interval_days, brokerware_status')

    // The set of active-Brokerware carriers everything else is scoped to.
    const activeDots = new Set(
      (carriers ?? [])
        .filter((c) => isBrokerwareActive(c.brokerware_status))
        .map((c) => c.dot_number)
    )
    const totalCarriers = activeDots.size

    // Latest score per carrier -> requires_revetting count (active only)
    const { data: scores } = await supabaseAdmin
      .from('carrier_scores')
      .select('dot_number, requires_revetting, upload_date')
      .order('upload_date', { ascending: false })
      .limit(100000)

    const latestScore = new Map<string, boolean>()
    for (const s of scores ?? []) {
      if (!latestScore.has(s.dot_number)) {
        latestScore.set(s.dot_number, !!s.requires_revetting)
      }
    }
    let requireRevetting = 0
    for (const [dot, needs] of Array.from(latestScore)) {
      if (needs && activeDots.has(dot)) requireRevetting++
    }

    // Latest insurance per carrier -> active hard stops (active only)
    const { data: insurance } = await supabaseAdmin
      .from('carrier_insurance')
      .select('dot_number, hard_stops, updated_at')
      .order('updated_at', { ascending: false })
      .limit(100000)

    const latestHardStops = new Map<string, string[]>()
    for (const i of insurance ?? []) {
      if (!latestHardStops.has(i.dot_number)) {
        latestHardStops.set(i.dot_number, i.hard_stops ?? [])
      }
    }
    let hardStopsActive = 0
    for (const [dot, hs] of Array.from(latestHardStops)) {
      if (hs && hs.length > 0 && activeDots.has(dot)) hardStopsActive++
    }

    // Delta changes in the last 7 days (active only)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentChanges } = await supabaseAdmin
      .from('carrier_delta_log')
      .select('dot_number, detected_at')
      .gte('detected_at', sevenDaysAgo)
      .limit(100000)
    const changesThisWeek = (recentChanges ?? []).filter((c) =>
      activeDots.has(c.dot_number)
    ).length

    // Carriers due or overdue for re-vetting (active only). The clock starts at
    // the last completed vetting, or onboarding for never-vetted carriers.
    const { data: vetting } = await supabaseAdmin
      .from('vetting_records')
      .select('dot_number, completed_at')
      .order('completed_at', { ascending: false })

    const lastReviewed = new Map<string, string | null>()
    for (const v of vetting ?? []) {
      if (!lastReviewed.has(v.dot_number)) {
        lastReviewed.set(v.dot_number, v.completed_at ?? null)
      }
    }

    const dueForRevet = (carriers ?? []).filter((c) => {
      if (!isBrokerwareActive(c.brokerware_status)) return false
      const r = computeRevetStatus(
        lastReviewed.get(c.dot_number) ?? null,
        c.created_at ?? null,
        c.revet_interval_days ?? null
      )
      return r.state === 'overdue' || r.state === 'due_soon'
    }).length

    return NextResponse.json({
      totalCarriers,
      requireRevetting,
      hardStopsActive,
      changesThisWeek,
      dueForRevet,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
