// Node-testable core of the bridge<->app WebSocket client. Talks the wire
// protocol mirrored in ./types.ts (verbatim copy of bridge/src/ws/schema.ts,
// Task 6 — BINDING). Kept free of React so it can be exercised directly from
// vitest with an injected fake WebSocket implementation (WebSocketImpl) —
// useTelemetry.ts is the thin React wrapper around this.
import type { Alert, RpcMethod, RpcParams, RpcRequest, ServerMessage, TelemetryState } from './types'

export type WsStatus = 'connecting' | 'open' | 'closed'

// Minimal structural subset of the standard (browser + `ws` package)
// WebSocket surface this module depends on — lets tests inject a fake
// without importing a real WebSocket implementation.
export interface WsLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(): void
}

export type WebSocketImplCtor = new (url: string) => WsLike

// Standard WebSocket readyState value for "open" — used instead of the
// constructor's static `.OPEN` so a bare-bones fake WsLike in tests doesn't
// need to define it.
const OPEN_READY_STATE = 1

export interface CreateWsClientOptions {
  onTelemetry?: (state: TelemetryState) => void
  onStatusChange?: (status: WsStatus) => void
  /** Task 7/8: the bridge's watchdog-alert push ({type:'alerts'}). Fired
   * with the full current alert list every time the bridge broadcasts one
   * (the bridge itself dedupes by code-set change — see ws/server.ts's
   * pushAlerts — so this fires once per real change, not once per tick). */
  onAlerts?: (alerts: Alert[]) => void
  /** Injectable WebSocket constructor — defaults to the ambient global
   * `WebSocket` (browser runtime). Tests pass a fake here. */
  WebSocketImpl?: WebSocketImplCtor
  /** Auto-reconnect delay in ms after the socket closes. Defaults to 2000
   * per the brief. */
  reconnectMs?: number
}

export interface WsClient {
  /** Sends an rpc request and resolves with the rpc_result's `data` payload
   * (Task 7 — mission/AI RPCs like surveyGrid/downloadMission/aiDraftMission
   * ride data back this way; T = void for methods that never send one, e.g.
   * arm/disarm/uploadMission) when the matching rpc_result arrives with
   * ok:true, or rejects with `Error(code)` when ok:false. Rejects
   * immediately (without sending) if the socket isn't currently open. */
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
  /** Stops the client and cancels any pending auto-reconnect. Idempotent. */
  close(): void
}

interface PendingRpc {
  resolve: (data?: unknown) => void
  reject: (err: Error) => void
}

export function createWsClient(url: string, options: CreateWsClientOptions = {}): WsClient {
  const WebSocketImpl =
    options.WebSocketImpl ?? ((globalThis as { WebSocket?: WebSocketImplCtor }).WebSocket as WebSocketImplCtor)
  if (!WebSocketImpl) {
    throw new Error('createWsClient: no WebSocketImpl provided and no global WebSocket available')
  }
  const reconnectMs = options.reconnectMs ?? 2000

  let socket: WsLike | null = null
  let closedByUser = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, PendingRpc>()

  function setStatus(status: WsStatus): void {
    options.onStatusChange?.(status)
  }

  function rejectAllPending(reason: string): void {
    for (const p of pending.values()) {
      p.reject(new Error(reason))
    }
    pending.clear()
  }

  function scheduleReconnect(): void {
    if (closedByUser || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectMs)
  }

  function connect(): void {
    setStatus('connecting')
    const ws = new WebSocketImpl(url)
    socket = ws

    ws.onopen = () => {
      setStatus('open')
    }

    ws.onmessage = (event) => {
      let msg: ServerMessage
      try {
        const raw = typeof event.data === 'string' ? event.data : String(event.data)
        msg = JSON.parse(raw) as ServerMessage
      } catch {
        return // malformed frame — ignore, matches the bridge's own tolerant parsing stance
      }
      if (msg.type === 'telemetry') {
        options.onTelemetry?.(msg.state)
        return
      }
      if (msg.type === 'alerts') {
        options.onAlerts?.(msg.alerts)
        return
      }
      if (msg.type === 'rpc_result') {
        const p = pending.get(msg.id)
        if (!p) return // no matching in-flight request (stale/duplicate reply) — ignore
        pending.delete(msg.id)
        if (msg.ok) {
          p.resolve(msg.data)
        } else {
          p.reject(new Error(msg.code))
        }
      }
    }

    ws.onclose = () => {
      socket = null
      setStatus('closed')
      rejectAllPending('CONNECTION_CLOSED')
      scheduleReconnect()
    }

    // Browsers/`ws` fire both onerror and onclose on a failed connection —
    // onclose (above) owns reconnect scheduling + pending-rpc cleanup so we
    // don't double-schedule here.
    ws.onerror = () => {}
  }

  connect()

  return {
    rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (!socket || socket.readyState !== OPEN_READY_STATE) {
          reject(new Error('NOT_CONNECTED'))
          return
        }
        const id = crypto.randomUUID()
        pending.set(id, { resolve: (data) => resolve(data as T), reject })
        const req: RpcRequest = params !== undefined ? { type: 'rpc', id, method, params } : { type: 'rpc', id, method }
        socket.send(JSON.stringify(req))
      })
    },
    close() {
      closedByUser = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      rejectAllPending('CLOSED_BY_CLIENT')
      socket?.close()
      socket = null
    },
  }
}
