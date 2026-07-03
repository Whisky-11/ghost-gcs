// WS server: broadcasts TelemetryState @CONFIG.telemetryHz (send-latest-snapshot
// each tick, diff-agnostic — no delta tracking) to every connected client + once
// immediately on connect, and routes validated `rpc` requests to `commands`.
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { CommandError } from '../commands/commands.js'
import { CONFIG } from '../config.js'
import type { TelemetryState } from '../state/telemetry.js'
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
}

export interface StartWsServerOptions {
  port: number
  getState(): TelemetryState
  commands: WsCommands
  /** Override broadcast rate for tests; defaults to CONFIG.telemetryHz. */
  telemetryHz?: number
}

export interface WsServerHandle {
  close(): Promise<void>
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
      handleClientMessage(socket, raw, opts.commands).catch((err: unknown) => {
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

async function handleClientMessage(socket: WebSocket, raw: RawData, commands: WsCommands): Promise<void> {
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
    await dispatch(commands, req)
    sendResult(socket, { type: 'rpc_result', id: req.id, ok: true })
  } catch (err) {
    if (err instanceof CommandError) {
      sendResult(socket, { type: 'rpc_result', id: req.id, ok: false, code: err.code, message: err.message })
    } else {
      console.error('[ws] rpc handler threw an unexpected error', err)
      const message = err instanceof Error ? err.message : String(err)
      sendResult(socket, { type: 'rpc_result', id: req.id, ok: false, code: 'INTERNAL', message })
    }
  }
}

function dispatch(commands: WsCommands, req: RpcRequest): Promise<void> {
  switch (req.method) {
    case 'arm':
      return commands.arm()
    case 'disarm':
      return commands.disarm()
    case 'setMode':
      // superRefine in schema.ts guarantees params.mode is a string once the
      // request has passed validation for method==='setMode'.
      return commands.setMode(req.params!.mode!)
    case 'takeoff':
      // Same guarantee for params.altM on method==='takeoff'.
      return commands.takeoff(req.params!.altM!)
    case 'rtl':
      return commands.rtl()
  }
}

function sendResult(socket: WebSocket, result: RpcResult): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(result))
}
