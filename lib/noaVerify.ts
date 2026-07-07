// Reads a factoring carrier's Notice of Assignment (NOA) PDF with Claude and
// verifies the assignee (factor) and remittance ("pay-to") address against the
// RMIS pay-to details + the linked factor. Same cheap-model, forced-tool pattern
// as the SOS matcher.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5'

export interface NoaVerifyInput {
  documentBase64: string
  mediaType: string // e.g. 'application/pdf' or 'image/png'
  carrierName: string | null
  factorName: string | null
  payToEntity: string | null
  payToAddress: string | null
}

export interface NoaVerification {
  is_noa: boolean
  assignee_name: string | null
  remittance_name: string | null
  remittance_address: string | null
  effective_date: string | null
  carrier_name_on_doc: string | null
  assignee_matches_factor: boolean
  payto_name_matches: boolean
  payto_address_match: 'match' | 'partial' | 'mismatch' | 'unknown'
  discrepancies: string[]
  summary: string
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    is_noa: { type: 'boolean', description: 'Is this document actually a Notice of Assignment (factoring assignment of receivables)?' },
    assignee_name: { type: ['string', 'null'], description: 'The factoring company named as assignee / to whom payments are assigned.' },
    remittance_name: { type: ['string', 'null'], description: 'The name payments should be made payable to (the pay-to name).' },
    remittance_address: { type: ['string', 'null'], description: 'The remittance / pay-to mailing address printed on the NOA.' },
    effective_date: { type: ['string', 'null'], description: 'Effective/issue date of the NOA (ISO YYYY-MM-DD if determinable).' },
    carrier_name_on_doc: { type: ['string', 'null'], description: 'The carrier/client named on the NOA.' },
    assignee_matches_factor: { type: 'boolean', description: 'Does the assignee named on the NOA match the linked factor / expected pay-to entity (ignore corporate suffixes/punctuation/case)?' },
    payto_name_matches: { type: 'boolean', description: 'Does the remittance name match the RMIS pay-to entity?' },
    payto_address_match: { type: 'string', enum: ['match', 'partial', 'mismatch', 'unknown'], description: 'How the NOA remittance address compares to the RMIS pay-to address.' },
    discrepancies: { type: 'array', items: { type: 'string' }, description: 'Human-readable discrepancies a reviewer must resolve (wrong factor named, address differs, expired/undated, carrier name mismatch, etc.).' },
    summary: { type: 'string', description: 'One-sentence reviewer summary.' },
  },
  required: [
    'is_noa', 'assignee_name', 'remittance_name', 'remittance_address',
    'effective_date', 'carrier_name_on_doc', 'assignee_matches_factor',
    'payto_name_matches', 'payto_address_match', 'discrepancies', 'summary',
  ],
  additionalProperties: false,
} as const

export function noaVerifyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export async function verifyNOA(input: NoaVerifyInput): Promise<NoaVerification> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('NOA verification is not configured (set ANTHROPIC_API_KEY)')
  }
  const client = new Anthropic()

  const prompt = `You are a freight-broker compliance reviewer verifying a carrier's Notice of Assignment (NOA) for factoring.

EXPECTED details from our system (FMCSA/RMIS):
- Carrier: ${input.carrierName ?? 'unknown'}
- Linked factor (who we expect to pay): ${input.factorName ?? 'unknown'}
- RMIS pay-to entity: ${input.payToEntity ?? 'unknown'}
- RMIS pay-to address: ${input.payToAddress ?? 'unknown'}

Read the attached document. Confirm it is a genuine Notice of Assignment, then extract the assignee (factoring company), the remittance/pay-to name and address, the carrier named, and the effective date. Compare them to the expected details above (ignore corporate-suffix, punctuation, and case differences when matching names). Flag anything a reviewer must resolve — e.g. the assignee is a different factor than expected, the remittance address does not match the RMIS pay-to address, the NOA is undated/expired, or the carrier named differs. Return only via the record_noa_verification tool.`

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [
      {
        name: 'record_noa_verification',
        description: 'Record the structured NOA verification verdict.',
        input_schema: OUTPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'record_noa_verification' },
    messages: [
      {
        role: 'user',
        content: [
          input.mediaType === 'application/pdf'
            ? {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: input.documentBase64,
                },
              }
            : {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mediaType as any,
                  data: input.documentBase64,
                },
              },
          { type: 'text', text: prompt },
        ] as any,
      },
    ],
  })

  const block = msg.content.find((b) => b.type === 'tool_use') as
    | { type: 'tool_use'; input: NoaVerification }
    | undefined
  if (!block) throw new Error('The model did not return a structured NOA verification')
  return block.input
}
