'use client'

import { Card, CardHeader, CardBody } from './ui/Card'

// Client-side Maps key. When set, the panel renders an inline satellite map +
// Street View of the FMCSA-registered address (a quick way to spot a fake /
// residential / mailbox-store address — a chameleon-carrier signal). When it's
// absent, the panel falls back to "open in Google Maps" links (no key needed),
// so this upgrades automatically once NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is added.
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
  /** Where the address came from, for the subtitle. */
  source?: string
}) {
  const address = buildAddress(street, city, state, zip)
  if (!address) return null

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
        <div className="mb-3 flex items-start gap-2">
          <span aria-hidden className="mt-0.5 text-gray-400">
            📍
          </span>
          <span className="text-sm font-medium text-gray-900">{address}</span>
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
              <div className="mb-1 text-xs font-medium text-gray-500">Street View</div>
              <a href={mapsLink} target="_blank" rel="noopener noreferrer" title="Open in Google Maps">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={streetImg!}
                  alt="Street View of the FMCSA address"
                  className="h-64 w-full rounded-md border border-gray-200 object-cover"
                  loading="lazy"
                />
              </a>
              <p className="mt-1 text-xs text-gray-400">
                No image? Street View may not cover this exact spot — click to open Maps.
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
