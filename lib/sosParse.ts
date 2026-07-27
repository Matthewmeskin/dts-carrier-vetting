import Anthropic from '@anthropic-ai/sdk'

// Turn free-text copied from a state Secretary-of-State record into the
// structured fields the manual-entry form uses. The reviewer pastes whatever
// they copied off the state site; Claude extracts the fields and the reviewer
// confirms before saving. No lookups — this only parses the pasted text.

const MODEL = 'claude-haiku-4-5'

export interface ParsedSos {
  entity_name: string | null
  state: string | null
  entity_id: string | null
  status: string | null
  entity_type: string | null
  formation_date: string | null
  registered_agent: string | null
  principal_address: string | null
  source_url: string | null
}

const SCHEMA = {
  type: 'object',
  properties: {
    entity_name: { type: ['string', 'null'], description: 'Legal entity name exactly as registered.' },
    state: { type: ['string', 'null'], description: 'Two-letter state code the record is from (e.g. NV, CA).' },
    entity_id: { type: ['string', 'null'], description: 'State entity / file / registration number.' },
    status: { type: ['string', 'null'], description: 'Status text, e.g. "Active", "Good Standing", "Dissolved".' },
    entity_type: { type: ['string', 'null'], description: 'Entity type, e.g. "Domestic LLC", "Corporation".' },
    formation_date: { type: ['string', 'null'], description: 'Formation / registration date as YYYY-MM-DD if determinable, else the date text.' },
    registered_agent: { type: ['string', 'null'], description: 'Registered agent name.' },
    principal_address: { type: ['string', 'null'], description: 'Principal / business address.' },
    source_url: { type: ['string', 'null'], description: 'A URL if one appears in the text, else null.' },
  },
  required: [
    'entity_name', 'state', 'entity_id', 'status', 'entity_type',
    'formation_date', 'registered_agent', 'principal_address', 'source_url',
  ],
  additionalProperties: false,
}

export function sosParseConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export async function parseSosText(text: string): Promise<ParsedSos> {
  if (!sosParseConfigured()) {
    throw new Error('AI parsing is not configured (set ANTHROPIC_API_KEY).')
  }
  const client = new Anthropic()
  const prompt = `Extract Secretary-of-State registration fields from the text below, which a user copied from a state business-entity record. Only use what is present in the text — do not guess or invent values; leave a field null when it is not clearly present. Normalize the state to its two-letter code and any date to YYYY-MM-DD when possible. Return only via the record_sos_fields tool.\n\nRECORD TEXT:\n${String(text).slice(0, 8000)}`

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    tools: [
      {
        name: 'record_sos_fields',
        description: 'Record the extracted Secretary-of-State fields.',
        input_schema: SCHEMA as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'record_sos_fields' },
    messages: [{ role: 'user', content: prompt }],
  })
  const block = msg.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: ParsedSos }
    | undefined
  if (!block) throw new Error('Could not parse the pasted text.')
  return block.input
}
