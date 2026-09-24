import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { roleCanApprove, ROLE_LABEL, type ApprovalLevel } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH { decision: 'approved' | 'sent_back', note? } — decide an open request.
// Approving applies the requested status to the carrier and completes the
// vetting record (which starts the re-vet clock), exactly as if the approver
// had saved it themselves. Sending back leaves the carrier as it is and hands
// the reviewer a note. Both are logged to the carrier's activity timeline.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const decision = body?.decision === 'approved' ? 'approved' : body?.decision === 'sent_back' ? 'sent_back' : null
    if (!decision) return NextResponse.json({ error: 'decision must be approved or sent_back' }, { status: 400 })
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null

    const { data: req } = await (supabaseAdmin as any)
      .from('approval_requests')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (req.decided_at) {
      return NextResponse.json({ error: 'This request has already been decided.' }, { status: 409 })
    }

    const level = req.required_level as ApprovalLevel
    if (!roleCanApprove(user.role, level)) {
      return NextResponse.json(
        {
          error: `This carrier requires ${ROLE_LABEL[level as 'manager' | 'director']}-level approval. Your role (${ROLE_LABEL[user.role]}) can't decide it.`,
        },
        { status: 403 }
      )
    }
    if (decision === 'sent_back' && !note) {
      return NextResponse.json({ error: 'Add a note so the reviewer knows what to fix.' }, { status: 400 })
    }

    const dot = String(req.dot_number)
    const actor = `${user.fullName || user.email || user.id} (${ROLE_LABEL[user.role]})`
    const now = new Date().toISOString()
    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id')
      .eq('dot_number', dot)
      .maybeSingle()

    if (decision === 'approved') {
      const { error: cErr } = await supabaseAdmin
        .from('carriers')
        .update({ carrier_status: req.requested_status } as any)
        .eq('dot_number', dot)
      if (cErr) throw cErr
      if (req.vetting_record_id) {
        // Complete the vetting under the approver's name; completed_at starts
        // the re-vet clock. Never overwrite an earlier completion date.
        const { data: rec } = await supabaseAdmin
          .from('vetting_records')
          .select('completed_at')
          .eq('id', req.vetting_record_id)
          .maybeSingle()
        await supabaseAdmin
          .from('vetting_records')
          .update({
            vetting_status: req.requested_status,
            approved_by: user.fullName || user.email || null,
            completed_at: (rec as any)?.completed_at ?? now,
          } as any)
          .eq('id', req.vetting_record_id)
      }
    }

    const { error: uErr } = await (supabaseAdmin as any)
      .from('approval_requests')
      .update({ decision, decided_by: actor, decided_at: now, decision_note: note })
      .eq('id', req.id)
    if (uErr) throw uErr

    await logCarrierEvent({
      dot,
      carrierId: (carrier as any)?.id ?? null,
      type: 'approval_decided',
      summary:
        decision === 'approved'
          ? `${ROLE_LABEL[level as 'manager' | 'director']} approval granted — status set to ${req.requested_status}${note ? ` — ${note}` : ''}.`
          : `Sent back by ${ROLE_LABEL[level as 'manager' | 'director']} — ${note}`,
      detail: { requestId: req.id, decision, requestedStatus: req.requested_status, requiredLevel: level, note, requestedBy: req.requested_by },
      actor,
    })
    return NextResponse.json({ ok: true, decision })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
