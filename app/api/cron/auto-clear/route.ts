import { NextResponse } from 'next/server'
import { reevaluatePendingCarriers } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/cron/auto-clear — nightly (n8n schedule). Re evaluates carriers the
// automated onboarding left in Pending Review or On Hold, using data that has
// arrived since (Bluewire monthly upload, RMIS delta, SOS), and approves the
// ones that are now clean. Never touches a status a person set.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const limit = Number(body?.limit) > 0 ? Number(body.limit) : 200
  try {
    const result = await reevaluatePendingCarriers(limit)
    return NextResponse.json({ ok: true, ...result })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
