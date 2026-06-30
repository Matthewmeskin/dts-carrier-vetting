import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TablesUpdate } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED_STATUSES = [
  'Approved',
  'Approved with Restrictions',
  'Exception Approved',
  'Declined',
  'Suspended',
  'Do Not Use',
  'Pending Review',
]

export async function PATCH(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json()
    const { carrier_status, do_not_use, do_not_use_reason } = body ?? {}

    if (carrier_status !== undefined && !ALLOWED_STATUSES.includes(carrier_status)) {
      return NextResponse.json(
        { error: `Invalid carrier_status: ${carrier_status}` },
        { status: 400 }
      )
    }

    const updates: TablesUpdate<'carriers'> = {}
    if (carrier_status !== undefined) updates.carrier_status = carrier_status
    if (do_not_use !== undefined) updates.do_not_use = do_not_use
    if (do_not_use_reason !== undefined) updates.do_not_use_reason = do_not_use_reason

    const { data, error } = await supabaseAdmin
      .from('carriers')
      .update(updates)
      .eq('dot_number', dot)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Carrier not found' }, { status: 404 })
    }

    return NextResponse.json({ carrier: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
