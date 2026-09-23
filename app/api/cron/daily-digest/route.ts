import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  sendDailyDigest,
  type DigestCarrier,
  type DigestReply,
  type OpenHardStopCarrier,
} from '@/lib/emailAlerts'
import { isBrokerwareDisabled } from '@/lib/revet'

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
    // Carriers whose hard stop(s) fully cleared (insurance restored) — the cleared
    // items, keyed by DOT.
    const resolvedByDot = new Map<string, Set<string>>()
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
        'hard_stop_resolved',
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
      } else if (e.event_type === 'hard_stop_resolved') {
        const cleared: string[] =
          (e.detail?.resolved as string[])?.filter(Boolean) ?? [e.summary]
        let set = resolvedByDot.get(dot)
        if (!set) {
          set = new Set()
          resolvedByDot.set(dot, set)
        }
        cleared.forEach((s) => set!.add(s))
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
      new Set([
        ...Array.from(byDot.keys()),
        ...Array.from(resolvedByDot.keys()),
        ...replies.map((r) => r.dot),
        ...Array.from(scoreFlaggedDots),
      ])
    )
    const carrierByDot = new Map<string, any>()
    if (allDots.length > 0) {
      const { data: carriers } = await supabaseAdmin
        .from('carriers')
        .select('dot_number, legal_name, mc_number, brokerware_status')
        .in('dot_number', allDots)
      for (const c of carriers ?? []) carrierByDot.set(String((c as any).dot_number), c)
    }
    const nameOf = (dot: string) => carrierByDot.get(dot)?.legal_name ?? `DOT ${dot}`
    const mcOf = (dot: string) => carrierByDot.get(dot)?.mc_number ?? null
    // Carriers disabled in Brokerware aren't being used — their alerts are
    // noise, so leave them out of every digest section.
    const disabled = (dot: string) =>
      isBrokerwareDisabled(carrierByDot.get(dot)?.brokerware_status)

    const hardStops: DigestCarrier[] = []
    const reviews: DigestCarrier[] = []
    for (const [dot, b] of Array.from(byDot.entries())) {
      if (disabled(dot)) continue
      const base = { dotNumber: dot, legalName: nameOf(dot), mcNumber: mcOf(dot) }
      if (b.hardStops.size > 0) {
        hardStops.push({ ...base, hardStops: Array.from(b.hardStops), reviews: [] })
      }
      if (b.reviews.size > 0) {
        reviews.push({ ...base, hardStops: [], reviews: Array.from(b.reviews) })
      }
    }
    // Resolved carriers passed the active + all-cleared filter WHEN THE EVENT
    // FIRED — but coverage can flap (No-Current-Info ↔ Valid) between pulls, so a
    // carrier that cleared earlier in the window may be hard-stopped again now.
    // Only show a resolution if the carrier is STILL clear: no current hard stops
    // AND not in this digest's hard-stop list. Otherwise it's not resolved.
    const resolvedDots = Array.from(resolvedByDot.keys())
    const currentHardCount = new Map<string, number>()
    if (resolvedDots.length > 0) {
      const { data: insRows } = await (supabaseAdmin as any)
        .from('carrier_insurance')
        .select('dot_number, hard_stops, updated_at')
        .in('dot_number', resolvedDots)
        .order('updated_at', { ascending: false })
      for (const r of insRows ?? []) {
        const d = String(r.dot_number)
        // First row per dot is its latest (ordered desc).
        if (!currentHardCount.has(d)) {
          currentHardCount.set(d, (r.hard_stops ?? []).filter(Boolean).length)
        }
      }
    }
    const hardStopDots = new Set(hardStops.map((c) => c.dotNumber))
    const resolved: DigestCarrier[] = []
    for (const [dot, cleared] of Array.from(resolvedByDot.entries())) {
      if (disabled(dot) || cleared.size === 0) continue
      // Still hard-stopped now (flapped back) → not a resolution.
      if ((currentHardCount.get(dot) ?? 0) > 0 || hardStopDots.has(dot)) continue
      resolved.push({
        dotNumber: dot,
        legalName: nameOf(dot),
        mcNumber: mcOf(dot),
        // Frame each item as cleared so a green "must be Valid" line doesn't read
        // like an open problem.
        hardStops: Array.from(cleared).map((s) => `Cleared: ${s}`),
        reviews: [],
      })
    }

    // 3) STANDING RISK LIST — every Brokerware-active carrier whose hard stop is
    //    still open right now, not just the ones detected in this window. The
    //    sections above are change notifications: a carrier alerted once on the
    //    day its insurance lapsed would never be mentioned again, even while it
    //    kept hauling for DTS. This repeats until the stop actually clears.
    //    Carriers a reviewer has knowingly signed off on (Exception Approved)
    //    are split into their own quieter list: the exception accepts the risk
    //    rather than removing it, so it still gets reported, but it shouldn't
    //    compete with carriers nobody has looked at. An exception that RMIS
    //    hasn't caught up with after EXCEPTION_MAX_DAYS escalates back, so a
    //    temporary exception can't quietly become permanent.
    const EXCEPTION_MAX_DAYS = 30
    const openHardStops: OpenHardStopCarrier[] = []
    const acceptedExceptions: OpenHardStopCarrier[] = []
    {
      const { data: activeCarriers } = await (supabaseAdmin as any)
        .from('carriers')
        .select('dot_number, legal_name, mc_number, brokerware_status, last_hauled_at, carrier_status')
        .limit(100000)
      const activeByDot = new Map<string, any>()
      for (const c of activeCarriers ?? []) {
        if (isBrokerwareDisabled(c.brokerware_status)) continue
        activeByDot.set(String(c.dot_number), c)
      }
      const activeDots = Array.from(activeByDot.keys())
      // carrier_insurance keeps every RMIS pull; the view exposes the newest row
      // per carrier so "open right now" reads only current state.
      const { data: latestIns } = activeDots.length
        ? await (supabaseAdmin as any)
            .from('carrier_insurance_latest')
            .select('dot_number, hard_stops')
            .in('dot_number', activeDots)
            .limit(100000)
        : { data: [] }
      const openByDot = new Map<string, string[]>()
      for (const r of latestIns ?? []) {
        const stops: string[] = (r.hard_stops ?? []).filter(Boolean)
        if (stops.length > 0) openByDot.set(String(r.dot_number), stops)
      }

      // "Open since" = the most recent transition INTO hard stop. The delta
      // monitor only records a stop in hard_stops_detected when it is new, so
      // the newest such row is the start of the current episode.
      const openDots = Array.from(openByDot.keys())
      const onsetByDot = new Map<string, string>()
      if (openDots.length > 0) {
        const { data: onsets } = await (supabaseAdmin as any)
          .from('carrier_delta_log')
          .select('dot_number, hard_stops_detected, detected_at')
          .in('dot_number', openDots)
          .order('detected_at', { ascending: false })
          .limit(100000)
        for (const r of onsets ?? []) {
          const d = String(r.dot_number)
          if (onsetByDot.has(d)) continue
          if (((r.hard_stops_detected ?? []).filter(Boolean)).length === 0) continue
          onsetByDot.set(d, r.detected_at)
        }
      }

      // When each exception-approved carrier was signed off, so an aged
      // exception can be escalated. Recorded either as a status_change or as a
      // vetting save that set the status.
      const exceptionDots = openDots.filter(
        (d) => activeByDot.get(d)?.carrier_status === 'Exception Approved'
      )
      const exceptionSinceByDot = new Map<string, string>()
      if (exceptionDots.length > 0) {
        const { data: statusEvents } = await (supabaseAdmin as any)
          .from('carrier_events')
          .select('dot_number, event_type, summary, detail, created_at')
          .in('dot_number', exceptionDots)
          .in('event_type', ['status_change', 'vetting_saved'])
          .order('created_at', { ascending: false })
          .limit(100000)
        for (const e of statusEvents ?? []) {
          const d = String(e.dot_number)
          if (exceptionSinceByDot.has(d)) continue
          const setsException =
            e.detail?.carrier_status === 'Exception Approved' ||
            (Array.isArray(e.detail?.changes) &&
              e.detail.changes.some((ch: unknown) =>
                String(ch).includes('Exception Approved')
              ))
          if (!setsException) continue
          exceptionSinceByDot.set(d, e.created_at)
        }
      }

      const dayMs = 24 * 3600e3
      const daysSince = (iso: string | null | undefined): number | null => {
        const ms = iso ? Date.parse(iso) : NaN
        return Number.isFinite(ms)
          ? Math.max(0, Math.floor((now.getTime() - ms) / dayMs))
          : null
      }
      for (const [dot, stops] of Array.from(openByDot.entries())) {
        const c = activeByDot.get(dot)
        const exceptionSince = exceptionSinceByDot.get(dot) ?? null
        const exceptionDays = daysSince(exceptionSince)
        const entry: OpenHardStopCarrier = {
          dotNumber: dot,
          legalName: c?.legal_name ?? `DOT ${dot}`,
          mcNumber: c?.mc_number ?? null,
          hardStops: stops,
          daysOpen: daysSince(onsetByDot.get(dot)),
          lastHauledAt: c?.last_hauled_at ?? null,
          exceptionSince,
          exceptionDays,
        }
        const accepted = c?.carrier_status === 'Exception Approved'
        // An exception with no recorded sign-off date can't be aged, so treat it
        // as current rather than escalating on missing data.
        const aged = exceptionDays !== null && exceptionDays > EXCEPTION_MAX_DAYS
        if (accepted && !aged) {
          acceptedExceptions.push(entry)
        } else {
          if (accepted && aged) {
            entry.note = `Exception approved ${exceptionDays} days ago — RMIS still not updated.`
          }
          openHardStops.push(entry)
        }
      }
      // Most recently hauled first — those are the ones actually being used.
      const byLastHauled = (a: OpenHardStopCarrier, b: OpenHardStopCarrier) => {
        const av = a.lastHauledAt ? Date.parse(a.lastHauledAt) : -Infinity
        const bv = b.lastHauledAt ? Date.parse(b.lastHauledAt) : -Infinity
        return bv - av
      }
      openHardStops.sort(byLastHauled)
      acceptedExceptions.sort(byLastHauled)
    }

    const replyList: DigestReply[] = replies
      .filter((r) => !disabled(r.dot))
      .map((r) => ({
        dotNumber: r.dot,
        legalName: nameOf(r.dot),
        note: r.note,
      }))

    const scoreFlagged = Array.from(scoreFlaggedDots).filter(
      (dot) => !disabled(dot)
    ).length
    // An open hard stop counts as something to report, so the digest keeps
    // going out daily while any active carrier is uninsured — silence only
    // means the list is genuinely empty.
    const itemCount =
      hardStops.length +
      openHardStops.length +
      acceptedExceptions.length +
      resolved.length +
      reviews.length +
      replyList.length +
      (scoreFlagged > 0 ? 1 : 0)
    const payload = {
      since,
      until,
      hardStops,
      openHardStops,
      acceptedExceptions,
      resolved,
      reviews,
      replies: replyList,
      scoreFlagged,
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        since,
        until,
        itemCount,
        scoreFlagged,
        hardStops,
        openHardStops,
        acceptedExceptions,
        resolved,
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
        { since, until, itemCount, sent: false, to: result.to ?? null, error: result.error },
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
      to: result.to ?? null,
      hardStops: hardStops.length,
      openHardStops: openHardStops.length,
      acceptedExceptions: acceptedExceptions.length,
      resolved: resolved.length,
      reviews: reviews.length,
      replies: replyList.length,
      scoreFlagged,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
