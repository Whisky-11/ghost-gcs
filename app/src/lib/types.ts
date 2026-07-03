// Mirror of bridge/src/ws/schema.ts's wire protocol (Task 6 — BINDING).
//
// This is a plain-TypeScript mirror, hand-kept in sync field-for-field with
// the bridge's zod schemas — the bridge owns runtime validation of the wire
// boundary (client-sent RPCs are validated there via rpcRequestSchema; a
// compile-time AssertEqual check on that side keeps telemetryStateSchema
// honest against state/telemetry.ts's TelemetryState). The app trusts the
// bridge's output shape rather than re-validating with its own zod schemas.

export interface Position {
  lat: number
  lng: number
  altM: number
  relAltM: number
}

export interface Attitude {
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

export interface Speed {
  groundMps: number
  airMps: number
  climbMps: number
}

export interface Battery {
  voltageV: number
  remainingPct: number
}

export interface Gps {
  fixType: number
  satellites: number
  hdop: number
}

export interface Home {
  lat: number
  lng: number
  altM: number
}

export interface StatusText {
  severity: number
  text: string
  tsMs: number
}

export type VehicleType = 'copter' | 'rover' | 'unknown'

export interface TelemetryState {
  connected: boolean
  lastHeartbeatMs: number | null
  vehicleType: VehicleType
  armed: boolean
  mode: string // resolved name, e.g. 'GUIDED'
  position: Position | null
  attitude: Attitude | null
  speed: Speed | null
  battery: Battery | null
  gps: Gps | null
  home: Home | null
  statusTexts: StatusText[] // ring, max 50 (bridge-side cap)
}

// server -> client: telemetry frame
export interface TelemetryMessage {
  type: 'telemetry'
  state: TelemetryState
}

// --- Task 7/8 additions: mission model, geometry, watchdog alerts --------
// Mirrors bridge/src/missions/model.ts's MissionItem/Mission,
// bridge/src/missions/survey.ts's LatLng, and bridge/src/watchdog/rules.ts's
// Alert field-for-field (same "hand-kept mirror" contract as the rest of
// this file — the bridge owns runtime validation + the compile-time
// AssertEqual honesty checks in ws/schema.ts; the app trusts the bridge's
// output shape).

export type MissionItemCommand = 'WAYPOINT' | 'TAKEOFF' | 'RTL' | 'LAND'

export interface MissionItem {
  seq: number
  command: MissionItemCommand
  lat: number
  lng: number
  altM: number
}

export interface Mission {
  items: MissionItem[]
}

// Shared geometry primitive (survey polygons, AI-drafted-mission geometry).
export interface LatLng {
  lat: number
  lng: number
}

export type AlertSeverity = 'info' | 'warn' | 'critical'

export interface Alert {
  code: string
  severity: AlertSeverity
  message: string
  data?: Record<string, unknown>
}

// server -> client: watchdog-alert push (Task 7). Broadcast whenever the
// *set* of active alert codes changes on the bridge. Pure projection of
// watchdog/rules.ts's evaluateWatchdog() output — never AI-produced.
export interface AlertsMessage {
  type: 'alerts'
  alerts: Alert[]
}

// client -> server: rpc request
export type RpcMethod =
  | 'arm'
  | 'disarm'
  | 'setMode'
  | 'takeoff'
  | 'rtl'
  // Task 7 additions — mission RPCs (the APP sequences upload -> arm ->
  // start; the bridge never chains them) + the AI RPCs (spec safety
  // invariant 1: these produce DATA/TEXT only, never a command).
  | 'uploadMission'
  | 'startMission'
  | 'clearMission'
  | 'downloadMission'
  | 'surveyGrid'
  | 'aiDraftMission'
  | 'aiNarrate'
  | 'aiDebrief'

export interface RpcParams {
  mode?: string
  // Bounded 2-120m — see TAKEOFF_ALT_MIN/TAKEOFF_ALT_MAX below. Mirrors
  // bridge/src/ws/schema.ts's rpcParamsSchema.altM (fix wave: takeoff
  // altitude bound added at both the schema and command layers). Shared by
  // takeoff.altM and surveyGrid.altM (same bound, see MISSION_ALT_MIN/MAX).
  altM?: number
  // uploadMission
  mission?: Mission
  // surveyGrid
  polygon?: LatLng[]
  spacingM?: number
  headingDeg?: number
  // aiDraftMission
  request?: string
  geometry?: LatLng[] | null
  // aiNarrate
  question?: string
  alertCode?: string
}

export interface RpcRequest {
  type: 'rpc'
  id: string
  method: RpcMethod
  params?: RpcParams
}

// server -> client: rpc reply. `data` (Task 7) carries mission/AI payloads —
// downloadMission/surveyGrid return MissionItem[], aiDraftMission returns a
// mission draft, aiNarrate/aiDebrief return narration text — every other
// method omits it.
export type RpcResult =
  | { type: 'rpc_result'; id: string; ok: true; data?: unknown }
  | { type: 'rpc_result'; id: string; ok: false; code: string; message: string }

export type ServerMessage = TelemetryMessage | RpcResult | AlertsMessage

// Takeoff altitude bounds (bridge/src/ws/schema.ts rpcParamsSchema.altM +
// bridge/src/commands/commands.ts's BAD_PARAM guard, added in the Task 6 fix
// wave). Exported here so Task 9's takeoff input can clamp client-side too
// (defense in depth, matching the bridge's own layered validation).
export const TAKEOFF_ALT_MIN = 2
export const TAKEOFF_ALT_MAX = 120

// Mission item altitude bounds (bridge/src/missions/model.ts's
// MISSION_ALT_MIN_M/MAX_M) — identical range to TAKEOFF_ALT_MIN/MAX above.
// Aliased under a mission-specific name for clarity at surveyGrid/mission
// editor call sites rather than duplicating the literal 2/120 constants.
export const MISSION_ALT_MIN = TAKEOFF_ALT_MIN
export const MISSION_ALT_MAX = TAKEOFF_ALT_MAX

// Hard take-cap on mission item arrays (bridge/src/missions/model.ts's
// MISSION_MAX_ITEMS) — mirrored here so the app can gate an oversized
// mission (a bad AI draft, a runaway survey grid) client-side too, same
// defense-in-depth pairing as the altitude bounds above. The bridge still
// owns the authoritative enforcement (schema.ts's `.max()` + validateMission).
export const MISSION_MAX_ITEMS = 1000
