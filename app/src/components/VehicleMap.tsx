'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { TelemetryState } from '@/lib/types'

// CARTO dark-matter basemap — free tier, attribution required. The Map
// constructor's `attributionControl` option defaults to a visible compact
// attribution control (not disabled below); do not set
// `attributionControl: false` — that would drop CARTO's required credit.
const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// Kuwait home coords (sim/run.sh's SITL --home) — used only as the map's
// pre-first-fix fallback center; the map re-centers on the vehicle's actual
// first position report.
const FALLBACK_CENTER: [number, number] = [47.9744, 29.3375]

const TRAIL_MAX_POINTS = 200
const TRAIL_SOURCE_ID = 'vehicle-trail'
const TRAIL_LAYER_ID = 'vehicle-trail-line'

// Simple arrow SVG pointing north (0deg) — rotated per attitude.yawDeg via
// Marker.setRotation(), which is clockwise-from-north to match MAVLink yaw.
const VEHICLE_ARROW_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <polygon points="15,2 24,26 15,20 6,26" fill="#f97316" stroke="#111827" stroke-width="1.5" />
</svg>
`.trim()

interface VehicleMapProps {
  state: TelemetryState | null
}

export default function VehicleMap({ state }: VehicleMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null)
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const trailRef = useRef<Array<[number, number]>>([])
  const styleLoadedRef = useRef(false)
  const centeredRef = useRef(false)
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)

  // Map lifecycle: created once on mount, destroyed on unmount.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: FALLBACK_CENTER,
      zoom: 14,
    })
    mapRef.current = map

    // Any user-initiated pan/drag/zoom breaks auto-follow until "Recenter"
    // is pressed.
    const stopFollowing = () => {
      if (followRef.current) {
        followRef.current = false
        setFollowing(false)
      }
    }
    map.on('dragstart', stopFollowing)
    map.on('wheel', stopFollowing)

    map.on('load', () => {
      styleLoadedRef.current = true
      map.addSource(TRAIL_SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: trailRef.current },
        },
      })
      map.addLayer({
        id: TRAIL_LAYER_ID,
        type: 'line',
        source: TRAIL_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-opacity': 0.85 },
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
      styleLoadedRef.current = false
      vehicleMarkerRef.current = null
      homeMarkerRef.current = null
      trailRef.current = []
      centeredRef.current = false
    }
  }, [])

  const recenter = useCallback(() => {
    followRef.current = true
    setFollowing(true)
    const map = mapRef.current
    const pos = state?.position
    if (map && pos) {
      map.easeTo({ center: [pos.lng, pos.lat] })
    }
  }, [state])

  // Vehicle marker + breadcrumb trail — updates on every position/yaw change.
  useEffect(() => {
    const map = mapRef.current
    const pos = state?.position
    if (!map || !pos) return
    const lngLat: [number, number] = [pos.lng, pos.lat]

    if (!vehicleMarkerRef.current) {
      const el = document.createElement('div')
      // Safe: VEHICLE_ARROW_SVG is a static, hardcoded module-level string
      // constant above — never interpolates telemetry, user input, or any
      // other runtime/external data, so this is not an XSS vector.
      el.innerHTML = VEHICLE_ARROW_SVG
      el.style.width = '30px'
      el.style.height = '30px'
      vehicleMarkerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat(lngLat)
        .addTo(map)
    } else {
      vehicleMarkerRef.current.setLngLat(lngLat)
    }
    vehicleMarkerRef.current.setRotation(state?.attitude?.yawDeg ?? 0)

    const trail = trailRef.current
    trail.push(lngLat)
    if (trail.length > TRAIL_MAX_POINTS) trail.shift()
    if (styleLoadedRef.current) {
      const source = map.getSource(TRAIL_SOURCE_ID) as GeoJSONSource | undefined
      source?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail } })
    }

    if (!centeredRef.current) {
      // Auto-center on first fix, then leave the user free to pan.
      centeredRef.current = true
      map.jumpTo({ center: lngLat, zoom: 17 })
    } else if (followRef.current) {
      map.easeTo({ center: lngLat, duration: 300 })
    }
  }, [state?.position, state?.attitude?.yawDeg])

  // Home marker — set once GCS receives a home position, updated if it changes.
  useEffect(() => {
    const map = mapRef.current
    const home = state?.home
    if (!map || !home) return
    const lngLat: [number, number] = [home.lng, home.lat]
    if (!homeMarkerRef.current) {
      homeMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' }).setLngLat(lngLat).addTo(map)
    } else {
      homeMarkerRef.current.setLngLat(lngLat)
    }
  }, [state?.home])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {!following && (
        <button
          onClick={recenter}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 1,
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#111827',
            color: '#f9fafb',
            fontSize: 13,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          Recenter
        </button>
      )}
    </div>
  )
}
