import { supabaseAdmin } from '@/lib/supabase'
import { noteIsFilled } from '@/lib/exceptionNote'
export { noteIsFilled }

// Policy (Sections 4 and 6): before a carrier is Exception Approved,
//  1. a short exception note is recorded in the portal, and
//  2. when the exception is score driven (GAP below 60 or a category below its
//     threshold), a signed safety letter from the carrier is on file.
// Other modes under Section 9 (LTL, expedited, forwarders, air, co-brokered)
// need the note only; the reviewer marks them on the checklist.

// A safety letter counts if it was uploaded within this many days.
export const SAFETY_LETTER_MAX_AGE_DAYS = 365

const SCORE_EXCEPTION_LEVELS = new Set(['owner_exception', 'additional_vetting', 'manager_exception'])

export interface ExceptionReadiness {
  ok: boolean
  missing: string[]
  scoreDriven: boolean
  otherMode: boolean
}

/**
 * What is still missing before `dot` can be Exception Approved.
 * Pass the note and checklist being saved; when omitted, the latest saved
 * vetting record is used (the approval queue path).
 */
export async function exceptionReadiness(
  dot: string,
  opts: { exceptionNote?: string | null; checklist?: any } = {}
): Promise<ExceptionReadiness> {
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
  const otherMode = !!checklist?.otherMode

  const { data: scoreRow } = await (supabaseAdmin as any)
    .from('carrier_scores')
    .select('approval_level')
    .eq('dot_number', dot)
    .order('release_month', { ascending: false })
    .order('upload_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const scoreDriven = SCORE_EXCEPTION_LEVELS.has(scoreRow?.approval_level ?? '')

  const missing: string[] = []
  if (!noteIsFilled(note)) missing.push('an exception note explaining why the carrier was approved')

  if (scoreDriven && !otherMode) {
    const since = new Date(Date.now() - SAFETY_LETTER_MAX_AGE_DAYS * 86400000).toISOString()
    const { count } = await supabaseAdmin
      .from('vetting_documents')
      .select('id', { count: 'exact', head: true })
      .eq('dot_number', dot)
      .eq('document_type', 'safety_plan')
      .gte('uploaded_at', since)
    if (!count) missing.push('a signed safety letter from the carrier (uploaded as Safety Letter)')
  }

  return { ok: missing.length === 0, missing, scoreDriven, otherMode }
}

export function readinessMessage(r: ExceptionReadiness): string {
  return `Before Exception Approved, add ${r.missing.join(' and ')}.`
}
