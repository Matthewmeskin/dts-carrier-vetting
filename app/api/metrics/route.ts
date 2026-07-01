import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { computeRevetStatus, isBrokerwareDisabled } from '@/lib/revet'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Dashboard summary metrics for the carrier list page.
export async function GET() {
  try {
    // Total carriers
    const { count: totalCarriers } = await supabaseAdmin
      .from('carriers')
      .select('id', { count: 'exact', head: true })

    // Latest score per carrier -> requires_revetting count
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
    const requireRevetting = Array.from(latestScore.values()).filter(Boolean).length

    // Latest insurance per carrier -> active hard stops
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
    const hardStopsActive = Array.from(latestHardStops.values()).filter(
      (hs) => hs && hs.length > 0
    ).length

    // Delta changes in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count: changesThisWeek } = await supabaseAdmin
      .from('carrier_delta_log')
      .select('id', { count: 'exact', head: true })
      .gte('detected_at', sevenDaysAgo)

    // Carriers due or overdue for re-vetting (clock starts at last completed
    // vetting, or onboarding for never-vetted carriers).
    const { data: carriers } = await supabaseAdmin
      .from('carriers')
      .select('dot_number, created_at, revet_interval_days, brokerware_status')

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
      if (isBrokerwareDisabled(c.brokerware_status)) return false
      const r = computeRevetStatus(
        lastReviewed.get(c.dot_number) ?? null,
        c.created_at ?? null,
        c.revet_interval_days ?? null
      )
      return r.state === 'overdue' || r.state === 'due_soon'
    }).length

    return NextResponse.json({
      totalCarriers: totalCarriers ?? 0,
      requireRevetting,
      hardStopsActive,
      changesThisWeek: changesThisWeek ?? 0,
      dueForRevet,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
