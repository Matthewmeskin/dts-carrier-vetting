'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardHeader, CardBody } from './ui/Card'

// Client-side Maps key. When set, the panel renders an inline satellite map +
// interactive Street View of the FMCSA-registered address (a quick way to spot
// a fake / residential / mailbox-store address — a chameleon-carrier signal).
// Without it, the panel falls back to "open in Google Maps" links (no key
// needed), so it upgrades automatically once the key is added.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

function buildAddress(
  street?: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null
): string {
  const line2 = [city, state, zip].filter((p) => p && String(p).trim()).join(' ')
  return [street, line2].filter((p) => p && String(p).trim()).join(', ')
}

// Load the Google Maps JS API once, shared across every AddressCheck instance.
let mapsPromise: Promise<any> | null = null
function loadMaps(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if ((window as any).google?.maps) return Promise.resolve((window as any).google)
  if (mapsPromise) return mapsPromise
  mapsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&v=weekly&libraries=places`
    s.async = true
    s.onload = () => resolve((window as any).google)
    s.onerror = () => reject(new Error('maps js failed'))
    document.head.appendChild(s)
  })
  return mapsPromise
}

// Interactive, draggable Street View (Maps JS). Geocodes the address, finds the
// nearest panorama, and renders it. Falls back to the static image on any
// failure (e.g. Maps JS / Geocoding API not enabled, or no imagery nearby).
function InteractiveStreetView({
  address,
  staticSrc,
  mapsLink,
}: {
  address: string
  staticSrc: string
  mapsLink: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMaps()
      .then((google) => {
        if (cancelled || !ref.current) return
        new google.maps.Geocoder().geocode(
          { address },
          (results: any, status: string) => {
            if (cancelled) return
            if (status !== 'OK' || !results?.[0]) return setFailed(true)
            const loc = results[0].geometry.location
            new google.maps.StreetViewService().getPanorama(
              { location: loc, radius: 150 },
              (data: any, st: string) => {
                if (cancelled) return
                if (st !== 'OK' || !data?.location?.pano) return setFailed(true)
                new google.maps.StreetViewPanorama(ref.current!, {
                  pano: data.location.pano,
                  pov: { heading: 0, pitch: 0 },
                  zoom: 0,
                  addressControl: false,
                  motionTracking: false,
                  motionTrackingControl: false,
                  fullscreenControl: true,
                })
              }
            )
          }
        )
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
    }
  }, [address])

  if (failed) {
    return (
      <a href={mapsLink} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={staticSrc}
          alt="Street View of the FMCSA address"
          className="h-64 w-full rounded-md border border-gray-200 object-cover"
          loading="lazy"
        />
      </a>
    )
  }
  return <div ref={ref} className="h-64 w-full overflow-hidden rounded-md border border-gray-200" />
}

// Rough great-circle distance in meters between two lat/lng points, so we can
// tell whether the nearest business actually sits AT the address (vs. a
// prominent business down the block).
function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

type LocTone = 'green' | 'amber' | 'red' | 'gray'

// Map a place's Google types + name to a friendly location-type estimate, with
// a vetting-oriented tone: a legitimate motor carrier should operate from a
// commercial/industrial site, not a home or a mailbox store.
function classifyPlace(
  types: string[],
  name: string
): { label: string; tone: LocTone; note?: string } {
  const t = new Set(types)
  const n = (name || '').toLowerCase()
  const mailish =
    t.has('post_office') ||
    /(ups store|the ups store|mail\s?box|mailboxes|postal|pak\s?mail|postnet|parcel|pack\s?ship|ipostal)/.test(n)
  if (mailish)
    return {
      label: 'Mail / parcel store',
      tone: 'red',
      note: 'Looks like a mailbox or parcel store — a common virtual-address / chameleon-carrier signal. Verify a real physical yard or office.',
    }
  const industrial = ['moving_company', 'storage', 'general_contractor'].some((x) => t.has(x))
  if (industrial) return { label: 'Trucking / industrial business', tone: 'green' }
  const commercial =
    t.has('establishment') || t.has('point_of_interest') || t.has('store') || t.has('car_repair')
  if (commercial) return { label: 'Commercial / business', tone: 'green' }
  return { label: 'Non-business (likely residential)', tone: 'amber' }
}

const LOC_DOT: Record<LocTone, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-gray-300',
}

// "Estimated location type" line. Geocodes the address, looks for a business at
// that exact point via the Places library, and classifies the result. Degrades
// silently (shows a hint) when Maps JS / Places isn't available.
function LocationTypeEstimate({ address }: { address: string }) {
  const [result, setResult] = useState<{
    label: string
    tone: LocTone
    note?: string
    name?: string
    types?: string[]
  } | null>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'unavailable'>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setResult(null)
    loadMaps()
      .then((google) => {
        if (cancelled) return
        if (!google?.maps?.places) {
          setStatus('unavailable')
          return
        }
        new google.maps.Geocoder().geocode({ address }, (res: any, st: string) => {
          if (cancelled) return
          if (st !== 'OK' || !res?.[0]) {
            setStatus('unavailable')
            return
          }
          const loc = res[0].geometry.location
          const svc = new google.maps.places.PlacesService(document.createElement('div'))
          // Scan for businesses AROUND the address (not just at the exact pin) —
          // multi-tenant industrial parks geocode to a point between units, so
          // requiring a business at the pin falsely reads as "residential". We
          // classify from nearby business density instead.
          svc.nearbySearch(
            { location: loc, radius: 150 },
            (places: any, pst: string) => {
              if (cancelled) return
              const list = pst === 'OK' && Array.isArray(places) ? places : []
              const ests = list
                .filter((p: any) => {
                  const t: string[] = p.types || []
                  return (
                    (t.includes('establishment') || t.includes('point_of_interest')) &&
                    !t.includes('locality') &&
                    !t.includes('route') &&
                    !t.includes('postal_code') &&
                    !t.includes('political')
                  )
                })
                .map((p: any) => ({
                  name: p.name || '',
                  types: (p.types || []) as string[],
                  dist: p.geometry?.location
                    ? metersBetween(
                        loc.lat(),
                        loc.lng(),
                        p.geometry.location.lat(),
                        p.geometry.location.lng()
                      )
                    : 99999,
                }))
                .sort((a: any, b: any) => a.dist - b.dist)

              const nearest = ests[0]
              const within150 = ests.filter((e: any) => e.dist <= 150)

              let out: {
                label: string
                tone: LocTone
                note?: string
                name?: string
                types?: string[]
              }
              if (nearest && nearest.dist <= 60) {
                // A business sits right at the address — classify by it.
                out = {
                  ...classifyPlace(nearest.types, nearest.name),
                  name: nearest.name,
                  types: nearest.types,
                }
              } else if (within150.length >= 2) {
                const names = within150
                  .map((e: any) => e.name)
                  .filter(Boolean)
                  .slice(0, 2)
                out = {
                  label: 'Commercial / industrial area',
                  tone: 'green',
                  note: `${within150.length} businesses at or around this address${names.length ? ` (e.g. ${names.join(', ')})` : ''}.`,
                  name: nearest?.name,
                  types: nearest?.types,
                }
              } else if (within150.length === 1) {
                out = {
                  ...classifyPlace(within150[0].types, within150[0].name),
                  name: within150[0].name,
                  types: within150[0].types,
                }
              } else {
                out = {
                  label: 'No businesses found nearby — possibly residential',
                  tone: 'amber',
                  note: 'Google shows no businesses at or near this address — often a residence or vacant lot. A real carrier usually operates from a commercial or industrial site; confirm with the satellite & Street View below.',
                }
              }
              setResult(out)
              setStatus('done')
            }
          )
        })
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [address])

  if (status === 'unavailable') {
    return (
      <p className="mt-2 text-xs text-gray-400">
        Estimated location type unavailable — enable the Google{' '}
        <span className="font-mono">Places API</span> to show it.
      </p>
    )
  }

  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-gray-500">Estimated location type:</span>
        {status === 'loading' ? (
          <span className="text-xs text-gray-400">estimating…</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
            <span className={`h-2 w-2 rounded-full ${LOC_DOT[result!.tone]}`} />
            {result!.label}
          </span>
        )}
        {result?.name && (
          <span className="text-xs text-gray-500">· {result.name}</span>
        )}
      </div>
      {result?.note && <p className="mt-1 text-xs text-gray-500">{result.note}</p>}
      <p className="mt-1 text-[11px] text-gray-400">
        Best-guess from Google Places — confirm with the satellite &amp; Street View below.
      </p>
    </div>
  )
}

export function AddressCheck({
  street,
  city,
  state,
  zip,
  source,
}: {
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  source?: string
}) {
  const address = buildAddress(street, city, state, zip)

  if (!address) {
    return (
      <Card>
        <CardHeader title="Address check" subtitle={source || 'FMCSA-registered physical address'} />
        <CardBody>
          <p className="text-sm text-gray-500">
            No FMCSA/RMIS physical address on file for this carrier. Use “Refresh
            from RMIS” on the Insurance panel to pull it.
          </p>
        </CardBody>
      </Card>
    )
  }

  const enc = encodeURIComponent(address)
  const mapsLink = `https://www.google.com/maps/search/?api=1&query=${enc}`
  const satEmbed = KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${KEY}&q=${enc}&maptype=satellite&zoom=18`
    : null
  const streetImg = KEY
    ? `https://maps.googleapis.com/maps/api/streetview?size=640x320&location=${enc}&fov=80&pitch=0&source=outdoor&key=${KEY}`
    : null

  return (
    <Card>
      <CardHeader
        title="Address check"
        subtitle={source || 'FMCSA-registered physical address'}
        action={
          <a
            href={mapsLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Google Maps ↗
          </a>
        }
      />
      <CardBody>
        <div className="mb-3">
          <div className="flex items-start gap-2">
            <span aria-hidden className="mt-0.5 text-gray-400">
              📍
            </span>
            <span className="text-sm font-medium text-gray-900">{address}</span>
          </div>
          {KEY && <LocationTypeEstimate address={address} />}
        </div>

        {KEY ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">Satellite</div>
              <iframe
                title="Address satellite view"
                src={satEmbed!}
                className="h-64 w-full rounded-md border border-gray-200"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-gray-500">Street View — drag to look around</div>
              <InteractiveStreetView address={address} staticSrc={streetImg!} mapsLink={mapsLink} />
              <p className="mt-1 text-xs text-gray-400">
                No imagery? Street View may not cover this exact spot — click to open Maps.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-600">
              Add a{' '}
              <span className="font-mono text-xs">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</span>{' '}
              to show the satellite map and Street View here inline. Until then:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={mapsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-dts-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00547f]"
              >
                Open in Google Maps ↗
              </a>
              <a
                href={mapsLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white"
              >
                Open Street View ↗
              </a>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
