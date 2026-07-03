// Wire protocol for the bridge<->app WebSocket (Task 6 brief — BINDING, Task 7's
// app builds against this verbatim). Two directions:
//   server -> client: telemetry frames (~CONFIG.telemetryHz) + rpc_result replies
//   client -> server: rpc requests
//
// telemetryStateSchema mirrors state/telemetry.ts's TelemetryState field-for-field
// (not re-exported from there — this module owns the *wire* shape, kept honest by
// the compile-time AssertEqual check at the bottom) so a drift between the reducer
// shape and the wire shape fails typecheck instead of failing silently at runtime.
import { z } from 'zod'
import { MISSION_ALT_MIN_M, MISSION_ALT_MAX_M, type Mission, type MissionItem } from '../missions/model.js'
import type { LatLng } from '../missions/survey.js'
import type { TelemetryState } from '../state/telemetry.js'
import type { Alert } from '../watchdog/rules.js'

const positionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  altM: z.number(),
  relAltM: z.number(),
})

const attitudeSchema = z.object({
  rollDeg: z.number(),
  pitchDeg: z.number(),
  yawDeg: z.number(),
})

const speedSchema = z.object({
  groundMps: z.number(),
  airMps: z.number(),
  climbMps: z.number(),
})

const batterySchema = z.object({
  voltageV: z.number(),
  remainingPct: z.number(),
})

const gpsSchema = z.object({
  fixType: z.number(),
  satellites: z.number(),
  hdop: z.number(),
})

const homeSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  altM: z.number(),
})

const statusTextSchema = z.object({
  severity: z.number(),
  text: z.string(),
  tsMs: z.number(),
})

export const telemetryStateSchema = z.object({
  connected: z.boolean(),
  lastHeartbeatMs: z.number().nullable(),
  vehicleType: z.enum(['copter', 'rover', 'unknown']),
  armed: z.boolean(),
  mode: z.string(),
  position: positionSchema.nullable(),
  attitude: attitudeSchema.nullable(),
  speed: speedSchema.nullable(),
  battery: batterySchema.nullable(),
  gps: gpsSchema.nullable(),
  home: homeSchema.nullable(),
  statusTexts: z.array(statusTextSchema),
})

// server -> client: telemetry frame
export const telemetryMessageSchema = z.object({
  type: z.literal('telemetry'),
  state: telemetryStateSchema,
})
export type TelemetryMessage = z.infer<typeof telemetryMessageSchema>

// server -> client: watchdog-alert push (Task 7). Broadcast whenever the
// *set* of active alert codes changes (see ws/server.ts's pushAlerts —
// dedup-by-code change detection lives there, not here; this schema only
// describes the wire shape). AI never produces this message — it is a pure
// projection of watchdog/rules.ts's evaluateWatchdog() output.
const alertSeveritySchema = z.enum(['info', 'warn', 'critical'])
const alertSchema = z.object({
  code: z.string(),
  severity: alertSeveritySchema,
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export const alertsMessageSchema = z.object({
  type: z.literal('alerts'),
  alerts: z.array(alertSchema),
})
export type AlertsMessage = z.infer<typeof alertsMessageSchema>

// Shared geometry primitive (survey polygons, AI-drafted-mission geometry).
const latLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

// Mirrors missions/model.ts's MissionItem/Mission field-for-field (kept
// honest by the AssertEqual checks at the bottom of this file) — used by
// uploadMission's params.mission and as downloadMission/surveyGrid's `data`
// wire shape.
const missionItemCommandSchema = z.enum(['WAYPOINT', 'TAKEOFF', 'RTL', 'LAND'])
const missionItemSchema = z.object({
  seq: z.number().int().min(0),
  command: missionItemCommandSchema,
  lat: z.number(),
  lng: z.number(),
  altM: z.number(),
})
const missionSchema = z.object({
  items: z.array(missionItemSchema),
})

// client -> server: rpc request
export const rpcMethodSchema = z.enum([
  'arm',
  'disarm',
  'setMode',
  'takeoff',
  'rtl',
  // Task 7 additions — mission RPCs (app sequences these; the bridge never
  // chains them) + the AI RPCs (spec safety invariant 1: these produce DATA/
  // TEXT only — see ws/server.ts's WsAi, which has no access to WsCommands
  // or WsMissions, so an AI handler cannot call a command mutator or
  // mission-upload even by mistake).
  'uploadMission',
  'startMission',
  'clearMission',
  'downloadMission',
  'surveyGrid',
  'aiDraftMission',
  'aiNarrate',
  'aiDebrief',
])
export type RpcMethod = z.infer<typeof rpcMethodSchema>

const rpcParamsSchema = z.object({
  mode: z.string().optional(),
  // Bounded to missions/model.ts's MISSION_ALT_MIN_M/MAX_M (2-120m, same
  // constant the plan's Task 9 UI clamp uses) — defense in depth alongside
  // commands.ts's runtime BAD_PARAM guard. Shared by takeoff.altM and
  // surveyGrid.altM.
  altM: z.number().min(MISSION_ALT_MIN_M).max(MISSION_ALT_MAX_M).optional(),
  // uploadMission
  mission: missionSchema.optional(),
  // surveyGrid
  polygon: z.array(latLngSchema).optional(),
  spacingM: z.number().positive().optional(),
  headingDeg: z.number().optional(),
  // aiDraftMission
  request: z.string().optional(),
  geometry: z.array(latLngSchema).nullable().optional(),
  // aiNarrate
  question: z.string().optional(),
  alertCode: z.string().optional(),
})

export const rpcRequestSchema = z
  .object({
    type: z.literal('rpc'),
    id: z.string(),
    method: rpcMethodSchema,
    params: rpcParamsSchema.optional(),
  })
  // This refinement only tightens *runtime* validation (method-specific
  // required-ness) without widening the inferred TS type — the params shape
  // stays the single flat (all-optional) object above for every method.
  .superRefine((val, ctx) => {
    if (val.method === 'setMode' && typeof val.params?.mode !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'setMode requires params.mode', path: ['params', 'mode'] })
    }
    if (val.method === 'takeoff' && typeof val.params?.altM !== 'number') {
      ctx.addIssue({ code: 'custom', message: 'takeoff requires params.altM', path: ['params', 'altM'] })
    }
    if (val.method === 'uploadMission') {
      const items = val.params?.mission?.items
      if (!Array.isArray(items) || items.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'uploadMission requires params.mission.items (non-empty)',
          path: ['params', 'mission'],
        })
      }
    }
    if (val.method === 'surveyGrid') {
      if (!Array.isArray(val.params?.polygon) || val.params.polygon.length < 3) {
        ctx.addIssue({
          code: 'custom',
          message: 'surveyGrid requires params.polygon with at least 3 points',
          path: ['params', 'polygon'],
        })
      }
      if (typeof val.params?.altM !== 'number') {
        ctx.addIssue({ code: 'custom', message: 'surveyGrid requires params.altM', path: ['params', 'altM'] })
      }
      if (typeof val.params?.spacingM !== 'number') {
        ctx.addIssue({ code: 'custom', message: 'surveyGrid requires params.spacingM', path: ['params', 'spacingM'] })
      }
    }
    if (val.method === 'aiDraftMission' && typeof val.params?.request !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'aiDraftMission requires params.request', path: ['params', 'request'] })
    }
  })
export type RpcRequest = z.infer<typeof rpcRequestSchema>

// server -> client: rpc reply. `data` (Task 7) carries mission/AI payloads —
// downloadMission/surveyGrid return MissionItem[], aiDraftMission returns a
// mission draft, aiNarrate/aiDebrief return narration text — every other
// method (arm/disarm/.../uploadMission/startMission/clearMission) omits it.
export const rpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('rpc_result'), id: z.string(), ok: z.literal(true), data: z.unknown().optional() }),
  z.object({
    type: z.literal('rpc_result'),
    id: z.string(),
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
])
export type RpcResult = z.infer<typeof rpcResultSchema>

export const serverMessageSchema = z.union([telemetryMessageSchema, rpcResultSchema, alertsMessageSchema])
export type ServerMessage = z.infer<typeof serverMessageSchema>

// Compile-time honesty check: telemetryStateSchema's inferred type must match
// TelemetryState exactly (both directions) — catches wire/reducer drift at
// typecheck time instead of at runtime.
type AssertEqual<A, B> = A extends B ? (B extends A ? true : false) : false
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TelemetryWireShapeMatchesReducerShape = AssertEqual<z.infer<typeof telemetryStateSchema>, TelemetryState>
const _telemetryWireShapeMatchesReducerShape: _TelemetryWireShapeMatchesReducerShape = true
void _telemetryWireShapeMatchesReducerShape

// Task 7's same compile-time honesty check, extended to the mission +
// geometry + alert wire shapes against their respective source-of-truth
// modules (missions/model.ts, missions/survey.ts, watchdog/rules.ts).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MissionItemWireShapeMatchesModel = AssertEqual<z.infer<typeof missionItemSchema>, MissionItem>
const _missionItemWireShapeMatchesModel: _MissionItemWireShapeMatchesModel = true
void _missionItemWireShapeMatchesModel

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _MissionWireShapeMatchesModel = AssertEqual<z.infer<typeof missionSchema>, Mission>
const _missionWireShapeMatchesModel: _MissionWireShapeMatchesModel = true
void _missionWireShapeMatchesModel

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _LatLngWireShapeMatchesModel = AssertEqual<z.infer<typeof latLngSchema>, LatLng>
const _latLngWireShapeMatchesModel: _LatLngWireShapeMatchesModel = true
void _latLngWireShapeMatchesModel

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AlertWireShapeMatchesModel = AssertEqual<z.infer<typeof alertSchema>, Alert>
const _alertWireShapeMatchesModel: _AlertWireShapeMatchesModel = true
void _alertWireShapeMatchesModel
