import { supabaseAdmin } from '@/lib/supabase'
import { evaluateEligibility } from '@/lib/eligibility'
import { isBrokerwareDisabled } from '@/lib/revet'
import { CarrierIndex, isNonHaulingCarrier, normalizeMc } from '@/lib/carrierMatch'

// Policy check: did the carriers we actually used meet the policy?
//
// Takes every load picked up in the window, matches its carrier to the portal,
// and applies the policy for that load's mode: Sections 1 to 8 for truckload,
// Section 9 for LTL and air. Also lists carriers declined in the portal that
// Brokerware still shows as active, since the policy says a declined carrier
// is disabled in the TMS.
//
// It reads each carrier's CURRENT record, not the record on the pickup date,
// so a carrier fixed since the load reads clean.

export const SECTION9_LOAD_MODES = new Set([
  'LTL',
  'TradeshowLTL',
  'RFLtl',
  'VolumePartial',
  'Air',
  'InternationalAir',
])
/** Modes outside the policy (no motor carrier selected by DTS). */
export const OUT_OF_SCOPE_MODES = new Set(['Ocean', 'Parcel', 'Intermodal', 'Services'])

const APPROVED = new Set(['Approved', 'Exception Approved'])

export interface PolicyCheckRow {
  key: string
  dot: string | null
  name: string
  status: string | null
  loads: number
  lastPickup: string | null
  modes: string[]
  section: 'Truckload' | 'Section 9'
  issues: string[]
}

export interface PolicyCheckResult {
  days: number
  loadsChecked: number
  carriersUsed: number
  rows: PolicyCheckRow[]
  declinedButActive: { dot: string; name: string; status: string; brokerware: string | null }[]
}

async function fetchAll<T>(table: string, select: string, build?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = (supabaseAdmin as any).from(table).select(select).range(from, from + 999)
    if (build) q = build(q)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function runPolicyCheck(days = 30): Promise<PolicyCheckResult> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const [loads, facts] = await Promise.all([
    fetchAll<any>('loads', 'load_id, shipment_mode, primary_carrier_name, primary_carrier_mc, pickup_date', (q) =>
      q.gte('pickup_date', since)
    ),
    fetchAll<any>('policy_carrier_facts', '*'),
  ])
  const index = new CarrierIndex(facts as any)
  const byId = new Map<string, any>(facts.map((f: any) => [f.id, f]))

  const groups = new Map<string, { fact: any | null; name: string; loads: any[] }>()
  let loadsChecked = 0
  for (const l of loads) {
    if (OUT_OF_SCOPE_MODES.has(l.shipment_mode)) continue
    if (!l.primary_carrier_name && !l.primary_carrier_mc) continue
    if (isNonHaulingCarrier(l.primary_carrier_name)) continue
    loadsChecked++
    const m = index.match({ carrierMCNumber: l.primary_carrier_mc, carrierName: l.primary_carrier_name })
    const fact = m.length > 0 ? byId.get(m[0].id) : null
    const key = fact ? `c:${fact.id}` : `u:${normalizeMc(l.primary_carrier_mc) || l.primary_carrier_name}`
    const g = groups.get(key) ?? { fact, name: l.primary_carrier_name ?? 'Unknown carrier', loads: [] as any[] }
    g.loads.push(l)
    groups.set(key, g)
  }

  const rows: PolicyCheckRow[] = []
  for (const [key, g] of Array.from(groups.entries())) {
    const modes = Array.from(new Set(g.loads.map((l) => String(l.shipment_mode ?? 'Unknown'))))
    const anyTruckload = g.loads.some((l) => !SECTION9_LOAD_MODES.has(l.shipment_mode))
    const lastPickup = g.loads.map((l) => l.pickup_date).sort().slice(-1)[0] ?? null
    const issues: string[] = []
    const f = g.fact
    if (!f) {
      issues.push('Carrier not in the portal — never vetted')
    } else {
      const el = evaluateEligibility({
        carrier_status: f.carrier_status,
        do_not_use: f.do_not_use,
        brokerware_status: f.brokerware_status,
        safety_rating: f.safety_rating,
        gap_score: anyTruckload ? f.gap_score : null,
        hard_stops: f.hard_stops,
        last_reviewed: f.last_reviewed,
        created_at: f.created_at,
        revet_interval_days: f.revet_interval_days,
        revet_due_override: f.revet_due_override,
        is_intrastate: f.is_intrastate,
      })
      let reasons = el.reasons
      if (!anyTruckload) {
        // Section 9: certificate insurance and new authority don't apply.
        reasons = reasons.filter(
          (r) => !/coverage|liability|cargo|insurance|days old|GAP score/i.test(r)
        )
      }
      issues.push(...reasons)
      if (!APPROVED.has(f.carrier_status ?? '') && !/Declined|On Hold|Do Not Use|Suspended/.test(f.carrier_status ?? '')) {
        issues.push(`Not approved in the portal (status: ${f.carrier_status ?? 'none'})`)
      }
    }
    if (issues.length === 0) continue
    rows.push({
      key,
      dot: f?.dot_number ?? null,
      name: f?.legal_name ?? g.name,
      status: f?.carrier_status ?? null,
      loads: g.loads.length,
      lastPickup,
      modes,
      section: anyTruckload ? 'Truckload' : 'Section 9',
      issues: Array.from(new Set(issues)),
    })
  }
  rows.sort((a, b) => b.loads - a.loads)

  const declinedButActive = facts
    .filter(
      (f: any) =>
        (f.do_not_use || ['Declined', 'Do Not Use', 'Suspended'].includes(f.carrier_status)) &&
        !isBrokerwareDisabled(f.brokerware_status) &&
        f.brokerware_status != null
    )
    .map((f: any) => ({
      dot: f.dot_number,
      name: f.legal_name ?? f.dba_name ?? f.dot_number,
      status: f.do_not_use ? 'Do Not Use' : f.carrier_status,
      brokerware: f.brokerware_status,
    }))

  return { days, loadsChecked, carriersUsed: groups.size, rows, declinedButActive }
}
