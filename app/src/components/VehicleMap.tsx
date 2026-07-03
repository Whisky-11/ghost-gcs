'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LatLng, Mission, MissionItem, RpcMethod, RpcParams, TelemetryState } from '@/lib/types'
import { TAKEOFF_ALT_DEFAULT } from '@/lib/controls'
import { initialMissionEditorState, missionEditorReducer } from '@/lib/mission'
import MissionOverlay from './MissionOverlay'
import GhostDraftOverlay from './GhostDraftOverlay'
import { MissionEditor } from './MissionEditor'

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
  /** Task 8: needed to call the bridge's pure surveyGrid RPC when the user
   * closes a survey polygon. Structurally the same shape useTelemetry()
   * returns, so callers pass its `rpc` straight through. */
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
  /** Task 8 forward-compat hook (consumed by Task 9's mission upload
   * controls): fired with the current editor mission every time it changes.
   * Optional so VehicleMap stays fully self-contained/functional without a
   * consumer wired up yet. */
  onMissionChange?: (mission: Mission) => void
  /** Task 10: fired with the current in-progress survey polygon every time
   * it changes — GhostPanel.tsx (hosted in page.tsx, outside this
   * component) needs it to build the geometry sent with "draft from
   * drawing". Same "lifted escape hatch" pattern as onMissionChange. */
  onPolygonPointsChange?: (points: LatLng[]) => void
  /** Task 10: GHOST's current mission-draft preview (empty when there is no
   * active draft) — rendered as a dashed, visually-distinct overlay via
   * GhostDraftOverlay, separate from the committed mission MissionOverlay
   * renders. Owned by GhostPanel.tsx's ghost.ts state, lifted through
   * page.tsx; this component only displays it. */
  draftPreviewItems?: MissionItem[]
  /** Task 10: GHOST's "Load into editor" writes here — an incrementing
   * `requestId` so the same items can be (re-)loaded even if their array
   * reference is unchanged. VehicleMap dispatches `setMissionItems` locally
   * on a new requestId; this is a PURE EDITOR MUTATION, never an rpc call —
   * GHOST has no other path into the working mission (spec safety
   * invariant 1: AI never uploads — see GhostPanel.tsx's module header). */
  loadMissionRequest?: { items: MissionItem[]; requestId: string } | null
}

export default function VehicleMap({
  state,
  rpc,
  onMissionChange,
  onPolygonPointsChange,
  draftPreviewItems,
  loadMissionRequest,
}: VehicleMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null)
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const trailRef = useRef<Array<[number, number]>>([])
  const styleLoadedRef = useRef(false)
  const centeredRef = useRef(false)
  const followRef = useRef(true)
  const [following, setFollowing] = useState(true)

  // Mirrors of the map instance + its style-loaded flag as REACT STATE (the
  // refs above stay for the imperative handlers that were already using
  // them pre-Task-8) so MissionOverlay — a child component — re-renders once
  // there's a real map to attach sources/layers to.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null)
  const [styleLoaded, setStyleLoaded] = useState(false)

  // Mission editor state (Task 8) — click-to-add waypoints / draw-a-polygon.
  // Owned here (not lifted to page.tsx) so VehicleMap is a fully
  // self-contained "host the overlay + click/draw modes" component per the
  // brief; onMissionChange is the escape hatch for a future consumer (Task
  // 9's upload controls) to observe the built mission.
  const [editor, dispatch] = useReducer(missionEditorReducer, initialMissionEditorState)
  const [defaultAltM, setDefaultAltM] = useState(TAKEOFF_ALT_DEFAULT)
  // Click handlers are registered once (map mount effect) — a ref keeps
  // them reading the latest mode-default altitude without re-registering.
  const defaultAltMRef = useRef(defaultAltM)
  useEffect(() => {
    defaultAltMRef.current = defaultAltM
  }, [defaultAltM])

  useEffect(() => {
    onMissionChange?.(editor.mission)
  }, [editor.mission, onMissionChange])

  useEffect(() => {
    onPolygonPointsChange?.(editor.polygonPoints)
  }, [editor.polygonPoints, onPolygonPointsChange])

  // GHOST's "Load into editor" (Task 10) — a local mutation only, keyed by
  // requestId so the same draft can be loaded again even if its items array
  // reference is unchanged (e.g. the operator re-loads after tweaking
  // nothing). Never triggers an rpc call; this is the exact same
  // 'setMissionItems' action the survey-grid generator dispatches.
  const lastLoadedRequestIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!loadMissionRequest || loadMissionRequest.requestId === lastLoadedRequestIdRef.current) return
    lastLoadedRequestIdRef.current = loadMissionRequest.requestId
    dispatch({ type: 'setMissionItems', items: loadMissionRequest.items })
  }, [loadMissionRequest])

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
    setMapInstance(map)

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

    // Task 8: a single click handler drives BOTH editor modes —
    // missionEditorReducer's 'mapClick' action is mode-aware (waypoint mode
    // appends a mission waypoint, polygon mode appends a polygon vertex).
    map.on('click', (e) => {
      dispatch({
        type: 'mapClick',
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        altM: defaultAltMRef.current,
      })
    })

    map.on('load', () => {
      styleLoadedRef.current = true
      setStyleLoaded(true)
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
      setMapInstance(null)
      styleLoadedRef.current = false
      setStyleLoaded(false)
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

  // Task 8: closing a survey polygon calls the bridge's pure surveyGrid RPC
  // (Task 2's lawnmower generator, run server-side — the app never generates
  // the grid itself) and loads the returned waypoints as the mission.
  const generateSurvey = useCallback(
    async (polygon: LatLng[], altM: number, spacingM: number): Promise<void> => {
      const items = await rpc<MissionItem[]>('surveyGrid', { polygon, altM, spacingM })
      dispatch({ type: 'setMissionItems', items })
    },
    [rpc],
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <MissionOverlay map={mapInstance} styleLoaded={styleLoaded} mission={editor.mission} polygonPoints={editor.polygonPoints} />
      <GhostDraftOverlay map={mapInstance} styleLoaded={styleLoaded} items={draftPreviewItems ?? []} />
      <MissionEditor
        mode={editor.mode}
        mission={editor.mission}
        polygonPoints={editor.polygonPoints}
        defaultAltM={defaultAltM}
        onDefaultAltMChange={setDefaultAltM}
        onModeChange={(mode) => dispatch({ type: 'setMode', mode })}
        onRemoveWaypoint={(seq) => dispatch({ type: 'removeWaypoint', seq })}
        onReorderWaypoint={(fromSeq, toSeq) => dispatch({ type: 'reorderWaypoint', fromSeq, toSeq })}
        onClearPolygon={() => dispatch({ type: 'clearPolygon' })}
        onClearMission={() => dispatch({ type: 'clearMission' })}
        onGenerateSurvey={generateSurvey}
      />
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
