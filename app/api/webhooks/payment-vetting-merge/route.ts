import { NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { isMachineOrSessionAuthorized } from '@/lib/machineAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/webhooks/payment-vetting-merge
//
// Combine the rendered vetting-log PDF with the original uploaded load documents
// into ONE PDF, so the emailed/attached report bundles the source docs. The n8n
// workflow can't merge PDFs (Code nodes have no pdf-lib), so it calls this with:
//   { vettingLogBase64, docUrls: [{ url, mimeType, fileName }] }
// and gets back the merged PDF as raw application/pdf bytes (n8n reads it as the
// binary attachment). Best-effort: an original that can't be embedded (e.g. TIFF)
// is skipped rather than failing the whole merge.
export async function POST(request: Request) {
  if (!(await isMachineOrSessionAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => null)
    const vettingLogBase64 = String(body?.vettingLogBase64 ?? '').replace(
      /^data:[^;]+;base64,/,
      ''
    )
    if (!vettingLogBase64) {
      return NextResponse.json({ error: 'Missing vettingLogBase64' }, { status: 400 })
    }
    const docUrls: Array<{ url?: string; mimeType?: string; fileName?: string }> =
      Array.isArray(body?.docUrls) ? body.docUrls : []

    const merged = await PDFDocument.create()

    // 1) The vetting log itself.
    const logDoc = await PDFDocument.load(Buffer.from(vettingLogBase64, 'base64'))
    const logPages = await merged.copyPages(logDoc, logDoc.getPageIndices())
    logPages.forEach((p) => merged.addPage(p))

    // 2) Append each original document.
    const skipped: string[] = []
    for (const d of docUrls) {
      if (!d?.url) continue
      try {
        const res = await fetch(d.url, { cache: 'no-store' })
        if (!res.ok) {
          skipped.push(`${d.fileName || 'document'} (fetch ${res.status})`)
          continue
        }
        const bytes = new Uint8Array(await res.arrayBuffer())
        const isPdf =
          bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
        const mt = String(d.mimeType || '').toLowerCase()

        if (isPdf) {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const pages = await merged.copyPages(src, src.getPageIndices())
          pages.forEach((p) => merged.addPage(p))
        } else if (mt.includes('png') || (bytes[0] === 0x89 && bytes[1] === 0x50)) {
          const img = await merged.embedPng(bytes)
          addImagePage(merged, img.width, img.height, img)
        } else if (
          mt.includes('jpeg') ||
          mt.includes('jpg') ||
          (bytes[0] === 0xff && bytes[1] === 0xd8)
        ) {
          const img = await merged.embedJpg(bytes)
          addImagePage(merged, img.width, img.height, img)
        } else {
          // TIFF and other formats pdf-lib can't embed — skip, keep the report.
          skipped.push(`${d.fileName || 'document'} (unsupported ${mt || 'type'})`)
        }
      } catch (e) {
        skipped.push(`${d.fileName || 'document'} (${e instanceof Error ? e.message : 'error'})`)
      }
    }

    const out = await merged.save()
    // Return the merged PDF as base64 JSON — easier for the n8n workflow to
    // carry through Code nodes than raw bytes (which n8n may spool to disk).
    return NextResponse.json({
      mergedBase64: Buffer.from(out).toString('base64'),
      skipped,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Merge failed' }, { status: 500 })
  }
}

// Add an image as its own page, scaled to fit within a Letter-size page.
function addImagePage(doc: PDFDocument, w: number, h: number, img: any) {
  const MAX_W = 612 // 8.5in @ 72dpi
  const MAX_H = 792 // 11in
  const scale = Math.min(MAX_W / w, MAX_H / h, 1)
  const dw = w * scale
  const dh = h * scale
  const page = doc.addPage([MAX_W, MAX_H])
  page.drawImage(img, {
    x: (MAX_W - dw) / 2,
    y: (MAX_H - dh) / 2,
    width: dw,
    height: dh,
  })
}
