import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvent } from '@/lib/auditLog'
import { refreshCarrierRmis } from '@/lib/rmisRefresh'
import { runCarrierSos } from '@/lib/sos'
import { normalizeEntityName } from '@/lib/sosNormalize'
import { requiredApprovalLevel, type ApprovalLevel } from '@/lib/roles'
import { getCarrierContext, loadEvaluatedChecklist } from '@/lib/carrierContext'
import type { VettingChecklist } from '@/lib/vettingChecklist'

// ---------------------------------------------------------------------------
// Automated carrier onboarding.
//
// Called by the n8n "Carrier OSINT" workflow when RMIS sends a New Registered
// Carrier notice. Creates the portal row, pulls RMIS and SOS, stores the web
// research, evaluates the vetting checklist and sets a status:
//
//   Approved        every required check passes on real data, no exception
//                   approval level required, web research clean
//   Pending Review  something is missing (no Bluewire score yet, no SOS match,
//                   authority under 365 days, RMIS pull failed ...) or a
//                   manager / director has to approve an exception
//   On Hold         a check FAILED on real data: RMIS hard stop, dissolved
//                   entity, bad safety rating, no active authority, fraud
//                   reports found, 3+ chameleon signals
//
// Humans only touch exceptions. A status a person has already set (Approved,
// Exception Approved, Declined, do_not_use, or a hold with their own note) is
// never overridden.
// ---------------------------------------------------------------------------

export const AUTO_ACTOR = 'Automated onboarding'
export const AUTO_NOTE_PREFIX = '[auto]'

export interface OsintInput {
  address_lookup?: string | null
  location_type?: string | null
  phone_osint?: string | null
  phone_fraud_search?: string | null
  complaints?: string | null
  web_presence?: string | null
  sos_cross_check?: string | null
  chameleon_flags?: string[] | null
  chameleon_flag_count?: number | null
  chameleon_detail?: string | null
  fraud_reports_found?: boolean | null
  [k: string]: unknown
}

export interface OnboardingInput {
  dot: string
  mc?: string | null
  legalName?: string | null
  dbaName?: string | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  email?: string | null
  rmisInsuredId?: string | null
  isFactoring?: boolean | null
  payToName?: string | null
  payToAddress?: string | null
  osint?: OsintInput | null
  source?: string | null
  /** Skip the RMIS pull (re-evaluation only). */
  skipRmis?: boolean
  /** Skip the SOS pull. */
  skipSos?: boolean
}

export type AutoDecision = 'approve' | 'pending' | 'hold' | 'unchanged'

export interface DecisionResult {
  decision: AutoDecision
  /** Why the carrier is not Approved (empty when approve). */
  reasons: string[]
  /** Things AR / ops should still do that do not block approval. */
  followUps: string[]
  approvalLevel: ApprovalLevel
  passed: string[]
  failed: string[]
  missing: string[]
}

const CLEAN_RE = /^(clean|none|no\b|not found|nothing)/i

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t ? t : null
}

/**
 * Decide from the evaluated checklist, the RMIS evaluation, SOS, the score
 * approval level and the stored web research. Pure: no I/O.
 */
export function evaluateAutoDecision(args: {
  checklist: VettingChecklist
  insurance: Record<string, any> | null
  score: Record<string, any> | null
  sos: Record<string, any> | null
  safetyRating: string | null
  osint: Record<string, any> | null
  rmisError?: string | null
}): DecisionResult {
  const { checklist, insurance, score, sos, safetyRating, osint } = args
  const reasons: string[] = []
  const holdReasons: string[] = []
  const followUps: string[] = []
  const passed: string[] = []
  const failed: string[] = []
  const missing: string[] = []

  const stepById = new Map(checklist.steps.map((st) => [st.id, st]))
  const status = (id: string) => stepById.get(id)?.autoStatus ?? null
  const evidence = (id: string) => stepById.get(id)?.evidence ?? ''

  for (const st of checklist.steps) {
    if (st.autoStatus === 'pass') passed.push(st.id)
    else if (st.autoStatus === 'fail') failed.push(st.id)
    else if (st.required) missing.push(st.id)
  }

  // ---- Hard failures on real data → On Hold
  const hardStops: string[] = Array.isArray(insurance?.hard_stops) ? insurance!.hard_stops : []
  if (hardStops.length) holdReasons.push(...hardStops.map((h) => `RMIS hard stop: ${h}`))
  if (status('authority_active') === 'fail') holdReasons.push(`No active operating authority (${evidence('authority_active')})`)
  if (status('safety_rating') === 'fail') holdReasons.push(`Safety rating ${safetyRating}`)
  if (status('auto_liability') === 'fail') holdReasons.push(`Auto liability below policy: ${evidence('auto_liability')}`)
  if (status('cargo_coverage') === 'fail') holdReasons.push(`Cargo coverage below policy: ${evidence('cargo_coverage')}`)
  const sosNorm = String(sos?.sos_status_normalized ?? '').toLowerCase()
  if (sos?.checked_at && (sosNorm === 'dissolved' || sosNorm === 'inactive' || sosNorm === 'delinquent')) {
    holdReasons.push(`Secretary of State entity is ${sos?.sos_status ?? sosNorm}`)
  }
  const flagCount = Number(osint?.chameleon_flag_count ?? (Array.isArray(osint?.chameleon_flags) ? osint!.chameleon_flags.length : 0))
  if (osint?.fraud_reports_found === true) holdReasons.push('Fraud or complaint reports found online')
  if (flagCount >= 3) holdReasons.push(`${flagCount} chameleon carrier signals: ${(osint?.chameleon_flags ?? []).slice(0, 3).join('; ')}`)
  if (status('gap_score') === 'fail' || status('category_scores') === 'fail') {
    holdReasons.push(`Bluewire scores below threshold: ${evidence('gap_score') || evidence('category_scores')}`)
  }

  // ---- Pending: missing data or exceptions a person has to document
  if (args.rmisError) reasons.push(`RMIS pull failed: ${args.rmisError}`)
  if (!insurance) reasons.push('No RMIS record on file yet')
  if (status('gap_score') === null) reasons.push('Bluewire GAP score not on file yet (arrives with the next monthly upload)')
  if (status('category_scores') === null && score == null) reasons.push('Bluewire category scores not on file yet')
  if (status('authority_age') === 'fail') reasons.push(evidence('authority_age'))
  if (status('authority_age') === null) reasons.push('Authority grant date not available')
  if (status('inspection_history') === 'fail') reasons.push('Zero roadside inspections on record, exception review required')
  if (status('broker_carrier_agreement') !== 'pass') reasons.push('Broker carrier agreement not confirmed in RMIS')
  if (status('w9') !== 'pass') reasons.push('W-9 not confirmed in RMIS')
  if (status('identity_verification') === 'fail') reasons.push(`Identity discrepancy: ${evidence('identity_verification')}`)
  if (status('fraud_indicators') === 'fail') reasons.push(`Fraud or identity signals: ${evidence('fraud_indicators')}`)
  if (!sos?.checked_at) reasons.push('Secretary of State check did not complete')
  else if (sosNorm !== 'active' && !holdReasons.length) reasons.push(`Secretary of State status ${sos?.sos_status ?? 'unknown'} (no active match)`)
  if (!osint) reasons.push('Web research (OSINT) not stored')
  else {
    if (flagCount > 0 && flagCount < 3) reasons.push(`${flagCount} chameleon signal(s): ${(osint.chameleon_flags ?? []).join('; ')}`)
    const complaints = s(osint.complaints)
    if (complaints && !CLEAN_RE.test(complaints)) reasons.push(`Complaint search: ${complaints.slice(0, 160)}`)
    const loc = String(osint.location_type ?? osint.address_lookup ?? '').toLowerCase()
    if (/residential|house|apartment|po box|virtual/.test(loc)) reasons.push(`Address looks ${/po box|virtual/.test(loc) ? 'like a mailbox or virtual office' : 'residential'}: ${s(osint.address_lookup)?.slice(0, 120) ?? loc}`)
  }

  const approvalLevel = requiredApprovalLevel(score?.approval_level, safetyRating)
  if (approvalLevel !== 'none') reasons.push(`Requires ${approvalLevel} approval per policy`)

  // ---- Follow ups that do not block the carrier decision
  if (insurance?.is_factoring === true) followUps.push('Factored carrier: NOA must be on file before first payment')
  if (status('general_liability') === null && insurance) followUps.push('General liability below preferred $1M/$2M or not reported')
  for (const w of stepById.get('auto_liability')?.autoWarn ? [stepById.get('auto_liability')!.autoWarn] : []) followUps.push(`Auto liability ${w}`)
  for (const w of stepById.get('cargo_coverage')?.autoWarn ? [stepById.get('cargo_coverage')!.autoWarn] : []) followUps.push(`Cargo ${w}`)

  if (holdReasons.length) {
    return { decision: 'hold', reasons: [...holdReasons, ...reasons], followUps, approvalLevel, passed, failed, missing }
  }
  if (reasons.length) {
    return { decision: 'pending', reasons, followUps, approvalLevel, passed, failed, missing }
  }
  return { decision: 'approve', reasons: [], followUps, approvalLevel, passed, failed, missing }
}

const STATUS_FOR: Record<Exclude<AutoDecision, 'unchanged'>, string> = {
  approve: 'Approved',
  pending: 'Pending Review',
  hold: 'On Hold',
}

/** Whether the automation may change this carrier's status. */
export function automationMayChangeStatus(carrier: Record<string, any>): boolean {
  if (carrier.do_not_use) return false
  const st = String(carrier.carrier_status ?? '').trim()
  if (st === 'Approved' || st === 'Exception Approved' || st === 'Declined') return false
  const note = String(carrier.status_note ?? '')
  // A hold a person placed (their own note) stays theirs.
  if (st === 'On Hold' && note && !note.startsWith(AUTO_NOTE_PREFIX)) return false
  return true
}

function noteFor(d: DecisionResult): string {
  const head =
    d.decision === 'approve'
      ? 'Auto approved at onboarding: every required check passed on RMIS, SOS and web research.'
      : d.decision === 'hold'
        ? 'On hold by automated onboarding:'
        : 'Pending review by automated onboarding:'
  const body = d.reasons.length ? ' ' + d.reasons.map((r) => `• ${r}`).join(' ') : ''
  const fu = d.followUps.length ? ' Follow up: ' + d.followUps.join('; ') + '.' : ''
  return `${AUTO_NOTE_PREFIX} ${head}${body}${fu}`.slice(0, 2000)
}

/**
 * Write the decision: carriers.carrier_status + status_note + auto_decision
 * columns, a vetting_records row when approving, and audit events. Returns the
 * status written (or null when left unchanged).
 */
export async function applyAutoDecision(
  dot: string,
  carrier: Record<string, any>,
  d: DecisionResult,
  checklist: VettingChecklist,
  opts: { actor?: string; source?: string } = {}
): Promise<{ statusWritten: string | null; changed: boolean }> {
  const actor = opts.actor ?? AUTO_ACTOR
  const now = new Date().toISOString()
  const may = automationMayChangeStatus(carrier)
  const target = STATUS_FOR[d.decision as Exclude<AutoDecision, 'unchanged'>] ?? null
  const prevStatus = String(carrier.carrier_status ?? '')

  const update: Record<string, any> = {
    auto_decision: d.decision,
    auto_decision_reasons: d.reasons,
    auto_decision_at: now,
  }
  let statusWritten: string | null = null
  if (may && target) {
    update.carrier_status = target
    update.status_note = noteFor(d)
    statusWritten = target
  }
  await supabaseAdmin.from('carriers').update(update as any).eq('dot_number', dot)

  const changed = !!statusWritten && statusWritten !== prevStatus

  if (statusWritten === 'Approved' && changed) {
    const record = {
      carrier_id: carrier.id,
      dot_number: dot,
      vetting_type: 'initial',
      vetting_status: 'Approved',
      checklist: { ...checklist, finalStatus: 'Approved', reviewedBy: actor, reviewedAt: now },
      exception_note: null,
      internal_notes: noteFor(d),
      reviewed_by: actor,
      approved_by: `${actor} (policy auto clear)`,
      approval_level_required: 'none',
      completed_at: now,
    }
    await supabaseAdmin.from('vetting_records').insert([record as any])
    await logCarrierEvent({
      dot,
      carrierId: carrier.id,
      type: 'vetting_saved',
      summary: 'Initial vetting auto completed: Approved (all required checks passed).',
      detail: { passed: d.passed, followUps: d.followUps, source: opts.source ?? 'onboarding' },
      actor,
    })
  }

  await logCarrierEvent({
    dot,
    carrierId: carrier.id,
    type: changed ? 'status_change' : 'auto_decision',
    summary: changed
      ? `${prevStatus || 'New'} → ${statusWritten} by ${actor}${d.reasons.length ? `: ${d.reasons[0]}` : ''}`.slice(0, 300)
      : `Automated decision ${d.decision}${may ? '' : ' (status left as set by staff)'}${d.reasons.length ? `: ${d.reasons[0]}` : ''}`.slice(0, 300),
    detail: { decision: d.decision, reasons: d.reasons, followUps: d.followUps, failed: d.failed, missing: d.missing, approvalLevel: d.approvalLevel, mayChange: may, source: opts.source ?? 'onboarding' },
    actor,
  })

  return { statusWritten, changed }
}

async function upsertFactor(name: string | null): Promise<string | null> {
  if (!name) return null
  const norm = normalizeEntityName(name)
  if (!norm) return null
  await supabaseAdmin
    .from('factors')
    .upsert([{ name, normalized_name: norm }] as any, { onConflict: 'normalized_name', ignoreDuplicates: true })
  const { data } = await supabaseAdmin
    .from('factors')
    .select('id, merged_into')
    .eq('normalized_name', norm)
    .maybeSingle()
  const f = data as any
  return f ? (f.merged_into ?? f.id) : null
}

async function storeOsint(dot: string, carrierId: string | null, osint: OsintInput, source: string) {
  const flags = Array.isArray(osint.chameleon_flags) ? osint.chameleon_flags.filter(Boolean).map(String) : []
  const fraudText = [osint.phone_fraud_search, osint.complaints].map((v) => s(v) ?? '').join(' ')
  const fraudFound =
    typeof osint.fraud_reports_found === 'boolean'
      ? osint.fraud_reports_found
      : fraudText
        ? !CLEAN_RE.test(fraudText) && /fraud|scam|theft|double.?broker|complaint/i.test(fraudText) && !/no (fraud|complaint|scam)|not found|clean/i.test(fraudText)
        : null
  const loc = s(osint.location_type) ?? (() => {
    const a = String(osint.address_lookup ?? '').toLowerCase()
    if (/po box|virtual|mailbox|ups store/.test(a)) return 'po_box'
    if (/residential|house|apartment|home/.test(a)) return 'residential'
    if (/commercial|industrial|warehouse|office|business|truck/.test(a)) return 'commercial'
    return null
  })()
  const row = {
    dot_number: dot,
    carrier_id: carrierId,
    source,
    address_lookup: s(osint.address_lookup),
    location_type: loc,
    phone_osint: s(osint.phone_osint),
    phone_fraud_search: s(osint.phone_fraud_search),
    complaints: s(osint.complaints),
    web_presence: s(osint.web_presence),
    sos_cross_check: s(osint.sos_cross_check),
    chameleon_flags: flags,
    chameleon_flag_count: Number(osint.chameleon_flag_count ?? flags.length) || 0,
    chameleon_detail: s(osint.chameleon_detail),
    fraud_reports_found: fraudFound,
    raw: osint,
    checked_at: new Date().toISOString(),
  }
  const { data, error } = await (supabaseAdmin as any).from('carrier_osint').insert([row]).select('*').single()
  if (error) throw error
  await logCarrierEvent({
    dot,
    carrierId,
    type: 'osint_check',
    summary: `Web research stored: ${row.chameleon_flag_count} chameleon signal(s), ${fraudFound ? 'fraud reports found' : 'no fraud reports'}, address ${loc ?? 'unknown'}.`,
    detail: { flags, location_type: loc, fraud_reports_found: fraudFound },
    actor: AUTO_ACTOR,
  })
  return data
}

async function seedPaymentBaseline(dot: string, ctx: Awaited<ReturnType<typeof getCarrierContext>>) {
  if (!ctx) return { seeded: false, reason: 'no context' }
  const payTo = s(ctx.factoring?.pay_to_entity)
  if (!payTo) return { seeded: false, reason: 'no pay to on RMIS' }
  if (ctx.payment_baseline) return { seeded: false, reason: 'baseline already exists' }
  const now = new Date().toISOString()
  const row = {
    dot_number: dot,
    remit_to_name: payTo,
    remit_to_address: s(ctx.factoring?.pay_to_address),
    remit_to_phone: null,
    remit_to_bank: null,
    remit_to_account: null,
    remit_to_routing: null,
    factor_name: ctx.factoring?.is_factoring ? payTo : null,
    carrier_name: s(ctx.carrier?.legal_name),
    carrier_mc: s(ctx.carrier?.mc_number),
    source_document_id: null,
    source_run_id: null,
    approved_by: 'RMIS registration (auto seeded at onboarding)',
    approved_at: now,
    source: 'rmis_onboarding',
    extracted: { source: 'rmis_onboarding', seeded_at: now },
  }
  const { error } = await (supabaseAdmin as any)
    .from('payment_baselines')
    .upsert([row], { onConflict: 'dot_number', ignoreDuplicates: true })
  if (error) return { seeded: false, reason: error.message }
  return { seeded: true, reason: null }
}

export interface OnboardingResult {
  created: boolean
  carrier: Record<string, any>
  rmis: { ok: boolean; source?: string; error?: string; hardStops: string[]; flags: string[] }
  sos: { ok: boolean; error?: string }
  osintStored: boolean
  decision: DecisionResult
  statusWritten: string | null
  statusChanged: boolean
  baseline: { seeded: boolean; reason: string | null }
  context: Awaited<ReturnType<typeof getCarrierContext>>
}

export async function onboardCarrier(input: OnboardingInput): Promise<OnboardingResult> {
  const dot = String(input.dot ?? '').replace(/\D/g, '')
  if (!dot) throw new Error('dot is required')
  const source = s(input.source) ?? 'rmis_onboarding'
  const now = new Date().toISOString()

  // ---- 1. Upsert the carrier row without clobbering data staff or Brokerware set
  const { data: existing } = await supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).maybeSingle()
  const ex = (existing as any) ?? null
  const factorId = input.isFactoring ? await upsertFactor(s(input.payToName)) : null
  const fill = (col: string, v: unknown) => (ex?.[col] ? {} : v != null && String(v).trim() ? { [col]: String(v).trim() } : {})
  const patch: Record<string, any> = {
    ...fill('mc_number', input.mc),
    ...fill('legal_name', input.legalName),
    ...fill('dba_name', input.dbaName),
    ...fill('street', input.street),
    ...fill('city', input.city),
    ...fill('state', input.state),
    ...fill('zip', input.zip),
    ...fill('phone', input.phone),
    ...fill('email', input.email),
    ...fill('rmis_insured_id', input.rmisInsuredId),
  }
  if (factorId && !ex?.factor_id) patch.factor_id = factorId
  if (!ex) {
    patch.dot_number = dot
    patch.onboarding_source = source
    patch.onboarded_at = now
    patch.carrier_status = 'Pending Review'
    const { error } = await supabaseAdmin.from('carriers').insert([patch as any])
    if (error) throw error
  } else {
    if (!ex.onboarding_source) {
      patch.onboarding_source = source
      patch.onboarded_at = now
    }
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('carriers').update(patch as any).eq('dot_number', dot)
      if (error) throw error
    }
  }
  const { data: carrierRow } = await supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).single()
  const carrier = carrierRow as any
  await logCarrierEvent({
    dot,
    carrierId: carrier.id,
    type: 'onboarding',
    summary: ex ? `Onboarding re run for existing carrier (${source}).` : `Carrier created from ${source}.`,
    detail: { created: !ex, source, input: { ...input, osint: undefined } },
    actor: AUTO_ACTOR,
  })

  // ---- 2. RMIS pull (the same one the Refresh RMIS button runs)
  let rmis: OnboardingResult['rmis'] = { ok: false, hardStops: [], flags: [] }
  if (!input.skipRmis) {
    try {
      const r = await refreshCarrierRmis(dot, { actor: AUTO_ACTOR, sourceLabel: 'onboarding' })
      rmis = { ok: true, source: r.source, hardStops: r.hardStops, flags: r.flags }
    } catch (e: any) {
      rmis = { ok: false, error: e?.message ?? String(e), hardStops: [], flags: [] }
    }
  } else {
    rmis = { ok: true, source: 'skipped', hardStops: [], flags: [] }
  }

  // ---- 3. Secretary of State
  let sos: OnboardingResult['sos'] = { ok: false }
  if (!input.skipSos) {
    try {
      const r = await runCarrierSos(dot)
      sos = { ok: !!r.carrierSos, error: r.errors.length ? r.errors.join('; ') : undefined }
    } catch (e: any) {
      sos = { ok: false, error: e?.message ?? String(e) }
    }
  } else {
    sos = { ok: true }
  }

  // ---- 4. Web research
  let osintStored = false
  if (input.osint && typeof input.osint === 'object') {
    try {
      await storeOsint(dot, carrier.id, input.osint, source)
      osintStored = true
    } catch {
      osintStored = false
    }
  }

  // ---- 5. Evaluate and decide
  const { evaluated, scoreRecord, insurance, sos: sosRow } = await loadEvaluatedChecklist(dot)
  const { data: freshCarrier } = await supabaseAdmin.from('carriers').select('*').eq('dot_number', dot).single()
  const fc = freshCarrier as any
  const { data: osintRows } = await (supabaseAdmin as any)
    .from('carrier_osint')
    .select('*')
    .eq('dot_number', dot)
    .order('checked_at', { ascending: false })
    .limit(1)
  const osintRow = (osintRows?.[0] as any) ?? null

  const decision = evaluateAutoDecision({
    checklist: evaluated,
    insurance: insurance && Object.keys(insurance).length ? insurance : null,
    score: scoreRecord,
    sos: sosRow,
    safetyRating: fc?.safety_rating ?? null,
    osint: osintRow,
    rmisError: rmis.ok ? null : rmis.error ?? 'unknown',
  })
  const applied = await applyAutoDecision(dot, fc, decision, evaluated, { source: 'onboarding' })

  // ---- 6. Seed the payment baseline from the RMIS pay to
  const ctxBefore = await getCarrierContext(dot)
  const baseline = await seedPaymentBaseline(dot, ctxBefore)
  const context = baseline.seeded ? await getCarrierContext(dot) : ctxBefore

  return {
    created: !ex,
    carrier: context?.carrier ?? fc,
    rmis,
    sos,
    osintStored,
    decision,
    statusWritten: applied.statusWritten,
    statusChanged: applied.changed,
    baseline,
    context,
  }
}

/**
 * Re evaluate carriers the automation left in Pending Review or On Hold, using
 * whatever data has arrived since (Bluewire upload, RMIS delta, SOS). Approves
 * the ones that are now clean. Used by the nightly auto clear.
 */
export async function reevaluatePendingCarriers(limit = 200): Promise<{
  evaluated: number
  approved: string[]
  stillPending: number
  held: number
  errors: string[]
}> {
  const { data: rows, error } = await supabaseAdmin
    .from('carriers')
    .select('*')
    .in('carrier_status', ['Pending Review', 'On Hold'])
    .not('auto_decision', 'is', null)
    .eq('do_not_use', false)
    .order('auto_decision_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  const out = { evaluated: 0, approved: [] as string[], stillPending: 0, held: 0, errors: [] as string[] }
  for (const r of (rows ?? []) as any[]) {
    if (!automationMayChangeStatus(r)) continue
    try {
      const dot = r.dot_number
      const { evaluated, scoreRecord, insurance, sos } = await loadEvaluatedChecklist(dot, r)
      const { data: osintRows } = await (supabaseAdmin as any)
        .from('carrier_osint')
        .select('*')
        .eq('dot_number', dot)
        .order('checked_at', { ascending: false })
        .limit(1)
      const decision = evaluateAutoDecision({
        checklist: evaluated,
        insurance: insurance && Object.keys(insurance).length ? insurance : null,
        score: scoreRecord,
        sos,
        safetyRating: r.safety_rating ?? null,
        osint: (osintRows?.[0] as any) ?? null,
      })
      out.evaluated++
      // Only write when the outcome changed, so the activity log stays quiet.
      const sameOutcome =
        decision.decision === r.auto_decision &&
        JSON.stringify(decision.reasons) === JSON.stringify(r.auto_decision_reasons ?? [])
      if (sameOutcome) {
        if (decision.decision === 'hold') out.held++
        else out.stillPending++
        continue
      }
      const applied = await applyAutoDecision(dot, r, decision, evaluated, { source: 'auto_clear' })
      if (applied.statusWritten === 'Approved') out.approved.push(dot)
      else if (decision.decision === 'hold') out.held++
      else out.stillPending++
    } catch (e: any) {
      out.errors.push(`${r.dot_number}: ${e?.message ?? e}`)
    }
  }
  return out
}
