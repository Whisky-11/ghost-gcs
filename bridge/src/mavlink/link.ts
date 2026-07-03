import { EventEmitter } from 'node:events'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import {
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  MavLinkProtocolV2,
  send as mavSend,
  minimal,
  common,
  type MavLinkData,
  type MavLinkPacket,
} from 'node-mavlink'
import { CONFIG } from '../config.js'
import { decode } from './registry.js'

// Our own GCS identity on the MAVLink network (QGroundControl-style default).
const GCS_SYSID = 254
const GCS_COMPID = 1

const HEARTBEAT_INTERVAL_MS = 1000
const RECONNECT_BACKOFF_MS = 2000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15000

/** Thrown by connect() when the TCP socket opens but no HEARTBEAT arrives within
 * the configured window (default 15s) — e.g. a silent peer or the wrong service
 * bound on the port. The socket is destroyed and auto-reconnect is suppressed
 * (same semantics as an explicit disconnect()) before this rejects. */
export class HeartbeatTimeoutError extends Error {
  readonly code = 'HEARTBEAT_TIMEOUT' as const
  constructor(timeoutMs: number) {
    super(`VehicleLink: no HEARTBEAT received within ${timeoutMs}ms`)
    this.name = 'HeartbeatTimeoutError'
  }
}

/** Thrown when disconnect() is called while a connect() promise is still
 * pending (i.e. before the first HEARTBEAT arrived or the timeout expired). */
export class ConnectAbortedError extends Error {
  readonly code = 'DISCONNECTED' as const
  constructor() {
    super('VehicleLink: disconnect() called before first HEARTBEAT')
    this.name = 'ConnectAbortedError'
  }
}

/** Minimal seam so tests can inject a fake socket instead of a real TCP
 * connection. Must behave like node:net's Socket for our purposes: a Duplex
 * stream (pipe()-able for the reader chain, writable for mavSend()). */
type SocketFactory = (opts: { host: string; port: number }) => Duplex

const defaultCreateSocket: SocketFactory = (opts) => netConnect(opts)

// Telemetry stream rates requested via MAV_CMD_SET_MESSAGE_INTERVAL once connected.
// Pinned against live SITL in the Task 3 spike (see task-3-report.md).
const STREAM_RATES: ReadonlyArray<{ msgId: number; hz: number }> = [
  { msgId: common.SysStatus.MSG_ID, hz: 1 }, // 1 SYS_STATUS
  { msgId: common.GpsRawInt.MSG_ID, hz: 1 }, // 24 GPS_RAW_INT
  { msgId: common.Attitude.MSG_ID, hz: 8 }, // 30 ATTITUDE
  { msgId: common.GlobalPositionInt.MSG_ID, hz: 4 }, // 33 GLOBAL_POSITION_INT
  { msgId: common.VfrHud.MSG_ID, hz: 4 }, // 74 VFR_HUD
]

export class VehicleLink extends EventEmitter {
  private socket: Duplex | null = null
  private readonly protocol = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private firstHeartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private explicitlyDisconnected = true
  private _connected = false
  private targetSysid: number | null = null
  private targetCompid: number | null = null
  private firstConnectResolve: (() => void) | null = null
  private firstConnectReject: ((err: Error) => void) | null = null
  private heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS
  private createSocket: SocketFactory = defaultCreateSocket
  private opts: { host: string; port: number } = { host: CONFIG.sitlTcp.host, port: CONFIG.sitlTcp.port }

  get connected(): boolean {
    return this._connected
  }

  /** Resolves on the first HEARTBEAT received from the vehicle. Rejects with
   * HeartbeatTimeoutError if no HEARTBEAT arrives within `heartbeatTimeoutMs`
   * (default 15s) of the socket opening — e.g. TCP connects but the peer is
   * silent or the wrong service is bound on the port. Rejects with
   * ConnectAbortedError if disconnect() is called first. Transient TCP-level
   * connection failures (ECONNREFUSED etc.) are retried via the 2s reconnect
   * backoff and surfaced through the 'raw-error' event instead — they don't
   * by themselves reject this promise; only the heartbeat timeout does. */
  connect(opts?: {
    host?: string
    port?: number
    heartbeatTimeoutMs?: number
    createSocket?: SocketFactory
  }): Promise<void> {
    this.explicitlyDisconnected = false
    if (opts?.host) this.opts.host = opts.host
    if (opts?.port) this.opts.port = opts.port
    if (opts?.heartbeatTimeoutMs !== undefined) this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs
    if (opts?.createSocket) this.createSocket = opts.createSocket
    return new Promise((resolve, reject) => {
      this.firstConnectResolve = resolve
      this.firstConnectReject = reject
      this.armHeartbeatTimeout()
      this.openSocket()
    })
  }

  disconnect(): void {
    this.explicitlyDisconnected = true
    this.clearHeartbeatTimeout()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    const wasConnected = this._connected
    this._connected = false
    this.targetSysid = null
    this.targetCompid = null
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    if (wasConnected) this.emit('disconnected')
    this.rejectPendingConnect(new ConnectAbortedError())
    this.removeAllListeners()
  }

  async send(msg: MavLinkData): Promise<void> {
    if (!this.socket) throw new Error('VehicleLink: not connected')
    await mavSend(this.socket, msg, this.protocol)
  }

  private openSocket(): void {
    const socket = this.createSocket({ host: this.opts.host, port: this.opts.port })
    this.socket = socket

    const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())

    reader.on('data', (pkt: MavLinkPacket) => {
      this.handlePacket(pkt)
      if (!this._connected && pkt.header.msgid === minimal.Heartbeat.MSG_ID) {
        this.clearHeartbeatTimeout()
        this._connected = true
        this.targetSysid = pkt.header.sysid
        this.targetCompid = pkt.header.compid
        this.startHeartbeat()
        this.requestStreamRates().catch((err: unknown) => this.emit('raw-error', err))
        this.emit('connected')
        this.firstConnectResolve?.()
        this.firstConnectResolve = null
        this.firstConnectReject = null
      }
    })

    socket.on('error', (err: Error) => {
      this.emit('raw-error', err)
    })

    socket.on('close', () => {
      const wasConnected = this._connected
      this._connected = false
      this.targetSysid = null
      this.targetCompid = null
      this.stopHeartbeat()
      if (wasConnected) this.emit('disconnected')
      if (!this.explicitlyDisconnected) this.scheduleReconnect()
    })
  }

  /** Arms the first-heartbeat timeout for the connect() promise currently
   * pending. Only ever active for the initial connect() call — once the first
   * HEARTBEAT arrives the timer is cleared for good and reconnects after a
   * drop don't re-arm it (those are covered by the 2s reconnect backoff). */
  private armHeartbeatTimeout(): void {
    this.clearHeartbeatTimeout()
    const timeoutMs = this.heartbeatTimeoutMs
    this.firstHeartbeatTimer = setTimeout(() => {
      this.firstHeartbeatTimer = null
      // Same semantics as an explicit disconnect(): stop retrying, tear the socket down.
      this.explicitlyDisconnected = true
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.stopHeartbeat()
      this._connected = false
      this.targetSysid = null
      this.targetCompid = null
      if (this.socket) {
        this.socket.destroy()
        this.socket = null
      }
      this.rejectPendingConnect(new HeartbeatTimeoutError(timeoutMs))
    }, timeoutMs)
  }

  private clearHeartbeatTimeout(): void {
    if (this.firstHeartbeatTimer) {
      clearTimeout(this.firstHeartbeatTimer)
      this.firstHeartbeatTimer = null
    }
  }

  private rejectPendingConnect(err: Error): void {
    const reject = this.firstConnectReject
    this.firstConnectResolve = null
    this.firstConnectReject = null
    reject?.(err)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.explicitlyDisconnected) this.openSocket()
    }, RECONNECT_BACKOFF_MS)
  }

  private handlePacket(pkt: MavLinkPacket): void {
    const decoded = decode(pkt)
    if (decoded) this.emit('message', decoded)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const sendHeartbeat = () => {
      const hb = new minimal.Heartbeat()
      hb.type = minimal.MavType.GCS
      hb.autopilot = minimal.MavAutopilot.INVALID
      this.send(hb).catch((err: unknown) => this.emit('raw-error', err))
    }
    sendHeartbeat()
    this.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async requestStreamRates(): Promise<void> {
    const sysid = this.targetSysid
    const compid = this.targetCompid
    if (sysid === null || compid === null) return
    for (const { msgId, hz } of STREAM_RATES) {
      const cmd = new common.CommandLong()
      cmd.targetSystem = sysid
      cmd.targetComponent = compid
      cmd.command = common.MavCmd.SET_MESSAGE_INTERVAL
      cmd._param1 = msgId
      cmd._param2 = 1e6 / hz
      await this.send(cmd)
    }
  }
}
