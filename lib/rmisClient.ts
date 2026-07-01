// RMIS API client — Expanded Carrier API + Delta API
//
// The Expanded Carrier API returns XML (parsed by lib/rmisParser.ts).
// The Delta API is JSON and is used to discover which carriers changed.
//
// Endpoints (per RMIS docs):
//   POST  {BASE}/_c/std/api/DeltaAPI.aspx
//   GET   {BASE}/_c/std/api/ExpandedCarrierAPI.aspx

const BASE_URL = process.env.RMIS_BASE_URL || 'https://api.rmissecure.com'
const CLIENT_ID = process.env.RMIS_CLIENT_ID
const CLIENT_PASSWORD = process.env.RMIS_CLIENT_PASSWORD

const DELTA_URL = `${BASE_URL}/_c/std/api/DeltaAPI.aspx`
const EXPANDED_URL = `${BASE_URL}/_c/std/api/ExpandedCarrierAPI.aspx`
const DOCUMENT_URL = `${BASE_URL}/_c/std/api/DocumentAPI.aspx`

function requireCredentials() {
  if (!CLIENT_ID || !CLIENT_PASSWORD) {
    throw new Error('RMIS credentials are not configured (RMIS_CLIENT_ID / RMIS_CLIENT_PASSWORD)')
  }
}

export interface RMISCredentials {
  clientID?: string
  clientPassword?: string
}

function resolveCreds(override?: RMISCredentials) {
  const clientID = override?.clientID || CLIENT_ID
  const clientPassword = override?.clientPassword || CLIENT_PASSWORD
  if (!clientID || !clientPassword) {
    throw new Error('RMIS credentials are not configured')
  }
  return { clientID, clientPassword }
}

/**
 * Fetch the Expanded Carrier record as raw XML.
 * Provide either an RMIS insured id (InsdID) or a DOT number.
 */
export async function fetchExpandedCarrierXML(params: {
  insdID?: string
  dotNumber?: string
  credentials?: RMISCredentials
}): Promise<string> {
  const { clientID, clientPassword } = resolveCreds(params.credentials)

  if (!params.insdID && !params.dotNumber) {
    throw new Error('fetchExpandedCarrierXML requires either insdID or dotNumber')
  }

  const query = new URLSearchParams({
    ClientID: clientID,
    ClientPassword: clientPassword,
  })
  if (params.insdID) query.set('InsdID', params.insdID)
  if (params.dotNumber) query.set('DOTNumber', params.dotNumber)

  const res = await fetch(`${EXPANDED_URL}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/xml, text/xml' },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`RMIS Expanded Carrier API returned ${res.status} ${res.statusText}`)
  }

  return res.text()
}

export type RMISDocumentType =
  | 'Certificate'
  | 'W9'
  | 'Agreement'
  | 'ClientAgreement'
  | 'Document'

export interface RMISDocument {
  buffer: Buffer
  contentType: string
  fileName: string
}

// Best-effort file-type sniff from magic bytes, since the DocumentAPI does not
// return a content type. Most RMIS documents are PDFs.
function detectContentType(buf: Buffer): { contentType: string; ext: string } {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF')
    return { contentType: 'application/pdf', ext: 'pdf' }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8)
    return { contentType: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { contentType: 'image/png', ext: 'png' }
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)
    // PK zip container — modern Office docs (docx/xlsx). Default to docx.
    return { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' }
  return { contentType: 'application/octet-stream', ext: 'bin' }
}

// Pull the base64 payload out of the DocumentAPI response, which may be a bare
// string or a JSON object keyed under one of several field names.
function extractBase64(raw: string): string {
  const text = raw.trim()
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const KNOWN = [
        'document', 'documentdata', 'data', 'filedata', 'file',
        'base64', 'content', 'bytes', 'image',
      ]
      const entries = Object.entries(parsed as Record<string, unknown>)
      // Prefer a known key, otherwise the longest string value.
      for (const [k, v] of entries) {
        if (typeof v === 'string' && KNOWN.includes(k.toLowerCase())) return v
      }
      let best = ''
      for (const [, v] of entries) {
        if (typeof v === 'string' && v.length > best.length) best = v
      }
      if (best) return best
    }
  } catch {
    // Not JSON — treat the whole body as the base64 payload.
  }
  return text.replace(/^"|"$/g, '')
}

/**
 * Retrieve a carrier document from RMIS (base64) and decode it to a Buffer.
 * documentType is one of Certificate | W9 | Agreement | ClientAgreement | Document.
 */
export async function fetchCarrierDocument(params: {
  insdID: string
  documentType: RMISDocumentType
  documentID: string
  credentials?: RMISCredentials
}): Promise<RMISDocument> {
  const { clientID, clientPassword } = resolveCreds(params.credentials)

  const query = new URLSearchParams({
    clientID,
    pwd: clientPassword,
    documentType: params.documentType,
    documentID: params.documentID,
    insdID: params.insdID,
    version: '1',
  })

  const res = await fetch(`${DOCUMENT_URL}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`RMIS Document API returned ${res.status} ${res.statusText}`)
  }

  const base64 = extractBase64(await res.text())
  if (!base64) {
    throw new Error('RMIS Document API returned no document data')
  }

  const buffer = Buffer.from(base64, 'base64')
  const { contentType, ext } = detectContentType(buffer)
  const fileName = `${params.documentType}-${params.documentID}.${ext}`
  return { buffer, contentType, fileName }
}

async function deltaRequest(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(DELTA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`RMIS Delta API returned ${res.status} ${res.statusText}`)
  }

  return res.json()
}

/** Delta Summary — how many insured IDs are queued as changed. */
export async function deltaSummary(credentials?: RMISCredentials): Promise<{ total: number; raw: any }> {
  const { clientID, clientPassword } = resolveCreds(credentials)
  const raw = await deltaRequest({
    ClientID: clientID,
    ClientPassword: clientPassword,
    APIMode: 'Summary',
  })
  const total = Number(raw?.RMISDeltaAPI?.SUMMARY?.TotalInsdIDs ?? 0)
  return { total, raw }
}

/** Delta Fetch — pull a batch of changed insured IDs. */
export async function deltaFetch(
  maxRecs = 50,
  credentials?: RMISCredentials
): Promise<{ insdIDs: string[]; raw: any }> {
  const { clientID, clientPassword } = resolveCreds(credentials)
  const raw = await deltaRequest({
    ClientID: clientID,
    ClientPassword: clientPassword,
    APIMode: 'Fetch',
    MaxRecs: String(maxRecs),
  })
  const fetched = raw?.RMISDeltaAPI?.FETCH?.InsdID
  const insdIDs: string[] = fetched
    ? (Array.isArray(fetched) ? fetched : [fetched]).map(String)
    : []
  return { insdIDs, raw }
}

/** Delta Clear — acknowledge processed insured IDs so they leave the queue. */
export async function deltaClear(
  items: { insdID: string; timeStamp?: string }[],
  credentials?: RMISCredentials
): Promise<any> {
  if (items.length === 0) return null
  const { clientID, clientPassword } = resolveCreds(credentials)
  return deltaRequest({
    ClientID: clientID,
    ClientPassword: clientPassword,
    APIMode: 'Clear',
    // Per the Delta API spec, Clear takes ClearInsureds with each insured's id
    // and the timeStamp from the Expanded Carrier API header response.
    ClearInsureds: items.map((i) => ({
      insdID: i.insdID,
      timeStamp: i.timeStamp,
    })),
  })
}

export { requireCredentials }
