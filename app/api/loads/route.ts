import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/loads?number=116180
//
// Look up a stored TMS load by its number — matches load_id, BOL number, or pick
// number (the number on the carrier's docs can be any of these). Used by the
// payment-vetting workflow to cross-check an invoice against the booked load
// without an extra TMS call. Bearer-authed like the other machine endpoints.
export async function GET(request: Request) {
  if (!(await isMachineOrSessionAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(request.url)
    const raw = (url.searchParams.get('number') ?? '').trim()
    if (!raw) return NextResponse.json({ found: false, error: 'Missing number' })

    const digits = raw.replace(/\D/g, '')
    const db = supabaseAdmin as any

    // Try load_id (numeric), then BOL number, then pick number.
    let load: any = null
    if (digits) {
      const { data } = await db
        .from('loads')
        .select('*')
        .eq('load_id', Number(digits))
        .maybeSingle()
      load = data ?? null
    }
    if (!load) {
      const { data } = await db
        .from('loads')
        .select('*')
        .or(`bol_num.eq.${raw},pick_num.eq.${raw}`)
        .limit(1)
      load = data?.[0] ?? null
    }
    if (!load && digits) {
      const { data } = await db
        .from('loads')
        .select('*')
        .or(`bol_num.eq.${digits},pick_num.eq.${digits}`)
        .limit(1)
      load = data?.[0] ?? null
    }

    if (!load) return NextResponse.json({ found: false })
    return NextResponse.json({ found: true, load })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
