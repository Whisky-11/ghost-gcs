'use client'

// Thin React wrapper over lib/ws.ts's node-testable createWsClient core.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createWsClient, type WsClient, type WsStatus } from '@/lib/ws'
import type { Alert, RpcMethod, RpcParams, TelemetryState } from '@/lib/types'

// CONFIG.wsPort (bridge/src/config.ts) — the bridge always listens on
// localhost:8090 per the plan's Global Constraints; overridable for
// non-local deployments via NEXT_PUBLIC_BRIDGE_WS_URL.
const DEFAULT_WS_URL = 'ws://localhost:8090'

export interface UseTelemetryResult {
  state: TelemetryState | null
  wsStatus: WsStatus
  /** Task 7/8: the bridge's most recently pushed watchdog-alert set (the
   * bridge already dedupes by code-set change — see ws/server.ts's
   * pushAlerts). Empty until the first push arrives. */
  alerts: Alert[]
  /** T = void for rpcs that never carry a `data` payload (arm/disarm/...);
   * pass an explicit T (e.g. rpc<MissionItem[]>('surveyGrid', ...)) for the
   * mission/AI rpcs that do. */
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
}

export function useTelemetry(): UseTelemetryResult {
  const [state, setState] = useState<TelemetryState | null>(null)
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const [alerts, setAlerts] = useState<Alert[]>([])
  const clientRef = useRef<WsClient | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BRIDGE_WS_URL ?? DEFAULT_WS_URL
    const client = createWsClient(url, {
      onTelemetry: setState,
      onStatusChange: setWsStatus,
      onAlerts: setAlerts,
    })
    clientRef.current = client
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [])

  const rpc = useCallback(<T = void,>(method: RpcMethod, params?: RpcParams): Promise<T> => {
    const client = clientRef.current
    if (!client) return Promise.reject(new Error('NOT_CONNECTED'))
    return client.rpc<T>(method, params)
  }, [])

  return { state, wsStatus, alerts, rpc }
}
