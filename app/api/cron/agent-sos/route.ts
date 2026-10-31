import { NextResponse } from 'next/server'
import { drainAgentSosQueue } from '@/lib/agentSos'
import { sosPipelineConfigured } from '@/lib/sos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST: run the Agent Platform's queued Secretary of State lookups (see
// lib/agentSos.ts). The Agent Platform's database pings this when it queues
// one, and its agents-sos-sweep job pings it every 15 minutes while any wait.
//
// The ping carries no data and grants nothing: this only works through what
// is already queued, and only the Agent Platform's permission checked
// functions queue (a new intake, a staff rerun, the monthly and annual
// rechecks). A stray ping finds an empty queue and costs nothing. The answer
// is counts only.
export async function POST() {
  const cfg = sosPipelineConfigured()
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Secretary of State lookup is not configured. Set ${cfg.missing.join(' and ')}.` },
      { status: 503 }
    )
  }
  try {
    const out = await drainAgentSosQueue()
    return NextResponse.json(out)
  } catch (err: any) {
    console.error('agent-sos: drain failed', err?.message)
    return NextResponse.json({ error: 'The lookups could not run.' }, { status: 500 })
  }
}
