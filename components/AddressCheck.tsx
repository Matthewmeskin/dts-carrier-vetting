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
  // The static image 403s when the key isn't enabled for the Street View Static
  // API — a broken <img> would just show its alt text, so surface a real message.
  const [imgBroken, setImgBroken] = useState(false)

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

  if (failed && imgBroken) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 text-center">
        <p className="text-sm font-medium text-gray-700">Street View isn’t available inline yet</p>
        <p className="max-w-sm text-xs text-gray-500">
          The satellite map is working, but Street View needs the{' '}
          <span className="font-medium">Maps JavaScript</span>,{' '}
          <span className="font-medium">Geocoding</span> and{' '}
          <span className="font-medium">Street View Static</span> APIs enabled for this Maps
          key in Google Cloud. Until then, open it in Maps:
        </p>
        <a
          href={mapsLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 rounded-md bg-dts-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-[#00547f]"
        >
          Open Street View ↗
        </a>
      </div>
    )
  }
  if (failed) {
    return (
      <a href={mapsLink} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={staticSrc}
          alt="Street View of the FMCSA address"
          className="h-64 w-full rounded-md border border-gray-200 object-cover"
          loading="lazy"
          onError={() => setImgBroken(true)}
        />
      </a>
    )
  }
  return <div ref={ref} className="h-64 w-full overflow-hidden rounded-md border border-gray-200" />
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
  // Maps show by default (they're the reliable signal for judging the site); the
  // toggle lets you hide them to shorten the page.
  const [showMaps, setShowMaps] = useState(true)

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
          {KEY && (
            <button
              type="button"
              onClick={() => setShowMaps((v) => !v)}
              className="mt-2 text-xs font-medium text-dts-blue hover:underline"
            >
              {showMaps ? 'Hide satellite & Street View' : 'Show satellite & Street View'}
            </button>
          )}
        </div>

        {KEY && showMaps && (
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
        )}

        {!KEY && (
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
