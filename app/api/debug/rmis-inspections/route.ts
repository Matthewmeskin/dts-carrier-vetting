import { NextResponse } from 'next/server'
import { fetchExpandedCarrierXML } from '@/lib/rmisClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// TEMPORARY debug endpoint: returns just the DOT inspection/crash portion of the
// raw RMIS Expanded Carrier feed so we can see whether individual inspection
// records (with dates) are available. Secret-gated. Remove after inspection.
// One-time token for this temporary probe (endpoint is deleted right after use).
const TEMP_TOKEN = 'tok_abcedc02f6d1b7250f426209261c5cf9490d2042e36e114b'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET && secret !== TEMP_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dot = (url.searchParams.get('dot') ?? '').replace(/\D/g, '')
  if (!dot) return NextResponse.json({ error: 'Missing dot' }, { status: 400 })
  try {
    const xml = await fetchExpandedCarrierXML({ dotNumber: dot })
    const grab = (tag: string) => {
      const m = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'i').exec(xml)
      return m ? m[0] : null
    }
    const inspections = grab('DOTInspectionCollection')
    const crashes = grab('DOTCrashCollection')
    // Also list any tag names that look date-ish inside the inspection node.
    const dateTags = inspections
      ? Array.from(new Set((inspections.match(/<([A-Za-z_]*[Dd]ate[A-Za-z_]*)>/g) ?? [])))
      : []
    return NextResponse.json({
      dot,
      xmlLength: xml.length,
      inspectionNode: inspections ? inspections.slice(0, 6000) : '(not present)',
      crashNodePreview: crashes ? crashes.slice(0, 1500) : '(not present)',
      dateTagsInInspectionNode: dateTags,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed' }, { status: 500 })
  }
}
