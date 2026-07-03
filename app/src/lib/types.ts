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

// client -> server: rpc request
export type RpcMethod = 'arm' | 'disarm' | 'setMode' | 'takeoff' | 'rtl'

export interface RpcParams {
  mode?: string
  // Bounded 2-120m — see TAKEOFF_ALT_MIN/TAKEOFF_ALT_MAX below. Mirrors
  // bridge/src/ws/schema.ts's rpcParamsSchema.altM (fix wave: takeoff
  // altitude bound added at both the schema and command layers).
  altM?: number
}

export interface RpcRequest {
  type: 'rpc'
  id: string
  method: RpcMethod
  params?: RpcParams
}

// server -> client: rpc reply
export type RpcResult =
  | { type: 'rpc_result'; id: string; ok: true }
  | { type: 'rpc_result'; id: string; ok: false; code: string; message: string }

export type ServerMessage = TelemetryMessage | RpcResult

// Takeoff altitude bounds (bridge/src/ws/schema.ts rpcParamsSchema.altM +
// bridge/src/commands/commands.ts's BAD_PARAM guard, added in the Task 6 fix
// wave). Exported here so Task 9's takeoff input can clamp client-side too
// (defense in depth, matching the bridge's own layered validation).
export const TAKEOFF_ALT_MIN = 2
export const TAKEOFF_ALT_MAX = 120
