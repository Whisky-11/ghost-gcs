// Pure client state for GHOST's three advisory AI features (Task 10):
// mission draft, free-form Q&A ("narrate"), and post-flight debrief. No
// React, no I/O — GhostPanel.tsx dispatches actions around its rpc() calls
// to aiDraftMission/aiNarrate/aiDebrief and this module only holds the pure
// idle|pending|done|error state machine, one slot per request kind, fully
// covered by node-env vitest (see __tests__/ghost.test.ts).
//
// AI-never-uploads (spec safety invariant 1): nothing in this module ever
// touches uploadMission/startMission/arm/disarm/etc — a GhostState only
// ever holds DATA (a mission draft) or TEXT (narration/debrief) for a human
// to review. "Loading" a draft into the editor is a separate, local mission
// mutation GhostPanel.tsx performs via a plain callback prop, never through
// this reducer or any rpc call.
import type { LatLng, Mission, MissionItem } from './types'

export type GhostRequestKind = 'draft' | 'narrate' | 'debrief'

export type GhostRequest<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; data: T }
  | { status: 'error'; message: string }

/** aiDraftMission's `data` payload (server.ts's dispatchAiDraftMission
 * return shape) — a mission draft is ONLY ever WAYPOINT items + a rationale
 * string, never anything uploadable as-is (the bridge's missionDraftSchema
 * enforces this server-side; this is just the client-side mirror of its
 * output shape). */
export interface GhostDraftData {
  items: MissionItem[]
  notes: string
}

export interface GhostState {
  draft: GhostRequest<GhostDraftData>
  narrate: GhostRequest<string>
  debrief: GhostRequest<string>
}

export const initialGhostState: GhostState = {
  draft: { status: 'idle' },
  narrate: { status: 'idle' },
  debrief: { status: 'idle' },
}

export type GhostAction =
  | { type: 'draft/start' }
  | { type: 'draft/success'; data: GhostDraftData }
  | { type: 'draft/error'; message: string }
  | { type: 'draft/reset' }
  | { type: 'narrate/start' }
  | { type: 'narrate/success'; data: string }
  | { type: 'narrate/error'; message: string }
  | { type: 'narrate/reset' }
  | { type: 'debrief/start' }
  | { type: 'debrief/success'; data: string }
  | { type: 'debrief/error'; message: string }
  | { type: 'debrief/reset' }

/** Pure transitions, one independent slot per request kind — starting/
 * resolving/resetting one kind never touches the other two's state (each
 * feature's pending/done/error is fully independent, matching the panel's
 * three separately-triggered actions). */
export function ghostReducer(state: GhostState, action: GhostAction): GhostState {
  switch (action.type) {
    case 'draft/start':
      return { ...state, draft: { status: 'pending' } }
    case 'draft/success':
      return { ...state, draft: { status: 'done', data: action.data } }
    case 'draft/error':
      return { ...state, draft: { status: 'error', message: action.message } }
    case 'draft/reset':
      return { ...state, draft: { status: 'idle' } }
    case 'narrate/start':
      return { ...state, narrate: { status: 'pending' } }
    case 'narrate/success':
      return { ...state, narrate: { status: 'done', data: action.data } }
    case 'narrate/error':
      return { ...state, narrate: { status: 'error', message: action.message } }
    case 'narrate/reset':
      return { ...state, narrate: { status: 'idle' } }
    case 'debrief/start':
      return { ...state, debrief: { status: 'pending' } }
    case 'debrief/success':
      return { ...state, debrief: { status: 'done', data: action.data } }
    case 'debrief/error':
      return { ...state, debrief: { status: 'error', message: action.message } }
    case 'debrief/reset':
      return { ...state, debrief: { status: 'idle' } }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// draftGeometryFromEditor — pure derivation of the geometry to send with
// "draft from drawing". Prefers the in-progress survey polygon (what the
// operator is actively drawing); falls back to the current mission's
// waypoints as a point set if no polygon is drawn; null if the editor is
// completely empty (buildMissionDraftPrompt's formatGeometry on the bridge
// side already handles null/empty gracefully — it tells the model not to
// fabricate a polygon rather than erroring).
// ---------------------------------------------------------------------------

export function draftGeometryFromEditor(polygonPoints: LatLng[], mission: Mission): LatLng[] | null {
  if (polygonPoints.length > 0) return polygonPoints
  if (mission.items.length > 0) return mission.items.map((it) => ({ lat: it.lat, lng: it.lng }))
  return null
}
