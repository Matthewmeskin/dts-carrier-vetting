import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  sendDailyDigest,
  type DigestCarrier,
  type DigestReply,
} from '@/lib/emailAlerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// POST — send ONE daily digest of everything that needs attention since the
// last digest: new hard stops, new review flags (ELD / scores / insurance), and
// RMIS replies that still say the COI isn't received. Individual detections keep
// logging to each carrier's activity timeline in real time; this only batches
// the outbound email so the inbox gets one message a day instead of many.
//
// Window = time of the last digest (from email_digests) → now, defaulting to the
// last 24h on the first run. Pass {"dryRun": true} to preview without sending or
// advancing the window. Pass {"sinceHours": N} to override the lookback.
// CRON_SECRET-guarded.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const dryRun = body?.dryRun === true

    const now = new Date()
    const until = now.toISOString()

    // Watermark: pick up where the last digest left off.
    let since: string
    if (Number(body?.sinceHours) > 0) {
      since = new Date(now.getTime() - Number(body.sinceHours) * 3600e3).toISOString()
    } else {
      const { data: last } = await (supabaseAdmin as any)
        .from('email_digests')
        .select('sent_at')
        .eq('kind', 'daily')
        .order('sent_at', { ascending: false })
        .limit(1)
      since =
        last && last.length > 0 && last[0].sent_at
          ? last[0].sent_at
          : new Date(now.getTime() - 24 * 3600e3).toISOString()
    }

    // Per-carrier accumulator.
    type Bucket = { hardStops: Set<string>; reviews: Set<string> }
    const byDot = new Map<string, Bucket>()
    const replies: { dot: string; note: string }[] = []
    // Monthly Bluewire uploads flag a large batch for re-vet — that's the re-vet
    // queue, not per-carrier alerts. Summarize as a count instead of listing each.
    const scoreFlaggedDots = new Set<string>()
    const bucket = (dot: string): Bucket => {
      let b = byDot.get(dot)
      if (!b) {
        b = { hardStops: new Set(), reviews: new Set() }
        byDot.set(dot, b)
      }
      return b
    }

    // 1) New hard stops from the RMIS delta monitor.
    const { data: deltaRows } = await (supabaseAdmin as any)
      .from('carrier_delta_log')
      .select('dot_number, hard_stops_detected, detected_at')
      .gt('detected_at', since)
      .limit(100000)
    for (const r of deltaRows ?? []) {
      const stops: string[] = (r.hard_stops_detected ?? []).filter(Boolean)
      if (stops.length === 0) continue
      const b = bucket(String(r.dot_number))
      stops.forEach((s) => b.hardStops.add(s))
    }

    // 2) Review flags + hard stops + RMIS replies from the event log.
    const { data: events } = await (supabaseAdmin as any)
      .from('carrier_events')
      .select('dot_number, event_type, summary, detail, created_at')
      .gt('created_at', since)
      .in('event_type', [
        'hard_stop',
        'eld_flag',
        'score_flag',
        'insurance_change',
        'insurance_refresh_response',
      ])
      .limit(100000)
    for (const e of events ?? []) {
      const dot = String(e.dot_number)
      if (e.event_type === 'hard_stop') {
        const stops: string[] = (e.detail?.hardStops as string[])?.filter(Boolean) ?? [
          e.summary,
        ]
        stops.forEach((s) => bucket(dot).hardStops.add(s))
      } else if (e.event_type === 'insurance_refresh_response') {
        // Only surface replies that still need us to chase the COI.
        if (e.detail?.classification === 'coi_not_received') {
          replies.push({ dot, note: e.summary ?? 'RMIS reply — COI not yet received.' })
        }
      } else if (e.event_type === 'score_flag') {
        // Bulk re-vet queue — counted, not listed per carrier.
        scoreFlaggedDots.add(dot)
      } else {
        // eld_flag, insurance_change — acute, list individually.
        bucket(dot).reviews.add(e.summary ?? e.event_type)
      }
    }

    // Resolve carrier identity for everyone involved.
    const allDots = Array.from(
      new Set([...Array.from(byDot.keys()), ...replies.map((r) => r.dot)])
    )
    const carrierByDot = new Map<string, any>()
    if (allDots.length > 0) {
      const { data: carriers } = await supabaseAdmin
        .from('carriers')
        .select('dot_number, legal_name, mc_number')
        .in('dot_number', allDots)
      for (const c of carriers ?? []) carrierByDot.set(String((c as any).dot_number), c)
    }
    const nameOf = (dot: string) => carrierByDot.get(dot)?.legal_name ?? `DOT ${dot}`
    const mcOf = (dot: string) => carrierByDot.get(dot)?.mc_number ?? null

    const hardStops: DigestCarrier[] = []
    const reviews: DigestCarrier[] = []
    for (const [dot, b] of Array.from(byDot.entries())) {
      const base = { dotNumber: dot, legalName: nameOf(dot), mcNumber: mcOf(dot) }
      if (b.hardStops.size > 0) {
        hardStops.push({ ...base, hardStops: Array.from(b.hardStops), reviews: [] })
      }
      if (b.reviews.size > 0) {
        reviews.push({ ...base, hardStops: [], reviews: Array.from(b.reviews) })
      }
    }
    const replyList: DigestReply[] = replies.map((r) => ({
      dotNumber: r.dot,
      legalName: nameOf(r.dot),
      note: r.note,
    }))

    const scoreFlagged = scoreFlaggedDots.size
    const itemCount =
      hardStops.length + reviews.length + replyList.length + (scoreFlagged > 0 ? 1 : 0)
    const payload = { since, until, hardStops, reviews, replies: replyList, scoreFlagged }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        since,
        until,
        itemCount,
        scoreFlagged,
        hardStops,
        reviews,
        replies: replyList,
      })
    }

    // Nothing to say → advance the window, skip the email (no inbox noise).
    if (itemCount === 0) {
      await (supabaseAdmin as any)
        .from('email_digests')
        .insert([{ kind: 'daily', since, sent_at: until, item_count: 0 }])
      return NextResponse.json({ since, until, itemCount: 0, sent: false, note: 'Nothing to report.' })
    }

    const result = await sendDailyDigest(payload)
    if (!result.sent) {
      // Don't advance the window on send failure — retry the same items next run.
      return NextResponse.json(
        { since, until, itemCount, sent: false, error: result.error },
        { status: 502 }
      )
    }

    await (supabaseAdmin as any)
      .from('email_digests')
      .insert([{ kind: 'daily', since, sent_at: until, item_count: itemCount }])

    return NextResponse.json({
      since,
      until,
      sent: true,
      hardStops: hardStops.length,
      reviews: reviews.length,
      replies: replyList.length,
      scoreFlagged,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
