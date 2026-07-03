// WS server: broadcasts TelemetryState @CONFIG.telemetryHz (send-latest-snapshot
// each tick, diff-agnostic — no delta tracking) to every connected client + once
// immediately on connect, routes validated `rpc` requests to `commands`/
// `missions`/the pure survey generator/`ai` (Task 7), and pushes watchdog
// `alerts` messages via `pushAlerts` (dedup-by-code change detection, see
// below).
//
// AI-never-commands (spec safety invariant 1) is enforced STRUCTURALLY here,
// not just by convention: `dispatchAi*` below only ever receive a `WsAi`
// value, which has no `commands`/`missions` field on it at all — there is no
// object in scope inside an AI dispatch branch that could call
// arm/disarm/setMode/takeoff/rtl/startMission or mission upload/clear. See
// ws/__tests__/server.test.ts's "AI never commands" test for the runtime
// assertion that backs this up.
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { ClaudeError, type ClaudeHeadless } from '../ai/claude.js'
import {
  buildDebriefPrompt,
  buildMissionDraftPrompt,
  buildNarratePrompt,
  computeFlightStats,
  missionDraftSchema,
  type FlightStats,
} from '../ai/features.js'
import { CommandError } from '../commands/commands.js'
import { CONFIG } from '../config.js'
import { validateMission, MISSION_MAX_ITEMS, type MissionItem } from '../missions/model.js'
import { MissionError } from '../missions/protocol.js'
import { generateSurveyGrid, type LatLng } from '../missions/survey.js'
import type { TelemetryState } from '../state/telemetry.js'
import type { Alert } from '../watchdog/rules.js'
import { rpcRequestSchema, type RpcRequest, type RpcResult } from './schema.js'

// Narrow surface the ws layer needs from makeCommands()'s return value — kept
// local (not imported from commands.ts) so this module only depends on the
// shape it actually calls, mirroring CommandDeps' own narrowing style.
export interface WsCommands {
  arm(): Promise<void>
  disarm(): Promise<void>
  setMode(mode: string): Promise<void>
  takeoff(altM: number): Promise<void>
  rtl(): Promise<void>
  startMission(): Promise<void>
}

// Narrow surface from makeMissionProtocol()'s return value. Upload/download/
// clear are explicit human UI actions the app sequences over separate RPCs —
// the ws layer never chains them (same "no chaining" rule as WsCommands).
export interface WsMissions {
  upload(items: MissionItem[]): Promise<void>
  download(): Promise<MissionItem[]>
  clear(): Promise<void>
}

// Everything an AI RPC handler is allowed to see. Deliberately does NOT
// include WsCommands or WsMissions (see the module header) — this is the
// structural half of the AI-never-commands invariant; the runtime test is
// the other half.
export interface WsAi {
  claude: ClaudeHeadless
  getState(): TelemetryState
  /** The most recent evaluateWatchdog() result (for aiNarrate's optional
   * alertCode lookup) — may have already cleared by the time the RPC
   * arrives; a miss falls back to a generic status narration rather than
   * erroring (a benign race, not a client bug). */
  getActiveAlerts(): Alert[]
  /** Rolling telemetry sample buffer for aiDebrief's computeFlightStats. */
  getFlightSamples(): TelemetryState[]
  /** Alerts observed over the same window as getFlightSamples(), for
   * aiDebrief's computeFlightStats. */
  getAlertHistory(): Alert[]
}

export interface StartWsServerOptions {
  port: number
  getState(): TelemetryState
  commands: WsCommands
  missions: WsMissions
  ai: WsAi
  /** Override broadcast rate for tests; defaults to CONFIG.telemetryHz. */
  telemetryHz?: number
}

export interface WsServerHandle {
  close(): Promise<void>
  /** Broadcasts `{type:'alerts', alerts}` to every connected client, but
   * ONLY when the *set* of alert `code`s differs from the last call (dedup
   * by code) — otherwise a no-op. This intentionally ignores changes to an
   * alert's message/severity text alone (e.g. LINK_STALE's age-in-message
   * growing every tick, or BATTERY_LOW's warn->critical escalation while the
   * code stays the same) so the push channel doesn't spam a broadcast on
   * every single telemetry tick a rule stays active. */
  pushAlerts(alerts: Alert[]): void
}

/** Thrown for wire-adjacent validation failures that zod's structural check
 * can't express (e.g. validateMission's semantic rules on uploadMission).
 * Kept local + minimal rather than overloading CommandError's fixed code
 * union with a code that isn't actually about a vehicle command. */
class RpcValidationError extends Error {
  constructor(
    public code: string,
    msg: string,
  ) {
    super(msg)
    this.name = 'RpcValidationError'
  }
}

function alertCodeSet(alerts: Alert[]): Set<string> {
  return new Set(alerts.map((a) => a.code))
}

function sameCodeSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const code of a) if (!b.has(code)) return false
  return true
}

export function startWsServer(opts: StartWsServerOptions): WsServerHandle {
  const hz = opts.telemetryHz ?? CONFIG.telemetryHz
  const wss = new WebSocketServer({ port: opts.port })

  const telemetryFrame = (): string => JSON.stringify({ type: 'telemetry', state: opts.getState() })

  wss.on('connection', (socket: WebSocket) => {
    // Immediate frame on connect, per the brief — clients don't wait up to
    // 1/hz seconds to see their first state.
    socket.send(telemetryFrame())

    socket.on('message', (raw: RawData) => {
      handleClientMessage(socket, raw, opts).catch((err: unknown) => {
        console.error('[ws] unexpected error handling client message', err)
      })
    })

    socket.on('error', (err: Error) => {
      console.error('[ws] client socket error', err)
    })
  })

  wss.on('error', (err: Error) => {
    console.error('[ws] server error', err)
  })

  const interval = setInterval(() => {
    if (wss.clients.size === 0) return
    const frame = telemetryFrame()
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(frame)
    }
  }, 1000 / hz)

  let lastAlertCodes = new Set<string>()

  return {
    close(): Promise<void> {
      clearInterval(interval)
      for (const client of wss.clients) client.terminate()
      return new Promise((resolve, reject) => {
        wss.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
    pushAlerts(alerts: Alert[]): void {
      const codes = alertCodeSet(alerts)
      if (sameCodeSet(codes, lastAlertCodes)) return
      lastAlertCodes = codes
      if (wss.clients.size === 0) return
      const frame = JSON.stringify({ type: 'alerts', alerts })
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(frame)
      }
    },
  }
}

/** Best-effort extraction of a string `id` from an otherwise-unvalidated
 * parsed JSON payload, so a request that fails schema validation can still
 * get a targeted BAD_REQUEST reply instead of being silently dropped. */
function recoverId(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const id = (parsed as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

async function handleClientMessage(socket: WebSocket, raw: RawData, opts: StartWsServerOptions): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw))
  } catch (err) {
    console.error('[ws] malformed JSON from client (not valid JSON), ignoring', err)
    return
  }

  const result = rpcRequestSchema.safeParse(parsed)
  if (!result.success) {
    const id = recoverId(parsed)
    if (id === null) {
      console.error('[ws] rpc request failed validation and has no recoverable id, ignoring', result.error.message)
      return
    }
    console.error('[ws] rpc request failed validation', { id, issues: result.error.message })
    sendResult(socket, { type: 'rpc_result', id, ok: false, code: 'BAD_REQUEST', message: 'invalid rpc request' })
    return
  }

  const req = result.data
  try {
    const data = await dispatch(opts, req)
    sendResult(socket, { type: 'rpc_result', id: req.id, ok: true, ...(data !== undefined ? { data } : {}) })
  } catch (err) {
    if (err instanceof ClaudeError) {
      // AI errors NEVER crash the daemon — they always surface as a clean
      // ok:false with an AI_* code (spec: "flying is never affected").
      const code = err.code === 'TIMEOUT' ? 'AI_TIMEOUT' : err.code === 'VALIDATION' ? 'AI_VALIDATION' : 'AI_UNAVAILABLE'
      sendResult(socket, { type: 'rpc_result', id: req.id, ok: false, code, message: err.message })
    } else if (err instanceof CommandError || err instanceof MissionError || err instanceof RpcValidationError) {
      sendResult(socket, { type: 'rpc_result', id: req.id, ok: false, code: err.code, message: err.message })
    } else {
      console.error('[ws] rpc handler threw an unexpected error', err)
      const message = err instanceof Error ? err.message : String(err)
      sendResult(socket, { type: 'rpc_result', id: req.id, ok: false, code: 'INTERNAL', message })
    }
  }
}

/** Routes a validated RpcRequest to commands/missions/the pure survey
 * generator/ai, per method. Returns the `data` payload to attach to the
 * rpc_result (undefined for methods with no data, e.g. arm/uploadMission).
 * Never chains multiple mutators — one RPC, one action (the app sequences
 * multi-step flows like arm -> takeoff -> startMission itself). */
async function dispatch(opts: StartWsServerOptions, req: RpcRequest): Promise<unknown> {
  const { commands, missions, ai } = opts
  switch (req.method) {
    case 'arm':
      await commands.arm()
      return undefined
    case 'disarm':
      await commands.disarm()
      return undefined
    case 'setMode':
      // superRefine in schema.ts guarantees params.mode is a string once the
      // request has passed validation for method==='setMode'.
      await commands.setMode(req.params!.mode!)
      return undefined
    case 'takeoff':
      // Same guarantee for params.altM on method==='takeoff'.
      await commands.takeoff(req.params!.altM!)
      return undefined
    case 'rtl':
      await commands.rtl()
      return undefined
    case 'startMission':
      await commands.startMission()
      return undefined
    case 'uploadMission': {
      // schema.ts guarantees params.mission.items is a non-empty array once
      // validation has passed for method==='uploadMission'; validateMission
      // is a second, semantic gate (contiguous seq, alt bounds, terminal-item
      // placement) zod's structural check can't express — defense in depth
      // before anything reaches the vehicle, same philosophy as the altM
      // wire+command dual bound.
      const mission = { items: req.params!.mission!.items }
      const validation = validateMission(mission)
      if (!validation.ok) {
        throw new RpcValidationError('BAD_MISSION', validation.error)
      }
      await missions.upload(mission.items)
      return undefined
    }
    case 'clearMission':
      await missions.clear()
      return undefined
    case 'downloadMission':
      return await missions.download()
    case 'surveyGrid': {
      // Pure geometry (missions/survey.ts) — no AI, no I/O. superRefine
      // guarantees polygon (>=3 pts)/altM/spacingM are present once
      // validation has passed for method==='surveyGrid'. Unlike
      // uploadMission, the *input* here (a polygon + spacing) isn't itself
      // bounded by MISSION_MAX_ITEMS — a tight spacing over a large polygon
      // can still generate an oversized grid, so the hard take-cap is
      // enforced on the generator's *output* instead.
      const grid = generateSurveyGrid({
        polygon: req.params!.polygon! as LatLng[],
        altM: req.params!.altM!,
        spacingM: req.params!.spacingM!,
        headingDeg: req.params!.headingDeg,
      })
      if (grid.length > MISSION_MAX_ITEMS) {
        throw new RpcValidationError(
          'SURVEY_TOO_LARGE',
          `survey grid has ${grid.length} waypoints, exceeds max of ${MISSION_MAX_ITEMS} — increase spacingM or shrink the polygon`,
        )
      }
      return grid
    }
    case 'aiDraftMission':
      return dispatchAiDraftMission(ai, req)
    case 'aiNarrate':
      return dispatchAiNarrate(ai, req)
    case 'aiDebrief':
      return dispatchAiDebrief(ai)
  }
}

/** AI RPC handlers below take ONLY a WsAi — see the module header for why
 * that alone is the structural half of the AI-never-commands invariant. */

async function dispatchAiDraftMission(ai: WsAi, req: RpcRequest): Promise<{ items: MissionItem[]; notes: string }> {
  const state = ai.getState()
  const prompt = buildMissionDraftPrompt({
    // superRefine guarantees params.request is a string once validation has
    // passed for method==='aiDraftMission'.
    request: req.params!.request!,
    geometry: (req.params!.geometry as LatLng[] | null | undefined) ?? null,
    home: state.home,
    vehicleType: state.vehicleType,
  })
  return ai.claude.askJson(prompt, missionDraftSchema)
}

async function dispatchAiNarrate(ai: WsAi, req: RpcRequest): Promise<{ text: string }> {
  const question = req.params?.question
  const alertCode = req.params?.alertCode
  const alert = alertCode ? ai.getActiveAlerts().find((a) => a.code === alertCode) : undefined
  const text = await ai.claude.ask(buildNarratePrompt({ alert, question, state: ai.getState() }))
  return { text }
}

async function dispatchAiDebrief(ai: WsAi): Promise<{ text: string; stats: FlightStats }> {
  const stats = computeFlightStats(ai.getFlightSamples(), ai.getAlertHistory())
  const text = await ai.claude.ask(buildDebriefPrompt(stats))
  return { text, stats }
}

function sendResult(socket: WebSocket, result: RpcResult): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(result))
}
