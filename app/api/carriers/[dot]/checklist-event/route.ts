import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSessionUser } from '@/lib/authServer'
import { logCarrierEvent } from '@/lib/auditLog'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Log a manual checklist check/uncheck to the carrier's activity timeline, with
// who did it and when — an audit trail for reasonable-care documentation. Only
// manual toggles are recorded; auto-evaluated steps don't hit this route.
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => ({}))
    const label = String(body?.label ?? '').trim().slice(0, 200)
    const checked = !!body?.checked
    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 })
    }

    const user = await getSessionUser()
    const actor = user
      ? `${user.fullName || user.email}${user.role ? ` (${ROLE_LABEL[user.role]})` : ''}`
      : 'DTS'

    const { data: carrier } = await (supabaseAdmin as any)
      .from('carriers')
      .select('id')
      .eq('dot_number', dot)
      .single()

    await logCarrierEvent({
      dot,
      carrierId: carrier?.id ?? null,
      type: 'checklist_change',
      summary: `${checked ? 'Checked' : 'Unchecked'}: “${label}”`,
      actor,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
