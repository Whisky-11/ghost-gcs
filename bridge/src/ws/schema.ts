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
import type { TelemetryState } from '../state/telemetry.js'

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

// client -> server: rpc request
export const rpcMethodSchema = z.enum(['arm', 'disarm', 'setMode', 'takeoff', 'rtl'])
export type RpcMethod = z.infer<typeof rpcMethodSchema>

const rpcParamsSchema = z.object({
  mode: z.string().optional(),
  altM: z.number().optional(),
})

export const rpcRequestSchema = z
  .object({
    type: z.literal('rpc'),
    id: z.string(),
    method: rpcMethodSchema,
    params: rpcParamsSchema.optional(),
  })
  // Structural shape stays exactly {mode?, altM?} per the brief's wire type —
  // this refinement only tightens *runtime* validation (method-specific
  // required-ness) without widening the inferred TS type.
  .superRefine((val, ctx) => {
    if (val.method === 'setMode' && typeof val.params?.mode !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'setMode requires params.mode', path: ['params', 'mode'] })
    }
    if (val.method === 'takeoff' && typeof val.params?.altM !== 'number') {
      ctx.addIssue({ code: 'custom', message: 'takeoff requires params.altM', path: ['params', 'altM'] })
    }
  })
export type RpcRequest = z.infer<typeof rpcRequestSchema>

// server -> client: rpc reply
export const rpcResultSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('rpc_result'), id: z.string(), ok: z.literal(true) }),
  z.object({
    type: z.literal('rpc_result'),
    id: z.string(),
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  }),
])
export type RpcResult = z.infer<typeof rpcResultSchema>

export const serverMessageSchema = z.union([telemetryMessageSchema, rpcResultSchema])
export type ServerMessage = z.infer<typeof serverMessageSchema>

// Compile-time honesty check: telemetryStateSchema's inferred type must match
// TelemetryState exactly (both directions) — catches wire/reducer drift at
// typecheck time instead of at runtime.
type AssertEqual<A, B> = A extends B ? (B extends A ? true : false) : false
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _TelemetryWireShapeMatchesReducerShape = AssertEqual<z.infer<typeof telemetryStateSchema>, TelemetryState>
const _telemetryWireShapeMatchesReducerShape: _TelemetryWireShapeMatchesReducerShape = true
void _telemetryWireShapeMatchesReducerShape
