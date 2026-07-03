import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWsClient, type WsLike, type WebSocketImplCtor, type WsStatus } from '../ws.js'
import type { Alert, MissionItem, TelemetryState } from '../types.js'

/** Fake WebSocket stand-in implementing the WsLike structural surface.
 * Every constructed instance is tracked on FakeWebSocket.instances so tests
 * can reach in and drive its lifecycle (open/receive/close) without a real
 * socket. */
class FakeWebSocket implements WsLike {
  static instances: FakeWebSocket[] = []
  readyState = 0 // CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  sent: string[] = []
  closeCalls = 0

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCalls++
    this.readyState = 3 // CLOSED
    this.onclose?.()
  }

  // --- test helpers (not part of WsLike) ---
  open(): void {
    this.readyState = 1 // OPEN
    this.onopen?.()
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }

  /** Simulates the remote end dropping the connection (server restart,
   * network blip) — distinct from close(), which is what the client calls. */
  simulateRemoteClose(): void {
    this.readyState = 3
    this.onclose?.()
  }

  lastSentId(): string {
    const last = this.sent[this.sent.length - 1]
    if (!last) throw new Error('nothing sent yet')
    return (JSON.parse(last) as { id: string }).id
  }
}

function fakeCtor(): WebSocketImplCtor {
  return FakeWebSocket as unknown as WebSocketImplCtor
}

function fixtureState(overrides: Partial<TelemetryState> = {}): TelemetryState {
  return {
    connected: true,
    lastHeartbeatMs: 1000,
    vehicleType: 'copter',
    armed: false,
    mode: 'GUIDED',
    position: { lat: 29.3375, lng: 47.9744, altM: 10, relAltM: 0 },
    attitude: { rollDeg: 0, pitchDeg: 0, yawDeg: 90 },
    speed: { groundMps: 0, airMps: 0, climbMps: 0 },
    battery: { voltageV: 12.6, remainingPct: 100 },
    gps: { fixType: 3, satellites: 10, hdop: 1.2 },
    home: { lat: 29.3375, lng: 47.9744, altM: 10 },
    statusTexts: [],
    ...overrides,
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWsClient', () => {
  it('resolves rpc() when a matching rpc_result arrives with ok:true', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const promise = client.rpc('arm')
    const id = socket.lastSentId()
    socket.receive({ type: 'rpc_result', id, ok: true })

    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects rpc() with Error(code) when the matching rpc_result has ok:false', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const promise = client.rpc('takeoff', { altM: 200 })
    const id = socket.lastSentId()
    socket.receive({ type: 'rpc_result', id, ok: false, code: 'BAD_PARAM', message: 'altM out of range' })

    await expect(promise).rejects.toThrow('BAD_PARAM')
  })

  it('resolves rpc<T>() with the rpc_result\'s data payload when present (Task 7/9 mission/AI rpcs)', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const promise = client.rpc<MissionItem[]>('surveyGrid', { polygon: [], altM: 30, spacingM: 25 })
    const id = socket.lastSentId()
    const items: MissionItem[] = [{ seq: 0, command: 'WAYPOINT', lat: 29.3, lng: 47.9, altM: 30 }]
    socket.receive({ type: 'rpc_result', id, ok: true, data: items })

    await expect(promise).resolves.toEqual(items)
  })

  it('fires onAlerts with the parsed alert array from an {type:"alerts"} frame', () => {
    const onAlerts = vi.fn()
    createWsClient('ws://test', { WebSocketImpl: fakeCtor(), onAlerts })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const alerts: Alert[] = [{ code: 'LINK_STALE', severity: 'critical', message: 'no heartbeat for 12s' }]
    socket.receive({ type: 'alerts', alerts })

    expect(onAlerts).toHaveBeenCalledTimes(1)
    expect(onAlerts).toHaveBeenCalledWith(alerts)
  })

  it('ignores an rpc_result whose id has no in-flight request', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    // Should not throw / crash the client.
    socket.receive({ type: 'rpc_result', id: 'unknown-id', ok: true })

    const promise = client.rpc('rtl')
    const id = socket.lastSentId()
    socket.receive({ type: 'rpc_result', id, ok: true })
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects rpc() immediately with NOT_CONNECTED when the socket is not open', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    // socket never opened — still readyState CONNECTING
    await expect(client.rpc('arm')).rejects.toThrow('NOT_CONNECTED')
  })

  it('calls onTelemetry with the parsed TelemetryState from a telemetry frame', () => {
    const onTelemetry = vi.fn()
    createWsClient('ws://test', { WebSocketImpl: fakeCtor(), onTelemetry })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const state = fixtureState({ armed: true, mode: 'RTL' })
    socket.receive({ type: 'telemetry', state })

    expect(onTelemetry).toHaveBeenCalledTimes(1)
    expect(onTelemetry).toHaveBeenCalledWith(state)
  })

  it('reports status transitions via onStatusChange (connecting -> open -> closed)', () => {
    const statuses: WsStatus[] = []
    createWsClient('ws://test', {
      WebSocketImpl: fakeCtor(),
      onStatusChange: (s) => statuses.push(s),
    })
    const socket = FakeWebSocket.instances[0]!
    expect(statuses).toEqual(['connecting'])
    socket.open()
    expect(statuses).toEqual(['connecting', 'open'])
    socket.simulateRemoteClose()
    expect(statuses).toEqual(['connecting', 'open', 'closed'])
  })

  it('schedules a reconnect 2s after the socket closes (fake timers)', () => {
    vi.useFakeTimers()
    try {
      createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
      expect(FakeWebSocket.instances).toHaveLength(1)

      FakeWebSocket.instances[0]!.simulateRemoteClose()
      expect(FakeWebSocket.instances).toHaveLength(1) // no new socket yet

      vi.advanceTimersByTime(1999)
      expect(FakeWebSocket.instances).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(2) // reconnected
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect after close() is called by the client', () => {
    vi.useFakeTimers()
    try {
      const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
      expect(FakeWebSocket.instances).toHaveLength(1)

      client.close()
      vi.advanceTimersByTime(10_000)
      expect(FakeWebSocket.instances).toHaveLength(1) // still just the one, no reconnect
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects in-flight rpcs when the connection drops', async () => {
    const client = createWsClient('ws://test', { WebSocketImpl: fakeCtor() })
    const socket = FakeWebSocket.instances[0]!
    socket.open()

    const promise = client.rpc('disarm')
    socket.simulateRemoteClose()

    await expect(promise).rejects.toThrow('CONNECTION_CLOSED')
  })
})
