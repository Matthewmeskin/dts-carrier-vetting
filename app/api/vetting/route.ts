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

    // Stamp the save on the carrier's Activity timeline (audit trail), including
    // the internal note if one was entered.
    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : reviewedBy
        ? String(reviewedBy)
        : 'DTS'
    const note = internalNotes ? String(internalNotes).trim() : ''
    const bits: string[] = []
    if (resolvedStatus) bits.push(`status set to ${resolvedStatus}`)
    let summary = bits.length ? `Vetting saved — ${bits.join(', ')}` : 'Vetting record saved'
    if (note) summary += ` · Note: “${note.slice(0, 300)}”`
    await logCarrierEvent({
      dot: String(dotNumber),
      carrierId: (carrier as any).id ?? null,
      type: 'vetting_saved',
      summary,
      detail: note ? { internalNotes: note } : null,
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
