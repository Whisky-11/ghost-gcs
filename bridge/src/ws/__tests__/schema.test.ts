import { describe, it, expect } from 'vitest'
import { MISSION_MAX_ITEMS, type MissionItem } from '../../missions/model.js'
import { rpcRequestSchema } from '../schema.js'

// Bound check on rpc params.altM for the takeoff method — defense in depth
// alongside commands.ts's runtime BAD_PARAM guard, matching the plan's
// Task 9 UI clamp (2-120m).
describe('rpcRequestSchema altM bounds', () => {
  it.each([0, -5, 121, 10000])('rejects takeoff with altM=%i', (altM) => {
    const result = rpcRequestSchema.safeParse({ type: 'rpc', id: '1', method: 'takeoff', params: { altM } })
    expect(result.success).toBe(false)
  })

  it('accepts takeoff with altM=20', () => {
    const result = rpcRequestSchema.safeParse({ type: 'rpc', id: '1', method: 'takeoff', params: { altM: 20 } })
    expect(result.success).toBe(true)
  })
})

// Hard take-cap on uploadMission.params.mission.items (scaling-from-day-1
// rule) — structural gate mirroring missions/model.ts's validateMission
// semantic gate on the same constant.
function itemsOfLength(n: number): MissionItem[] {
  const items: MissionItem[] = []
  for (let seq = 0; seq < n; seq++) {
    items.push({ seq, command: 'WAYPOINT', lat: 29.3, lng: 47.9, altM: 20 })
  }
  return items
}

describe('rpcRequestSchema mission.items cap', () => {
  it(`accepts uploadMission with exactly ${MISSION_MAX_ITEMS} items`, () => {
    const result = rpcRequestSchema.safeParse({
      type: 'rpc',
      id: '1',
      method: 'uploadMission',
      params: { mission: { items: itemsOfLength(MISSION_MAX_ITEMS) } },
    })
    expect(result.success).toBe(true)
  })

  it(`rejects uploadMission with ${MISSION_MAX_ITEMS + 1} items`, () => {
    const result = rpcRequestSchema.safeParse({
      type: 'rpc',
      id: '1',
      method: 'uploadMission',
      params: { mission: { items: itemsOfLength(MISSION_MAX_ITEMS + 1) } },
    })
    expect(result.success).toBe(false)
  })
})
