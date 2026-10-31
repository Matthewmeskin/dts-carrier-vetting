// Secretary of State lookups for the Agent Platform (the operations portal's
// /agents section, dts-sage). The Agent Platform queues them in its own
// tables (agents.ag_sos_queue) and pings app/api/cron/agent-sos. This claims
// them, looks each one up through the same OpenSOS client carriers use, has
// Claude Haiku read the registry's answer, and writes the verdict back with
// public.ag_sos_record, which updates the agent's checklist. Nothing here
// touches carrier or factor tables.

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from './supabase'
import { lookupEntity } from './sosClient'

// The current Haiku: cheap and fast, per the "cheap AI to read the data" rule
// the carrier matcher (lib/sosMatch.ts) follows.
const MODEL = 'claude-haiku-5-5'

export interface AgentSosJob {
  id: string
  agent_id: string
  check_key: 'sos' | 'sos_ca'
  entity_name: string
  state: string
  fresh: boolean
  address: string | null
  dba: string | null
  people: string[]
}

export interface AgentSosMatch {
  matched: boolean
  match_confidence: 'high' | 'medium' | 'low' | 'none'
  entity_name: string | null
  entity_id: string | null
  status: string | null
  status_normalized: 'active' | 'inactive' | 'dissolved' | 'delinquent' | 'unknown'
  entity_type: string | null
  formation_date: string | null
  registered_agent: string | null
  principal_address: string | null
  officers: string[]
  people_listed: string[]
  name_match: boolean
  mismatches: string[]
  risk_flags: string[]
  summary: string
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    matched: { type: 'boolean', description: 'True if one entity in the response is plausibly the target company.' },
    match_confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
    entity_name: { type: ['string', 'null'], description: 'Registered legal name of the matched entity.' },
    entity_id: { type: ['string', 'null'], description: 'State entity, file or registration number.' },
    status: { type: ['string', 'null'], description: 'Status text exactly as the registry gives it.' },
    status_normalized: { type: 'string', enum: ['active', 'inactive', 'dissolved', 'delinquent', 'unknown'] },
    entity_type: { type: ['string', 'null'] },
    formation_date: { type: ['string', 'null'], description: 'YYYY-MM-DD if the record shows it, else null.' },
    registered_agent: { type: ['string', 'null'] },
    principal_address: { type: ['string', 'null'] },
    officers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Every officer, member, manager, director, organizer or principal named on the matched entity.',
    },
    people_listed: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Which of the PEOPLE given in the prompt appear among those officers, spelled exactly as given in the prompt. Empty when none do or the record names nobody.',
    },
    name_match: { type: 'boolean', description: 'Does the registered name match the target, ignoring suffixes like LLC or INC and punctuation?' },
    mismatches: { type: 'array', items: { type: 'string' }, description: 'Plain differences from the target (name, address, people).' },
    risk_flags: { type: 'array', items: { type: 'string' }, description: 'Anything a compliance reviewer should see, such as an entity formed in the last few months.' },
    summary: { type: 'string', description: 'One sentence for a compliance reviewer.' },
  },
  required: [
    'matched', 'match_confidence', 'entity_name', 'entity_id', 'status', 'status_normalized', 'entity_type',
    'formation_date', 'registered_agent', 'principal_address', 'officers', 'people_listed', 'name_match',
    'mismatches', 'risk_flags', 'summary',
  ],
  additionalProperties: false,
} as const

/** Reads one registry answer against the agent's company and people. */
export async function matchAgentSos(job: AgentSosJob, raw: unknown): Promise<AgentSosMatch> {
  const client = new Anthropic()
  const purpose =
    job.check_key === 'sos_ca'
      ? `This is a California lookup for a company formed in another state, to confirm it is registered to do business in California.`
      : `This is a lookup in the company's state of formation, to confirm it is active and that someone on its DTS setup runs it.`

  const prompt = `You are checking a freight agent company's registration against a Secretary of State record for DTS, a freight broker. ${purpose}

TARGET company:
- Legal name: ${job.entity_name}
- DBA: ${job.dba ?? 'none'}
- Business address: ${job.address ?? 'unknown'}
- State searched: ${job.state}

PEOPLE on the DTS setup (any of them should appear as an officer, member, manager, director, organizer or principal):
${job.people.length ? job.people.map((p) => `- ${p}`).join('\n') : '- none given'}

RAW Secretary of State response (zero, one or several candidate entities):
${JSON.stringify(raw).slice(0, 16000)}

Pick the one entity that is the target company, ignoring differences in suffixes (LLC, L.L.C., INC, CORP), punctuation and case; a match on the DBA counts. If none plausibly is, set matched=false, match_confidence="none" and status_normalized="unknown". A person counts as listed when the record names the same person, whatever the order (LAST, FIRST), case, middle names or initials. Record differences in mismatches and anything a reviewer should see in risk_flags. Answer only through the record_agent_sos tool.`

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [
      {
        name: 'record_agent_sos',
        description: 'Record the Secretary of State verdict for the agent company.',
        input_schema: OUTPUT_SCHEMA as any,
      },
    ],
    // A forced tool call: Haiku 5.5 answers straight through the tool.
    tool_choice: { type: 'tool', name: 'record_agent_sos' },
    messages: [{ role: 'user', content: prompt }],
  })

  // Haiku's safety classifiers can decline (no server-side fallback): the
  // lookup is retried and, after three tries, left for a person.
  const stop = msg.stop_reason as string | null
  if (stop === 'refusal') throw new Error('The matcher declined this record')
  if (stop === 'max_tokens') throw new Error('The matcher ran out of room')
  const block = msg.content.find((b) => b.type === 'tool_use') as { type: 'tool_use'; input: AgentSosMatch } | undefined
  if (!block) throw new Error('The matcher did not return a verdict')
  const m = block.input
  // Only names the Agent Platform sent can come back as listed.
  const sent = new Map(job.people.map((p) => [p.trim().toLowerCase(), p]))
  m.people_listed = (Array.isArray(m.people_listed) ? m.people_listed : [])
    .map((p) => sent.get(String(p).trim().toLowerCase()))
    .filter((p): p is string => Boolean(p))
  m.officers = Array.isArray(m.officers) ? m.officers.map(String) : []
  return m
}

function errorText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e ?? 'Unknown error')
  return s.slice(0, 400)
}

/** One queued lookup, start to finish. Never throws: failures are reported back for a retry. */
export async function runAgentSosJob(job: AgentSosJob): Promise<'clear' | 'flag' | 'retry' | 'failed' | 'ignored' | 'error'> {
  const db = supabaseAdmin as any
  let match: AgentSosMatch
  let raw: unknown
  try {
    const res = await lookupEntity({ entityName: job.entity_name, state: job.state, fresh: job.fresh, timeoutMs: 60_000 })
    raw = res.raw
    match = await matchAgentSos(job, raw)
  } catch (e) {
    const { data, error } = await db.rpc('ag_sos_record', { p_id: job.id, p_match: null, p_raw: null, p_error: errorText(e) })
    if (error) console.error('agent-sos: could not report a failure', error.code)
    return error ? 'error' : data
  }
  const { data, error } = await db.rpc('ag_sos_record', { p_id: job.id, p_match: match, p_raw: raw ?? null, p_error: null })
  if (error) {
    console.error('agent-sos: could not record a result', error.code)
    return 'error'
  }
  return data
}

/** Works through the queue, two at a time, until it is empty or time runs short. */
export async function drainAgentSosQueue(budgetMs = 240_000): Promise<{ processed: number; results: Record<string, number> }> {
  const db = supabaseAdmin as any
  const started = Date.now()
  const results: Record<string, number> = {}
  let processed = 0
  while (Date.now() - started < budgetMs) {
    const { data, error } = await db.rpc('ag_sos_claim', { p_limit: 2 })
    if (error) throw new Error(`Could not claim lookups (${error.code ?? 'error'})`)
    const jobs = (data ?? []) as AgentSosJob[]
    if (jobs.length === 0) break
    const outcomes = await Promise.all(jobs.map((j) => runAgentSosJob(j)))
    for (const o of outcomes) {
      results[o] = (results[o] ?? 0) + 1
      processed++
    }
  }
  return { processed, results }
}
