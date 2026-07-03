// Validated vehicle commands (spec safety invariant 4): every method checks
// TelemetryState before sending anything, and every sent COMMAND_LONG is
// correlated to its COMMAND_ACK (or times out) before resolving — callers
// never get a false "ok" for a command the vehicle silently dropped.
import type { EventEmitter } from 'node:events'
import { common, type MavLinkData } from 'node-mavlink'
import type { VehicleLink } from '../mavlink/link.js'
import { COPTER_MODES, ROVER_MODES, type TelemetryState } from '../state/telemetry.js'

export class CommandError extends Error {
  constructor(
    public code:
      | 'NOT_CONNECTED'
      | 'ALREADY_ARMED'
      | 'NOT_ARMED'
      | 'BAD_MODE'
      | 'MODE_UNKNOWN'
      | 'ACK_FAILED'
      | 'ACK_TIMEOUT',
    msg?: string,
  ) {
    super(msg ?? code)
    this.name = 'CommandError'
  }
}

export interface CommandDeps {
  link: Pick<VehicleLink, 'send' | 'connected'> & EventEmitter
  getState(): TelemetryState
}

const ACK_TIMEOUT_MS = 5000

// Target vehicle identity for COMMAND_LONG. P0 flies a single simulated
// vehicle; ArduPilot SITL's default MAVLink identity is sysid=1, compid=1
// (MAV_COMP_ID_AUTOPILOT1) — the same default VehicleLink documents having
// discovered from the first HEARTBEAT (see Task 3's report). CommandDeps
// only exposes `send`/`connected` (per the brief's interface — VehicleLink
// keeps the discovered sysid/compid private), so there's no live value to
// plumb through here; hardcoded to the documented SITL default rather than
// invented. A future multi-vehicle deployment would need this parameterized
// (e.g. VehicleLink exposing its discovered targetSysid/targetCompid).
const TARGET_SYSTEM = 1
const TARGET_COMPONENT = 1

// name -> customMode, per vehicle type. Inverse of COPTER_MODES/ROVER_MODES.
function invert(table: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [customMode, name] of Object.entries(table)) out[name] = Number(customMode)
  return out
}
const COPTER_MODE_IDS = invert(COPTER_MODES)
const ROVER_MODE_IDS = invert(ROVER_MODES)

function modeTableFor(vehicleType: TelemetryState['vehicleType']): Record<string, number> | null {
  if (vehicleType === 'copter') return COPTER_MODE_IDS
  if (vehicleType === 'rover') return ROVER_MODE_IDS
  return null
}

function assertConnected(deps: CommandDeps): void {
  if (!deps.link.connected) throw new CommandError('NOT_CONNECTED')
}

function buildCommandLong(
  command: common.MavCmd,
  params: Partial<Record<'_param1' | '_param2' | '_param7', number>>,
): common.CommandLong {
  const cmd = new common.CommandLong()
  cmd.targetSystem = TARGET_SYSTEM
  cmd.targetComponent = TARGET_COMPONENT
  cmd.command = command
  cmd.confirmation = 0
  if (params._param1 !== undefined) cmd._param1 = params._param1
  if (params._param2 !== undefined) cmd._param2 = params._param2
  if (params._param7 !== undefined) cmd._param7 = params._param7
  return cmd
}

/** Sends `cmd` and resolves once a matching COMMAND_ACK (data.command ===
 * cmd.command) arrives with result === MAV_RESULT_ACCEPTED (0); rejects with
 * ACK_FAILED for any other result, or ACK_TIMEOUT if no matching ACK arrives
 * within 5s. */
function sendAndAwaitAck(deps: CommandDeps, cmd: common.CommandLong): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false

    const onMessage = (msg: { msgName: string; data: Record<string, unknown> }): void => {
      if (settled) return
      if (msg.msgName !== 'COMMAND_ACK') return
      if ((msg.data.command as number) !== cmd.command) return
      settled = true
      cleanup()
      const result = msg.data.result as number
      if (result === common.MavResult.ACCEPTED) {
        resolve()
      } else {
        reject(new CommandError('ACK_FAILED', `command ${cmd.command} rejected: MAV_RESULT=${result}`))
      }
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new CommandError('ACK_TIMEOUT', `no ACK for command ${cmd.command} within ${ACK_TIMEOUT_MS}ms`))
    }, ACK_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timer)
      deps.link.removeListener('message', onMessage)
    }

    deps.link.on('message', onMessage)
    deps.link.send(cmd as unknown as MavLinkData).catch((err: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

export function makeCommands(deps: CommandDeps): {
  arm(): Promise<void>
  disarm(): Promise<void>
  setMode(mode: string): Promise<void>
  takeoff(altM: number): Promise<void>
  rtl(): Promise<void>
} {
  async function arm(): Promise<void> {
    assertConnected(deps)
    if (deps.getState().armed) throw new CommandError('ALREADY_ARMED')
    const cmd = buildCommandLong(common.MavCmd.COMPONENT_ARM_DISARM, { _param1: 1 })
    await sendAndAwaitAck(deps, cmd)
  }

  async function disarm(): Promise<void> {
    assertConnected(deps)
    if (!deps.getState().armed) throw new CommandError('NOT_ARMED')
    const cmd = buildCommandLong(common.MavCmd.COMPONENT_ARM_DISARM, { _param1: 0 })
    await sendAndAwaitAck(deps, cmd)
  }

  async function setMode(mode: string): Promise<void> {
    assertConnected(deps)
    const table = modeTableFor(deps.getState().vehicleType)
    const customMode = table?.[mode]
    if (customMode === undefined) {
      throw new CommandError('MODE_UNKNOWN', `unknown mode "${mode}" for vehicleType=${deps.getState().vehicleType}`)
    }
    // param1=1 enables MAV_MODE_FLAG_CUSTOM_MODE_ENABLED so param2 (customMode) is honored.
    const cmd = buildCommandLong(common.MavCmd.DO_SET_MODE, { _param1: 1, _param2: customMode })
    await sendAndAwaitAck(deps, cmd)
  }

  async function takeoff(altM: number): Promise<void> {
    assertConnected(deps)
    const state = deps.getState()
    if (state.vehicleType !== 'copter' || !state.armed || state.mode !== 'GUIDED') {
      throw new CommandError('BAD_MODE', 'takeoff requires vehicleType=copter, armed=true, mode=GUIDED')
    }
    const cmd = buildCommandLong(common.MavCmd.NAV_TAKEOFF, { _param7: altM })
    await sendAndAwaitAck(deps, cmd)
  }

  async function rtl(): Promise<void> {
    await setMode('RTL')
  }

  return { arm, disarm, setMode, takeoff, rtl }
}
