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
    // Verify auth
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

    let insdIDs: string[] = Array.isArray(body?.insdIDs) ? body.insdIDs.map(String) : []

    // If not provided, discover via delta API
    if (insdIDs.length === 0) {
      await deltaSummary(creds)
      const fetched = await deltaFetch(50, creds)
      insdIDs = fetched.insdIDs
    }

    if (insdIDs.length === 0) {
      return NextResponse.json({ processed: 0, hardStopsDetected: 0 })
    }

    const toClear: { insdID: string; timeStamp?: string }[] = []
    const hardStopCarriers: HardStopCarrier[] = []

    for (const insdID of insdIDs) {
      try {
        const xml = await fetchExpandedCarrierXML({ insdID, credentials: creds })
        const parsed = parseRMISXML(xml)
        const evaluation = evaluateRMIS(parsed)

        const { data: carrier } = await supabaseAdmin
          .from('carriers')
          .select('*')
          .eq('dot_number', parsed.dotNumber)
          .single()

        if (carrier) {
          // Previous latest insurance
          const { data: prevRows } = await supabaseAdmin
            .from('carrier_insurance')
            .select('*')
            .eq('dot_number', parsed.dotNumber)
            .order('updated_at', { ascending: false })
            .limit(1)
          const prev: any = prevRows && prevRows.length > 0 ? prevRows[0] : null

          // Change summary (stored as text[] of human-readable descriptions)
          const changeSummary: string[] = []
          const compare = (label: string, oldVal: any, newVal: any) => {
            const o = oldVal ?? null
            const n = newVal ?? null
            if (o !== n) changeSummary.push(`${label}: "${o ?? '—'}" → "${n ?? '—'}"`)
          }
          compare('Auto status', prev?.auto_status, parsed.autoStatus)
          compare('Cargo status', prev?.cargo_status, parsed.cargoStatus)
          compare('Operating status', prev?.operating_status, parsed.operatingStatus)
          compare('Safety rating', (carrier as any).safety_rating, parsed.safetyRating)

          // Upsert insurance (insert new row)
          const row = buildInsuranceRow(
            (carrier as any).id,
            parsed.dotNumber,
            parsed,
            evaluation,
            xml
          )
          await supabaseAdmin.from('carrier_insurance').insert([row])

          // Update carrier safety rating + insured id
          const carrierUpdates: TablesUpdate<'carriers'> = {}
          if (parsed.rmisCarrierID) carrierUpdates.rmis_insured_id = parsed.rmisCarrierID
          if (parsed.safetyRating) carrierUpdates.safety_rating = parsed.safetyRating
          if (Object.keys(carrierUpdates).length > 0) {
            await supabaseAdmin
              .from('carriers')
              .update(carrierUpdates)
              .eq('dot_number', parsed.dotNumber)
          }

          // Archive any new/changed documents (deduped by content).
          try {
            const insId = parsed.rmisCarrierID || insdID
            if (insId) {
              await archiveCarrierDocuments({
                dot: parsed.dotNumber,
                carrierId: (carrier as any).id,
                insdID: String(insId),
                xml,
              })
            }
          } catch (docErr) {
            console.error(`Delta doc archive failed for ${parsed.dotNumber}:`, docErr)
          }

          // Insert delta log
          const deltaRow = {
            dot_number: parsed.dotNumber,
            rmis_insured_id: insdID,
            change_summary: changeSummary,
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

          if (evaluation.hardStops.length > 0) {
            hardStopCarriers.push({
              dotNumber: parsed.dotNumber,
              legalName: (carrier as any).legal_name ?? parsed.legalName,
              hardStops: evaluation.hardStops,
              flags: evaluation.flags,
              alertType: 'delta_hard_stop',
              deltaLogIds: deltaInserted ? [(deltaInserted as any).id] : [],
            })
          }
        }

        toClear.push({ insdID, timeStamp: parsed.headerTimestamp })
      } catch (perCarrierErr) {
        console.error(`Delta processing error for InsdID ${insdID}:`, perCarrierErr)
        // do not clear failed records so they remain queued
      }
    }

    // Alert for hard stops
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
        // mark delta log rows alert_sent
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

    // Clear processed records from RMIS queue
    try {
      await deltaClear(toClear, creds)
    } catch (clearErr) {
      console.error('deltaClear failed:', clearErr)
    }

    return NextResponse.json({
      processed: toClear.length,
      hardStopsDetected: hardStopCarriers.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
