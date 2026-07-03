// Bridge daemon main: VehicleLink -> reduce() -> TelemetryState -> WS broadcast,
// plus validated RPC -> makeCommands. See docs/superpowers/plans/2026-07-03-p0-foundations.md.
import { CONFIG } from './config.js'
import { VehicleLink } from './mavlink/link.js'
import { makeCommands } from './commands/commands.js'
import { reduce, initialState, type TelemetryState } from './state/telemetry.js'
import { startWsServer } from './ws/server.js'

const CONNECT_RETRY_MS = 5000

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

  const wsHandle = startWsServer({
    port: CONFIG.wsPort,
    getState: () => state,
    commands,
  })
  console.log(`[bridge] ws server listening on ws://localhost:${CONFIG.wsPort}`)

  let shuttingDown = false
  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('[bridge] SIGINT received, shutting down...')
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
