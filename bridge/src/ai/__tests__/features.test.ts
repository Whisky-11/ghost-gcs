import { describe, it, expect } from 'vitest'
import {
  AI_SYSTEM_PREAMBLE,
  missionDraftSchema,
  buildMissionDraftPrompt,
  buildNarratePrompt,
  buildDebriefPrompt,
  computeFlightStats,
  type FlightStats,
} from '../features.js'
import { initialState, type TelemetryState } from '../../state/telemetry.js'
import type { Alert } from '../../watchdog/rules.js'

function state(overrides: Partial<TelemetryState>): TelemetryState {
  return { ...initialState(), ...overrides }
}

describe('AI_SYSTEM_PREAMBLE', () => {
  it('states GHOST is advisory and never commands the vehicle', () => {
    expect(AI_SYSTEM_PREAMBLE).toMatch(/GHOST/)
    expect(AI_SYSTEM_PREAMBLE.toLowerCase()).toMatch(/advisory/)
    expect(AI_SYSTEM_PREAMBLE.toLowerCase()).toMatch(/never/)
    expect(AI_SYSTEM_PREAMBLE.toLowerCase()).toMatch(/command/)
  })
})

describe('missionDraftSchema', () => {
  const validDraft = {
    items: [
      { seq: 0, command: 'WAYPOINT', lat: 29.30001, lng: 47.9001, altM: 30 },
      { seq: 1, command: 'WAYPOINT', lat: 29.30011, lng: 47.9002, altM: 45 },
    ],
    notes: 'two-leg survey inside the drawn polygon',
  }

  it('accepts a valid draft (WAYPOINT-only, alt in bounds)', () => {
    const result = missionDraftSchema.safeParse(validDraft)
    expect(result.success).toBe(true)
  })

  it('rejects an item with altM below the 2m floor', () => {
    const draft = { ...validDraft, items: [{ ...validDraft.items[0], altM: 1 }] }
    const result = missionDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  it('rejects an item with altM above the 120m ceiling', () => {
    const draft = { ...validDraft, items: [{ ...validDraft.items[0], altM: 121 }] }
    const result = missionDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  it('rejects an item with altM exactly at the boundary edges (2 and 120 are inclusive)', () => {
    const draft = {
      ...validDraft,
      items: [
        { seq: 0, command: 'WAYPOINT', lat: 1, lng: 1, altM: 2 },
        { seq: 1, command: 'WAYPOINT', lat: 1, lng: 1, altM: 120 },
      ],
    }
    expect(missionDraftSchema.safeParse(draft).success).toBe(true)
  })

  it('rejects a non-WAYPOINT command (e.g. a hallucinated TAKEOFF)', () => {
    const draft = { ...validDraft, items: [{ ...validDraft.items[0], command: 'TAKEOFF' }] }
    const result = missionDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  it('rejects a non-WAYPOINT command (RTL)', () => {
    const draft = { ...validDraft, items: [{ ...validDraft.items[0], command: 'RTL' }] }
    expect(missionDraftSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects a draft missing notes', () => {
    const { notes: _notes, ...withoutNotes } = validDraft
    expect(missionDraftSchema.safeParse(withoutNotes).success).toBe(false)
  })

  it('rejects a draft with a non-array items field', () => {
    expect(missionDraftSchema.safeParse({ items: 'nope', notes: 'x' }).success).toBe(false)
  })
})

describe('buildMissionDraftPrompt', () => {
  it('includes the safety preamble', () => {
    const prompt = buildMissionDraftPrompt({
      request: 'survey the north field',
      geometry: null,
      home: null,
      vehicleType: 'copter',
    })
    expect(prompt).toContain(AI_SYSTEM_PREAMBLE)
  })

  it('includes the operator request text', () => {
    const prompt = buildMissionDraftPrompt({
      request: 'survey the north field at 40m',
      geometry: null,
      home: null,
      vehicleType: 'copter',
    })
    expect(prompt).toContain('survey the north field at 40m')
  })

  it('includes every geometry vertex when geometry is provided', () => {
    const geometry = [
      { lat: 29.3001, lng: 47.9001 },
      { lat: 29.3011, lng: 47.9002 },
      { lat: 29.3021, lng: 47.9003 },
    ]
    const prompt = buildMissionDraftPrompt({ request: 'x', geometry, home: null, vehicleType: 'copter' })
    for (const pt of geometry) {
      expect(prompt).toContain(String(pt.lat))
      expect(prompt).toContain(String(pt.lng))
    }
  })

  it('instructs output to be confined to WAYPOINT items inside the geometry', () => {
    const prompt = buildMissionDraftPrompt({
      request: 'x',
      geometry: [{ lat: 1, lng: 1 }],
      home: null,
      vehicleType: 'copter',
    })
    expect(prompt).toMatch(/WAYPOINT/)
    expect(prompt.toLowerCase()).toMatch(/inside/)
    expect(prompt.toLowerCase()).toMatch(/geometry/)
  })

  it('instructs the altM bounds 2-120', () => {
    const prompt = buildMissionDraftPrompt({ request: 'x', geometry: null, home: null, vehicleType: 'copter' })
    expect(prompt).toContain('2')
    expect(prompt).toContain('120')
  })

  it('instructs that a human reviews the draft before upload', () => {
    const prompt = buildMissionDraftPrompt({ request: 'x', geometry: null, home: null, vehicleType: 'copter' })
    expect(prompt.toLowerCase()).toMatch(/human/)
    expect(prompt.toLowerCase()).toMatch(/review/)
    expect(prompt.toLowerCase()).toMatch(/upload/)
  })

  it('handles a null geometry without fabricating coordinates', () => {
    const prompt = buildMissionDraftPrompt({ request: 'x', geometry: null, home: null, vehicleType: 'copter' })
    expect(prompt.toLowerCase()).toMatch(/no geometry/)
  })

  it('includes home position when provided', () => {
    const prompt = buildMissionDraftPrompt({
      request: 'x',
      geometry: null,
      home: { lat: 29.5, lng: 48.1 },
      vehicleType: 'rover',
    })
    expect(prompt).toContain('29.5')
    expect(prompt).toContain('48.1')
  })

  it('includes the vehicle type', () => {
    const prompt = buildMissionDraftPrompt({ request: 'x', geometry: null, home: null, vehicleType: 'rover' })
    expect(prompt).toContain('rover')
  })
})

describe('buildNarratePrompt', () => {
  it('includes the safety preamble', () => {
    const prompt = buildNarratePrompt({ state: state({}), question: 'status?' })
    expect(prompt).toContain(AI_SYSTEM_PREAMBLE)
  })

  it('includes telemetry state fields (mode, armed, position)', () => {
    const s = state({
      mode: 'GUIDED',
      armed: true,
      position: { lat: 29.1, lng: 48.2, altM: 10, relAltM: 5 },
    })
    const prompt = buildNarratePrompt({ state: s, question: 'status?' })
    expect(prompt).toContain('GUIDED')
    expect(prompt).toContain('true')
    expect(prompt).toContain('29.1')
    expect(prompt).toContain('48.2')
  })

  it('includes the alert when narrating an alert', () => {
    const alert: Alert = { code: 'BATTERY_LOW', severity: 'critical', message: 'battery at 10%' }
    const prompt = buildNarratePrompt({ state: state({}), alert })
    expect(prompt).toContain('BATTERY_LOW')
    expect(prompt).toContain('critical')
    expect(prompt).toContain('battery at 10%')
  })

  it('includes the operator question when narrating a question', () => {
    const prompt = buildNarratePrompt({ state: state({}), question: 'how much battery is left?' })
    expect(prompt).toContain('how much battery is left?')
  })

  it('falls back to a generic status narration when neither alert nor question is given', () => {
    const prompt = buildNarratePrompt({ state: state({}) })
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain(AI_SYSTEM_PREAMBLE)
  })
})

describe('buildDebriefPrompt', () => {
  const stats: FlightStats = {
    durationSec: 125,
    maxAltM: 42,
    maxGroundMps: 6.5,
    minBatteryPct: 38,
    modeChanges: ['GUIDED', 'AUTO', 'RTL'],
    alertHistory: [{ code: 'GPS_DEGRADED', severity: 'warn', message: 'GPS fix type 2 while armed' }],
    waypointsFlown: 3,
  }

  it('includes the safety preamble', () => {
    expect(buildDebriefPrompt(stats)).toContain(AI_SYSTEM_PREAMBLE)
  })

  it('includes every stat value', () => {
    const prompt = buildDebriefPrompt(stats)
    expect(prompt).toContain('125')
    expect(prompt).toContain('42')
    expect(prompt).toContain('6.5')
    expect(prompt).toContain('38')
    expect(prompt).toContain('3')
    expect(prompt).toContain('GUIDED')
    expect(prompt).toContain('AUTO')
    expect(prompt).toContain('RTL')
  })

  it('includes alert history entries', () => {
    const prompt = buildDebriefPrompt(stats)
    expect(prompt).toContain('GPS_DEGRADED')
    expect(prompt).toContain('GPS fix type 2 while armed')
  })

  it('handles an empty alert history and empty mode changes', () => {
    const emptyStats: FlightStats = {
      durationSec: 0,
      maxAltM: 0,
      maxGroundMps: 0,
      minBatteryPct: 100,
      modeChanges: [],
      alertHistory: [],
      waypointsFlown: 0,
    }
    const prompt = buildDebriefPrompt(emptyStats)
    expect(prompt.length).toBeGreaterThan(0)
  })
})

describe('computeFlightStats', () => {
  it('returns all-zero/defaults for an empty sample buffer', () => {
    const stats = computeFlightStats([], [])
    expect(stats).toEqual<FlightStats>({
      durationSec: 0,
      maxAltM: 0,
      maxGroundMps: 0,
      minBatteryPct: 100,
      modeChanges: [],
      alertHistory: [],
      waypointsFlown: 0,
    })
  })

  it('computes durationSec from the span of lastHeartbeatMs across samples', () => {
    const samples = [
      state({ lastHeartbeatMs: 1_000 }),
      state({ lastHeartbeatMs: 5_000 }),
      state({ lastHeartbeatMs: 21_000 }),
    ]
    const stats = computeFlightStats(samples, [])
    expect(stats.durationSec).toBe(20)
  })

  it('durationSec is 0 when fewer than two samples carry a heartbeat timestamp', () => {
    const samples = [state({ lastHeartbeatMs: null }), state({ lastHeartbeatMs: 4_000 })]
    expect(computeFlightStats(samples, []).durationSec).toBe(0)
  })

  it('computes maxAltM from the highest relAltM seen', () => {
    const samples = [
      state({ position: { lat: 0, lng: 0, altM: 0, relAltM: 10 } }),
      state({ position: { lat: 0, lng: 0, altM: 0, relAltM: 55 } }),
      state({ position: { lat: 0, lng: 0, altM: 0, relAltM: 30 } }),
    ]
    expect(computeFlightStats(samples, []).maxAltM).toBe(55)
  })

  it('computes maxGroundMps from the highest groundMps seen', () => {
    const samples = [
      state({ speed: { groundMps: 2, airMps: 2, climbMps: 0 } }),
      state({ speed: { groundMps: 9.2, airMps: 9, climbMps: 1 } }),
    ]
    expect(computeFlightStats(samples, []).maxGroundMps).toBe(9.2)
  })

  it('computes minBatteryPct from the lowest remainingPct seen', () => {
    const samples = [
      state({ battery: { voltageV: 12.4, remainingPct: 80 } }),
      state({ battery: { voltageV: 11.8, remainingPct: 22 } }),
      state({ battery: { voltageV: 11.9, remainingPct: 40 } }),
    ]
    expect(computeFlightStats(samples, []).minBatteryPct).toBe(22)
  })

  it('minBatteryPct defaults to 100 when no sample carries battery data', () => {
    const samples = [state({ battery: null }), state({ battery: null })]
    expect(computeFlightStats(samples, []).minBatteryPct).toBe(100)
  })

  it('extracts modeChanges as deduped consecutive mode transitions, ignoring the empty initial mode', () => {
    const samples = [
      state({ mode: '' }),
      state({ mode: 'GUIDED' }),
      state({ mode: 'GUIDED' }),
      state({ mode: 'AUTO' }),
      state({ mode: 'AUTO' }),
      state({ mode: 'RTL' }),
    ]
    expect(computeFlightStats(samples, []).modeChanges).toEqual(['GUIDED', 'AUTO', 'RTL'])
  })

  it('counts waypointsFlown as the number of times the vehicle entered AUTO mode', () => {
    const samples = [
      state({ mode: 'GUIDED' }),
      state({ mode: 'AUTO' }), // enter AUTO (1)
      state({ mode: 'AUTO' }),
      state({ mode: 'GUIDED' }), // leave AUTO
      state({ mode: 'AUTO' }), // re-enter AUTO (2)
      state({ mode: 'RTL' }),
    ]
    expect(computeFlightStats(samples, []).waypointsFlown).toBe(2)
  })

  it('waypointsFlown is 0 when AUTO mode is never entered', () => {
    const samples = [state({ mode: 'GUIDED' }), state({ mode: 'GUIDED' })]
    expect(computeFlightStats(samples, []).waypointsFlown).toBe(0)
  })

  it('carries the given alerts through as alertHistory unchanged', () => {
    const alerts: Alert[] = [
      { code: 'LINK_STALE', severity: 'warn', message: 'no heartbeat for 4.0s' },
      { code: 'BATTERY_LOW', severity: 'critical', message: 'battery at 10%' },
    ]
    expect(computeFlightStats([], alerts).alertHistory).toEqual(alerts)
  })
})
