import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { supabaseAdmin } from '@/lib/supabase'
import { evaluateScores } from '@/lib/scoringRules'
import { sendComplianceAlert } from '@/lib/emailAlerts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    let total = 0
    let autoCleared = 0
    let errors = 0
    const flagged: FlaggedCarrier[] = []

    for (const rawRow of rawRows) {
      // Map columns to fields
      const r: Record<string, any> = {}
      for (const [header, field] of Object.entries(COLUMN_MAP)) {
        if (header in rawRow) r[field] = rawRow[header]
      }

      const dotNumber = r.dotNumber !== undefined && r.dotNumber !== null
        ? String(r.dotNumber).trim()
        : ''
      if (!dotNumber) continue

      total++

      try {
        // 1. Upsert carrier
        const carrierUpsert = {
          dot_number: dotNumber,
          legal_name: r.legalName ?? null,
          dba_name: r.dbaName ?? null,
          mc_number: r.mcNumber ?? null,
          city: r.city ?? null,
          state: r.state ?? null,
          street: r.street ?? null,
          zip: r.zip != null ? String(r.zip) : null,
          power_units: num(r.powerUnits),
          safety_rating: r.safetyRating ?? null,
        }

        const { error: upsertError } = await supabaseAdmin
          .from('carriers')
          .upsert([carrierUpsert], { onConflict: 'dot_number' })
        if (upsertError) throw upsertError

        // Read back carrier id
        const { data: carrierRow, error: readError } = await supabaseAdmin
          .from('carriers')
          .select('id, legal_name')
          .eq('dot_number', dotNumber)
          .single()
        if (readError || !carrierRow) throw readError ?? new Error('Carrier not found after upsert')

        // 2. Evaluate scores
        const scoresForEval: Record<string, number> = {
          gap_score: num(r.gapScore) ?? 0,
          crash_score: num(r.crashScore) ?? 0,
          violation_score: num(r.violationScore) ?? 0,
          csa_basics_score: num(r.csaBasicsScore) ?? 0,
          driver_oos_score: num(r.driverOosScore) ?? 0,
          critical_acute_violation_score: num(r.criticalAcuteScore) ?? 0,
        }
        const evaluation = evaluateScores(scoresForEval)

        // 3. Insert carrier_scores
        const scoreRow = {
          carrier_id: (carrierRow as any).id,
          dot_number: dotNumber,
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
        }

        const { error: scoreError } = await supabaseAdmin
          .from('carrier_scores')
          .insert([scoreRow])
        if (scoreError) throw scoreError

        // 4. Collect flagged
        if (evaluation.requiresRevetting) {
          flagged.push({
            dotNumber,
            legalName: (carrierRow as any).legal_name ?? r.legalName ?? '',
            gapScore: evaluation.gapScore,
            flaggedCategories: evaluation.flaggedCategories,
            approvalLevel: evaluation.approvalLevel,
            alertType: 'score_failure',
          })
        } else {
          autoCleared++
        }
      } catch (rowErr) {
        errors++
        console.error(`Row error for DOT ${dotNumber}:`, rowErr)
        continue
      }
    }

    // Send alert + log if any flagged
    if (flagged.length > 0) {
      const batchLabel = `Monthly Bluewire upload — ${new Date().toLocaleDateString()}`
      try {
        await sendComplianceAlert(flagged, batchLabel)
      } catch (alertErr) {
        console.error('Compliance alert failed:', alertErr)
      }

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

    return NextResponse.json({ total, flagged: flagged.length, autoCleared, errors })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
