// Task 3 live SITL verification script — kept alongside probe-sitl.ts (P0
// Task 2) as a reusable manual-verification tool, not part of the shipped
// bridge runtime. Connects to a running `sim/run.sh copter` container,
// clears + uploads a TAKEOFF/WAYPOINT/WAYPOINT/RTL mission via
// missions/protocol.ts, downloads it back to confirm the round-trip (and
// ArduPilot's reserved home slot at wire seq=0), arms, does an explicit
// GUIDED takeoff (arm->AUTO alone does not auto-takeoff on this ArduPilot
// build — see commands.ts's startMission() doc + the Task 3 report), then
// starts the mission via commands.ts's startMission() and polls telemetry
// to observe the flight. Prints labeled state snapshots to stdout.
// Usage: `sim/run.sh copter` in one terminal, then `npx tsx
// scripts/live-mission-test.ts` from bridge/ in another.
import { common, type MavLinkData } from 'node-mavlink'
import { VehicleLink } from '../src/mavlink/link.js'
import { makeCommands, CommandError } from '../src/commands/commands.js'
import { makeMissionProtocol, MissionError } from '../src/missions/protocol.js'
import { reduce, initialState, type TelemetryState } from '../src/state/telemetry.js'
import type { MissionItem } from '../src/missions/model.js'

function log(label: string, obj: unknown): void {
  console.log(`[${new Date().toISOString()}] ${label}`, JSON.stringify(obj))
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const link = new VehicleLink()
  let state: TelemetryState = initialState()
  link.on('message', ({ msgName, data }: { msgName: string; data: Record<string, unknown> }) => {
    state = reduce(state, msgName, data, Date.now())
  })
  link.on('raw-error', (err: unknown) => log('raw-error', String(err)))
  link.on('disconnected', () => log('disconnected', {}))

  log('connecting', { host: '127.0.0.1', port: 5760 })
  await link.connect({ host: '127.0.0.1', port: 5760 })
  log('connected', { vehicleType: state.vehicleType })

  // HOME_POSITION is only broadcast once (at boot / when home changes), not
  // in our requested stream rates — on a reconnect to an already-running
  // SITL it may never arrive on its own, so explicitly request it.
  const getHome = new common.CommandLong()
  getHome.targetSystem = 1
  getHome.targetComponent = 1
  getHome.command = common.MavCmd.GET_HOME_POSITION
  await link.send(getHome as unknown as MavLinkData).catch((err: unknown) => log('GET_HOME_POSITION send failed', String(err)))

  log('waiting for home position + GPS 3D fix (SITL needs ~30-60s post-boot)', {})
  const waitStart = Date.now()
  while ((!state.home || (state.gps?.fixType ?? 0) < 3) && Date.now() - waitStart < 90_000) {
    await sleep(2000)
    log('waiting...', { home: state.home, gps: state.gps, mode: state.mode })
  }
  if (!state.home) {
    log('FATAL: no HOME_POSITION received within 90s', {})
    process.exit(1)
  }
  log('home acquired', { home: state.home, gps: state.gps })

  const home = state.home
  const items: MissionItem[] = [
    { seq: 0, command: 'TAKEOFF', lat: home.lat, lng: home.lng, altM: 20 },
    { seq: 1, command: 'WAYPOINT', lat: home.lat + 0.0003, lng: home.lng, altM: 20 },
    { seq: 2, command: 'WAYPOINT', lat: home.lat + 0.0003, lng: home.lng + 0.0004, altM: 20 },
    { seq: 3, command: 'RTL', lat: home.lat, lng: home.lng, altM: 20 },
  ]
  log('mission to upload', items)

  const protocol = makeMissionProtocol({ link })

  log('clearing any existing mission', {})
  try {
    await protocol.clear()
    log('clear OK', {})
  } catch (err) {
    log('clear FAILED (continuing anyway)', String(err))
  }

  log('uploading mission', {})
  try {
    await protocol.upload(items)
    log('upload OK', {})
  } catch (err) {
    log('FATAL: upload failed', err instanceof MissionError ? { code: err.code, message: err.message } : String(err))
    process.exit(1)
  }

  log('downloading mission back to verify round-trip + observe seq=0 behavior', {})
  try {
    const downloaded = await protocol.download()
    log('download OK', downloaded)
  } catch (err) {
    log('download FAILED', err instanceof MissionError ? { code: err.code, message: err.message } : String(err))
  }

  const commands = makeCommands({ link, getState: () => state })

  log('setMode GUIDED', {})
  await commands.setMode('GUIDED')
  await sleep(1000)
  log('mode after GUIDED', { mode: state.mode })

  log('arming (retrying on prearm failure up to 90s)', { alreadyArmed: state.armed })
  const armStart = Date.now()
  let ackedArm = state.armed // a prior run against this same SITL session may have left it armed
  while (!ackedArm && Date.now() - armStart < 90_000) {
    try {
      await commands.arm()
      ackedArm = true
    } catch (err) {
      if (err instanceof CommandError && err.code === 'ALREADY_ARMED') {
        ackedArm = true
        break
      }
      const msg = err instanceof CommandError ? `${err.code}: ${err.message}` : String(err)
      log('arm attempt failed, retrying in 5s', msg)
      await sleep(5000)
    }
  }
  if (!ackedArm) {
    log('FATAL: could not arm within 90s', {})
    process.exit(1)
  }
  log('ARM COMMAND_ACK accepted, waiting for telemetry-confirmed armed=true (P0 arm-ACK-vs-state lesson)', {
    stateArmedRightAfterAck: state.armed,
  })
  // The COMMAND_ACK for arm resolves before the next HEARTBEAT updates
  // state.armed — startMission() checks TELEMETRY state, not the ACK, so we
  // must wait for the HEARTBEAT-confirmed armed=true before calling it.
  const confirmStart = Date.now()
  while (!state.armed && Date.now() - confirmStart < 10_000) {
    await sleep(200)
  }
  log('ARMED (telemetry-confirmed)', { armed: state.armed, mode: state.mode })

  log('GUIDED takeoff to 20m (arm->AUTO alone did NOT auto-takeoff in an earlier run of this script -- see report; explicit GUIDED takeoff first, then AUTO to run the rest of the mission)', {})
  await commands.takeoff(20)
  const takeoffStart = Date.now()
  while ((state.position?.relAltM ?? 0) < 15 && Date.now() - takeoffStart < 30_000) {
    await sleep(2000)
    log('climbing...', { relAltM: state.position?.relAltM, mode: state.mode, armed: state.armed })
  }
  log('takeoff altitude reached (or timed out)', { relAltM: state.position?.relAltM })

  log('startMission -> setMode AUTO (vehicle already airborne; expect it to pick up at the first WAYPOINT)', {})
  await commands.startMission()
  await sleep(1000)
  log('mode after startMission', { mode: state.mode, armed: state.armed })

  // Poll telemetry for ~4 minutes to watch it march through waypoints and RTL.
  const pollStart = Date.now()
  let lastMode = state.mode
  while (Date.now() - pollStart < 240_000) {
    await sleep(3000)
    if (state.mode !== lastMode) {
      log('MODE CHANGE', { from: lastMode, to: state.mode })
      lastMode = state.mode
    }
    log('snapshot', {
      mode: state.mode,
      armed: state.armed,
      position: state.position,
      speed: state.speed,
    })
    if (!state.armed && state.mode === 'RTL') {
      log('vehicle disarmed after RTL — flight complete', {})
      break
    }
    if (!state.armed && lastMode !== 'GUIDED' && Date.now() - pollStart > 20_000) {
      log('vehicle disarmed — flight ended (or landed)', { mode: state.mode })
      break
    }
  }

  log('done, disconnecting', {})
  link.disconnect()
  process.exit(0)
}

main().catch((err) => {
  console.error('UNCAUGHT', err)
  process.exit(1)
})
