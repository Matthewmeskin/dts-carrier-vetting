import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { supabaseAdmin } from '@/lib/supabase'
import { evaluateScores } from '@/lib/scoringRules'
import { isBrokerwareDisabled } from '@/lib/revet'
import { logCarrierEvents, type CarrierEventInput } from '@/lib/auditLog'
import { TablesInsert } from '@/lib/database.types'

const GOOD_STANDING_STATUSES = [
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
]

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CHUNK = 500

const COLUMN_MAP: Record<string, string> = {
  'DOT Number': 'dotNumber',
  mcNumber: 'mcNumber',
  'Legal Name': 'legalName',
  'Dba Name': 'dbaName',
  City: 'city',
  State: 'state',
  Street: 'street',
  Zip: 'zip',
  '# of Power Units': 'powerUnits',
  'Rating Label': 'safetyRating',
  'Gap Score': 'gapScore',
  'Crash Score': 'crashScore',
  'Violation Score': 'violationScore',
  'Csa Basics Score': 'csaBasicsScore',
  'Driver Oos Score': 'driverOosScore',
  'Critical Acute Violation Score': 'criticalAcuteScore',
  'New Entrant Score': 'newEntrantScore',
  'Mcs 150 Score': 'mcs150Score',
  'Judicial Hellholes': 'judicialHellholesScore',
  'Safety Rating Score': 'safetyRatingScore',
  'Severity Category': 'severityCategory',
  'Release Month': 'releaseMonth',
  'Status (My Carrier Network Upload.csv)': 'status',
}

function num(x: any): number | null {
  if (x === undefined || x === null || x === '') return null
  const n = Number(x)
  return Number.isNaN(n) ? null : n
}

// Bluewire's "Release Month" often arrives as an Excel date serial (days since
// 1899-12-30). Convert those to a readable "YYYY-MM"; pass real strings through.
function releaseMonth(x: any): string | null {
  if (x === undefined || x === null || x === '') return null
  const s = String(x).trim()
  const n = Number(s)
  if (!Number.isNaN(n) && n > 20000 && n < 90000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  return s
}

interface FlaggedCarrier {
  dotNumber: string
  legalName: string
  gapScore?: number
  flaggedCategories?: string[]
  approvalLevel?: string
  alertType: 'score_failure'
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!file || typeof (file as any).arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 })
    }

    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet)

    // Map + dedupe rows by DOT (last wins).
    const mapped = new Map<string, Record<string, any>>()
    for (const rawRow of rawRows) {
      const r: Record<string, any> = {}
      for (const [header, field] of Object.entries(COLUMN_MAP)) {
        if (header in rawRow) r[field] = rawRow[header]
      }
      const dot = r.dotNumber != null ? String(r.dotNumber).trim() : ''
      if (!dot) continue
      mapped.set(dot, r)
    }
    const total = mapped.size

    // 1. Bulk upsert carrier identity (chunked).
    const carrierRows: TablesInsert<'carriers'>[] = Array.from(mapped.entries()).map(
      ([dot, r]) => ({
        dot_number: dot,
        legal_name: r.legalName ?? null,
        dba_name: r.dbaName ?? null,
        mc_number: r.mcNumber != null ? String(r.mcNumber) : null,
        city: r.city ?? null,
        state: r.state ?? null,
        street: r.street ?? null,
        zip: r.zip != null ? String(r.zip) : null,
        power_units: num(r.powerUnits),
        safety_rating: r.safetyRating ?? null,
      })
    )
    for (let i = 0; i < carrierRows.length; i += CHUNK) {
      const { error } = await supabaseAdmin
        .from('carriers')
        .upsert(carrierRows.slice(i, i + CHUNK), { onConflict: 'dot_number' })
      if (error) throw error
    }

    // 2. Resolve carrier ids + standing in bulk.
    const idByDot = new Map<string, string>()
    const metaByDot = new Map<
      string,
      { id: string; status: string | null; doNotUse: boolean | null; brokerware: string | null }
    >()
    const dots = Array.from(mapped.keys())
    for (let i = 0; i < dots.length; i += CHUNK) {
      const { data, error } = await supabaseAdmin
        .from('carriers')
        .select('id, dot_number, carrier_status, do_not_use, brokerware_status')
        .in('dot_number', dots.slice(i, i + CHUNK))
      if (error) throw error
      for (const c of data ?? []) {
        const dot = String((c as any).dot_number)
        idByDot.set(dot, (c as any).id)
        metaByDot.set(dot, {
          id: (c as any).id,
          status: (c as any).carrier_status ?? null,
          doNotUse: (c as any).do_not_use ?? null,
          brokerware: (c as any).brokerware_status ?? null,
        })
      }
    }

    // 3. Evaluate and build score rows in memory.
    // One timestamp for the whole batch — this upload becomes a single snapshot
    // point in each carrier's trend (see the (dot_number, upload_date) unique key).
    const uploadedAt = new Date().toISOString()
    let autoCleared = 0
    const flagged: FlaggedCarrier[] = []
    const scoreRows: TablesInsert<'carrier_scores'>[] = []
    // Per-dot pass result for the recertification pass below.
    const evalByDot = new Map<string, { passed: boolean; gap: number | null }>()
    for (const [dot, r] of Array.from(mapped.entries())) {
      const carrierId = idByDot.get(dot)
      if (!carrierId) continue

      const evaluation = evaluateScores({
        gap_score: num(r.gapScore) ?? 0,
        crash_score: num(r.crashScore),
        violation_score: num(r.violationScore),
        csa_basics_score: num(r.csaBasicsScore),
        driver_oos_score: num(r.driverOosScore),
        critical_acute_violation_score: num(r.criticalAcuteScore),
        new_entrant_score: num(r.newEntrantScore),
        mcs_150_score: num(r.mcs150Score),
        safety_rating_score: num(r.safetyRatingScore),
      })

      scoreRows.push({
        carrier_id: carrierId,
        dot_number: dot,
        gap_score: num(r.gapScore),
        crash_score: num(r.crashScore),
        violation_score: num(r.violationScore),
        csa_basics_score: num(r.csaBasicsScore),
        driver_oos_score: num(r.driverOosScore),
        critical_acute_violation_score: num(r.criticalAcuteScore),
        new_entrant_score: num(r.newEntrantScore),
        mcs_150_score: num(r.mcs150Score),
        judicial_hellholes_score: num(r.judicialHellholesScore),
        safety_rating_score: num(r.safetyRatingScore),
        severity_category: r.severityCategory ?? null,
        rating_label: r.safetyRating ?? null,
        release_month: releaseMonth(r.releaseMonth),
        overall_pass: evaluation.overallPass,
        requires_revetting: evaluation.requiresRevetting,
        flagged_scores: evaluation.flaggedCategories,
        approval_level: evaluation.approvalLevel,
        // Each upload is its own snapshot/trend point, keyed by this timestamp.
        upload_date: uploadedAt,
      })

      evalByDot.set(dot, {
        passed: !evaluation.requiresRevetting,
        gap: evaluation.gapScore ?? null,
      })

      if (evaluation.requiresRevetting) {
        flagged.push({
          dotNumber: dot,
          legalName: r.legalName ?? '',
          gapScore: evaluation.gapScore,
          flaggedCategories: evaluation.flaggedCategories,
          approvalLevel: evaluation.approvalLevel,
          alertType: 'score_failure',
        })
      } else {
        autoCleared++
      }
    }

    // 4. Bulk upsert scores (idempotent per carrier + release month).
    for (let i = 0; i < scoreRows.length; i += CHUNK) {
      const { error } = await supabaseAdmin
        .from('carrier_scores')
        .upsert(scoreRows.slice(i, i + CHUNK), {
          onConflict: 'dot_number,upload_date',
        })
      if (error) throw error
    }

    const errors = total - scoreRows.length
    const batchLabel = `Monthly Bluewire upload — ${new Date().toLocaleDateString()}`

    // 5. Auto-recertification — reset the re-vet timer for carriers that are in
    // good standing AND still pass this month's scores AND remain RMIS-certified
    // with no hard stops. This is the recurring compliance checkpoint.
    const insByDot = new Map<string, { certified: boolean; hardStops: number }>()
    for (let i = 0; i < dots.length; i += CHUNK) {
      const { data } = await (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('dot_number, rmis_is_certified, hard_stops')
        .in('dot_number', dots.slice(i, i + CHUNK))
      for (const row of data ?? []) {
        insByDot.set(String(row.dot_number), {
          certified: row.rmis_is_certified === true,
          hardStops: Array.isArray(row.hard_stops) ? row.hard_stops.length : 0,
        })
      }
    }

    const nowIso = new Date().toISOString()
    const recertDots: string[] = []
    const events: CarrierEventInput[] = []
    let recertified = 0
    for (const [dot] of Array.from(mapped.entries())) {
      const meta = metaByDot.get(dot)
      const ev = evalByDot.get(dot)
      if (!meta || !ev) continue

      const goodStanding =
        !!meta.status &&
        GOOD_STANDING_STATUSES.includes(meta.status) &&
        !meta.doNotUse &&
        !isBrokerwareDisabled(meta.brokerware)
      const ins = insByDot.get(dot)
      const rmisOk = ins?.certified === true && ins.hardStops === 0

      if (ev.passed && goodStanding && rmisOk) {
        recertDots.push(dot)
        events.push({
          dot,
          carrierId: meta.id,
          type: 'recertification',
          summary: `Auto re-certified — scores pass and RMIS certified; re-vet timer reset.`,
          detail: { gap: ev.gap, batch: batchLabel },
          actor: 'Bluewire upload',
        })
        recertified++
      } else if (!ev.passed) {
        events.push({
          dot,
          carrierId: meta.id,
          type: 'score_flag',
          summary: `Scores flagged for re-vet on ${batchLabel} (GAP ${ev.gap ?? '—'}).`,
          detail: { gap: ev.gap, batch: batchLabel },
          actor: 'Bluewire upload',
        })
      }
    }

    // Reset the re-vet clock in bulk for recertified carriers.
    for (let i = 0; i < recertDots.length; i += CHUNK) {
      await supabaseAdmin
        .from('carriers')
        .update({ revet_reset_at: nowIso } as any)
        .in('dot_number', recertDots.slice(i, i + CHUNK))
    }
    await logCarrierEvents(events)

    // Log if any flagged. No instant email — the score_flag events above feed
    // the daily digest.
    if (flagged.length > 0) {
      try {
        const sentTo = (process.env.ALERT_EMAIL_TO ?? '')
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
        await supabaseAdmin.from('alert_log').insert([
          {
            alert_type: 'monthly_score_failure',
            dot_numbers: flagged.map((f) => f.dotNumber),
            carrier_names: flagged.map((f) => f.legalName),
            alert_summary: `${flagged.length} carrier(s) require re-vetting from ${batchLabel}`,
            sent_to: sentTo,
          },
        ])
      } catch (logErr) {
        console.error('alert_log insert failed:', logErr)
      }
    }

    return NextResponse.json({
      total,
      flagged: flagged.length,
      autoCleared,
      recertified,
      errors,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
