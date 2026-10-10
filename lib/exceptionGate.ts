import { supabaseAdmin } from '@/lib/supabase'
import { noteIsFilled } from '@/lib/exceptionNote'
import { requiredApprovalLevel, levelForStatus, type ApprovalLevel } from '@/lib/roles'
export { noteIsFilled }

// Policy checks that run on the server before a carrier is approved, so the
// portal enforces them whoever is saving and from whichever screen.
//
// Exception Approved (Sections 4 and 6):
//  1. a short note saying why, and
//  2. when the exception is score driven (GAP below 60, a category below its
//     threshold, or no Bluewire score at all), a signed safety letter from the
//     carrier uploaded within the last 12 months.
// Section 9 carriers (LTL, expedited, forwarder, air, co-brokered) are
// confirmed by an approver with an onboarding note; no safety letter.

export const SAFETY_LETTER_MAX_AGE_DAYS = 365

const SCORE_EXCEPTION_LEVELS = new Set(['owner_exception', 'additional_vetting', 'manager_exception'])

interface CarrierPolicyFacts {
  scoreLevel: string | null
  hasScore: boolean
  safetyRating: string | null
  note: string | null
  otherMode: boolean
}

async function loadFacts(
  dot: string,
  opts: { exceptionNote?: string | null; checklist?: any } = {}
): Promise<CarrierPolicyFacts> {
  let note = opts.exceptionNote
  let checklist = opts.checklist
  if (note === undefined || checklist === undefined) {
    const { data: rec } = await supabaseAdmin
      .from('vetting_records')
      .select('exception_note, checklist')
      .eq('dot_number', dot)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (note === undefined) note = (rec as any)?.exception_note ?? null
    if (checklist === undefined) checklist = (rec as any)?.checklist ?? null
  }
  const [{ data: scoreRow }, { data: carrier }] = await Promise.all([
    (supabaseAdmin as any)
      .from('carrier_scores')
      .select('approval_level, gap_score')
      .eq('dot_number', dot)
      .order('release_month', { ascending: false })
      .order('upload_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from('carriers').select('safety_rating').eq('dot_number', dot).maybeSingle(),
  ])
  return {
    scoreLevel: scoreRow?.approval_level ?? null,
    hasScore: scoreRow?.gap_score != null,
    safetyRating: (carrier as any)?.safety_rating ?? null,
    note: note ?? null,
    otherMode: !!checklist?.otherMode,
  }
}

/** The approval level `status` needs for this carrier under the policy. */
export async function requiredLevelFor(
  dot: string,
  status: string,
  opts: { checklist?: any } = {}
): Promise<ApprovalLevel> {
  const f = await loadFacts(dot, { exceptionNote: null, checklist: opts.checklist })
  let level = requiredApprovalLevel(f.scoreLevel, f.safetyRating)
  // Section 9 carriers are always confirmed by an approver. A truckload carrier
  // with no Bluewire score is treated as GAP below 60 (Section 4).
  if (f.otherMode || !f.hasScore) level = 'director'
  return levelForStatus(status, level)
}

export interface ExceptionReadiness {
  ok: boolean
  missing: string[]
  scoreDriven: boolean
  otherMode: boolean
}

/**
 * What is still missing before `dot` can be approved as `status`. Pass the
 * note and checklist being saved; when omitted, the latest saved vetting
 * record is used (the approval queue path).
 */
export async function exceptionReadiness(
  dot: string,
  opts: { exceptionNote?: string | null; checklist?: any; status?: string } = {}
): Promise<ExceptionReadiness> {
  const f = await loadFacts(dot, opts)
  const status = opts.status ?? 'Exception Approved'
  const scoreDriven = !f.hasScore || SCORE_EXCEPTION_LEVELS.has(f.scoreLevel ?? '')
  const missing: string[] = []
  const applies = status === 'Exception Approved' || f.otherMode
  if (!applies) return { ok: true, missing, scoreDriven, otherMode: f.otherMode }

  if (!noteIsFilled(f.note)) {
    missing.push(
      f.otherMode
        ? 'an onboarding note saying what was confirmed'
        : 'an exception note explaining why the carrier was approved'
    )
  }
  if (status === 'Exception Approved' && scoreDriven && !f.otherMode) {
    const since = new Date(Date.now() - SAFETY_LETTER_MAX_AGE_DAYS * 86400000).toISOString()
    const { count } = await supabaseAdmin
      .from('vetting_documents')
      .select('id', { count: 'exact', head: true })
      .eq('dot_number', dot)
      .eq('document_type', 'safety_plan')
      .gte('uploaded_at', since)
    if (!count) missing.push('a signed safety letter from the carrier (uploaded as Safety Letter)')
  }
  return { ok: missing.length === 0, missing, scoreDriven, otherMode: f.otherMode }
}

export function readinessMessage(r: ExceptionReadiness): string {
  return `Before an approver signs off, add ${r.missing.join(' and ')}.`
}
