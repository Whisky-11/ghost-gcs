import { describe, it, expect } from 'vitest'
import { minimal, common } from 'node-mavlink'
import { initialState, reduce, modeName, COPTER_MODES, ROVER_MODES } from '../telemetry.js'
import type { TelemetryState } from '../telemetry.js'

// Build decode()-shaped { msgName, data } pairs from real dialect class
// instances (field-name-honest — same classes registry.ts registers) instead
// of hand-rolled objects, so a field-name drift in the library would break
// these tests rather than silently mismatching reduce().
function toData(msg: object): Record<string, unknown> {
  return { ...(msg as unknown as Record<string, unknown>) }
}

function heartbeat(opts: { type: number; baseMode: number; customMode: number }): Record<string, unknown> {
  const hb = new minimal.Heartbeat()
  hb.type = opts.type
  hb.autopilot = minimal.MavAutopilot.INVALID
  hb.baseMode = opts.baseMode
  hb.customMode = opts.customMode
  hb.systemStatus = minimal.MavState.ACTIVE
  return toData(hb)
}

describe('initialState', () => {
  it('starts disconnected, unknown vehicle, empty ring', () => {
    const s = initialState()
    expect(s.connected).toBe(false)
    expect(s.lastHeartbeatMs).toBeNull()
    expect(s.vehicleType).toBe('unknown')
    expect(s.armed).toBe(false)
    expect(s.position).toBeNull()
    expect(s.statusTexts).toEqual([])
  })
})

describe('reduce: unknown message', () => {
  it('returns the exact same state reference', () => {
    const s = initialState()
    const next = reduce(s, 'SOME_UNTRACKED_MESSAGE', {}, 1000)
    expect(next).toBe(s)
  })
})

describe('reduce: HEARTBEAT', () => {
  it('sets armed=true when MAV_MODE_FLAG_SAFETY_ARMED (128) bit is set', () => {
    const data = heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 128 + 64, customMode: 4 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 5000)
    expect(next.armed).toBe(true)
  })

  it('sets armed=false when the bit is clear', () => {
    const armedState = reduce(
      initialState(),
      'HEARTBEAT',
      heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 128, customMode: 4 }),
      1000,
    )
    expect(armedState.armed).toBe(true)
    const disarmed = reduce(
      armedState,
      'HEARTBEAT',
      heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 0, customMode: 4 }),
      2000,
    )
    expect(disarmed.armed).toBe(false)
  })

  it('resolves copter GUIDED(4) and sets vehicleType', () => {
    const data = heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 0, customMode: 4 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 1000)
    expect(next.vehicleType).toBe('copter')
    expect(next.mode).toBe('GUIDED')
  })

  it('resolves rover MANUAL(0) and sets vehicleType', () => {
    const data = heartbeat({ type: minimal.MavType.GROUND_ROVER, baseMode: 0, customMode: 0 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 1000)
    expect(next.vehicleType).toBe('rover')
    expect(next.mode).toBe('MANUAL')
  })

  it('falls back to MODE(<n>) for an unrecognized custom_mode', () => {
    const data = heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 0, customMode: 42 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 1000)
    expect(next.mode).toBe('MODE(42)')
  })

  it('falls back to MODE(<n>) for an unknown vehicle type (e.g. fixed-wing)', () => {
    const data = heartbeat({ type: minimal.MavType.FIXED_WING, baseMode: 0, customMode: 3 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 1000)
    expect(next.vehicleType).toBe('unknown')
    expect(next.mode).toBe('MODE(3)')
  })

  it('sets lastHeartbeatMs to the injected nowMs', () => {
    const data = heartbeat({ type: minimal.MavType.QUADROTOR, baseMode: 0, customMode: 0 })
    const next = reduce(initialState(), 'HEARTBEAT', data, 123456)
    expect(next.lastHeartbeatMs).toBe(123456)
  })
})

describe('modeName', () => {
  it('matches the COPTER_MODES / ROVER_MODES tables directly', () => {
    expect(modeName('copter', 4)).toBe(COPTER_MODES[4])
    expect(modeName('rover', 0)).toBe(ROVER_MODES[0])
    expect(modeName('unknown', 7)).toBe('MODE(7)')
  })
})

describe('reduce: GLOBAL_POSITION_INT', () => {
  it('scales lat/lon by 1e7 and alt/relative_alt by 1e3', () => {
    const gpi = new common.GlobalPositionInt()
    gpi.lat = 292375100 // 29.23751 deg (Kuwait-ish)
    gpi.lon = 479761000 // 47.9761 deg
    gpi.alt = 45000 // 45 m
    gpi.relativeAlt = 12000 // 12 m
    const next = reduce(initialState(), 'GLOBAL_POSITION_INT', toData(gpi), 1000)
    expect(next.position).toEqual({ lat: 29.23751, lng: 47.9761, altM: 45, relAltM: 12 })
  })
})

describe('reduce: ATTITUDE', () => {
  it('converts roll/pitch/yaw from radians to degrees', () => {
    const att = new common.Attitude()
    att.roll = Math.PI / 2 // 90 deg
    att.pitch = Math.PI // 180 deg
    att.yaw = -Math.PI / 2 // -90 deg
    const next = reduce(initialState(), 'ATTITUDE', toData(att), 1000)
    expect(next.attitude?.rollDeg).toBeCloseTo(90)
    expect(next.attitude?.pitchDeg).toBeCloseTo(180)
    expect(next.attitude?.yawDeg).toBeCloseTo(-90)
  })
})

describe('reduce: VFR_HUD', () => {
  it('maps groundspeed/airspeed/climb directly (already m/s)', () => {
    const hud = new common.VfrHud()
    hud.groundspeed = 5.5
    hud.airspeed = 6.1
    hud.climb = -0.4
    const next = reduce(initialState(), 'VFR_HUD', toData(hud), 1000)
    expect(next.speed).toEqual({ groundMps: 5.5, airMps: 6.1, climbMps: -0.4 })
  })
})

describe('reduce: SYS_STATUS', () => {
  it('scales voltage_battery/1000 and passes through battery_remaining', () => {
    const status = new common.SysStatus()
    status.voltageBattery = 12600 // 12.6 V
    status.batteryRemaining = 87
    const next = reduce(initialState(), 'SYS_STATUS', toData(status), 1000)
    expect(next.battery).toEqual({ voltageV: 12.6, remainingPct: 87 })
  })

  it('keeps the prior remainingPct when battery_remaining is -1 but still refreshes voltage', () => {
    const first = new common.SysStatus()
    first.voltageBattery = 12600
    first.batteryRemaining = 87
    const withBattery = reduce(initialState(), 'SYS_STATUS', toData(first), 1000)

    const second = new common.SysStatus()
    second.voltageBattery = 12400
    second.batteryRemaining = -1
    const next = reduce(withBattery, 'SYS_STATUS', toData(second), 2000)
    expect(next.battery).toEqual({ voltageV: 12.4, remainingPct: 87 })
  })

  it('leaves battery null when battery_remaining is -1 and there is no prior reading', () => {
    const status = new common.SysStatus()
    status.voltageBattery = 12000
    status.batteryRemaining = -1
    const next = reduce(initialState(), 'SYS_STATUS', toData(status), 1000)
    expect(next.battery).toBeNull()
  })
})

describe('reduce: GPS_RAW_INT', () => {
  it('maps fix_type/satellites_visible and scales eph/100', () => {
    const gps = new common.GpsRawInt()
    gps.fixType = common.GpsFixType.GPS_FIX_TYPE_3D_FIX
    gps.satellitesVisible = 11
    gps.eph = 150
    const next = reduce(initialState(), 'GPS_RAW_INT', toData(gps), 1000)
    expect(next.gps).toEqual({ fixType: common.GpsFixType.GPS_FIX_TYPE_3D_FIX, satellites: 11, hdop: 1.5 })
  })
})

describe('reduce: HOME_POSITION', () => {
  it('scales latitude/longitude by 1e7 and altitude by 1e3', () => {
    const home = new common.HomePosition()
    home.latitude = 292375100
    home.longitude = 479761000
    home.altitude = 30000
    const next = reduce(initialState(), 'HOME_POSITION', toData(home), 1000)
    expect(next.home).toEqual({ lat: 29.23751, lng: 47.9761, altM: 30 })
  })
})

describe('reduce: STATUSTEXT', () => {
  function statustext(severity: number, text: string): Record<string, unknown> {
    const st = new common.StatusText()
    st.severity = severity
    st.text = text
    return toData(st)
  }

  it('pushes { severity, text, tsMs } onto statusTexts', () => {
    const next = reduce(initialState(), 'STATUSTEXT', statustext(common.MavSeverity.INFO, 'Armed'), 4242)
    expect(next.statusTexts).toEqual([{ severity: common.MavSeverity.INFO, text: 'Armed', tsMs: 4242 }])
  })

  it('caps the ring at 50 entries, dropping the oldest', () => {
    let state: TelemetryState = initialState()
    for (let i = 0; i < 55; i++) {
      state = reduce(state, 'STATUSTEXT', statustext(common.MavSeverity.INFO, `msg-${i}`), 1000 + i)
    }
    expect(state.statusTexts).toHaveLength(50)
    expect(state.statusTexts[0]?.text).toBe('msg-5')
    expect(state.statusTexts[49]?.text).toBe('msg-54')
  })
})
