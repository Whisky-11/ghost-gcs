import { describe, it, expect } from 'vitest'
import { validateMission, missionWarnings, type Mission, type MissionItem } from '../model.js'

function item(partial: Partial<MissionItem> & Pick<MissionItem, 'seq' | 'command'>): MissionItem {
  return { lat: 47.3977, lng: 8.5456, altM: 20, ...partial }
}

describe('validateMission', () => {
  it('accepts a well-formed mission (TAKEOFF, WAYPOINT, RTL last)', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF' }),
        item({ seq: 1, command: 'WAYPOINT' }),
        item({ seq: 2, command: 'RTL' }),
      ],
    }
    expect(validateMission(m)).toEqual({ ok: true })
  })

  it('rejects an empty mission', () => {
    const m: Mission = { items: [] }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('rejects non-contiguous seq (gap)', () => {
    const m: Mission = {
      items: [item({ seq: 0, command: 'TAKEOFF' }), item({ seq: 2, command: 'RTL' })],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('rejects seq not starting at 0', () => {
    const m: Mission = {
      items: [item({ seq: 1, command: 'TAKEOFF' }), item({ seq: 2, command: 'RTL' })],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate seq', () => {
    const m: Mission = {
      items: [item({ seq: 0, command: 'TAKEOFF' }), item({ seq: 0, command: 'RTL' })],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('accepts out-of-order array as long as seq set is contiguous 0..n-1', () => {
    const m: Mission = {
      items: [item({ seq: 1, command: 'WAYPOINT' }), item({ seq: 0, command: 'TAKEOFF' })],
    }
    expect(validateMission(m)).toEqual({ ok: true })
  })

  it('rejects altM below 2 for TAKEOFF', () => {
    const m: Mission = { items: [item({ seq: 0, command: 'TAKEOFF', altM: 1 })] }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('rejects altM above 120 for WAYPOINT', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF' }),
        item({ seq: 1, command: 'WAYPOINT', altM: 121 }),
      ],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('accepts altM at the exact bounds (2 and 120)', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF', altM: 2 }),
        item({ seq: 1, command: 'WAYPOINT', altM: 120 }),
      ],
    }
    expect(validateMission(m)).toEqual({ ok: true })
  })

  it('rejects RTL not as the last item', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF' }),
        item({ seq: 1, command: 'RTL' }),
        item({ seq: 2, command: 'WAYPOINT' }),
      ],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('rejects LAND not as the last item', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF' }),
        item({ seq: 1, command: 'LAND' }),
        item({ seq: 2, command: 'WAYPOINT' }),
      ],
    }
    const result = validateMission(m)
    expect(result.ok).toBe(false)
  })

  it('accepts LAND as the last item', () => {
    const m: Mission = {
      items: [item({ seq: 0, command: 'TAKEOFF' }), item({ seq: 1, command: 'LAND' })],
    }
    expect(validateMission(m)).toEqual({ ok: true })
  })
})

describe('missionWarnings', () => {
  it('warns when the mission does not start with TAKEOFF', () => {
    const m: Mission = {
      items: [item({ seq: 0, command: 'WAYPOINT' }), item({ seq: 1, command: 'RTL' })],
    }
    const warnings = missionWarnings(m)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => /takeoff/i.test(w))).toBe(true)
  })

  it('warns when the mission has no terminal RTL/LAND item', () => {
    const m: Mission = {
      items: [item({ seq: 0, command: 'TAKEOFF' }), item({ seq: 1, command: 'WAYPOINT' })],
    }
    const warnings = missionWarnings(m)
    expect(warnings.some((w) => /rtl|land|terminal/i.test(w))).toBe(true)
  })

  it('returns no warnings for a well-formed mission', () => {
    const m: Mission = {
      items: [
        item({ seq: 0, command: 'TAKEOFF' }),
        item({ seq: 1, command: 'WAYPOINT' }),
        item({ seq: 2, command: 'RTL' }),
      ],
    }
    expect(missionWarnings(m)).toEqual([])
  })

  it('returns no warnings for an empty mission (validateMission owns that error)', () => {
    const m: Mission = { items: [] }
    expect(missionWarnings(m)).toEqual([])
  })
})
