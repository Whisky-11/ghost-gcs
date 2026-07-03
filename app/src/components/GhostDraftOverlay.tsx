'use client'

// Renders GHOST's mission-DRAFT preview (Task 10) — a dashed, hollow-marker
// overlay on the same maplibre map MissionOverlay.tsx uses for the
// COMMITTED mission. Deliberately styled distinct from MissionOverlay
// (grey vs white, longer dash gaps, hollow "D<n>" markers vs filled "<n>"
// markers) so a draft can never be visually mistaken for an uploaded
// mission — it is a PREVIEW only, until the human clicks "Load into editor"
// in GhostPanel.tsx (a local mutation) and then reviews + uploads it via
// Task 9's MissionControls (spec safety invariant 1: AI never uploads).
//
// Same "untested-by-design" status as MissionOverlay.tsx: maplibre needs a
// real WebGL context, so this is verified via `pnpm --filter app build` +
// manual smoke, not node-env vitest. All data shaping reuses lib/mission.ts's
// pure missionToLineCoordinates, which IS covered by vitest.
import { useEffect, useRef } from 'react'
import type { GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl'
import { missionToLineCoordinates } from '@/lib/mission'
import type { MissionItem } from '@/lib/types'

const DRAFT_LINE_SOURCE_ID = 'ghost-draft-line'
const DRAFT_LINE_LAYER_ID = 'ghost-draft-line-layer'
const DRAFT_POINTS_SOURCE_ID = 'ghost-draft-points'
const DRAFT_POINTS_LAYER_ID = 'ghost-draft-points-layer'
const DRAFT_LABELS_LAYER_ID = 'ghost-draft-points-labels'

interface GhostDraftOverlayProps {
  map: MaplibreMap | null
  /** True once the map's 'load' event has fired — mirrors MissionOverlay's
   * own gate; sources/layers can only be added after that. */
  styleLoaded: boolean
  /** The current AI-drafted mission's items (empty when there is no active
   * draft) — GhostPanel.tsx is the only producer of this array, via
   * aiDraftMission's response; this component never fetches or mutates it. */
  items: MissionItem[]
}

export default function GhostDraftOverlay({ map, styleLoaded, items }: GhostDraftOverlayProps) {
  const initializedMapRef = useRef<MaplibreMap | null>(null)

  // Source/layer setup — runs once per map instance, once its style has
  // loaded.
  useEffect(() => {
    if (!map || !styleLoaded || initializedMapRef.current === map) return
    initializedMapRef.current = map

    map.addSource(DRAFT_LINE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    })
    map.addLayer({
      id: DRAFT_LINE_LAYER_ID,
      type: 'line',
      source: DRAFT_LINE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#9ca3af', 'line-width': 2, 'line-dasharray': [1, 2], 'line-opacity': 0.9 },
    })

    map.addSource(DRAFT_POINTS_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: DRAFT_POINTS_LAYER_ID,
      type: 'circle',
      source: DRAFT_POINTS_SOURCE_ID,
      paint: {
        // Hollow (transparent fill, stroked outline only) — the committed
        // mission's points (MissionOverlay) are solid-filled dark circles
        // with a light stroke; a hollow marker reads unmistakably as "not
        // committed yet".
        'circle-radius': 7,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#9ca3af',
      },
    })
    map.addLayer({
      id: DRAFT_LABELS_LAYER_ID,
      type: 'symbol',
      source: DRAFT_POINTS_SOURCE_ID,
      layout: { 'text-field': ['get', 'label'], 'text-size': 10 },
      paint: { 'text-color': '#9ca3af' },
    })

    return () => {
      initializedMapRef.current = null
    }
  }, [map, styleLoaded])

  // Re-pushed whenever the draft items change (a new draft, a cleared draft,
  // or a draft superseded by loading it into the editor — GhostPanel clears
  // its own preview once loaded).
  useEffect(() => {
    if (!map || !styleLoaded) return
    const lineSource = map.getSource(DRAFT_LINE_SOURCE_ID) as GeoJSONSource | undefined
    const pointsSource = map.getSource(DRAFT_POINTS_SOURCE_ID) as GeoJSONSource | undefined
    if (!lineSource || !pointsSource) return

    const coords = missionToLineCoordinates({ items })
    lineSource.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })

    const ordered = [...items].sort((a, b) => a.seq - b.seq)
    pointsSource.setData({
      type: 'FeatureCollection',
      features: ordered.map((it) => ({
        type: 'Feature' as const,
        properties: { label: `D${it.seq + 1}` },
        geometry: { type: 'Point' as const, coordinates: [it.lng, it.lat] },
      })),
    })
  }, [map, styleLoaded, items])

  return null
}
