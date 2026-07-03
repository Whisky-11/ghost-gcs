'use client'

// Renders the mission plan (waypoint line + numbered markers) and the
// in-progress survey polygon (vertices + closing outline) as maplibre
// GeoJSON sources/layers on the host VehicleMap. Purely a rendering effect —
// all data shaping (line coordinates, seq ordering) lives in the pure
// lib/mission.ts helpers, covered by vitest; this component only pushes
// their output into maplibre and is verified via `pnpm --filter app build`
// + manual smoke (maplibre-gl needs a real WebGL context, so it isn't
// unit-testable in node-env vitest, matching VehicleMap.tsx's own
// untested-by-design status).
import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import { missionToLineCoordinates, polygonToLineCoordinates, SURVEY_MIN_POLYGON_POINTS } from '@/lib/mission'
import type { LatLng, Mission } from '@/lib/types'

const MISSION_LINE_SOURCE_ID = 'mission-line'
const MISSION_LINE_LAYER_ID = 'mission-line-layer'
const MISSION_POINTS_SOURCE_ID = 'mission-points'
const MISSION_POINTS_LAYER_ID = 'mission-points-layer'
const MISSION_LABELS_LAYER_ID = 'mission-points-labels'
const POLYGON_SOURCE_ID = 'mission-polygon'
const POLYGON_FILL_LAYER_ID = 'mission-polygon-fill'
const POLYGON_LINE_LAYER_ID = 'mission-polygon-line'
const POLYGON_POINTS_SOURCE_ID = 'mission-polygon-points'
const POLYGON_POINTS_LAYER_ID = 'mission-polygon-points-layer'

interface MissionOverlayProps {
  map: MaplibreMap | null
  /** True once the map's 'load' event has fired — sources/layers can only be
   * added after that (mirrors VehicleMap.tsx's own styleLoadedRef gate). */
  styleLoaded: boolean
  mission: Mission
  polygonPoints: LatLng[]
}

export default function MissionOverlay({ map, styleLoaded, mission, polygonPoints }: MissionOverlayProps) {
  const initializedMapRef = useRef<MaplibreMap | null>(null)

  // Source/layer setup — runs once per map instance, once its style has
  // loaded (mirrors the trail source's own setup in VehicleMap.tsx).
  useEffect(() => {
    if (!map || !styleLoaded || initializedMapRef.current === map) return
    initializedMapRef.current = map

    map.addSource(MISSION_LINE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    })
    map.addLayer({
      id: MISSION_LINE_LAYER_ID,
      type: 'line',
      source: MISSION_LINE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#f9fafb', 'line-width': 2, 'line-dasharray': [2, 1.5] },
    })

    map.addSource(MISSION_POINTS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: MISSION_POINTS_LAYER_ID,
      type: 'circle',
      source: MISSION_POINTS_SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': '#111827',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#f9fafb',
      },
    })
    map.addLayer({
      id: MISSION_LABELS_LAYER_ID,
      type: 'symbol',
      source: MISSION_POINTS_SOURCE_ID,
      layout: { 'text-field': ['get', 'label'], 'text-size': 11 },
      paint: { 'text-color': '#f9fafb' },
    })

    map.addSource(POLYGON_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[]] } },
    })
    map.addLayer({
      id: POLYGON_FILL_LAYER_ID,
      type: 'fill',
      source: POLYGON_SOURCE_ID,
      paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.15 },
    })
    map.addLayer({
      id: POLYGON_LINE_LAYER_ID,
      type: 'line',
      source: POLYGON_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#9ca3af', 'line-width': 2 },
    })

    map.addSource(POLYGON_POINTS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: POLYGON_POINTS_LAYER_ID,
      type: 'circle',
      source: POLYGON_POINTS_SOURCE_ID,
      paint: { 'circle-radius': 5, 'circle-color': '#9ca3af' },
    })

    return () => {
      initializedMapRef.current = null
    }
  }, [map, styleLoaded])

  // Mission line + numbered markers — re-pushed whenever the mission changes.
  useEffect(() => {
    if (!map || !styleLoaded) return
    const lineSource = map.getSource(MISSION_LINE_SOURCE_ID) as GeoJSONSource | undefined
    const pointsSource = map.getSource(MISSION_POINTS_SOURCE_ID) as GeoJSONSource | undefined
    if (!lineSource || !pointsSource) return

    const coords = missionToLineCoordinates(mission)
    lineSource.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })

    const ordered = [...mission.items].sort((a, b) => a.seq - b.seq)
    pointsSource.setData({
      type: 'FeatureCollection',
      features: ordered.map((it) => ({
        type: 'Feature' as const,
        properties: { label: String(it.seq + 1) },
        geometry: { type: 'Point' as const, coordinates: [it.lng, it.lat] },
      })),
    })
  }, [map, styleLoaded, mission])

  // In-progress survey polygon — vertices + a closed outline once there are
  // enough points to form one; an open polyline of vertices before that.
  useEffect(() => {
    if (!map || !styleLoaded) return
    const polySource = map.getSource(POLYGON_SOURCE_ID) as GeoJSONSource | undefined
    const ptsSource = map.getSource(POLYGON_POINTS_SOURCE_ID) as GeoJSONSource | undefined
    if (!polySource || !ptsSource) return

    const closed = polygonPoints.length >= SURVEY_MIN_POLYGON_POINTS
    const ring = closed ? polygonToLineCoordinates(polygonPoints, true) : []
    polySource.setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })

    ptsSource.setData({
      type: 'FeatureCollection',
      features: polygonPoints.map((pt) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: [pt.lng, pt.lat] },
      })),
    })
  }, [map, styleLoaded, polygonPoints])

  return null
}
