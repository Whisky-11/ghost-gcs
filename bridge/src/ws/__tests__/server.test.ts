import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { startWsServer, type WsAi, type WsCommands, type WsMissions, type WsServerHandle } from '../server.js'
import { CommandError } from '../../commands/commands.js'
import { ClaudeError, type ClaudeHeadless } from '../../ai/claude.js'
import { MissionError } from '../../missions/protocol.js'
import type { MissionItem } from '../../missions/model.js'
import { initialState, type TelemetryState } from '../../state/telemetry.js'
import type { Alert } from '../../watchdog/rules.js'

/** Fake commands: records every call and lets tests script per-method
 * resolve/reject behavior — no real VehicleLink, no real MAVLink. */
class FakeCommands implements WsCommands {
  calls: Array<{ method: string; args: unknown[] }> = []
  armImpl: () => Promise<void> = () => Promise.resolve()

  async arm(): Promise<void> {
    this.calls.push({ method: 'arm', args: [] })
    return this.armImpl()
  }
  async disarm(): Promise<void> {
    this.calls.push({ method: 'disarm', args: [] })
  }
  async setMode(mode: string): Promise<void> {
    this.calls.push({ method: 'setMode', args: [mode] })
  }
  async takeoff(altM: number): Promise<void> {
    this.calls.push({ method: 'takeoff', args: [altM] })
  }
  async rtl(): Promise<void> {
    this.calls.push({ method: 'rtl', args: [] })
  }
  async startMission(): Promise<void> {
    this.calls.push({ method: 'startMission', args: [] })
  }
}

/** Fake mission protocol: records every call, lets tests script per-method
 * resolve/reject behavior — no real VehicleLink, no real MAVLink. */
class FakeMissions implements WsMissions {
  calls: Array<{ method: string; args: unknown[] }> = []
  uploadImpl: () => Promise<void> = () => Promise.resolve()
  downloadImpl: () => Promise<MissionItem[]> = () => Promise.resolve([])
  clearImpl: () => Promise<void> = () => Promise.resolve()

  async upload(items: MissionItem[]): Promise<void> {
    this.calls.push({ method: 'upload', args: [items] })
    return this.uploadImpl()
  }
  async download(): Promise<MissionItem[]> {
    this.calls.push({ method: 'download', args: [] })
    return this.downloadImpl()
  }
  async clear(): Promise<void> {
    this.calls.push({ method: 'clear', args: [] })
    return this.clearImpl()
  }
}

/** Fake ClaudeHeadless: records every prompt, lets tests script per-call
 * resolve/reject behavior — the real `claude` CLI is never invoked. */
class FakeClaude implements ClaudeHeadless {
  askCalls: string[] = []
  askJsonCalls: string[] = []
  askImpl: (prompt: string) => Promise<string> = () => Promise.resolve('narration text')
  askJsonImpl: (prompt: string) => Promise<unknown> = () =>
    Promise.resolve({ items: [], notes: 'no geometry drawn' })

  async ask(prompt: string): Promise<string> {
    this.askCalls.push(prompt)
    return this.askImpl(prompt)
  }
  async askJson<T>(prompt: string, schema: z.ZodType<T>): Promise<T> {
    this.askJsonCalls.push(prompt)
    const value = await this.askJsonImpl(prompt)
    return schema.parse(value)
  }
}

function randomPort(): number {
  // High, unlikely-to-collide range — "ephemeral" in the sense of per-test,
  // not OS-assigned (port:0); the interface exposes no address getter so the
  // test picks its own port per the brief's exact `startWsServer` signature.
  return 20000 + Math.floor(Math.random() * 20000)
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => resolve(JSON.parse(data.toString())))
  })
}

function collectMessages(ws: WebSocket, ms: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const msgs: unknown[] = []
    const onMessage = (data: Buffer) => msgs.push(JSON.parse(data.toString()))
    ws.on('message', onMessage)
    setTimeout(() => {
      ws.off('message', onMessage)
      resolve(msgs)
    }, ms)
  })
}

describe('startWsServer', () => {
  let handle: WsServerHandle
  let port: number
  let commands: FakeCommands
  let missions: FakeMissions
  let claude: FakeClaude
  let state: TelemetryState
  let activeAlerts: Alert[]
  let flightSamples: TelemetryState[]
  let alertHistory: Alert[]
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    port = randomPort()
    commands = new FakeCommands()
    missions = new FakeMissions()
    claude = new FakeClaude()
    state = initialState()
    activeAlerts = []
    flightSamples = []
    alertHistory = []
    const ai: WsAi = {
      claude,
      getState: () => state,
      getActiveAlerts: () => activeAlerts,
      getFlightSamples: () => flightSamples,
      getAlertHistory: () => alertHistory,
    }
    // Server intentionally logs on malformed/rejected input (per the brief) —
    // spy + silence so expected-path test output stays clean.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    handle = startWsServer({ port, getState: () => state, commands, missions, ai, telemetryHz: 5 })
  })

  afterEach(async () => {
    await handle.close()
    errorSpy.mockRestore()
  })

  it('sends a telemetry frame immediately on connect', async () => {
    const ws = await connectClient(port)
    const msg = await nextMessage(ws)
    expect(msg).toEqual({ type: 'telemetry', state })
    ws.close()
  })

  it('broadcasts at least 2 ticks within 600ms at 5Hz (real timers, generous window)', async () => {
    const ws = await connectClient(port)
    const msgs = await collectMessages(ws, 650)
    // immediate-on-connect frame + interval ticks every 200ms (5Hz) — expect
    // the immediate frame plus at least 2 ticks inside the window.
    expect(msgs.length).toBeGreaterThanOrEqual(3)
    for (const msg of msgs) expect(msg).toEqual({ type: 'telemetry', state })
    ws.close()
  })

  it('routes a valid arm rpc to commands and replies ok:true', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws) // discard immediate telemetry frame
    ws.send(JSON.stringify({ type: 'rpc', id: 'abc', method: 'arm' }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'abc', ok: true })
    expect(commands.calls).toEqual([{ method: 'arm', args: [] }])
    ws.close()
  })

  it('routes setMode/takeoff params through to commands', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: '1', method: 'setMode', params: { mode: 'GUIDED' } }))
    expect(await nextMessage(ws)).toEqual({ type: 'rpc_result', id: '1', ok: true })
    ws.send(JSON.stringify({ type: 'rpc', id: '2', method: 'takeoff', params: { altM: 20 } }))
    expect(await nextMessage(ws)).toEqual({ type: 'rpc_result', id: '2', ok: true })
    expect(commands.calls).toEqual([
      { method: 'setMode', args: ['GUIDED'] },
      { method: 'takeoff', args: [20] },
    ])
    ws.close()
  })

  it('surfaces a CommandError code as rpc_result ok:false', async () => {
    commands.armImpl = () => Promise.reject(new CommandError('ALREADY_ARMED'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'x1', method: 'arm' }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'x1', ok: false, code: 'ALREADY_ARMED' })
    ws.close()
  })

  it('maps an unexpected thrown error to code INTERNAL', async () => {
    commands.armImpl = () => Promise.reject(new Error('boom'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'x2', method: 'arm' }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'x2', ok: false, code: 'INTERNAL' })
    ws.close()
  })

  it('does not crash on malformed JSON and still serves a subsequent rpc', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send('not json{{{')
    ws.send(JSON.stringify({ type: 'rpc', id: 'ok1', method: 'arm' }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'ok1', ok: true })
    ws.close()
  })

  it('rejects an rpc with an unknown method via zod, replying BAD_REQUEST when id is recoverable', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'bad1', method: 'selfDestruct' }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'bad1', ok: false, code: 'BAD_REQUEST', message: 'invalid rpc request' })
    expect(commands.calls).toHaveLength(0)
    ws.close()
  })

  it('ignores (does not reply, does not crash) a schema-invalid message with no recoverable id', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', method: 'arm' })) // no id at all
    ws.send(JSON.stringify({ type: 'rpc', id: 'after', method: 'arm' }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'after', ok: true })
    ws.close()
  })

  // --- Task 7: mission RPCs ------------------------------------------------

  const sampleMission: MissionItem[] = [
    { seq: 0, command: 'TAKEOFF', lat: 29.3, lng: 47.9, altM: 20 },
    { seq: 1, command: 'WAYPOINT', lat: 29.3001, lng: 47.9001, altM: 20 },
    { seq: 2, command: 'RTL', lat: 0, lng: 0, altM: 0 },
  ]

  it('routes uploadMission to the fake mission protocol and replies ok:true', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'u1', method: 'uploadMission', params: { mission: { items: sampleMission } } }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'u1', ok: true })
    expect(missions.calls).toEqual([{ method: 'upload', args: [sampleMission] }])
    expect(commands.calls).toHaveLength(0)
    ws.close()
  })

  it('rejects uploadMission with a semantically invalid mission (validateMission) without calling missions.upload', async () => {
    const invalidMission: MissionItem[] = [{ seq: 0, command: 'WAYPOINT', lat: 0, lng: 0, altM: 500 }] // altM out of bounds
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'u2', method: 'uploadMission', params: { mission: { items: invalidMission } } }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'u2', ok: false, code: 'BAD_MISSION' })
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('rejects uploadMission with empty items via zod, replying BAD_REQUEST', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'u3', method: 'uploadMission', params: { mission: { items: [] } } }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'u3', ok: false, code: 'BAD_REQUEST' })
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('routes startMission to commands.startMission', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 's1', method: 'startMission' }))
    expect(await nextMessage(ws)).toEqual({ type: 'rpc_result', id: 's1', ok: true })
    expect(commands.calls).toEqual([{ method: 'startMission', args: [] }])
    ws.close()
  })

  it('routes clearMission to missions.clear', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'c1', method: 'clearMission' }))
    expect(await nextMessage(ws)).toEqual({ type: 'rpc_result', id: 'c1', ok: true })
    expect(missions.calls).toEqual([{ method: 'clear', args: [] }])
    ws.close()
  })

  it('routes downloadMission to missions.download and returns items as data', async () => {
    missions.downloadImpl = () => Promise.resolve(sampleMission)
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'd1', method: 'downloadMission' }))
    const reply = await nextMessage(ws)
    expect(reply).toEqual({ type: 'rpc_result', id: 'd1', ok: true, data: sampleMission })
    ws.close()
  })

  it('surfaces a MissionError code (e.g. from missions.upload) as rpc_result ok:false', async () => {
    missions.uploadImpl = () => Promise.reject(new MissionError('MISSION_REJECTED'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'u4', method: 'uploadMission', params: { mission: { items: sampleMission } } }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'u4', ok: false, code: 'MISSION_REJECTED' })
    ws.close()
  })

  // --- Task 7: pure surveyGrid RPC -----------------------------------------

  it('routes surveyGrid to the pure generator and returns waypoints as data', async () => {
    const polygon = [
      { lat: 29.3, lng: 47.9 },
      { lat: 29.301, lng: 47.9 },
      { lat: 29.301, lng: 47.901 },
      { lat: 29.3, lng: 47.901 },
    ]
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(
      JSON.stringify({
        type: 'rpc',
        id: 'g1',
        method: 'surveyGrid',
        params: { polygon, altM: 30, spacingM: 20 },
      }),
    )
    const reply = (await nextMessage(ws)) as { type: string; id: string; ok: boolean; data: unknown[] }
    expect(reply.ok).toBe(true)
    expect(Array.isArray(reply.data)).toBe(true)
    expect(reply.data.length).toBeGreaterThan(0)
    // Pure — never touches commands or missions.
    expect(commands.calls).toHaveLength(0)
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('rejects surveyGrid with fewer than 3 polygon points via zod', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(
      JSON.stringify({
        type: 'rpc',
        id: 'g2',
        method: 'surveyGrid',
        params: { polygon: [{ lat: 1, lng: 1 }], altM: 30, spacingM: 20 },
      }),
    )
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'g2', ok: false, code: 'BAD_REQUEST' })
    ws.close()
  })

  // --- Task 7: AI RPCs + the AI-never-commands invariant -------------------

  it('aiDraftMission returns draft data via the injected fake ClaudeHeadless and NEVER touches commands/missions/link', async () => {
    claude.askJsonImpl = () =>
      Promise.resolve({
        items: [{ seq: 0, command: 'WAYPOINT', lat: 29.3, lng: 47.9, altM: 30 }],
        notes: 'single-leg draft',
      })
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(
      JSON.stringify({
        type: 'rpc',
        id: 'a1',
        method: 'aiDraftMission',
        params: { request: 'survey the field', geometry: [{ lat: 29.3, lng: 47.9 }] },
      }),
    )
    const reply = (await nextMessage(ws)) as { ok: boolean; data: { items: unknown[]; notes: string } }
    expect(reply.ok).toBe(true)
    expect(reply.data.notes).toBe('single-leg draft')
    expect(reply.data.items).toHaveLength(1)
    expect(claude.askJsonCalls).toHaveLength(1)
    // The AI-never-commands invariant (spec safety invariant 1): drafting a
    // mission must NEVER call a command mutator or mission upload/clear —
    // it only ever produces DATA for a human to review before an explicit,
    // separate uploadMission RPC.
    expect(commands.calls).toHaveLength(0)
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('aiNarrate returns text via ClaudeHeadless.ask and touches no command/mission mutator', async () => {
    claude.askImpl = () => Promise.resolve('battery is nominal, no action needed')
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'a2', method: 'aiNarrate', params: { question: 'how is the battery?' } }))
    const reply = (await nextMessage(ws)) as { ok: boolean; data: { text: string } }
    expect(reply.ok).toBe(true)
    expect(reply.data.text).toBe('battery is nominal, no action needed')
    expect(claude.askCalls).toHaveLength(1)
    expect(claude.askCalls[0]).toContain('how is the battery?')
    expect(commands.calls).toHaveLength(0)
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('aiNarrate resolves an alertCode against getActiveAlerts and includes it in the prompt', async () => {
    activeAlerts = [{ code: 'BATTERY_LOW', severity: 'critical', message: 'battery at 10%' }]
    claude.askImpl = () => Promise.resolve('battery critically low, consider RTL soon')
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'a3', method: 'aiNarrate', params: { alertCode: 'BATTERY_LOW' } }))
    const reply = (await nextMessage(ws)) as { ok: boolean; data: { text: string } }
    expect(reply.ok).toBe(true)
    expect(claude.askCalls[0]).toContain('BATTERY_LOW')
    ws.close()
  })

  it('aiDebrief computes flight stats from getFlightSamples/getAlertHistory and returns text+stats', async () => {
    flightSamples = [
      { ...initialState(), lastHeartbeatMs: 0, mode: 'AUTO' },
      { ...initialState(), lastHeartbeatMs: 5_000, mode: 'AUTO' },
    ]
    alertHistory = [{ code: 'GPS_DEGRADED', severity: 'warn', message: 'GPS fix type 2 while armed' }]
    claude.askImpl = () => Promise.resolve('uneventful short flight')
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'a4', method: 'aiDebrief' }))
    const reply = (await nextMessage(ws)) as { ok: boolean; data: { text: string; stats: { durationSec: number } } }
    expect(reply.ok).toBe(true)
    expect(reply.data.text).toBe('uneventful short flight')
    expect(reply.data.stats.durationSec).toBe(5)
    expect(commands.calls).toHaveLength(0)
    expect(missions.calls).toHaveLength(0)
    ws.close()
  })

  it('maps ClaudeError TIMEOUT to rpc_result ok:false code AI_TIMEOUT without crashing the daemon', async () => {
    claude.askImpl = () => Promise.reject(new ClaudeError('TIMEOUT'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'e1', method: 'aiNarrate', params: { question: 'status?' } }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'e1', ok: false, code: 'AI_TIMEOUT' })
    // Server survives — a subsequent rpc on the same connection still works.
    ws.send(JSON.stringify({ type: 'rpc', id: 'e1b', method: 'arm' }))
    expect(await nextMessage(ws)).toEqual({ type: 'rpc_result', id: 'e1b', ok: true })
    ws.close()
  })

  it('maps ClaudeError CLI_ERROR to rpc_result ok:false code AI_UNAVAILABLE', async () => {
    claude.askImpl = () => Promise.reject(new ClaudeError('CLI_ERROR'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'e2', method: 'aiNarrate' }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'e2', ok: false, code: 'AI_UNAVAILABLE' })
    ws.close()
  })

  it('maps ClaudeError VALIDATION (askJson) to rpc_result ok:false code AI_VALIDATION', async () => {
    claude.askJsonImpl = () => Promise.reject(new ClaudeError('VALIDATION'))
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'e3', method: 'aiDraftMission', params: { request: 'x' } }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'e3', ok: false, code: 'AI_VALIDATION' })
    ws.close()
  })

  it('rejects aiDraftMission missing params.request via zod, replying BAD_REQUEST', async () => {
    const ws = await connectClient(port)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'rpc', id: 'e4', method: 'aiDraftMission', params: {} }))
    const reply = await nextMessage(ws)
    expect(reply).toMatchObject({ type: 'rpc_result', id: 'e4', ok: false, code: 'BAD_REQUEST' })
    expect(claude.askJsonCalls).toHaveLength(0)
    ws.close()
  })

  // --- Task 7: pushAlerts (server->client push, dedup by code) -------------

  describe('pushAlerts', () => {
    it('broadcasts {type:"alerts", alerts} to connected clients', async () => {
      const ws = await connectClient(port)
      await nextMessage(ws) // discard immediate telemetry frame
      const alerts: Alert[] = [{ code: 'BATTERY_LOW', severity: 'warn', message: 'battery at 20%' }]
      handle.pushAlerts(alerts)
      const msg = await nextMessage(ws)
      expect(msg).toEqual({ type: 'alerts', alerts })
      ws.close()
    })

    it('does NOT re-broadcast when the alert code set is unchanged (dedup by code)', async () => {
      const ws = await connectClient(port)
      await nextMessage(ws)
      handle.pushAlerts([{ code: 'LINK_STALE', severity: 'warn', message: 'no heartbeat for 3.1s' }])
      await nextMessage(ws) // first broadcast
      // Same code, escalated message/severity — must NOT trigger a second
      // broadcast (this is exactly what stops a persisting LINK_STALE from
      // spamming a push every tick as its age-in-message grows).
      handle.pushAlerts([{ code: 'LINK_STALE', severity: 'critical', message: 'no heartbeat for 11.0s' }])
      const msgs = await collectMessages(ws, 300)
      // Only telemetry ticks should have arrived in this window, no 'alerts'.
      expect(msgs.every((m) => (m as { type: string }).type === 'telemetry')).toBe(true)
      ws.close()
    })

    it('re-broadcasts when the alert code set changes (a code clears)', async () => {
      const ws = await connectClient(port)
      await nextMessage(ws)
      handle.pushAlerts([{ code: 'GPS_DEGRADED', severity: 'warn', message: 'GPS fix type 2 while armed' }])
      await nextMessage(ws)
      handle.pushAlerts([]) // GPS_DEGRADED cleared
      const msg = await nextMessage(ws)
      expect(msg).toEqual({ type: 'alerts', alerts: [] })
      ws.close()
    })

    it('does not throw when there are no connected clients', () => {
      expect(() => handle.pushAlerts([{ code: 'X', severity: 'info', message: 'y' }])).not.toThrow()
    })
  })
})
