import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { computeRevetStatus, isBrokerwareDisabled } from '@/lib/revet'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIVE_STATUSES = [
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
]

interface CarrierSummary {
  id: string
  dot_number: string
  mc_number: string | null
  legal_name: string | null
  dba_name: string | null
  city: string | null
  state: string | null
  power_units: number | null
  safety_rating: string | null
  carrier_status: string | null
  do_not_use: boolean | null
  gap_score: number | null
  requires_revetting: boolean | null
  flagged_scores: string[] | null
  approval_level: string | null
  score_upload_date: string | null
  auto_status: string | null
  cargo_status: string | null
  auto_expiration_date: string | null
  cargo_expiration_date: string | null
  rmis_overall_pass: boolean | null
  rmis_is_certified: boolean | null
  rmis_status: 'certified' | 'not_certified' | 'not_in_rmis' | 'pending'
  hard_stops: string[] | null
  insurance_fetched_at: string | null
  last_reviewed: string | null
  revet_interval_days: number | null
  created_at: string | null
  brokerware_status: string | null
  business_type: string | null
  eld_enrolled: boolean | null
  w9_on_file: boolean | null
  agreement_on_file: boolean | null
  is_factoring: boolean | null
  noa_on_file: boolean
}

/** The later of two ISO timestamps (either may be null). */
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function latestPerDot<T extends Record<string, any>>(rows: T[]): Record<string, T> {
  const map: Record<string, T> = {}
  for (const row of rows) {
    const dot = String(row.dot_number)
    if (!(dot in map)) map[dot] = row
  }
  return map
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const status = params.get('status')
    const requiresRevetting = params.get('requiresRevetting') === 'true'
    const dueForRevet = params.get('dueForRevet') === 'true'
    const activeOnly = params.get('activeOnly') === 'true'
    const search = params.get('search')
    // Default high enough to return the whole roster (the list view shows all
    // carriers and sorts/filters client-side); callers can still page explicitly.
    const limit = Number(params.get('limit')) || 10000
    const offset = Number(params.get('offset')) || 0

    // Base carriers query
    let carrierQuery = supabaseAdmin.from('carriers').select('*')

    if (search) {
      carrierQuery = carrierQuery.or(
        `legal_name.ilike.%${search}%,dot_number.ilike.%${search}%`
      )
    }

    if (status === 'Approved') {
      carrierQuery = carrierQuery.eq('carrier_status', 'Approved')
    } else if (status === 'DoNotUse') {
      carrierQuery = carrierQuery.eq('do_not_use', true)
    }
    // NeedsReview and HardStop are handled after merge (need related data)

    // Fetch carriers, scores, insurance and vetting in parallel. Select only the
    // columns the list needs — crucially NOT carrier_insurance.raw_rmis_response,
    // which is a ~40KB XML blob per row and would balloon the payload to tens of
    // MB across the roster. Explicit high limit avoids PostgREST's 1000-row cap
    // silently hiding carriers as history accumulates.
    const [carriersRes, scoresRes, insRes, vetRes, noaRes] = await Promise.all([
      carrierQuery,
      supabaseAdmin
        .from('carrier_scores')
        .select(
          'dot_number, gap_score, requires_revetting, flagged_scores, approval_level, upload_date, release_month'
        )
        // Latest by FMCSA release month (not upload time) so a back-filled older
        // month doesn't override the current month on the roster.
        .order('release_month', { ascending: false })
        .order('upload_date', { ascending: false })
        .limit(100000),
      // One row per carrier (server-side latest) so the whole roster fits under
      // the API row cap — pulling all history could drop carriers past the cap.
      (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select(
          'dot_number, auto_status, cargo_status, auto_expiration_date, cargo_expiration_date, rmis_overall_pass, rmis_is_certified, hard_stops, w9_company_type, rmis_eld_enrolled, w9_on_file, broker_carrier_agreement_on_file, is_factoring, fetched_at, updated_at'
        )
        .limit(100000),
      supabaseAdmin
        .from('vetting_records')
        .select('dot_number, completed_at')
        .order('completed_at', { ascending: false }),
      // Which carriers have a Notice of Assignment archived.
      supabaseAdmin
        .from('vetting_documents')
        .select('dot_number')
        .eq('document_type', 'noa')
        .limit(100000),
    ])
    if (carriersRes.error) throw carriersRes.error
    if (scoresRes.error) throw scoresRes.error
    if (insRes.error) throw insRes.error
    if (vetRes.error) throw vetRes.error

    const carriers = carriersRes.data
    const latestScores = latestPerDot(scoresRes.data ?? [])
    const latestInsurance = latestPerDot(insRes.data ?? [])
    const latestVetting = latestPerDot(vetRes.data ?? [])
    const noaDots = new Set<string>(
      (noaRes.data ?? []).map((r: any) => String(r.dot_number))
    )

    let merged: CarrierSummary[] = (carriers ?? []).map((c: any) => {
      const dot = String(c.dot_number)
      const s: any = latestScores[dot]
      const ins: any = latestInsurance[dot]
      const v: any = latestVetting[dot]
      // Distinguish "not in RMIS" (we looked and RMIS had no record) from
      // "pending" (not pulled yet) so the dashboard isn't ambiguously blank.
      const rmisStatus: CarrierSummary['rmis_status'] = ins
        ? ins.rmis_is_certified
          ? 'certified'
          : 'not_certified'
        : c.rmis_attempted_at && !c.rmis_insured_id
          ? 'not_in_rmis'
          : 'pending'
      return {
        id: c.id,
        dot_number: c.dot_number,
        mc_number: c.mc_number ?? null,
        legal_name: c.legal_name ?? null,
        dba_name: c.dba_name ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        power_units: c.power_units ?? null,
        safety_rating: c.safety_rating ?? null,
        carrier_status: c.carrier_status ?? null,
        do_not_use: c.do_not_use ?? null,
        gap_score: s?.gap_score ?? null,
        requires_revetting: s?.requires_revetting ?? null,
        flagged_scores: s?.flagged_scores ?? null,
        approval_level: s?.approval_level ?? null,
        score_upload_date: s?.upload_date ?? null,
        auto_status: ins?.auto_status ?? null,
        cargo_status: ins?.cargo_status ?? null,
        auto_expiration_date: ins?.auto_expiration_date ?? null,
        cargo_expiration_date: ins?.cargo_expiration_date ?? null,
        rmis_overall_pass: ins?.rmis_overall_pass ?? null,
        rmis_is_certified: ins?.rmis_is_certified ?? null,
        rmis_status: rmisStatus,
        hard_stops: ins?.hard_stops ?? null,
        insurance_fetched_at: ins?.fetched_at ?? null,
        // The re-vet clock anchors to the later of the last completed vetting and
        // any auto-recertification (score upload + RMIS still certified).
        last_reviewed: maxIso(v?.completed_at ?? null, c.revet_reset_at ?? null),
        revet_interval_days: c.revet_interval_days ?? null,
        created_at: c.created_at ?? null,
        brokerware_status: c.brokerware_status ?? null,
        business_type: ins?.w9_company_type ?? null,
        eld_enrolled: ins?.rmis_eld_enrolled ?? null,
        w9_on_file: ins?.w9_on_file ?? null,
        agreement_on_file: ins?.broker_carrier_agreement_on_file ?? null,
        is_factoring: ins?.is_factoring ?? null,
        noa_on_file: noaDots.has(dot),
      }
    })

    // Status filters requiring merged data
    if (status === 'NeedsReview') {
      merged = merged.filter(
        (c) => c.carrier_status === 'Pending Review' || c.requires_revetting === true
      )
    } else if (status === 'HardStop') {
      merged = merged.filter((c) => (c.hard_stops?.length ?? 0) > 0)
    }

    if (requiresRevetting) {
      merged = merged.filter((c) => c.requires_revetting === true)
    }

    if (activeOnly) {
      merged = merged.filter(
        (c) =>
          !c.do_not_use &&
          !isBrokerwareDisabled(c.brokerware_status) &&
          c.carrier_status != null &&
          ACTIVE_STATUSES.includes(c.carrier_status)
      )
    }

    if (dueForRevet) {
      merged = merged.filter((c) => {
        if (isBrokerwareDisabled(c.brokerware_status)) return false
        const r = computeRevetStatus(c.last_reviewed, c.created_at, c.revet_interval_days)
        return r.state === 'overdue' || r.state === 'due_soon'
      })
    }

    // Sort by gap_score ascending, nulls last
    merged.sort((a, b) => {
      if (a.gap_score === null && b.gap_score === null) return 0
      if (a.gap_score === null) return 1
      if (b.gap_score === null) return -1
      return a.gap_score - b.gap_score
    })

    const total = merged.length

    // lastUpload = max score_upload_date
    let lastUpload: string | null = null
    for (const c of merged) {
      if (c.score_upload_date && (!lastUpload || c.score_upload_date > lastUpload)) {
        lastUpload = c.score_upload_date
      }
    }

    const paged = merged.slice(offset, offset + limit)

    return NextResponse.json({ carriers: paged, total, lastUpload })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
