import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrCreateCarrierFolder } from '@/lib/googleDrive'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Legacy snake_case → carrier status, kept for backward compatibility with any
// older callers. New callers send the carrier status value directly.
const STATUS_MAP: Record<string, string> = {
  approved: 'Approved',
  exception_approved: 'Exception Approved',
  declined: 'Declined',
  // Legacy decisions that have since been folded into "Declined".
  suspended: 'Declined',
  do_not_use: 'Declined',
  approved_with_restrictions: 'Exception Approved',
  in_progress: 'Pending Review',
}

// A vetting is "complete" (stamps completed_at and starts the re-vet clock) for
// any real decision — i.e. anything other than the not-yet-decided states.
const IN_PROGRESS_STATUSES = new Set(['Pending Review', 'in_progress', '', null as any])

// Decisions that put a carrier in good standing (usable). Granting one of these
// clears the score-driven re-vet flag, since the current score is now covered.
const GOOD_STANDING_STATUSES = new Set(['Approved', 'Exception Approved'])

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      dotNumber,
      vettingType,
      vettingStatus,
      checklist,
      exceptionNote,
      internalNotes,
      reviewedBy,
      approvedBy,
      approvalLevelRequired,
    } = body ?? {}

    if (!dotNumber) {
      return NextResponse.json({ error: 'Missing dotNumber' }, { status: 400 })
    }

    const { data: carrier, error: carrierError } = await supabaseAdmin
      .from('carriers')
      .select('id, legal_name')
      .eq('dot_number', String(dotNumber))
      .single()

    if (carrierError || !carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    // Google Drive folder (non-fatal)
    let folder: { id: string; webViewLink: string } | null = null
    let warning: string | undefined
    try {
      folder = await getOrCreateCarrierFolder(
        String(dotNumber),
        (carrier as any).legal_name ?? ''
      )
    } catch (driveErr: any) {
      warning = `Google Drive folder could not be created: ${driveErr?.message ?? 'unknown error'}`
      console.error('Drive error:', driveErr)
    }

    // Accept the carrier-status value directly, or map a legacy snake_case one.
    const resolvedStatus: string | null =
      STATUS_MAP[vettingStatus] ?? (vettingStatus ? String(vettingStatus) : null)
    const isComplete = !!resolvedStatus && !IN_PROGRESS_STATUSES.has(resolvedStatus)

    const vettingRow = {
      carrier_id: (carrier as any).id,
      dot_number: String(dotNumber),
      vetting_type: vettingType ?? null,
      vetting_status: resolvedStatus,
      checklist: checklist ?? null,
      exception_note: exceptionNote ?? null,
      internal_notes: internalNotes ?? null,
      reviewed_by: reviewedBy ?? null,
      approved_by: approvedBy ?? null,
      approval_level_required: approvalLevelRequired ?? null,
      google_drive_folder_id: folder?.id ?? null,
      google_drive_folder_url: folder?.webViewLink ?? null,
      completed_at: isComplete ? new Date().toISOString() : null,
    }

    // Grab the prior saved record (before we insert this one) so the Activity
    // entry can report what actually changed in the vetting record.
    const { data: prevRecords } = await supabaseAdmin
      .from('vetting_records')
      .select(
        'vetting_status, checklist, exception_note, internal_notes, reviewed_by, approved_by'
      )
      .eq('dot_number', String(dotNumber))
      .order('created_at', { ascending: false })
      .limit(1)
    const prev = (prevRecords?.[0] as any) ?? null

    const { data: vettingRecord, error: insertError } = await supabaseAdmin
      .from('vetting_records')
      .insert([vettingRow])
      .select('*')
      .single()
    if (insertError) throw insertError

    // Keep the carrier's live status in sync with the decision.
    if (resolvedStatus) {
      await supabaseAdmin
        .from('carriers')
        .update({ carrier_status: resolvedStatus })
        .eq('dot_number', String(dotNumber))
    }

    // Granting a good-standing decision (Approved / Exception Approved) means the
    // current failing score is now knowingly covered — so clear the score-driven
    // re-vet flag on the latest score immediately, instead of waiting for the
    // next Bluewire upload to suppress it. A future upload with a materially
    // worse score re-raises the flag (see app/api/upload-scores). The scheduled
    // re-vet clock is untouched, so the carrier still comes due on its date.
    if (resolvedStatus && GOOD_STANDING_STATUSES.has(resolvedStatus)) {
      const { data: latestScore } = await (supabaseAdmin as any)
        .from('carrier_scores')
        .select('id, requires_revetting')
        .eq('dot_number', String(dotNumber))
        .order('upload_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestScore?.id && latestScore.requires_revetting) {
        await (supabaseAdmin as any)
          .from('carrier_scores')
          .update({ requires_revetting: false })
          .eq('id', latestScore.id)
      }
    }

    // Stamp the save on the carrier's Activity timeline (audit trail), including
    // the internal note if one was entered.
    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : reviewedBy
        ? String(reviewedBy)
        : 'DTS'
    const note = internalNotes ? String(internalNotes).trim() : ''

    // Diff this save against the previous record so the timeline shows what
    // actually changed — not just a repeated "status set to X". Checklist box
    // toggles and cadence/document changes are logged on their own events, so
    // here we surface the record-level fields (decision, reviewer, approver,
    // exception note, internal note, overall checklist completion).
    const completedIds = (cl: any): string => {
      const steps = Array.isArray(cl?.steps) ? cl.steps : []
      return steps
        .filter((s: any) => s?.completed)
        .map((s: any) => s?.id)
        .sort()
        .join(',')
    }
    const prevExc = (prev?.exception_note ?? '').trim()
    const newExc = (exceptionNote ?? '').toString().trim()
    const prevNote = (prev?.internal_notes ?? '').trim()
    const noteVerb = (was: string, now: string) =>
      now ? (was ? 'updated' : 'added') : 'removed'

    const changes: string[] = []
    if (resolvedStatus && resolvedStatus !== (prev?.vetting_status ?? null)) {
      changes.push(`status set to ${resolvedStatus}`)
    }
    if ((reviewedBy ?? '') !== (prev?.reviewed_by ?? '')) {
      changes.push(`reviewer → ${reviewedBy || '—'}`)
    }
    if ((approvedBy ?? '') !== (prev?.approved_by ?? '')) {
      changes.push(`approver → ${approvedBy || '—'}`)
    }
    if (newExc !== prevExc) changes.push(`exception note ${noteVerb(prevExc, newExc)}`)
    if (note !== prevNote) changes.push(`internal note ${noteVerb(prevNote, note)}`)
    if (completedIds(checklist) !== completedIds(prev?.checklist)) {
      const steps = Array.isArray((checklist as any)?.steps)
        ? (checklist as any).steps
        : []
      const done = steps.filter((s: any) => s?.completed).length
      changes.push(`checklist updated (${done}/${steps.length} complete)`)
    }

    let summary = changes.length
      ? `Vetting saved — ${changes.join(', ')}`
      : prev
        ? 'Vetting re-saved (no field changes)'
        : `Vetting saved${resolvedStatus ? ` — status set to ${resolvedStatus}` : ''}`
    if (note && note !== prevNote) summary += ` · Note: “${note.slice(0, 300)}”`
    await logCarrierEvent({
      dot: String(dotNumber),
      carrierId: (carrier as any).id ?? null,
      type: 'vetting_saved',
      summary,
      detail: { changes, internalNotes: note || null },
      actor,
    })

    return NextResponse.json({
      id: (vettingRecord as any).id,
      vettingRecord,
      folder,
      ...(warning ? { warning } : {}),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
