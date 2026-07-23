import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvent } from '@/lib/auditLog'
import { getSessionUser } from '@/lib/authServer'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DECISION_LABEL: Record<string, string> = {
  ok_to_pay: 'OK to pay',
  hold: 'Hold',
  rejected: 'Rejected',
}

// GET /api/carriers/[dot]/payment-vetting/review?documentId=...
// Returns the saved review for a specific report (documentId) or, if none is
// given, the carrier's latest review. Lets the in-portal review page prefill.
export async function GET(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const documentId = new URL(request.url).searchParams.get('documentId')
    const db = supabaseAdmin as any
    let q = db
      .from('payment_vetting_reviews')
      .select('*')
      .eq('dot_number', params.dot)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (documentId) q = q.eq('document_id', documentId)
    const { data } = await q
    return NextResponse.json({ review: (data && data[0]) || null })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST /api/carriers/[dot]/payment-vetting/review
// Saves (upserts by document_id) the payment-confirmation-call review a staffer
// logs against a report, so the notes live in the system instead of on a print-out.
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => ({}))

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id')
      .eq('dot_number', dot)
      .maybeSingle()

    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : body?.confirmed_by || 'DTS'

    const str = (v: any) => (v == null || v === '' ? null : String(v))
    const row: Record<string, any> = {
      dot_number: dot,
      carrier_id: (carrier as any)?.id ?? null,
      document_id: str(body?.documentId),
      load_number: str(body?.load_number),
      date_of_factor: str(body?.date_of_factor),
      factor_phone: str(body?.factor_phone),
      contact_name: str(body?.contact_name),
      contact_dept: str(body?.contact_dept),
      remit_confirmed: str(body?.remit_confirmed),
      confirmed_by: str(body?.confirmed_by) || (user ? user.fullName || user.email : null),
      call_datetime: str(body?.call_datetime),
      decision: str(body?.decision),
      notes: str(body?.notes),
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const db = supabaseAdmin as any
    // Upsert by document_id when we have one; else insert a fresh review.
    let saved: any = null
    if (row.document_id) {
      const { data, error } = await db
        .from('payment_vetting_reviews')
        .upsert(row, { onConflict: 'document_id' })
        .select('*')
        .single()
      if (error) throw error
      saved = data
    } else {
      const { data, error } = await db
        .from('payment_vetting_reviews')
        .insert(row)
        .select('*')
        .single()
      if (error) throw error
      saved = data
    }

    const decisionLabel = row.decision ? DECISION_LABEL[row.decision] || row.decision : null
    await logCarrierEvent({
      dot,
      carrierId: (carrier as any)?.id ?? null,
      type: 'payment_vetting_review',
      summary: `Payment vetting review logged${decisionLabel ? ` — ${decisionLabel}` : ''}${
        row.remit_confirmed ? ` · remit/bank ${row.remit_confirmed}` : ''
      }.`,
      detail: { review: row },
      actor,
    })

    return NextResponse.json({ review: saved })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
