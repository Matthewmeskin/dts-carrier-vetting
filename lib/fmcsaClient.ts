// FMCSA data via the DTS proxy (wraps the FMCSA QCMobile API). Used as a
// fallback for carriers that aren't in our RMIS monitored list, to pull the
// authority / operating-status / safety data RMIS can't give us for them.
//
//   {BASE}?dotNumber=<DOT>&token=<TOKEN>                      → carrier profile
//   {BASE}?dotNumber=<DOT>&endpoint=authority&token=<TOKEN>   → operating authority

const BASE = process.env.FMCSA_PROXY_URL || 'https://fmcsa-proxy.onrender.com/fmcsa'
const TOKEN = process.env.FMCSA_PROXY_TOKEN

export function fmcsaConfigured(): boolean {
  return !!TOKEN
}

async function call(dot: string, endpoint?: string): Promise<any> {
  if (!TOKEN) throw new Error('FMCSA proxy not configured (FMCSA_PROXY_TOKEN)')
  const url = new URL(BASE)
  url.searchParams.set('dotNumber', dot)
  if (endpoint) url.searchParams.set('endpoint', endpoint)
  url.searchParams.set('token', TOKEN)
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`FMCSA proxy ${endpoint || 'profile'} returned ${res.status}`)
  }
  return res.json()
}

export interface FmcsaData {
  legalName: string | null
  dbaName: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  powerUnits: number | null
  drivers: number | null
  allowedToOperate: string | null // 'Y' / 'N'
  safetyRating: string | null
  // Normalized to 'A' when active, else the raw status ('I','N',…) or null.
  commonAuthority: string | null
  contractAuthority: string | null
  brokerAuthority: string | null
  raw: any
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function normAuth(v: any): string | null {
  const s = String(v ?? '').trim().toUpperCase()
  if (!s) return null
  if (s === 'A' || s === 'ACTIVE' || s === 'Y' || s === 'YES') return 'A'
  return s
}

/**
 * Pull the carrier profile + operating authority from FMCSA. Both sub-calls are
 * best-effort: if one fails the other's data is still returned.
 */
export async function fetchFmcsaCarrier(dot: string): Promise<FmcsaData> {
  const [profile, authority] = await Promise.all([
    call(dot).catch(() => null),
    call(dot, 'authority').catch(() => null),
  ])

  const c = profile?.content?.carrier ?? profile?.carrier ?? null

  let auth: any = null
  const ac = authority?.content ?? authority
  if (Array.isArray(ac) && ac.length > 0) auth = ac[0].carrierAuthority || ac[0]
  else if (ac && typeof ac === 'object') auth = ac.carrierAuthority || ac

  return {
    legalName: c?.legalName ?? null,
    dbaName: c?.dbaName ?? null,
    street: c?.phyStreet ?? null,
    city: c?.phyCity ?? null,
    state: c?.phyState ?? null,
    zip: c?.phyZipcode ?? null,
    phone: c?.telephone ?? c?.phone ?? null,
    powerUnits: num(c?.totalPowerUnits),
    drivers: num(c?.totalDrivers),
    allowedToOperate: c?.allowedToOperate ?? null,
    safetyRating: c?.safetyRating ?? null,
    commonAuthority: normAuth(auth?.commonAuthorityStatus),
    contractAuthority: normAuth(auth?.contractAuthorityStatus),
    brokerAuthority: normAuth(auth?.brokerAuthorityStatus),
    raw: { profile, authority },
  }
}
