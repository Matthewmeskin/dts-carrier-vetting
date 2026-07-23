// Haiku-powered matcher: given a target carrier/factor identity (name + address
// from FMCSA/RMIS) and a raw OpenSOS lookup response, pick the best-matching
// entity and return a normalized, structured verdict. Using the model here keeps
// us resilient to per-state response shapes and does the fuzzy name/address
// reconciliation a reviewer would otherwise do by hand.

import Anthropic from '@anthropic-ai/sdk'

// Cheap, fast model per the "cheap AI to read the data" requirement.
const MODEL = 'claude-haiku-4-5'

export interface SosMatchTarget {
  kind: 'carrier' | 'factor'
  name: string
  address?: string | null
  state?: string | null
  /** Authority context helps flag reincarnation / chameleon patterns (carriers only). */
  authorityOriginalDate?: string | null
  authorityReinstatementDate?: string | null
}

export interface SosMatch {
  matched: boolean
  match_confidence: 'high' | 'medium' | 'low' | 'none'
  entity_name: string | null
  entity_id: string | null
  status: string | null
  status_normalized: 'active' | 'inactive' | 'dissolved' | 'delinquent' | 'unknown'
  entity_type: string | null
  formation_date: string | null
  registered_agent: string | null
  registered_agent_address: string | null
  principal_address: string | null
  officers: string[]
  name_match: boolean
  address_match: 'match' | 'partial' | 'mismatch' | 'unknown'
  mismatches: string[]
  risk_flags: string[]
  summary: string
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    matched: { type: 'boolean', description: 'True if a confident match to the target entity exists in the response.' },
    match_confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
    entity_name: { type: ['string', 'null'], description: 'Registered legal name of the matched entity.' },
    entity_id: { type: ['string', 'null'], description: 'State entity/file/registration number.' },
    status: { type: ['string', 'null'], description: 'Raw status text from the registry.' },
    status_normalized: { type: 'string', enum: ['active', 'inactive', 'dissolved', 'delinquent', 'unknown'] },
    entity_type: { type: ['string', 'null'] },
    formation_date: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD if determinable, else null.' },
    registered_agent: { type: ['string', 'null'] },
    registered_agent_address: { type: ['string', 'null'] },
    principal_address: { type: ['string', 'null'] },
    officers: { type: 'array', items: { type: 'string' }, description: 'Officer / principal / manager names.' },
    name_match: { type: 'boolean', description: 'Does the registered name match the target name (ignoring corporate suffixes)?' },
    address_match: { type: 'string', enum: ['match', 'partial', 'mismatch', 'unknown'] },
    mismatches: { type: 'array', items: { type: 'string' }, description: 'Human-readable discrepancies vs. the target identity.' },
    risk_flags: { type: 'array', items: { type: 'string' }, description: 'Fraud / chameleon / reincarnation signals, e.g. new entity under reinstated authority, dissolved entity still operating.' },
    summary: { type: 'string', description: 'One-sentence reviewer summary.' },
  },
  required: [
    'matched', 'match_confidence', 'entity_name', 'entity_id', 'status',
    'status_normalized', 'entity_type', 'formation_date', 'registered_agent',
    'registered_agent_address', 'principal_address', 'officers', 'name_match',
    'address_match', 'mismatches', 'risk_flags', 'summary',
  ],
  additionalProperties: false,
} as const

export function sosMatchConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/**
 * Reconcile a raw OpenSOS response against the target identity. Returns a
 * structured, normalized match verdict. Throws if ANTHROPIC_API_KEY is missing.
 */
export async function matchSosRecord(
  target: SosMatchTarget,
  rawSos: unknown
): Promise<SosMatch> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('SOS matching is not configured (set ANTHROPIC_API_KEY)')
  }

  const client = new Anthropic()

  const authorityContext =
    target.kind === 'carrier'
      ? `\nAuthority context: original FMCSA authority grant ${target.authorityOriginalDate ?? 'unknown'}, reinstatement ${target.authorityReinstatementDate ?? 'none'}.\nDATE ORDERING IS USUALLY NORMAL, NOT A RISK. A company is incorporated FIRST and applies for FMCSA authority afterward, so a formation date that PRE-DATES the original authority grant (by months or even a year+) is the EXPECTED, benign order — do NOT flag it. Likewise a registered-agent change, address change, or officer change that happens YEARS after the authority grant is routine corporate housekeeping — do NOT flag it. ONLY the reincarnation/chameleon pattern is a risk_flag: a NEWLY FORMED entity (formation AT or AFTER the original authority grant, or formed shortly before a REINSTATEMENT of previously-revoked authority) reusing an older MC/DOT — i.e. the entity is newer than the authority it operates under. If the formation simply pre-dates the grant, leave risk_flags empty for that item.`
      : `\nThis is a FACTORING company (payment recipient). Focus on confirming it is a real, active, registered entity whose name/address match the pay-to details.`

  const prompt = `You are verifying a ${target.kind}'s legal-entity registration against a Secretary of State record.

TARGET identity (from FMCSA/RMIS):
- Name: ${target.name}
- Address: ${target.address ?? 'unknown'}
- State searched: ${target.state ?? 'unknown'}${authorityContext}

RAW Secretary-of-State API response (may contain zero, one, or multiple candidate entities):
${JSON.stringify(rawSos).slice(0, 12000)}

Pick the single best-matching entity (ignore corporate-suffix differences like INC/LLC/CORP and punctuation/case when comparing names). Extract and normalize the fields. If no entity in the response plausibly matches the target, set matched=false, match_confidence="none", and status_normalized="unknown". Record any discrepancies in mismatches and any fraud/identity signals in risk_flags. Return only via the record_sos_match tool.`

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [
      {
        name: 'record_sos_match',
        description: 'Record the normalized Secretary-of-State match verdict.',
        input_schema: OUTPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'record_sos_match' },
    messages: [{ role: 'user', content: prompt }],
  })

  const block = msg.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: SosMatch }
    | undefined
  if (!block) {
    throw new Error('Haiku did not return a structured SOS match')
  }
  return block.input
}
