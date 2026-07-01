import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchExpandedCarrierXML,
  deltaSummary,
  deltaFetch,
  deltaClear,
  RMISCredentials,
} from '@/lib/rmisClient'
import { parseRMISXML } from '@/lib/rmisParser'
import { evaluateRMIS } from '@/lib/rmisEvaluator'
import { sendComplianceAlert } from '@/lib/emailAlerts'
import { buildInsuranceRow } from '@/app/api/carriers/[dot]/insurance/route'
import { archiveCarrierDocuments } from '@/lib/rmisArchive'
import { TablesUpdate } from '@/lib/database.types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Keep each run bounded so the function completes and we never abandon the
// queue mid-drain.
export const maxDuration = 60

// Fetch a small batch per run. The RMIS Delta queue must be CLEARED as we go
// (RMIS suspends accounts that fetch without clearing). We clear each carrier
// immediately after pulling it, so even if the run is cut short the queue still
// drains, and the remaining carriers simply reappear on the next run.
const DEFAULT_MAX_PER_RUN = 15

interface HardStopCarrier {
  dotNumber: string
  legalName: string
  hardStops: string[]
  flags: string[]
  alertType: 'delta_hard_stop'
  deltaLogIds: string[]
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const creds: RMISCredentials | undefined =
      body?.clientID || body?.clientPassword
        ? { clientID: body.clientID, clientPassword: body.clientPassword }
        : undefined

    const maxPerRun =
      Number(body?.maxRecs) > 0 ? Number(body.maxRecs) : DEFAULT_MAX_PER_RUN

    let insdIDs: string[] = Array.isArray(body?.insdIDs) ? body.insdIDs.map(String) : []
    let queueTotal: number | null = null

    // Discover changed carriers via the Delta API (Summary → Fetch).
    if (insdIDs.length === 0) {
      const summary = await deltaSummary(creds)
      queueTotal = summary.total
      const fetched = await deltaFetch(maxPerRun, creds)
      insdIDs = fetched.insdIDs
    }

    if (insdIDs.length === 0) {
      return NextResponse.json({ queueTotal, fetched: 0, cleared: 0, failed: 0, hardStopsDetected: 0 })
    }

    let cleared = 0
    let failed = 0
    const hardStopCarriers: HardStopCarrier[] = []

    for (const insdID of insdIDs) {
      try {
        // 1) Pull the current Expanded record (throws on an RMIS error envelope).
        const xml = await fetchExpandedCarrierXML({ insdID, credentials: creds })
        const parsed = parseRMISXML(xml)
        const evaluation = evaluateRMIS(parsed)

        // Clear requires the timestamp from the Expanded header. If it is
        // missing we can't safely clear, so skip (it'll be retried next run).
        if (!parsed.headerTimestamp) {
          failed++
          continue
        }

        // 2) Persist the change (best-effort) before clearing so we never lose data.
        const { data: carrier } = await supabaseAdmin
          .from('carriers')
          .select('*')
          .eq('dot_number', parsed.dotNumber)
          .single()

        let deltaLogId: string | null = null
        if (carrier) {
          const { data: prevRows } = await supabaseAdmin
            .from('carrier_insurance')
            .select('*')
            .eq('dot_number', parsed.dotNumber)
            .order('updated_at', { ascending: false })
            .limit(1)
          const prev: any = prevRows && prevRows.length > 0 ? prevRows[0] : null

          const row = buildInsuranceRow(
            (carrier as any).id,
            parsed.dotNumber,
            parsed,
            evaluation,
            xml
          )
          await supabaseAdmin.from('carrier_insurance').insert([row])

          const carrierUpdates: TablesUpdate<'carriers'> = {}
          if (parsed.rmisCarrierID) carrierUpdates.rmis_insured_id = parsed.rmisCarrierID
          if (parsed.safetyRating) carrierUpdates.safety_rating = parsed.safetyRating
          if (Object.keys(carrierUpdates).length > 0) {
            await supabaseAdmin
              .from('carriers')
              .update(carrierUpdates)
              .eq('dot_number', parsed.dotNumber)
          }

          const deltaRow = {
            dot_number: parsed.dotNumber,
            rmis_insured_id: insdID,
            change_summary: buildChangeSummary(prev, parsed, carrier),
            hard_stops_detected: evaluation.hardStops,
            flags_detected: evaluation.flags,
            previous_auto_status: prev?.auto_status ?? null,
            new_auto_status: parsed.autoStatus,
            previous_cargo_status: prev?.cargo_status ?? null,
            new_cargo_status: parsed.cargoStatus,
            previous_operating_status: prev?.operating_status ?? null,
            new_operating_status: parsed.operatingStatus,
            previous_safety_rating: (carrier as any).safety_rating ?? null,
            new_safety_rating: parsed.safetyRating,
            alert_sent: false,
            processed: true,
          }
          const { data: deltaInserted } = await supabaseAdmin
            .from('carrier_delta_log')
            .insert([deltaRow])
            .select('id')
            .single()
          deltaLogId = deltaInserted ? (deltaInserted as any).id : null

          if (evaluation.hardStops.length > 0) {
            hardStopCarriers.push({
              dotNumber: parsed.dotNumber,
              legalName: (carrier as any).legal_name ?? parsed.legalName,
              hardStops: evaluation.hardStops,
              flags: evaluation.flags,
              alertType: 'delta_hard_stop',
              deltaLogIds: deltaLogId ? [deltaLogId] : [],
            })
          }
        }

        // 3) CLEAR THIS CARRIER NOW — the critical step. Done per-carrier so the
        // queue drains incrementally and a timeout never leaves it un-cleared.
        await deltaClear([{ insdID, timeStamp: parsed.headerTimestamp }], creds)
        cleared++

        // 4) Optionally archive changed documents (best-effort, after clearing).
        // Off by default: pulling documents is slow and hits the Document API a
        // lot, so we keep the delta lean and reliable. Enable per-run with
        // {"archiveDocs": true} if you accept the extra load.
        if (carrier && body?.archiveDocs === true) {
          try {
            const insId = parsed.rmisCarrierID || insdID
            await archiveCarrierDocuments({
              dot: parsed.dotNumber,
              carrierId: (carrier as any).id,
              insdID: String(insId),
              xml,
            })
          } catch (docErr) {
            console.error(`Delta doc archive failed for ${parsed.dotNumber}:`, docErr)
          }
        }
      } catch (perCarrierErr) {
        // Leave this one queued; it will be retried on a later run. We do NOT
        // hammer it — the next scheduled run picks it up after the 120s
        // visibility window.
        console.error(`Delta processing error for InsdID ${insdID}:`, perCarrierErr)
        failed++
      }
    }

    // Alert for any new hard stops.
    if (hardStopCarriers.length > 0) {
      try {
        await sendComplianceAlert(
          hardStopCarriers.map((c) => ({
            dotNumber: c.dotNumber,
            legalName: c.legalName,
            hardStops: c.hardStops,
            flags: c.flags,
            alertType: c.alertType,
          })),
          'RMIS delta monitoring'
        )
        const allIds = hardStopCarriers.flatMap((c) => c.deltaLogIds)
        if (allIds.length > 0) {
          await supabaseAdmin
            .from('carrier_delta_log')
            .update({ alert_sent: true, alert_sent_at: new Date().toISOString() })
            .in('id', allIds)
        }
      } catch (alertErr) {
        console.error('Delta compliance alert failed:', alertErr)
      }
    }

    return NextResponse.json({
      queueTotal,
      fetched: insdIDs.length,
      cleared,
      failed,
      hardStopsDetected: hardStopCarriers.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// Human-readable change summary between the previous insurance row and the new
// parsed record.
function buildChangeSummary(prev: any, parsed: any, carrier: any): string[] {
  const changes: string[] = []
  const compare = (label: string, oldVal: any, newVal: any) => {
    const o = oldVal ?? null
    const n = newVal ?? null
    if (o !== n) changes.push(`${label}: "${o ?? '—'}" → "${n ?? '—'}"`)
  }
  compare('Auto status', prev?.auto_status, parsed.autoStatus)
  compare('Cargo status', prev?.cargo_status, parsed.cargoStatus)
  compare('Operating status', prev?.operating_status, parsed.operatingStatus)
  compare('Safety rating', carrier?.safety_rating, parsed.safetyRating)
  return changes
}
