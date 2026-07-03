import { EventEmitter } from 'node:events'
import { connect as netConnect, type Socket } from 'node:net'
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
  private socket: Socket | null = null
  private readonly protocol = new MavLinkProtocolV2(GCS_SYSID, GCS_COMPID)
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private explicitlyDisconnected = true
  private _connected = false
  private targetSysid: number | null = null
  private targetCompid: number | null = null
  private firstConnectResolve: (() => void) | null = null
  private opts: { host: string; port: number } = { host: CONFIG.sitlTcp.host, port: CONFIG.sitlTcp.port }

  get connected(): boolean {
    return this._connected
  }

  /** Resolves on the first HEARTBEAT received from the vehicle. Never rejects —
   * transient connection failures are retried via the 2s reconnect backoff and
   * surfaced through the 'raw-error' event instead. */
  connect(opts?: { host?: string; port?: number }): Promise<void> {
    this.explicitlyDisconnected = false
    if (opts?.host) this.opts.host = opts.host
    if (opts?.port) this.opts.port = opts.port
    return new Promise((resolve) => {
      this.firstConnectResolve = resolve
      this.openSocket()
    })
  }

  disconnect(): void {
    this.explicitlyDisconnected = true
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
    this.removeAllListeners()
  }

  async send(msg: MavLinkData): Promise<void> {
    if (!this.socket) throw new Error('VehicleLink: not connected')
    await mavSend(this.socket, msg, this.protocol)
  }

  private openSocket(): void {
    const socket = netConnect({ host: this.opts.host, port: this.opts.port })
    this.socket = socket

    const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())

    reader.on('data', (pkt: MavLinkPacket) => {
      this.handlePacket(pkt)
      if (!this._connected && pkt.header.msgid === minimal.Heartbeat.MSG_ID) {
        this._connected = true
        this.targetSysid = pkt.header.sysid
        this.targetCompid = pkt.header.compid
        this.startHeartbeat()
        this.requestStreamRates().catch((err: unknown) => this.emit('raw-error', err))
        this.emit('connected')
        this.firstConnectResolve?.()
        this.firstConnectResolve = null
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
