import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML, RMISCredentials } from '@/lib/rmisClient'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_BATCH = 10

// POST — re-pull RMIS documents for a batch of carriers so any documents on file
// in RMIS (notably NOAs for factoring carriers) get archived into the portal.
//
// Default target: factoring carriers that are in RMIS but have no NOA archived.
// Cycles least-recently-refreshed first via carriers.docs_refreshed_at, so a
// carrier that genuinely has no NOA in RMIS is stamped and skipped next run
// rather than reprocessed forever. Pass {"mode":"all"} to refresh docs for any
// in-RMIS carrier regardless of NOA status.
export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const batchSize =
      Number(body?.batchSize) > 0 ? Number(body.batchSize) : DEFAULT_BATCH
    const mode: 'missing_noa' | 'all' =
      body?.mode === 'all' ? 'all' : 'missing_noa'
    const creds: RMISCredentials | undefined =
      body?.clientID || body?.clientPassword
        ? { clientID: body.clientID, clientPassword: body.clientPassword }
        : undefined

    // Build the target dot set.
    let targetDots: Set<string> | null = null
    if (mode === 'missing_noa') {
      const [{ data: factoring }, { data: noa }] = await Promise.all([
        (supabaseAdmin as any)
          .from('latest_carrier_insurance')
          .select('dot_number')
          .eq('is_factoring', true)
          .limit(100000),
        supabaseAdmin
          .from('vetting_documents')
          .select('dot_number')
          .eq('document_type', 'noa')
          .limit(100000),
      ])
      const noaSet = new Set((noa ?? []).map((r: any) => String(r.dot_number)))
      targetDots = new Set(
        (factoring ?? [])
          .map((r: any) => String(r.dot_number))
          .filter((d: string) => !noaSet.has(d))
      )
      if (targetDots.size === 0) {
        return NextResponse.json({ processed: 0, note: 'No factoring carriers missing an NOA.' })
      }
    }

    // Skip carriers refreshed within the last 7 days so a carrier that genuinely
    // has no NOA in RMIS isn't re-pulled every run once the backlog is drained.
    const staleBefore = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

    // Least-recently-refreshed carriers that are in RMIS (have an insured id).
    const { data: candidates, error } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, rmis_insured_id, docs_refreshed_at')
      .not('rmis_insured_id', 'is', null)
      .order('docs_refreshed_at', { ascending: true, nullsFirst: true })
      .limit(targetDots ? 5000 : batchSize)
    if (error) throw error

    // Apply the target-dot filter (missing_noa) + recency guard, then batch.
    const picked = (candidates ?? [])
      .filter((c: any) => !targetDots || targetDots.has(String(c.dot_number)))
      .filter(
        (c: any) => !c.docs_refreshed_at || c.docs_refreshed_at < staleBefore
      )
      .slice(0, batchSize)

    let succeeded = 0
    let failed = 0
    let archived = 0
    const now = new Date().toISOString()

    for (const c of picked) {
      const dot = (c as any).dot_number
      try {
        const xml = await fetchExpandedCarrierXML({
          insdID: (c as any).rmis_insured_id || undefined,
          dotNumber: dot,
          credentials: creds,
        })
        const res = await archiveCarrierDocuments({
          dot,
          carrierId: (c as any).id,
          insdID: String((c as any).rmis_insured_id),
          xml,
        })
        archived += res.archived
        succeeded++
      } catch {
        failed++
      } finally {
        await supabaseAdmin
          .from('carriers')
          .update({ docs_refreshed_at: now } as any)
          .eq('dot_number', dot)
      }
    }

    // How many targets remain (missing_noa mode).
    let remaining: number | null = null
    if (mode === 'missing_noa' && targetDots) {
      const stampedThisRun = new Set(picked.map((c: any) => String(c.dot_number)))
      remaining = Array.from(targetDots).filter((d) => !stampedThisRun.has(d)).length
    }

    return NextResponse.json({
      mode,
      processed: picked.length,
      succeeded,
      failed,
      documentsArchived: archived,
      remainingTargets: remaining,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 }
    )
  }
}
