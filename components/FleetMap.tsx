'use client'

import { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import { formatDateTime } from '@/lib/utils'

export interface MapVehicle {
  latitude: number
  longitude: number
  name: string
  vin: string | null
  speed: { value: number | null; unit: string | null } | null
  dateTime: string | null
  address: string | null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Renders the fleet's ELD positions on an interactive OpenStreetMap via Leaflet.
// Leaflet is imported dynamically inside the effect so it never runs on the
// server (it touches `window` at load time).
export function FleetMap({ vehicles }: { vehicles: MapVehicle[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false
    let ResizeObs: ResizeObserver | null = null

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          scrollWheelZoom: false,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(mapRef.current)
        // The container often mounts at 0px (inside a just-rendered panel);
        // recalculate once its real size is known.
        ResizeObs = new ResizeObserver(() => mapRef.current?.invalidateSize())
        ResizeObs.observe(containerRef.current)
      }

      const map = mapRef.current
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
      }
      const group = L.featureGroup()

      for (const v of vehicles) {
        const moving = (v.speed?.value ?? 0) > 0
        const marker = L.circleMarker([v.latitude, v.longitude], {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: moving ? '#16a34a' : '#6b7280',
          fillOpacity: 0.9,
        })
        const speedTxt =
          v.speed?.value != null
            ? `${Math.round(v.speed.value)} ${v.speed.unit || 'mph'}`
            : '—'
        const when = v.dateTime ? formatDateTime(v.dateTime) : 'unknown'
        const maps = `https://www.google.com/maps?q=${v.latitude},${v.longitude}`
        marker.bindPopup(
          `<div style="font:13px/1.4 system-ui,sans-serif;min-width:160px">
             <div style="font-weight:600;margin-bottom:2px">${escapeHtml(v.name)}</div>
             ${v.vin ? `<div style="font-family:monospace;font-size:11px;color:#6b7280">${escapeHtml(v.vin)}</div>` : ''}
             <div style="margin-top:4px">Speed: <b>${escapeHtml(speedTxt)}</b></div>
             <div style="color:#6b7280">${escapeHtml(when)}</div>
             ${v.address ? `<div style="color:#6b7280">${escapeHtml(v.address)}</div>` : ''}
             <a href="${maps}" target="_blank" rel="noopener noreferrer" style="color:#005b8f">Open in Google Maps ↗</a>
           </div>`
        )
        marker.bindTooltip(v.name, { direction: 'top' })
        group.addLayer(marker)
      }

      group.addTo(map)
      layerRef.current = group

      const bounds = group.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 })
      } else {
        map.setView([39.5, -98.35], 4) // continental US fallback
      }
    })()

    return () => {
      cancelled = true
      if (ResizeObs) ResizeObs.disconnect()
    }
  }, [vehicles])

  // Tear the map down only when the component unmounts.
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-lg border border-gray-200"
      style={{ zIndex: 0 }}
    />
  )
}
