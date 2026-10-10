import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML } from '@/lib/rmisClient'
import { keepRawResponse } from '@/lib/rmisRefresh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

// POST { dots: string[], version?: string } — pull the full Expanded Carrier response for a
// few carriers and keep it in rmis_raw_responses, without changing any
// carrier data. For reading new RMIS sections (scheduled VINs, certification
// note types) before parsing them. Bearer PORTAL_LINK_SECRET or CRON_SECRET.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  const ok = [process.env.PORTAL_LINK_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .some((s) => auth === `Bearer ${s}`)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const dots = (Array.isArray(body?.dots) ? body.dots : [])
    .map((d: unknown) => String(d ?? '').replace(/\D/g, ''))
    .filter(Boolean)
    .slice(0, 10)
  if (!dots.length) return NextResponse.json({ error: 'dots is required' }, { status: 400 })
  const version = /^\d{1,3}$/.test(String(body?.version ?? '')) ? String(body.version) : undefined

  const out: { dot: string; ok: boolean; bytes?: number; error?: string }[] = []
  for (const dot of dots) {
    try {
      const { data: c } = await supabaseAdmin
        .from('carriers')
        .select('rmis_insured_id')
        .eq('dot_number', dot)
        .maybeSingle()
      const xml = await fetchExpandedCarrierXML({
        insdID: (c as any)?.rmis_insured_id || undefined,
        dotNumber: dot,
        version,
      })
      await keepRawResponse(dot, xml, `raw_v${version ?? '13'}`)
      out.push({ dot, ok: true, bytes: xml.length })
    } catch (e: any) {
      out.push({ dot, ok: false, error: e?.message ?? 'failed' })
    }
  }
  return NextResponse.json({ results: out })
}
