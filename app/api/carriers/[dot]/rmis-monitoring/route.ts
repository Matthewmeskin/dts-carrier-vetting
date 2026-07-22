import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { setCarrierMonitoring, type AttachMode } from '@/lib/rmisClient'
import { logCarrierEvent } from '@/lib/auditLog'
import { getSessionUser } from '@/lib/authServer'
import { ROLE_LABEL, ROLE_RANK } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/carriers/[dot]/rmis-monitoring  { mode: 'Detach' }
//
// Attach or (in production) Detach a carrier from our RMIS monitored list. Detach
// stops RMIS from tracking/charging for a carrier we no longer work with — e.g.
// one disabled in the TMS. Manager+ only, since it changes what we monitor.
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => ({}))
    const mode: AttachMode = body?.mode === 'Attach' ? 'Attach' : 'Detach'

    const authOn = process.env.AUTH_ENABLED !== 'false'
    const user = await getSessionUser()
    if (authOn && !user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    if (authOn && user && ROLE_RANK[user.role] < ROLE_RANK.manager) {
      return NextResponse.json(
        { error: `Changing RMIS monitoring requires Manager or Director. Your role is ${ROLE_LABEL[user.role]}.` },
        { status: 403 }
      )
    }

    const { data: carrier } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, mc_number, rmis_insured_id')
      .eq('dot_number', dot)
      .maybeSingle()
    if (!carrier) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }
    const c = carrier as any

    const result = await setCarrierMonitoring({
      mode,
      insuredID: c.rmis_insured_id ? String(c.rmis_insured_id) : undefined,
      mcNumber: c.mc_number ? String(c.mc_number) : undefined,
      dotNumber: String(c.dot_number),
    })

    await logCarrierEvent({
      dot,
      carrierId: c.id ?? null,
      type: 'rmis_refresh',
      summary:
        mode === 'Detach'
          ? 'Detached from RMIS monitoring (removed from monitored carrier list).'
          : 'Attached to RMIS monitoring.',
      detail: { mode, status: result.status },
      actor: user ? `${user.fullName || user.email} (${ROLE_LABEL[user.role]})` : 'DTS',
    })

    return NextResponse.json({ ok: true, mode })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
