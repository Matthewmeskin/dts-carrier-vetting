import { NextResponse } from 'next/server'
import { parseSosText, sosParseConfigured } from '@/lib/sosParse'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/carriers/[dot]/sos/parse  { text }
// Parses raw text copied from a state SOS record into structured fields for the
// manual-entry form. Parsing only — the reviewer reviews and saves via PUT.
export async function POST(request: Request) {
  try {
    if (!sosParseConfigured()) {
      return NextResponse.json(
        { error: 'AI parsing is not configured (set ANTHROPIC_API_KEY).' },
        { status: 503 }
      )
    }
    const body = await request.json().catch(() => ({}))
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Paste the record text first.' }, { status: 400 })
    }
    const parsed = await parseSosText(text)
    return NextResponse.json({ parsed })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Could not parse the pasted text.' },
      { status: 500 }
    )
  }
}
