import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { noaVerifyConfigured } from '@/lib/noaVerify'
import { runNoaCheck } from '@/lib/noaCheck'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// POST { dot } — read the carrier's Notice of Assignment on file and check it
// against the factor and RMIS pay-to, on behalf of the Payables portal, which
// now owns NOA matching (the AI key and the storage access live here).
// Bearer-authenticated with PORTAL_LINK_SECRET (or CRON_SECRET), no session.
// The result lands in noa_verifications, which Payables reads directly.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const ok = [process.env.PORTAL_LINK_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .some((s) => auth === `Bearer ${s}`)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!noaVerifyConfigured()) {
    return NextResponse.json(
      { error: 'NOA verification is not configured on the vetting portal (ANTHROPIC_API_KEY).' },
      { status: 503 }
    )
  }
  const body = await request.json().catch(() => ({}))
  const dot = String(body?.dot ?? '').replace(/\D/g, '')
  if (!dot) return NextResponse.json({ error: 'dot is required' }, { status: 400 })

  const { data: docs } = await supabaseAdmin
    .from('vetting_documents')
    .select('id')
    .eq('dot_number', dot)
    .eq('document_type', 'noa')
    .not('storage_path', 'is', null)
    .limit(1)
  if (!docs?.length) {
    return NextResponse.json({ error: 'No Notice of Assignment on file for this carrier.' }, { status: 404 })
  }

  const ran = await runNoaCheck(dot)
  if (!ran) return NextResponse.json({ error: 'The NOA could not be read. Try again in a minute.' }, { status: 502 })

  const { data: last } = await (supabaseAdmin as any)
    .from('noa_verifications')
    .select('result, checked_at')
    .eq('dot_number', dot)
    .order('checked_at', { ascending: false })
    .limit(1)
  return NextResponse.json({ verification: last?.[0]?.result ?? null, checkedAt: last?.[0]?.checked_at ?? null })
}
