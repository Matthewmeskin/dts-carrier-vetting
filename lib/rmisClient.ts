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
    InsdID: items.map((i) => i.insdID),
  })
}

export { requireCredentials }
