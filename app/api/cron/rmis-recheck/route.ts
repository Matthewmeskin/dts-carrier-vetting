import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { refreshCarrierRmis } from '@/lib/rmisRefresh'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST — re-pull RMIS for carriers that are active in Brokerware but whose
// last RMIS snapshot says "not certified" and is older than `days` (default 3).
// The Delta API does not always report a carrier finishing its packet (a
// renewed GL or a new workers comp certificate), so without this a carrier
// that is now certified keeps showing as not certified. Oldest snapshot first.
// Body: { days?: number, batchSize?: number, dots?: string[] }. CRON_SECRET.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const days = Number(body?.days) > 0 ? Number(body.days) : 3
    const batchSize = Math.min(50, Number(body?.batchSize) > 0 ? Number(body.batchSize) : 15)
    let dots: string[] = Array.isArray(body?.dots) ? body.dots.map(String) : []

    if (dots.length === 0) {
      const cutoff = Date.now() - days * 86400000
      const { data: active, error } = await supabaseAdmin
        .from('carriers')
        .select('dot_number, rmis_insured_id')
        .eq('brokerware_status', 'Active')
        .not('rmis_insured_id', 'is', null)
        .limit(2000)
      if (error) throw error
      const activeDots = (active ?? []).map((c: any) => String(c.dot_number))
      const latest = new Map<string, { cert: boolean; at: number }>()
      for (let i = 0; i < activeDots.length; i += 200) {
        const { data } = await (supabaseAdmin as any)
          .from('carrier_insurance')
          .select('dot_number, rmis_is_certified, fetched_at')
          .in('dot_number', activeDots.slice(i, i + 200))
          .order('fetched_at', { ascending: false })
          .limit(20000)
        for (const r of data ?? []) {
          const d = String(r.dot_number)
          // null = non monitored (not attached to our RMIS); a recheck can't certify it.
          if (!latest.has(d)) latest.set(d, { cert: r.rmis_is_certified !== false, at: Date.parse(r.fetched_at ?? '') || 0 })
        }
      }
      dots = Array.from(latest.entries())
        .filter(([, v]) => !v.cert && v.at < cutoff)
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, batchSize)
        .map(([d]) => d)
    }

    const results: { dot: string; ok: boolean; certified?: boolean | null; error?: string }[] = []
    for (const dot of dots) {
      try {
        const r: any = await refreshCarrierRmis(dot, { actor: 'RMIS recheck', sourceLabel: 'rmis_recheck' })
        results.push({ dot, ok: true, certified: r?.parsed?.rmisIsCertified ?? null })
      } catch (e: any) {
        results.push({ dot, ok: false, error: e?.message ?? 'error' })
      }
    }
    return NextResponse.json({ checked: results.length, results })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
