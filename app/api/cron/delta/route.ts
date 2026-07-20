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
import { evaluateRMIS, isExpiringCoverageStatus } from '@/lib/rmisEvaluator'
import { sendInsuranceRefreshRequest } from '@/lib/emailAlerts'
import { logCarrierEvent } from '@/lib/auditLog'
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

// Current time in RMIS's timestamp format ("M/D/YYYY h:mm:ss AM/PM", UTC) —
// used to force-clear a stale InsdID we can't pull an Expanded record for.
function rmisNowTimestamp(): string {
  return new Date()
    .toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .replace(',', '')
}

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
      // Timestamp used to clear this InsdID from the delta queue. Prefer the
      // Expanded header timestamp; if we can't pull the record (stale/invalid
      // InsdID), fall back to "now" so it still clears instead of looping forever.
      let clearTs: string | null = null
      try {
        // 1) Pull the current Expanded record (throws on an RMIS error envelope).
        const xml = await fetchExpandedCarrierXML({ insdID, credentials: creds })
        const parsed = parseRMISXML(xml)
        const evaluation = evaluateRMIS(parsed)
        clearTs = parsed.headerTimestamp || null

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

          // Only surface what actually CHANGED since the last pull, so baseline
          // conditions on carriers we already work with don't re-enter the review
          // queue on every refresh. Flags are compared by a normalized key (digits
          // /punctuation stripped) so a drifting value ("~132 months ago") isn't
          // mistaken for a new flag. A carrier's first-ever pull establishes a
          // silent baseline for flags; genuine hard stops still surface on first
          // pull (a do-not-use condition is worth knowing even at baseline).
          const flagKey = (s: string) =>
            s.toLowerCase().replace(/[0-9]+/g, '#').replace(/[^a-z#]+/g, ' ').replace(/\s+/g, ' ').trim()
          const prevFlagKeys = new Set(
            (Array.isArray(prev?.rmis_flags) ? prev.rmis_flags : []).map(flagKey)
          )
          const prevHardKeys = new Set(
            (Array.isArray(prev?.hard_stops) ? prev.hard_stops : []).map(flagKey)
          )
          const newFlags = prev
            ? evaluation.flags.filter((f) => !prevFlagKeys.has(flagKey(f)))
            : []
          const newHardStops = prev
            ? evaluation.hardStops.filter((h) => !prevHardKeys.has(flagKey(h)))
            : evaluation.hardStops

          const deltaRow = {
            dot_number: parsed.dotNumber,
            rmis_insured_id: insdID,
            change_summary: buildChangeSummary(prev, parsed, carrier),
            hard_stops_detected: newHardStops,
            flags_detected: newFlags,
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

          // Alert only on newly-introduced hard stops, not baseline ones that
          // persist across refreshes (which would re-alert every run).
          if (newHardStops.length > 0) {
            hardStopCarriers.push({
              dotNumber: parsed.dotNumber,
              legalName: (carrier as any).legal_name ?? parsed.legalName,
              hardStops: newHardStops,
              flags: newFlags,
              alertType: 'delta_hard_stop',
              deltaLogIds: deltaLogId ? [deltaLogId] : [],
            })
          }

          // Coverage due to expire → email RMIS (Truckstop) to request an updated
          // certificate, one carrier per email, and stamp it in the carrier's
          // activity log. Deduped to at most once per 14 days so a status that
          // stays "Due-To-Expire" across daily deltas isn't re-emailed.
          const autoExp = isExpiringCoverageStatus(parsed.autoStatus)
          const cargoExp = isExpiringCoverageStatus(parsed.cargoStatus)
          if (autoExp || cargoExp) {
            const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
            const { data: recent } = await (supabaseAdmin as any)
              .from('carrier_events')
              .select('id')
              .eq('dot_number', parsed.dotNumber)
              .eq('event_type', 'insurance_refresh_request')
              .gte('created_at', since)
              .limit(1)
            if (!recent || recent.length === 0) {
              const coverages = [
                autoExp ? 'Auto liability' : '',
                cargoExp ? 'Cargo' : '',
              ].filter(Boolean)
              const result = await sendInsuranceRefreshRequest({
                dotNumber: parsed.dotNumber,
                mcNumber: (carrier as any).mc_number ?? null,
                legalName: (carrier as any).legal_name ?? parsed.legalName,
                coverages,
                autoExpiration: autoExp ? parsed.autoExpirationDate || null : null,
                cargoExpiration: cargoExp ? parsed.cargoExpirationDate || null : null,
              })
              await logCarrierEvent({
                dot: parsed.dotNumber,
                carrierId: (carrier as any).id ?? null,
                type: 'insurance_refresh_request',
                summary: result.sent
                  ? `Requested updated insurance from RMIS (${result.to}) — ${coverages.join(' & ')} due to expire.`
                  : `Insurance update needed — ${coverages.join(' & ')} due to expire (email not sent: ${result.error}).`,
                detail: {
                  to: result.to,
                  sent: result.sent,
                  error: result.error ?? null,
                  coverages,
                  autoStatus: parsed.autoStatus,
                  cargoStatus: parsed.cargoStatus,
                },
                actor: 'system (RMIS delta)',
              })
            }
          }
        }

        // 3) Optionally archive changed documents (best-effort).
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
        console.error(`Delta processing error for InsdID ${insdID}:`, perCarrierErr)
        failed++
      }

      // CLEAR — ALWAYS, so the queue drains. A stale/invalid InsdID whose
      // Expanded record can't be pulled is force-cleared with the current
      // timestamp, so it stops reappearing on every batch (RMIS suspends
      // accounts whose delta queue never clears). This is the key fix for
      // carriers that were stuck in the queue for months.
      try {
        await deltaClear([{ insdID, timeStamp: clearTs || rmisNowTimestamp() }], creds)
        cleared++
      } catch (clearErr) {
        console.error(`Delta clear failed for InsdID ${insdID}:`, clearErr)
      }
    }

    // New hard stops are recorded in carrier_delta_log above; the daily digest
    // picks them up. Mark them so the timeline reflects they were surfaced.
    if (hardStopCarriers.length > 0) {
      try {
        const allIds = hardStopCarriers.flatMap((c) => c.deltaLogIds)
        if (allIds.length > 0) {
          await supabaseAdmin
            .from('carrier_delta_log')
            .update({ alert_sent: true, alert_sent_at: new Date().toISOString() })
            .in('id', allIds)
        }
      } catch (alertErr) {
        console.error('Delta hard-stop marking failed:', alertErr)
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
