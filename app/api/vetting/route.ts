import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getOrCreateCarrierFolder } from '@/lib/googleDrive'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TERMINAL_STATUSES = [
  'approved',
  'approved_with_restrictions',
  'exception_approved',
  'declined',
]

const STATUS_MAP: Record<string, string> = {
  approved: 'Approved',
  approved_with_restrictions: 'Approved with Restrictions',
  exception_approved: 'Exception Approved',
  declined: 'Declined',
  in_progress: 'Pending Review',
}

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

    const isTerminal = TERMINAL_STATUSES.includes(vettingStatus)

    const vettingRow = {
      carrier_id: (carrier as any).id,
      dot_number: String(dotNumber),
      vetting_type: vettingType ?? null,
      vetting_status: vettingStatus ?? null,
      checklist: checklist ?? null,
      exception_note: exceptionNote ?? null,
      internal_notes: internalNotes ?? null,
      reviewed_by: reviewedBy ?? null,
      approved_by: approvedBy ?? null,
      approval_level_required: approvalLevelRequired ?? null,
      google_drive_folder_id: folder?.id ?? null,
      google_drive_folder_url: folder?.webViewLink ?? null,
      completed_at: isTerminal ? new Date().toISOString() : null,
    }

    const { data: vettingRecord, error: insertError } = await supabaseAdmin
      .from('vetting_records')
      .insert([vettingRow])
      .select('*')
      .single()
    if (insertError) throw insertError

    // Map status to carrier_status and update
    const mappedStatus = STATUS_MAP[vettingStatus]
    if (mappedStatus) {
      await supabaseAdmin
        .from('carriers')
        .update({ carrier_status: mappedStatus })
        .eq('dot_number', String(dotNumber))
    }

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
