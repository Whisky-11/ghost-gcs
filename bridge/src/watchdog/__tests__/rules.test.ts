import { describe, it, expect } from 'vitest'
import { initialState } from '../../state/telemetry.js'
import type { TelemetryState } from '../../state/telemetry.js'
import { evaluateWatchdog } from '../rules.js'
import type { Alert } from '../rules.js'

/** A fully healthy, nominal in-flight TelemetryState — every rule should stay
 * silent against this baseline. Individual tests override just the field(s)
 * that should trip a rule. */
function nominalState(overrides: Partial<TelemetryState> = {}): TelemetryState {
  return {
    ...initialState(),
    connected: true,
    lastHeartbeatMs: 10_000,
    armed: true,
    mode: 'AUTO',
    position: { lat: 29.3, lng: 47.9, altM: 50, relAltM: 50 },
    home: { lat: 29.3001, lng: 47.9001, altM: 10 },
    speed: { groundMps: 5, airMps: 5, climbMps: 0 },
    battery: { voltageV: 22.2, remainingPct: 80 },
    gps: { fixType: 3, satellites: 12, hdop: 0.9 },
    statusTexts: [],
    ...overrides,
  }
}

function codesOf(alerts: Alert[]): string[] {
  return alerts.map((a) => a.code)
}

describe('evaluateWatchdog: nominal baseline', () => {
  it('raises no alerts for a fully healthy state', () => {
    const state = nominalState()
    const alerts = evaluateWatchdog(state, state, 10_000)
    expect(alerts).toEqual([])
  })

  it('raises no alerts on the very first tick (prev = null) when nominal', () => {
    const state = nominalState()
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(alerts).toEqual([])
  })
})

describe('evaluateWatchdog: LINK_STALE', () => {
  it('no alert when heartbeat has never been seen', () => {
    const state = nominalState({ lastHeartbeatMs: null })
    const alerts = evaluateWatchdog(state, null, 50_000)
    expect(codesOf(alerts)).not.toContain('LINK_STALE')
  })

  it('no alert at exactly the 3s boundary (not yet stale)', () => {
    const state = nominalState({ lastHeartbeatMs: 10_000 })
    const alerts = evaluateWatchdog(state, null, 13_000)
    expect(codesOf(alerts)).not.toContain('LINK_STALE')
  })

  it('warn just past 3s', () => {
    const state = nominalState({ lastHeartbeatMs: 10_000 })
    const alerts = evaluateWatchdog(state, null, 13_001)
    const alert = alerts.find((a) => a.code === 'LINK_STALE')
    expect(alert?.severity).toBe('warn')
  })

  it('still warn at exactly the 10s boundary (not yet critical)', () => {
    const state = nominalState({ lastHeartbeatMs: 10_000 })
    const alerts = evaluateWatchdog(state, null, 20_000)
    const alert = alerts.find((a) => a.code === 'LINK_STALE')
    expect(alert?.severity).toBe('warn')
  })

  it('critical just past 10s', () => {
    const state = nominalState({ lastHeartbeatMs: 10_000 })
    const alerts = evaluateWatchdog(state, null, 20_001)
    const alert = alerts.find((a) => a.code === 'LINK_STALE')
    expect(alert?.severity).toBe('critical')
  })
})

describe('evaluateWatchdog: BATTERY_LOW', () => {
  it('no alert when battery telemetry is unavailable', () => {
    const state = nominalState({ battery: null })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_LOW')
  })

  it('no alert at exactly 25% (not yet low)', () => {
    const state = nominalState({ battery: { voltageV: 22, remainingPct: 25 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_LOW')
  })

  it('warn just under 25%', () => {
    const state = nominalState({ battery: { voltageV: 22, remainingPct: 24 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    const alert = alerts.find((a) => a.code === 'BATTERY_LOW')
    expect(alert?.severity).toBe('warn')
  })

  it('still warn at exactly 15% (not yet critical)', () => {
    const state = nominalState({ battery: { voltageV: 21, remainingPct: 15 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    const alert = alerts.find((a) => a.code === 'BATTERY_LOW')
    expect(alert?.severity).toBe('warn')
  })

  it('critical just under 15%', () => {
    const state = nominalState({ battery: { voltageV: 20, remainingPct: 14 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    const alert = alerts.find((a) => a.code === 'BATTERY_LOW')
    expect(alert?.severity).toBe('critical')
  })
})

describe('evaluateWatchdog: GPS_DEGRADED', () => {
  it('no alert when disarmed even with a poor fix', () => {
    const state = nominalState({ armed: false, gps: { fixType: 1, satellites: 3, hdop: 5 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('GPS_DEGRADED')
  })

  it('no alert when armed with a good fix (fixType 3 = 3D fix)', () => {
    const state = nominalState({ armed: true, gps: { fixType: 3, satellites: 12, hdop: 0.9 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('GPS_DEGRADED')
  })

  it('no alert when armed but gps telemetry is unavailable', () => {
    const state = nominalState({ armed: true, gps: null })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('GPS_DEGRADED')
  })

  it('warn when armed with fixType < 3', () => {
    const state = nominalState({ armed: true, gps: { fixType: 2, satellites: 5, hdop: 2 } })
    const alerts = evaluateWatchdog(state, null, 10_000)
    const alert = alerts.find((a) => a.code === 'GPS_DEGRADED')
    expect(alert?.severity).toBe('warn')
    expect(alert?.data).toMatchObject({ fixType: 2 })
  })
})

describe('evaluateWatchdog: BATTERY_VS_HOME (advisory energy-to-return heuristic)', () => {
  it('no alert when disarmed, regardless of battery/distance', () => {
    const state = nominalState({
      armed: false,
      battery: { voltageV: 18, remainingPct: 10 },
      position: { lat: 29.4, lng: 48.0, altM: 50, relAltM: 50 }, // far from home
      home: { lat: 29.3, lng: 47.9, altM: 10 },
      speed: { groundMps: 5, airMps: 5, climbMps: 0 },
    })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_VS_HOME')
  })

  it('no alert when position, home, or speed telemetry is missing', () => {
    const state = nominalState({ armed: true, battery: { voltageV: 18, remainingPct: 10 }, home: null })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_VS_HOME')
  })

  it('no alert when essentially hovering (groundspeed below the meaningful-motion floor)', () => {
    const state = nominalState({
      armed: true,
      battery: { voltageV: 18, remainingPct: 5 },
      position: { lat: 29.4, lng: 48.0, altM: 50, relAltM: 50 },
      home: { lat: 29.3, lng: 47.9, altM: 10 },
      speed: { groundMps: 0.1, airMps: 0.1, climbMps: 0 },
    })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_VS_HOME')
  })

  it('direction A: far from home + low battery relative to groundspeed -> warns', () => {
    // ~10km north-east of home (0.09deg lat/lng ~ 10km), cruising at 5 m/s ->
    // ~2000s straight-line time-to-home. Battery at 10% against the module's
    // naive 18-minute (1080s) full-charge assumption estimates ~108s of
    // flight left — nowhere near enough per the heuristic.
    const state = nominalState({
      armed: true,
      position: { lat: 29.39, lng: 47.99, altM: 50, relAltM: 50 },
      home: { lat: 29.3, lng: 47.9, altM: 10 },
      speed: { groundMps: 5, airMps: 5, climbMps: 0 },
      battery: { voltageV: 18, remainingPct: 10 },
    })
    const alerts = evaluateWatchdog(state, null, 10_000)
    const alert = alerts.find((a) => a.code === 'BATTERY_VS_HOME')
    expect(alert?.severity).toBe('warn')
    expect(alert?.data).toMatchObject({ remainingPct: 10 })
  })

  it('direction B: close to home + healthy battery relative to groundspeed -> no alert', () => {
    // ~111m from home, cruising at 5 m/s -> ~22s time-to-home. 80% battery
    // against the 1080s full-charge assumption estimates ~864s of flight
    // left — comfortably enough per the heuristic.
    const state = nominalState({
      armed: true,
      position: { lat: 29.3001, lng: 47.9001, altM: 50, relAltM: 50 },
      home: { lat: 29.3, lng: 47.9, altM: 10 },
      speed: { groundMps: 5, airMps: 5, climbMps: 0 },
      battery: { voltageV: 22, remainingPct: 80 },
    })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('BATTERY_VS_HOME')
  })
})

describe('evaluateWatchdog: STATUSTEXT_ERROR', () => {
  it('no alert on the first tick (prev = null) even if statusTexts already contains errors', () => {
    const state = nominalState({ statusTexts: [{ severity: 2, text: 'PreArm: Bad Gyro', tsMs: 5_000 }] })
    const alerts = evaluateWatchdog(state, null, 10_000)
    expect(codesOf(alerts)).not.toContain('STATUSTEXT_ERROR')
  })

  it('no alert when the statustext already existed in prev (not new)', () => {
    const entry = { severity: 2, text: 'PreArm: Bad Gyro', tsMs: 5_000 }
    const prev = nominalState({ statusTexts: [entry] })
    const state = nominalState({ statusTexts: [entry] })
    const alerts = evaluateWatchdog(state, prev, 10_000)
    expect(codesOf(alerts)).not.toContain('STATUSTEXT_ERROR')
  })

  it('no alert for a new statustext with severity > 3 (e.g. NOTICE/INFO)', () => {
    const prev = nominalState({ statusTexts: [] })
    const state = nominalState({ statusTexts: [{ severity: 6, text: 'Compass calibrated', tsMs: 9_000 }] })
    const alerts = evaluateWatchdog(state, prev, 10_000)
    expect(codesOf(alerts)).not.toContain('STATUSTEXT_ERROR')
  })

  it('warns on a new statustext with severity <= 3', () => {
    const prev = nominalState({ statusTexts: [] })
    const state = nominalState({ statusTexts: [{ severity: 2, text: 'Crash: Disarming', tsMs: 9_000 }] })
    const alerts = evaluateWatchdog(state, prev, 10_000)
    const alert = alerts.find((a) => a.code === 'STATUSTEXT_ERROR')
    expect(alert?.severity).toBe('warn')
    expect(alert?.message).toContain('Crash: Disarming')
  })

  it('emits one alert per new qualifying statustext', () => {
    const prev = nominalState({ statusTexts: [] })
    const state = nominalState({
      statusTexts: [
        { severity: 2, text: 'Crash: Disarming', tsMs: 9_000 },
        { severity: 0, text: 'EMERGENCY', tsMs: 9_100 },
      ],
    })
    const alerts = evaluateWatchdog(state, prev, 10_000)
    expect(codesOf(alerts).filter((c) => c === 'STATUSTEXT_ERROR')).toHaveLength(2)
  })
})

describe('evaluateWatchdog: dedupe key stability', () => {
  it('LINK_STALE keeps the same stable code as severity escalates warn -> critical across ticks', () => {
    const state = nominalState({ lastHeartbeatMs: 10_000 })
    const warnAlerts = evaluateWatchdog(state, null, 14_000) // +4s -> warn
    const critAlerts = evaluateWatchdog(state, null, 21_000) // +11s -> critical
    const warnAlert = warnAlerts.find((a) => a.code === 'LINK_STALE')
    const critAlert = critAlerts.find((a) => a.code === 'LINK_STALE')
    expect(warnAlert?.code).toBe('LINK_STALE')
    expect(critAlert?.code).toBe('LINK_STALE')
    expect(warnAlert?.severity).toBe('warn')
    expect(critAlert?.severity).toBe('critical')
  })

  it('a fully-degraded state raises every rule under a stable, unique-per-rule code', () => {
    const prev = nominalState({ statusTexts: [] })
    const state = nominalState({
      lastHeartbeatMs: 0,
      armed: true,
      gps: { fixType: 1, satellites: 2, hdop: 8 },
      battery: { voltageV: 17, remainingPct: 5 },
      position: { lat: 29.39, lng: 47.99, altM: 50, relAltM: 50 },
      home: { lat: 29.3, lng: 47.9, altM: 10 },
      speed: { groundMps: 5, airMps: 5, climbMps: 0 },
      statusTexts: [{ severity: 1, text: 'Failsafe: Battery', tsMs: 9_000 }],
    })
    const alerts = evaluateWatchdog(state, prev, 20_001)
    expect(codesOf(alerts)).toEqual(
      expect.arrayContaining(['LINK_STALE', 'BATTERY_LOW', 'GPS_DEGRADED', 'BATTERY_VS_HOME', 'STATUSTEXT_ERROR']),
    )
    // Calling again with identical inputs reproduces identical codes (stable, not random/order-flaky).
    const alertsAgain = evaluateWatchdog(state, prev, 20_001)
    expect(codesOf(alertsAgain)).toEqual(codesOf(alerts))
  })
})
