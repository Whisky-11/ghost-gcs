// Client mission model + pure editor helpers (Task 8). Builds on the
// wire-mirrored Mission/MissionItem/LatLng types in ./types (Task 7's wire
// mirror, hand-kept in sync with bridge/src/missions/model.ts +
// bridge/src/missions/survey.ts) — this module owns EDITOR-side logic only:
// no React, no WebSocket/RPC calls, no maplibre. Fully covered by node-env
// vitest (see __tests__/mission.test.ts) so the click/draw wiring in
// VehicleMap.tsx + MissionEditor.tsx can stay thin (delegate here, then
// verify via build + manual smoke — maplibre needs a real WebGL context).
import { MISSION_ALT_MAX, MISSION_ALT_MIN, type LatLng, type Mission, type MissionItem, type MissionItemCommand } from './types'

export function createEmptyMission(): Mission {
  return { items: [] }
}

// ---------------------------------------------------------------------------
// Pure editor mutators — task-8 brief's BINDING interface names
// (addWaypoint/removeWaypoint/reorderWaypoint). Every mutator returns a new
// Mission with items reseq'd to stay contiguous 0..n-1 (validateMission's
// bridge-side seq-contiguity rule), never mutates its input.
// ---------------------------------------------------------------------------

/** Appends an item at the end of the mission (seq = items.length). Defaults
 * to 'WAYPOINT' — the only command the click-to-add map flow produces;
 * TAKEOFF/RTL/LAND items are a manual edit outside this task's scope. */
export function addWaypoint(
  mission: Mission,
  latlng: LatLng,
  altM: number,
  command: MissionItemCommand = 'WAYPOINT',
): Mission {
  const item: MissionItem = { seq: mission.items.length, command, lat: latlng.lat, lng: latlng.lng, altM }
  return { items: [...mission.items, item] }
}

/** Removes the item with the given seq, then reseqs the remaining items to
 * stay contiguous (order preserved). No-op (returns an equivalent,
 * already-contiguous mission) if seq isn't found. */
export function removeWaypoint(mission: Mission, seq: number): Mission {
  const filtered = mission.items.filter((it) => it.seq !== seq)
  return { items: reseq(filtered) }
}

/** Moves the item currently at `fromSeq` to array position `toSeq`
 * (0-based, clamped into range), reseqing every item afterward so seqs stay
 * contiguous. No-op (still reseqs) if fromSeq isn't found. */
export function reorderWaypoint(mission: Mission, fromSeq: number, toSeq: number): Mission {
  const ordered = [...mission.items].sort((a, b) => a.seq - b.seq)
  const fromIndex = ordered.findIndex((it) => it.seq === fromSeq)
  if (fromIndex === -1) return { items: reseq(ordered) }
  const [moved] = ordered.splice(fromIndex, 1)
  const clampedTo = Math.max(0, Math.min(ordered.length, toSeq))
  ordered.splice(clampedTo, 0, moved!)
  return { items: reseq(ordered) }
}

function reseq(items: MissionItem[]): MissionItem[] {
  return items.map((it, i) => ({ ...it, seq: i }))
}

// ---------------------------------------------------------------------------
// Survey-grid request pre-validation. The bridge's surveyGrid RPC
// re-validates (wire superRefine + generateSurveyGrid's own guards) —
// this is a client-side gate only, so a hopeless request (open polygon,
// zero spacing, out-of-range altitude) never leaves the browser and the
// editor can show an inline error instead of a round trip + toast.
// ---------------------------------------------------------------------------

export const SURVEY_MIN_POLYGON_POINTS = 3

export interface SurveyGridRequest {
  polygon: LatLng[]
  altM: number
  spacingM: number
}

export type SurveyGridRequestResult = { ok: true; request: SurveyGridRequest } | { ok: false; error: string }

export function polygonToSurveyRequest(polygon: LatLng[], altM: number, spacingM: number): SurveyGridRequestResult {
  if (polygon.length < SURVEY_MIN_POLYGON_POINTS) {
    return { ok: false, error: `polygon needs at least ${SURVEY_MIN_POLYGON_POINTS} points (has ${polygon.length})` }
  }
  if (!Number.isFinite(spacingM) || spacingM <= 0) {
    return { ok: false, error: 'spacing must be a number greater than 0' }
  }
  if (!Number.isFinite(altM) || altM < MISSION_ALT_MIN || altM > MISSION_ALT_MAX) {
    return { ok: false, error: `altitude must be between ${MISSION_ALT_MIN} and ${MISSION_ALT_MAX}m` }
  }
  return { ok: true, request: { polygon, altM, spacingM } }
}

// ---------------------------------------------------------------------------
// Overlay geometry helpers — pure coordinate shaping consumed by
// MissionOverlay.tsx's maplibre GeoJSON sources. [lng,lat] pair order
// matches GeoJSON's (and maplibre's) coordinate convention, the reverse of
// the lat/lng field order MissionItem/LatLng use.
// ---------------------------------------------------------------------------

export function missionToLineCoordinates(mission: Mission): [number, number][] {
  return [...mission.items].sort((a, b) => a.seq - b.seq).map((it) => [it.lng, it.lat])
}

/** `closed: true` appends the first point again so the returned coordinates
 * trace a closed ring (maplibre Polygon geometry / a closed preview
 * outline); `closed: false` leaves it as an open polyline (in-progress
 * draw). Empty input returns an empty array either way. */
export function polygonToLineCoordinates(polygon: LatLng[], closed: boolean): [number, number][] {
  const coords: [number, number][] = polygon.map((pt) => [pt.lng, pt.lat])
  if (closed && polygon.length > 0) coords.push(coords[0]!)
  return coords
}

// ---------------------------------------------------------------------------
// Editor state + reducer — the pure core behind VehicleMap.tsx's map-click
// handling and MissionEditor.tsx's panel actions. `mapClick` is mode-aware:
// 'waypoint' mode appends a mission waypoint at the clicked point,
// 'polygon' mode appends a polygon vertex — the map registers one click
// handler and dispatches this single action regardless of mode.
// ---------------------------------------------------------------------------

export type MissionEditorMode = 'waypoint' | 'polygon'

export interface MissionEditorState {
  mode: MissionEditorMode
  mission: Mission
  polygonPoints: LatLng[]
}

export const initialMissionEditorState: MissionEditorState = {
  mode: 'waypoint',
  mission: { items: [] },
  polygonPoints: [],
}

export type MissionEditorAction =
  | { type: 'setMode'; mode: MissionEditorMode }
  | { type: 'mapClick'; latlng: LatLng; altM: number }
  | { type: 'removeWaypoint'; seq: number }
  | { type: 'reorderWaypoint'; fromSeq: number; toSeq: number }
  | { type: 'clearPolygon' }
  | { type: 'clearMission' }
  // Replaces the whole mission (surveyGrid's returned MissionItem[], or a
  // loaded AI draft) — also clears the in-progress polygon + returns to
  // waypoint mode so the editor shows the resulting plan, not a stale draw.
  | { type: 'setMissionItems'; items: MissionItem[] }

export function missionEditorReducer(state: MissionEditorState, action: MissionEditorAction): MissionEditorState {
  switch (action.type) {
    case 'setMode':
      return { ...state, mode: action.mode }
    case 'mapClick':
      if (state.mode === 'polygon') {
        return { ...state, polygonPoints: [...state.polygonPoints, action.latlng] }
      }
      return { ...state, mission: addWaypoint(state.mission, action.latlng, action.altM) }
    case 'removeWaypoint':
      return { ...state, mission: removeWaypoint(state.mission, action.seq) }
    case 'reorderWaypoint':
      return { ...state, mission: reorderWaypoint(state.mission, action.fromSeq, action.toSeq) }
    case 'clearPolygon':
      return { ...state, polygonPoints: [] }
    case 'clearMission':
      return { ...state, mission: createEmptyMission() }
    case 'setMissionItems':
      return { ...state, mission: { items: action.items }, polygonPoints: [], mode: 'waypoint' }
    default:
      return state
  }
}
