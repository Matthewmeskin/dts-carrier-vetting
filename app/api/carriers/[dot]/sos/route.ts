import { NextResponse } from 'next/server'
import { runCarrierSos, sosPipelineConfigured } from '@/lib/sos'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Rough status normalization for a manually-entered SOS status string.
function normalizeStatus(s: string): 'active' | 'inactive' | 'unknown' {
  const t = s.toLowerCase()
  if (/active|good standing|current|in existence/.test(t)) return 'active'
  if (/dissolved|revoked|inactive|forfeit|cancel|terminat|expired|suspend/.test(t))
    return 'inactive'
  return 'unknown'
}

// Compare a manually-entered SOS principal address against the carrier's
// physical address. Heuristic (no AI): zip5 + leading street number match =>
// 'match'; same state/city but not the street => 'partial'; else 'mismatch'.
// Returns null when we don't have enough to compare.
function compareAddress(
  sosAddr: string | null,
  phys: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }
): 'match' | 'partial' | 'mismatch' | null {
  const physStr = [phys.street, phys.city, phys.state, phys.zip]
    .filter(Boolean)
    .join(' ')
  if (!sosAddr || !physStr.trim()) return null
  const sos = sosAddr.toLowerCase()
  const p = physStr.toLowerCase()
  const zip5 = (s: string) => (s.match(/\b(\d{5})\b/) || [])[1] || ''
  const num = (s: string) => (s.match(/\b(\d{1,6})\b/) || [])[1] || ''
  const sosZip = zip5(sos)
  const physZip = (phys.zip || '').replace(/\D/g, '').slice(0, 5) || zip5(p)
  const sosNum = num(sos)
  const physNum = (phys.street || '').match(/\b(\d{1,6})\b/)?.[1] || num(p)
  const st = (phys.state || '').toLowerCase()
  const cityMatch = !!phys.city && sos.includes(String(phys.city).toLowerCase())
  const stateMatch = !!st && new RegExp(`\\b${st}\\b`).test(sos)
  if (sosZip && physZip && sosNum && physNum && sosZip === physZip && sosNum === physNum)
    return 'match'
  if ((sosZip && physZip && sosZip === physZip) || cityMatch || stateMatch)
    return 'partial'
  return 'mismatch'
}
// Live SOS scrapes for some states (CA, IL) can take well over a minute on the
// first, uncached pull. Give the function room so it doesn't die mid-scrape.
export const maxDuration = 300

// GET — is the SOS pipeline configured? (Lets the UI show/hide the button.)
export async function GET() {
  const cfg = sosPipelineConfigured()
  return NextResponse.json({ configured: cfg.ok, missing: cfg.missing })
}

// POST — run the Secretary-of-State check for this carrier (and its factor).
// Body (optional): { fresh?: boolean, refreshFactor?: boolean }
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const cfg = sosPipelineConfigured()
    if (!cfg.ok) {
      return NextResponse.json(
        {
          error: `Secretary-of-State lookup is not configured. Set ${cfg.missing.join(
            ' and '
          )} in the environment.`,
        },
        { status: 503 }
      )
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const result = await runCarrierSos(params.dot, {
      fresh: Boolean(body?.fresh),
      refreshFactor: Boolean(body?.refreshFactor),
      // Optional overrides: search SOS under a different name (DBA / owner name)
      // and/or a different state.
      name: typeof body?.name === 'string' ? body.name : undefined,
      state: typeof body?.state === 'string' ? body.state : undefined,
    })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}

// PUT — manually record the CORRECT Secretary-of-State entity when the automated
// search can't find it or matches a same-named but unrelated business. The
// reviewer looks it up on the state site and enters the confirmed details here.
// Stored as a manual, human-confirmed match (match_confidence = 'manual').
export async function PUT(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => ({}))
    const str = (v: any) => {
      const s = v == null ? '' : String(v).trim()
      return s || null
    }
    // "Unable to find" — the reviewer searched the state site and no SOS record
    // exists (or none could be located). Recorded so it's clearly distinct from
    // "never checked".
    const notFound = body?.not_found === true
    const entityName = str(body?.entity_name)
    const state = str(body?.state)?.toUpperCase() ?? null
    if (!notFound && (!entityName || !state)) {
      return NextResponse.json(
        { error: 'Entity name and state are required.' },
        { status: 400 }
      )
    }

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, street, city, state, zip')
      .eq('dot_number', dot)
      .maybeSingle()

    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : 'DTS staff'

    const statusRaw = str(body?.status)
    const sourceUrl = str(body?.source_url)
    const principalAddress = str(body?.principal_address)

    // Compare the SOS principal address against the carrier's PHYSICAL address
    // (prefer RMIS/DOT over Brokerware, which is often the factor's remit-to).
    let addressMatch: 'match' | 'partial' | 'mismatch' | null = null
    if (!notFound && principalAddress) {
      const { data: insRows } = await (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('rmis_carrier_street, rmis_carrier_city, rmis_carrier_state, rmis_carrier_zip')
        .eq('dot_number', dot)
        .limit(1)
      const ins = insRows?.[0] ?? {}
      addressMatch = compareAddress(principalAddress, {
        street: ins.rmis_carrier_street ?? (carrier as any)?.street,
        city: ins.rmis_carrier_city ?? (carrier as any)?.city,
        state: ins.rmis_carrier_state ?? (carrier as any)?.state,
        zip: ins.rmis_carrier_zip ?? (carrier as any)?.zip,
      })
    }

    const row: Record<string, any> = notFound
      ? {
          carrier_id: (carrier as any)?.id ?? null,
          dot_number: dot,
          sos_state: state,
          sos_entity_id: null,
          sos_status: 'Not found',
          sos_status_normalized: 'not_found',
          sos_entity_type: null,
          sos_formation_date: null,
          sos_registered_agent: null,
          sos_principal_address: null,
          sos_officers: [],
          name_match: null,
          address_match: null,
          match_confidence: 'not_found',
          mismatches: [],
          risk_flags: [],
          sos_summary:
            `No SOS record found — searched by ${actor}` +
            (entityName ? ` (searched "${entityName}"${state ? `, ${state}` : ''})` : '') +
            (str(body?.notes) ? ` — ${str(body?.notes)}` : ''),
          sos_search_name: entityName,
          sos_raw: { manual: true, not_found: true, entered_by: actor },
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : {
          carrier_id: (carrier as any)?.id ?? null,
          dot_number: dot,
          sos_state: state,
          sos_entity_name: entityName,
          sos_entity_id: str(body?.entity_id),
          sos_status: statusRaw,
          sos_status_normalized: statusRaw ? normalizeStatus(statusRaw) : 'unknown',
          sos_entity_type: str(body?.entity_type),
          sos_formation_date: str(body?.formation_date),
          sos_registered_agent: str(body?.registered_agent),
          sos_principal_address: principalAddress,
          sos_officers: [],
          name_match: true, // a human confirmed this is the right entity
          address_match: addressMatch,
          match_confidence: 'manual',
          mismatches: [],
          risk_flags: [],
          sos_summary:
            `Manually entered by ${actor}` +
            (str(body?.notes) ? ` — ${str(body?.notes)}` : ''),
          sos_search_name: entityName,
          // The RPC derives sos_source_url from sos_raw.source_url for the link.
          sos_raw: { manual: true, entered_by: actor, source_url: sourceUrl },
          checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

    const { data: saved, error } = await (supabaseAdmin as any)
      .from('carrier_sos')
      .upsert(row, { onConflict: 'dot_number' })
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ ok: true, sos: saved })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}

// DELETE — remove the stored SOS record for this carrier. Used when the matched
// entity is wrong (e.g. a same-named but unrelated business) so the reviewer can
// clear it and, if desired, re-run a fresh lookup.
export async function DELETE(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const { error } = await supabaseAdmin
      .from('carrier_sos')
      .delete()
      .eq('dot_number', params.dot)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
