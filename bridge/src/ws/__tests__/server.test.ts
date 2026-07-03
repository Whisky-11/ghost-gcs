import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import { startWsServer, type WsCommands, type WsServerHandle } from '../server.js'
import { CommandError } from '../../commands/commands.js'
import { initialState, type TelemetryState } from '../../state/telemetry.js'

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
  let state: TelemetryState
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    port = randomPort()
    commands = new FakeCommands()
    state = initialState()
    // Server intentionally logs on malformed/rejected input (per the brief) —
    // spy + silence so expected-path test output stays clean.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    handle = startWsServer({ port, getState: () => state, commands, telemetryHz: 5 })
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
})
