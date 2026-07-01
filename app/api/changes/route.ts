import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { classifyDelta } from '@/lib/deltaRisk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — network-wide feed of carrier changes from the RMIS delta log, joined
// with carrier identity and classified by vetting-framework severity.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const riskOnly = p.get('riskOnly') === 'true'
    const unreviewedOnly = p.get('unreviewedOnly') === 'true'
    const limit = Number(p.get('limit')) || 200

    const { data: rows, error } = await supabaseAdmin
      .from('carrier_delta_log')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit)
    if (error) throw error

    const { data: carriers } = await supabaseAdmin
      .from('carriers')
      .select('dot_number, legal_name, carrier_status, do_not_use')
    const byDot = new Map(
      (carriers ?? []).map((c: any) => [String(c.dot_number), c])
    )

    let changes = (rows ?? []).map((r: any) => {
      const c = byDot.get(String(r.dot_number))
      return {
        ...r,
        severity: classifyDelta(r),
        legal_name: c?.legal_name ?? null,
        carrier_status: c?.carrier_status ?? null,
        do_not_use: c?.do_not_use ?? null,
      }
    })

    if (riskOnly) changes = changes.filter((c) => c.severity !== 'info')
    if (unreviewedOnly) changes = changes.filter((c) => !c.reviewed_at)

    const atRisk = changes.filter((c) => c.severity === 'at_risk').length
    const needsReview = changes.filter((c) => c.severity === 'flag').length
    const unreviewed = changes.filter((c) => !c.reviewed_at).length

    return NextResponse.json({
      changes,
      counts: { total: changes.length, atRisk, needsReview, unreviewed },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// PATCH — mark a change reviewed (or clear the review).
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, reviewedBy, reviewed } = body ?? {}
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }
    const clearing = reviewed === false
    const { data, error } = await supabaseAdmin
      .from('carrier_delta_log')
      .update({
        reviewed_at: clearing ? null : new Date().toISOString(),
        reviewed_by: clearing ? null : reviewedBy ? String(reviewedBy) : 'Reviewer',
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !data) {
      return NextResponse.json({ error: 'Change not found' }, { status: 404 })
    }
    return NextResponse.json({ change: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
