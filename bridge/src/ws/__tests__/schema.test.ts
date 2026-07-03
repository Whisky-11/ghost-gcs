import { describe, it, expect } from 'vitest'
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
