'use client'

// Thin React wrapper over lib/ws.ts's node-testable createWsClient core.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createWsClient, type WsClient, type WsStatus } from '@/lib/ws'
import type { RpcMethod, RpcParams, TelemetryState } from '@/lib/types'

// CONFIG.wsPort (bridge/src/config.ts) — the bridge always listens on
// localhost:8090 per the plan's Global Constraints; overridable for
// non-local deployments via NEXT_PUBLIC_BRIDGE_WS_URL.
const DEFAULT_WS_URL = 'ws://localhost:8090'

export interface UseTelemetryResult {
  state: TelemetryState | null
  wsStatus: WsStatus
  rpc(method: RpcMethod, params?: RpcParams): Promise<void>
}

export function useTelemetry(): UseTelemetryResult {
  const [state, setState] = useState<TelemetryState | null>(null)
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting')
  const clientRef = useRef<WsClient | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_BRIDGE_WS_URL ?? DEFAULT_WS_URL
    const client = createWsClient(url, {
      onTelemetry: setState,
      onStatusChange: setWsStatus,
    })
    clientRef.current = client
    return () => {
      client.close()
      clientRef.current = null
    }
  }, [])

  const rpc = useCallback((method: RpcMethod, params?: RpcParams): Promise<void> => {
    const client = clientRef.current
    if (!client) return Promise.reject(new Error('NOT_CONNECTED'))
    return client.rpc(method, params)
  }, [])

  return { state, wsStatus, rpc }
}
