import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TablesUpdate } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the approved-factors registry, with how many carriers use each factor.
export async function GET() {
  try {
    const { data: factors, error } = await supabaseAdmin
      .from('factors')
      .select('*')
      // Only canonical factors; merged spelling-variants roll up into these.
      .is('merged_into', null)
      .order('name', { ascending: true })
      .limit(2000)
    if (error) throw error

    // Carrier counts per factor (single grouped query, no N+1).
    const { data: links } = await supabaseAdmin
      .from('carriers')
      .select('factor_id')
      .not('factor_id', 'is', null)
      .limit(100000)
    const counts: Record<string, number> = {}
    for (const l of links ?? []) {
      const id = (l as any).factor_id
      if (id) counts[id] = (counts[id] ?? 0) + 1
    }

    const withCounts = (factors ?? []).map((f: any) => ({
      ...f,
      carrier_count: counts[f.id] ?? 0,
    }))
    return NextResponse.json({ factors: withCounts })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

const VALID_STATUS = new Set(['approved', 'rejected', 'review'])

// PATCH — update a factor's approval status / notes.
// Body: { id, approval_status?, notes?, approved_by? }
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const id = body?.id
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const update: TablesUpdate<'factors'> = { updated_at: new Date().toISOString() }
    if (body.approval_status !== undefined) {
      if (!VALID_STATUS.has(body.approval_status)) {
        return NextResponse.json({ error: 'invalid approval_status' }, { status: 400 })
      }
      update.approval_status = body.approval_status
      if (body.approval_status === 'approved') {
        update.approved_by = body.approved_by ?? 'DTS'
        update.approved_at = new Date().toISOString()
      } else {
        update.approved_by = null
        update.approved_at = null
      }
    }
    if (body.notes !== undefined) update.notes = body.notes

    const { data, error } = await supabaseAdmin
      .from('factors')
      .update(update)
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ factor: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
