import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { logCarrierEvents, type CarrierEventInput } from '@/lib/auditLog'
import { getSessionUser } from '@/lib/authServer'
import { ROLE_LABEL } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/carriers/bulk-status — apply a neutral status change to many carriers
// at once. Deliberately scoped to the reversible "On Hold" workflow (and taking
// carriers back off hold); it does NOT set adverse statuses (Declined / Do Not
// Use) in bulk, so it needs no approval-level gate.
//
// Body: { dots: string[], action: 'hold' | 'unhold', note?: string }
//   hold   → carrier_status = 'On Hold', status_note = note
//   unhold → carrier_status = 'Pending Review', status_note = null
export async function POST(request: Request) {
  try {
    const authOn = process.env.AUTH_ENABLED !== 'false'
    const user = await getSessionUser()
    if (authOn && !user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body?.action === 'unhold' ? 'unhold' : 'hold'
    const note = typeof body?.note === 'string' ? body.note.trim() : ''
    const dots: string[] = Array.isArray(body?.dots)
      ? Array.from(
          new Set(
            body.dots.map((d: unknown) => String(d ?? '').trim()).filter(Boolean)
          )
        )
      : []

    if (dots.length === 0) {
      return NextResponse.json({ error: 'No carriers selected.' }, { status: 400 })
    }
    if (dots.length > 2000) {
      return NextResponse.json(
        { error: 'Too many carriers in one request (max 2000).' },
        { status: 400 }
      )
    }

    const nextStatus = action === 'hold' ? 'On Hold' : 'Pending Review'
    const updates: Record<string, unknown> = { carrier_status: nextStatus }
    // On hold, record the neutral note; taking off hold clears it.
    updates.status_note = action === 'hold' ? note || null : null

    const { data, error } = await supabaseAdmin
      .from('carriers')
      .update(updates as any)
      .in('dot_number', dots)
      .select('id, dot_number, legal_name')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = data ?? []
    const actor = user ? `${user.email} (${ROLE_LABEL[user.role]})` : 'DTS'
    const summary =
      action === 'hold'
        ? `Placed On Hold (bulk)${note ? ` — ${note}` : ''}.`
        : 'Taken off hold → Pending Review (bulk).'

    const events: CarrierEventInput[] = rows.map((c: any) => ({
      dot: String(c.dot_number),
      carrierId: c.id ?? null,
      type: 'status_change',
      summary,
      detail: { carrier_status: nextStatus, status_note: action === 'hold' ? note || null : null, bulk: true },
      actor,
    }))
    await logCarrierEvents(events)

    return NextResponse.json({ ok: true, updated: rows.length, action })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
