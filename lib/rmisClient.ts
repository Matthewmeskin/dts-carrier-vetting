// RMIS API client — Expanded Carrier API + Delta API
//
// The Expanded Carrier API returns XML (parsed by lib/rmisParser.ts).
// The Delta API is JSON and is used to discover which carriers changed.
//
// Endpoints (per RMIS docs):
//   POST  {BASE}/_c/std/api/DeltaAPI.aspx
//   GET   {BASE}/_c/std/api/ExpandedCarrierAPI.aspx

import { withRmisLock } from './rmisLock'

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
  mcNumber?: string
  credentials?: RMISCredentials
}): Promise<string> {
  const { clientID, clientPassword } = resolveCreds(params.credentials)

  // Expanded Carrier API: querytype ∈ INSDID | MC_MX | DOT, with queryid as the
  // matching identifier. Prefer the RMIS insured id, then DOT, then MC.
  let querytype: string
  let queryid: string
  if (params.insdID) {
    querytype = 'INSDID'
    queryid = params.insdID
  } else if (params.dotNumber) {
    querytype = 'DOT'
    queryid = params.dotNumber
  } else if (params.mcNumber) {
    querytype = 'MC_MX'
    queryid = params.mcNumber
  } else {
    throw new Error('fetchExpandedCarrierXML requires insdID, dotNumber, or mcNumber')
  }

  const query = new URLSearchParams({
    clientID,
    pwd: clientPassword,
    querytype,
    queryid,
    version: '13',
  })

  const xml = await withRmisLock(async () => {
    const res = await fetch(`${EXPANDED_URL}?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml' },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`RMIS Expanded Carrier API returned ${res.status} ${res.statusText}`)
    }
    return res.text()
  }, { label: 'expanded' })
  // RMIS returns HTTP 200 with an error envelope on auth/param failures
  // (e.g. "Password could not be validated."). Reject these so callers never
  // parse an empty stub and store it over good data.
  if (/<Result>\s*ERROR\s*<\/Result>/i.test(xml)) {
    const err = /<Error>([\s\S]*?)<\/Error>/i.exec(xml)?.[1]?.trim()
    throw new Error(`RMIS Expanded Carrier API error: ${err || 'unknown error'}`)
  }
  return xml
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
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  )
    return { contentType: 'image/tiff', ext: 'tif' }
  return { contentType: 'application/octet-stream', ext: 'bin' }
}

// Map RMIS DocumentFileType to a content type + extension, falling back to a
// magic-byte sniff.
function mapFileType(fileType: string, buf: Buffer): { contentType: string; ext: string } {
  const t = fileType.trim().toLowerCase()
  if (t === 'pdf') return { contentType: 'application/pdf', ext: 'pdf' }
  if (t === 'tif' || t === 'tiff') return { contentType: 'image/tiff', ext: 'tif' }
  if (t === 'jpg' || t === 'jpeg') return { contentType: 'image/jpeg', ext: 'jpg' }
  if (t === 'png') return { contentType: 'image/png', ext: 'png' }
  if (t === 'doc' || t === 'docx')
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ext: t,
    }
  return detectContentType(buf)
}

function xmlTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return m ? m[1] : null
}

/**
 * Retrieve a carrier document from RMIS and decode it. The Document API returns
 * XML: <RMISDocumentAPI> with <DocumentInfo> metadata and a <DocumentData>
 * base64 payload. documentType ∈ Certificate | W9 | Agreement | ClientAgreement
 * | Document; documentID is the RMIS image/document id from the Expanded record.
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

  const xml = await withRmisLock(async () => {
    const res = await fetch(`${DOCUMENT_URL}?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml' },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`RMIS Document API returned ${res.status} ${res.statusText}`)
    }
    return res.text()
  }, { label: 'document' })
  const result = xmlTag(xml, 'Result')?.trim()
  if (result && result.toUpperCase() !== 'SUCCESS') {
    throw new Error(`RMIS Document API: ${xmlTag(xml, 'Error')?.trim() || 'error'}`)
  }

  const base64 = (xmlTag(xml, 'DocumentData') ?? '').replace(/\s+/g, '')
  if (!base64) {
    throw new Error(`RMIS Document API returned no document data: ${xml.slice(0, 200)}`)
  }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length < 100) {
    throw new Error('RMIS document payload was too small to be a valid file')
  }

  const fileType = xmlTag(xml, 'DocumentFileType')?.trim() ?? ''
  const title = xmlTag(xml, 'DocumentTitle')?.trim() ?? ''
  const { contentType, ext } = mapFileType(fileType, buffer)
  const fileName = title || `${params.documentType}-${params.documentID}.${ext}`
  return { buffer, contentType, fileName }
}

async function deltaRequest(body: Record<string, unknown>): Promise<any> {
  return withRmisLock(async () => {
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
  }, { label: 'delta' })
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
