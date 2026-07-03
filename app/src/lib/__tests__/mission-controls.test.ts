import { describe, expect, it } from 'vitest'
import {
  MISSION_START_CONFIRM_TEXT,
  clearDisabledReason,
  hasUploadableMission,
  missionControlAvailability,
  missionExceedsMax,
  startDisabledReason,
  uploadDisabledReason,
} from '../mission-controls'
import { MISSION_MAX_ITEMS, type Mission, type MissionItem, type TelemetryState } from '../types'

function makeState(overrides: Partial<TelemetryState> = {}): TelemetryState {
  return {
    connected: true,
    lastHeartbeatMs: 1_000,
    vehicleType: 'copter',
    armed: false,
    mode: 'GUIDED',
    position: null,
    attitude: null,
    speed: null,
    battery: null,
    gps: null,
    home: null,
    statusTexts: [],
    ...overrides,
  }
}

function item(seq: number): MissionItem {
  return { seq, command: 'WAYPOINT', lat: 29.3, lng: 47.9, altM: 30 }
}

function makeMission(count: number): Mission {
  return { items: Array.from({ length: count }, (_, i) => item(i)) }
}

const EMPTY: Mission = { items: [] }
const ONE: Mission = makeMission(1)

describe('missionControlAvailability', () => {
  it('null state: everything disabled', () => {
    expect(missionControlAvailability(null, true, true)).toEqual({
      canUpload: false,
      canStart: false,
      canClear: false,
    })
  })

  it('disconnected: everything disabled regardless of hasMission/missionUploaded', () => {
    const a = missionControlAvailability(makeState({ connected: false, armed: true }), true, true)
    expect(a).toEqual({ canUpload: false, canStart: false, canClear: false })
  })

  it('connected, no mission built: canUpload false, canClear true', () => {
    const a = missionControlAvailability(makeState(), false, false)
    expect(a.canUpload).toBe(false)
    expect(a.canClear).toBe(true)
  })

  it('connected + hasMission: canUpload true', () => {
    const a = missionControlAvailability(makeState(), true, false)
    expect(a.canUpload).toBe(true)
  })

  it('connected + hasMission + disarmed + uploaded: canStart false (not armed)', () => {
    const a = missionControlAvailability(makeState({ armed: false }), true, true)
    expect(a.canStart).toBe(false)
  })

  it('connected + armed + NOT uploaded: canStart false', () => {
    const a = missionControlAvailability(makeState({ armed: true }), true, false)
    expect(a.canStart).toBe(false)
  })

  it('connected + armed + uploaded: canStart true', () => {
    const a = missionControlAvailability(makeState({ armed: true }), true, true)
    expect(a.canStart).toBe(true)
  })

  it('canClear only requires connected — true even with no mission / not armed / not uploaded', () => {
    const a = missionControlAvailability(makeState({ armed: false }), false, false)
    expect(a.canClear).toBe(true)
  })

  it('connected but disarmed with a mission uploaded still cannot start', () => {
    const a = missionControlAvailability(makeState({ armed: false }), true, true)
    expect(a).toEqual({ canUpload: true, canStart: false, canClear: true })
  })
})

describe('missionExceedsMax / hasUploadableMission', () => {
  it('empty mission does not exceed max but is not uploadable', () => {
    expect(missionExceedsMax(EMPTY)).toBe(false)
    expect(hasUploadableMission(EMPTY)).toBe(false)
  })

  it('mission at exactly MISSION_MAX_ITEMS does not exceed max and is uploadable', () => {
    const m = makeMission(MISSION_MAX_ITEMS)
    expect(missionExceedsMax(m)).toBe(false)
    expect(hasUploadableMission(m)).toBe(true)
  })

  it('mission over MISSION_MAX_ITEMS exceeds max and is not uploadable', () => {
    const m = makeMission(MISSION_MAX_ITEMS + 1)
    expect(missionExceedsMax(m)).toBe(true)
    expect(hasUploadableMission(m)).toBe(false)
  })

  it('non-empty, within-bounds mission is uploadable', () => {
    expect(hasUploadableMission(ONE)).toBe(true)
  })
})

describe('uploadDisabledReason', () => {
  it('not connected', () => {
    expect(uploadDisabledReason(makeState({ connected: false }), ONE)).toBe('Not connected to vehicle')
  })

  it('null state', () => {
    expect(uploadDisabledReason(null, ONE)).toBe('Not connected to vehicle')
  })

  it('no mission items', () => {
    expect(uploadDisabledReason(makeState(), EMPTY)).toMatch(/no mission/i)
  })

  it('oversized mission', () => {
    const reason = uploadDisabledReason(makeState(), makeMission(MISSION_MAX_ITEMS + 1))
    expect(reason).toMatch(/exceeds max/i)
  })

  it('available: null reason', () => {
    expect(uploadDisabledReason(makeState(), ONE)).toBeNull()
  })
})

describe('startDisabledReason', () => {
  it('not connected', () => {
    expect(startDisabledReason(makeState({ connected: false }), true)).toBe('Not connected to vehicle')
  })

  it('null state', () => {
    expect(startDisabledReason(null, true)).toBe('Not connected to vehicle')
  })

  it('not armed', () => {
    expect(startDisabledReason(makeState({ armed: false }), true)).toMatch(/armed/i)
  })

  it('armed but not uploaded', () => {
    expect(startDisabledReason(makeState({ armed: true }), false)).toMatch(/upload/i)
  })

  it('available: null reason', () => {
    expect(startDisabledReason(makeState({ armed: true }), true)).toBeNull()
  })
})

describe('clearDisabledReason', () => {
  it('not connected', () => {
    expect(clearDisabledReason(makeState({ connected: false }))).toBe('Not connected to vehicle')
  })

  it('null state', () => {
    expect(clearDisabledReason(null)).toBe('Not connected to vehicle')
  })

  it('connected: available', () => {
    expect(clearDisabledReason(makeState())).toBeNull()
  })
})

describe('MISSION_START_CONFIRM_TEXT', () => {
  it('is the exact confirm-gesture copy the brief specifies', () => {
    expect(MISSION_START_CONFIRM_TEXT).toBe('Start AUTO mission?')
  })
})
