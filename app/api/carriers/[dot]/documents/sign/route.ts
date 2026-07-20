import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'carrier-documents'

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

// Issue a short-lived signed upload URL so the browser can upload the file
// DIRECTLY to Supabase Storage, bypassing Vercel's 4.5 MB serverless request-body
// limit (which was rejecting document uploads with a non-JSON 413). The client
// uploads to the signed URL, then calls POST /documents with the returned path
// to record the document row.
export async function POST(
  request: Request,
  { params }: { params: { dot: string } }
) {
  try {
    const dot = params.dot
    const body = await request.json().catch(() => ({}))
    const fileName = sanitizeName(String(body?.fileName ?? 'document'))
    const path = `${dot}/${Date.now()}-${fileName}`

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? 'Could not create upload URL' },
        { status: 500 }
      )
    }

    return NextResponse.json({ path: data.path ?? path, token: data.token })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 })
  }
}
