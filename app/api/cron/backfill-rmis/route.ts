import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchExpandedCarrierXML, RMISCredentials } from '@/lib/rmisClient'
import { parseRMISXML } from '@/lib/rmisParser'
import { evaluateRMIS } from '@/lib/rmisEvaluator'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'
import { buildInsuranceRow } from '@/app/api/carriers/[dot]/insurance/route'
import { TablesUpdate } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_BATCH = 25

// POST — backfill RMIS Expanded Carrier data + documents for a batch of
// carriers, cycling through the roster (least-recently-attempted first). Run on
// a schedule until the whole roster is covered; the delta poller keeps it fresh
// afterward.
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
    const batchSize = Number(body?.batchSize) > 0 ? Number(body.batchSize) : DEFAULT_BATCH
    const creds: RMISCredentials | undefined =
      body?.clientID || body?.clientPassword
        ? { clientID: body.clientID, clientPassword: body.clientPassword }
        : undefined

    // Never-attempted carriers only — this is a one-time drain of the roster;
    // the delta poller keeps carriers fresh afterward (so we don't re-insert
    // unchanged insurance rows on every cycle).
    const { data: carriers, error } = await supabaseAdmin
      .from('carriers')
      .select('id, dot_number, mc_number, rmis_insured_id, safety_rating')
      .is('rmis_attempted_at', null)
      .limit(batchSize)
    if (error) throw error

    let succeeded = 0
    let failed = 0
    let docsArchived = 0
    const now = new Date().toISOString()

    for (const carrier of carriers ?? []) {
      const dot = (carrier as any).dot_number
      try {
        const xml = await fetchExpandedCarrierXML({
          insdID: (carrier as any).rmis_insured_id || undefined,
          dotNumber: dot,
          credentials: creds,
        })
        const parsed = parseRMISXML(xml)
        const evaluation = evaluateRMIS(parsed)

        const row = buildInsuranceRow((carrier as any).id, dot, parsed, evaluation, xml)
        const { error: insErr } = await supabaseAdmin
          .from('carrier_insurance')
          .insert([row])
        if (insErr) throw insErr

        const carrierUpdates: TablesUpdate<'carriers'> = { rmis_attempted_at: now }
        if (parsed.rmisCarrierID) carrierUpdates.rmis_insured_id = parsed.rmisCarrierID
        if (parsed.safetyRating) carrierUpdates.safety_rating = parsed.safetyRating
        await supabaseAdmin.from('carriers').update(carrierUpdates).eq('dot_number', dot)

        const insdID = parsed.rmisCarrierID || (carrier as any).rmis_insured_id
        if (insdID) {
          const archive = await archiveCarrierDocuments({
            dot,
            carrierId: (carrier as any).id,
            insdID: String(insdID),
            xml,
          })
          docsArchived += archive.archived
        }
        succeeded++
      } catch (perCarrierErr) {
        // Mark attempted even on failure so we cycle past unmonitored carriers.
        await supabaseAdmin
          .from('carriers')
          .update({ rmis_attempted_at: now })
          .eq('dot_number', dot)
        failed++
      }
    }

    // How many carriers have never been attempted yet.
    const { count: remaining } = await supabaseAdmin
      .from('carriers')
      .select('id', { count: 'exact', head: true })
      .is('rmis_attempted_at', null)

    return NextResponse.json({
      processed: (carriers ?? []).length,
      succeeded,
      failed,
      docsArchived,
      remainingNeverAttempted: remaining ?? 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
