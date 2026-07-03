import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Duplex } from 'node:stream'
import { minimal, MavLinkProtocolV2 } from 'node-mavlink'
import { VehicleLink, HeartbeatTimeoutError, ConnectAbortedError } from '../link.js'

// Mirrors link.ts's private SocketFactory shape (not exported) for typing the fake factory.
type SocketFactory = (opts: { host: string; port: number }) => Duplex

/** Fake TCP-socket stand-in: pipe()-able (readable side) for the reader chain,
 * writable (captures every mavSend() write) without echoing writes back to the
 * readable side. Data is only ever delivered via injectHeartbeat(). */
class FakeSocket extends Duplex {
  writes: Buffer[] = []
  _read(): void {
    // no-op — bytes are pushed manually via injectHeartbeat()
  }
  _write(chunk: unknown, _enc: string, cb: (err?: Error | null) => void): void {
    this.writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    cb()
  }
  injectHeartbeat(sysid = 1, compid = 1): void {
    this.push(buildHeartbeatBytes(sysid, compid))
  }
}

/** Real on-wire bytes for a HEARTBEAT, built via the library's own
 * serialize/header/payload/crc round-trip — same technique as registry.test.ts. */
function buildHeartbeatBytes(sysid: number, compid: number): Buffer {
  const hb = new minimal.Heartbeat()
  hb.type = minimal.MavType.GCS
  hb.autopilot = minimal.MavAutopilot.INVALID
  const protocol = new MavLinkProtocolV2(sysid, compid)
  return protocol.serialize(hb, 0)
}

describe('VehicleLink first-heartbeat timeout', () => {
  let sockets: FakeSocket[]
  let createSocket: ReturnType<typeof vi.fn<SocketFactory>>

  beforeEach(() => {
    vi.useFakeTimers()
    sockets = []
    createSocket = vi.fn<SocketFactory>(() => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects with HeartbeatTimeoutError if no HEARTBEAT arrives within 15s, destroys the socket, and does not reconnect', async () => {
    const link = new VehicleLink()
    const promise = link.connect({ createSocket })
    // swallow the rejection for assertion below; also assert on the raw promise
    const assertion = expect(promise).rejects.toBeInstanceOf(HeartbeatTimeoutError)

    await vi.advanceTimersByTimeAsync(15000)

    await assertion
    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(HeartbeatTimeoutError)
      expect((err as HeartbeatTimeoutError).code).toBe('HEARTBEAT_TIMEOUT')
    })

    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.destroyed).toBe(true)
    expect(link.connected).toBe(false)

    // no reconnect: advancing well past the 2s backoff must not open a second socket
    await vi.advanceTimersByTimeAsync(10000)
    expect(createSocket).toHaveBeenCalledTimes(1)
  })

  it('resolves when a HEARTBEAT arrives at 3s, clears the timer, and later silence does not reject', async () => {
    const link = new VehicleLink()
    const promise = link.connect({ createSocket })

    await vi.advanceTimersByTimeAsync(3000)
    sockets[0]!.injectHeartbeat()
    // let the reader pipeline (splitter -> parser) flush the injected bytes
    await vi.advanceTimersByTimeAsync(0)

    await expect(promise).resolves.toBeUndefined()
    expect(link.connected).toBe(true)

    // advance well past the original 15s window with no further heartbeats —
    // the (already-cleared) first-heartbeat timer must not fire/reject anything.
    await vi.advanceTimersByTimeAsync(20000)
    expect(link.connected).toBe(true)

    link.disconnect()
  })

  it('disconnect() before the timeout clears the timer and rejects with ConnectAbortedError', async () => {
    const link = new VehicleLink()
    const promise = link.connect({ createSocket })

    await vi.advanceTimersByTimeAsync(1000)
    link.disconnect()

    await expect(promise).rejects.toBeInstanceOf(ConnectAbortedError)
    await promise.catch((err: unknown) => {
      expect((err as ConnectAbortedError).code).toBe('DISCONNECTED')
    })

    // advancing past where the 15s heartbeat timeout would have fired must not
    // throw an unhandled rejection or double-reject — the timer was cleared.
    await vi.advanceTimersByTimeAsync(15000)
    expect(createSocket).toHaveBeenCalledTimes(1)
  })
})
