// Bridge daemon main: VehicleLink -> reduce() -> TelemetryState -> WS broadcast,
// plus validated RPC -> makeCommands/makeMissionProtocol/ClaudeHeadless. See
// docs/superpowers/plans/2026-07-03-p0-foundations.md (P0) and
// docs/superpowers/plans/2026-07-03-p1-missions-and-copilot.md (P1 Task 7).
import { makeClaudeHeadless } from './ai/claude.js'
import { CONFIG } from './config.js'
import { VehicleLink } from './mavlink/link.js'
import { makeCommands } from './commands/commands.js'
import { makeMissionProtocol } from './missions/protocol.js'
import { reduce, initialState, type TelemetryState } from './state/telemetry.js'
import { evaluateWatchdog, type Alert } from './watchdog/rules.js'
import { startWsServer } from './ws/server.js'

const CONNECT_RETRY_MS = 5000

// Rolling telemetry sample buffer for aiDebrief's computeFlightStats — capped
// at 600 samples (2 minutes at CONFIG.telemetryHz=5Hz), per the Task 7 brief.
// Sampled on the SAME periodic timer that runs the watchdog, not on every raw
// MAVLink 'message' event (which arrives at wildly different per-message-type
// rates) — this is also what makes evaluateWatchdog's LINK_STALE rule work at
// all: it detects the *absence* of heartbeats, so it must be re-evaluated on
// a clock even when zero messages are arriving, not only reactively inside
// the 'message' handler.
const FLIGHT_SAMPLE_CAP = 600
// Bounded log of alerts, one entry per NEWLY-ACTIVE alert code (a code that
// transitions from inactive to active) — not one entry per tick a code stays
// active, else a persistent rule like LINK_STALE (whose message/severity
// escalates every tick) would spam the debrief history. Mirrors
// computeFlightStats's own "count AUTO-mode transitions, not AUTO-mode
// samples" pattern in ai/features.ts.
const ALERT_HISTORY_CAP = 300
const WATCHDOG_HZ = 5

/** Boot-order decision (Task 6 carry-note): SITL is a separate process/
 * container the daemon doesn't control and may not be up yet when the bridge
 * starts. `VehicleLink.connect()` rejects (HeartbeatTimeoutError after its
 * 15s window, or a raw TCP error path) rather than waiting forever, and by
 * design does NOT auto-reconnect after that rejection (see link.ts's
 * armHeartbeatTimeout/disconnect-semantics doc comment) — so a bare
 * `await link.connect()` would leave the daemon dead on a cold start before
 * `sim/run.sh` has finished booting. Instead we retry connect() in a loop
 * with 5s spacing until it resolves once: the daemon must be startable
 * (and the ws server reachable) before SITL is. Once connect() resolves the
 * first time, VehicleLink's own internal reconnect-with-2s-backoff (link.ts)
 * takes over for any later drop — this loop only ever covers the FIRST
 * HEARTBEAT. */
async function connectWithRetry(link: VehicleLink): Promise<void> {
  for (;;) {
    try {
      await link.connect()
      return
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[bridge] connect() failed (${reason}) — retrying in ${CONNECT_RETRY_MS}ms`)
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS))
    }
  }
}

async function main(): Promise<void> {
  let state: TelemetryState = initialState()

  const link = new VehicleLink()

  link.on('message', ({ msgName, data }: { msgName: string; data: Record<string, unknown> }) => {
    state = reduce(state, msgName, data, Date.now())
  })
  // TelemetryState.connected is deliberately NOT driven by reduce() (Task 4
  // report: "expected to be toggled by whatever wires VehicleLink's
  // 'connected'/'disconnected' events to state in a later task") — that
  // wiring is here, since these are link-lifecycle events, not decoded
  // MAVLink messages.
  link.on('connected', () => {
    state = { ...state, connected: true }
    console.log('[bridge] vehicle link connected')
  })
  link.on('disconnected', () => {
    state = { ...state, connected: false }
    console.log('[bridge] vehicle link disconnected — reconnecting')
  })
  link.on('raw-error', (err: unknown) => console.error('[bridge] vehicle link error', err))

  console.log(`[bridge] connecting to SITL at ${CONFIG.sitlTcp.host}:${CONFIG.sitlTcp.port}...`)
  await connectWithRetry(link)
  console.log('[bridge] connected to vehicle (first heartbeat received)')

  // The daemon layer only exposes individual commands over RPC — it never
  // chains them itself (Task 5 carry-note: an arm ACK precedes the HEARTBEAT
  // that flips state.armed, so programmatic chaining can race a stale
  // state.armed read). The UI gates each call on the latest telemetry state.
  const commands = makeCommands({ link, getState: () => state })

  // Mission upload/download/clear (P1 Task 3). Same "no chaining" rule as
  // commands — the app sequences upload -> arm -> takeoff -> startMission
  // over separate RPCs.
  const missions = makeMissionProtocol({ link })

  // ClaudeHeadless (P1 Task 5) — spawns the local `claude` CLI, never the
  // Anthropic API. Has no access to `link`/`commands`/`missions`; only ever
  // reachable from ws/server.ts's WsAi (see server.ts's module header for the
  // AI-never-commands invariant this structurally enforces).
  const claude = makeClaudeHeadless()

  let flightSamples: TelemetryState[] = []
  let activeAlertCodes = new Set<string>()
  let lastAlerts: Alert[] = []
  let alertHistory: Alert[] = []
  let prevWatchdogState: TelemetryState | null = null

  const wsHandle = startWsServer({
    port: CONFIG.wsPort,
    getState: () => state,
    commands,
    missions,
    ai: {
      claude,
      getState: () => state,
      getActiveAlerts: () => lastAlerts,
      getFlightSamples: () => flightSamples,
      getAlertHistory: () => alertHistory,
    },
  })
  console.log(`[bridge] ws server listening on ws://localhost:${CONFIG.wsPort}`)

  // Own periodic tick (independent of the ws server's broadcast interval):
  // samples telemetry into flightSamples and re-evaluates the advisory
  // watchdog every tick, pushing `alerts` to clients on a set change
  // (pushAlerts dedupes by code internally — see ws/server.ts).
  const watchdogInterval = setInterval(() => {
    flightSamples.push(state)
    if (flightSamples.length > FLIGHT_SAMPLE_CAP) {
      flightSamples = flightSamples.slice(flightSamples.length - FLIGHT_SAMPLE_CAP)
    }

    const alerts = evaluateWatchdog(state, prevWatchdogState, Date.now())
    prevWatchdogState = state
    lastAlerts = alerts

    const codes = new Set(alerts.map((a) => a.code))
    for (const alert of alerts) {
      if (activeAlertCodes.has(alert.code)) continue
      alertHistory.push(alert)
    }
    if (alertHistory.length > ALERT_HISTORY_CAP) {
      alertHistory = alertHistory.slice(alertHistory.length - ALERT_HISTORY_CAP)
    }
    activeAlertCodes = codes

    wsHandle.pushAlerts(alerts)
  }, 1000 / WATCHDOG_HZ)

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('[bridge] SIGINT received, shutting down...')
    clearInterval(watchdogInterval)
    wsHandle
      .close()
      .catch((err: unknown) => console.error('[bridge] error closing ws server', err))
      .finally(() => {
        link.disconnect()
        process.exit(0)
      })
  }

  process.on('SIGINT', shutdown)
}

main().catch((err: unknown) => {
  console.error('[bridge] fatal error', err)
  process.exit(1)
})
