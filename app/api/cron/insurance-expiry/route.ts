import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { isBrokerwareDisabled } from '@/lib/revet'
import { sendInsuranceExpiryReport, type ExpiredInsuranceCarrier } from '@/lib/emailAlerts'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// POST — proactively email the full list of ACTIVE carriers whose auto/cargo
// insurance is CURRENTLY expired (not just newly-detected, which the daily
// digest covers). CRON_SECRET-guarded; run on a schedule from n8n.
// {"dryRun": true} returns the list without sending.

function coverageExpired(
  status: string | null | undefined,
  expDate: string | null | undefined
): boolean {
  if (expDate) {
    const d = new Date(expDate)
    if (!isNaN(d.getTime())) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (d.getTime() < today.getTime()) return true
    }
  }
  const s = (status || '').toLowerCase()
  return (
    s.includes('expired') ||
    s.includes('no-current') ||
    s.includes('no current') ||
    s.includes('cancel') ||
    s === 'none'
  )
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    const dryRun = body?.dryRun === true

    // Latest insurance row per carrier (view), paginated.
    const ins: any[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (supabaseAdmin as any)
        .from('latest_carrier_insurance')
        .select('dot_number, auto_status, auto_expiration_date, cargo_status, cargo_expiration_date')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      ins.push(...rows)
      if (rows.length < PAGE) break
    }

    // Carrier standing + names.
    const carriers: any[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (supabaseAdmin as any)
        .from('carriers')
        .select('dot_number, legal_name, mc_number, carrier_status, do_not_use, brokerware_status')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      carriers.push(...rows)
      if (rows.length < PAGE) break
    }
    const carrierByDot = new Map<string, any>()
    for (const c of carriers) carrierByDot.set(String(c.dot_number), c)

    const expired: ExpiredInsuranceCarrier[] = []
    for (const row of ins) {
      const dot = String(row.dot_number)
      const c = carrierByDot.get(dot)
      if (!c) continue
      // Only carriers we might actually use.
      if (c.do_not_use === true) continue
      if (isBrokerwareDisabled(c.brokerware_status)) continue

      const issues: string[] = []
      if (coverageExpired(row.auto_status, row.auto_expiration_date)) {
        issues.push(
          `Auto liability expired${row.auto_expiration_date ? ` ${formatDate(row.auto_expiration_date)}` : ''}${row.auto_status ? ` (${row.auto_status})` : ''}`
        )
      }
      if (coverageExpired(row.cargo_status, row.cargo_expiration_date)) {
        issues.push(
          `Cargo expired${row.cargo_expiration_date ? ` ${formatDate(row.cargo_expiration_date)}` : ''}${row.cargo_status ? ` (${row.cargo_status})` : ''}`
        )
      }
      if (issues.length === 0) continue
      expired.push({
        dotNumber: dot,
        legalName: c.legal_name ?? dot,
        mcNumber: c.mc_number ?? null,
        issues,
      })
    }

    expired.sort((a, b) => a.legalName.localeCompare(b.legalName))

    let sent = false
    let emailError: string | undefined
    if (!dryRun) {
      const res = await sendInsuranceExpiryReport(expired)
      sent = res.sent
      emailError = res.error
    }

    return NextResponse.json({
      expiredCount: expired.length,
      sent,
      dryRun,
      ...(emailError ? { emailError } : {}),
      carriers: expired.map((e) => ({ dot: e.dotNumber, name: e.legalName, issues: e.issues })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
