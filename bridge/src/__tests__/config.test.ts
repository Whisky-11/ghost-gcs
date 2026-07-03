import { describe, it, expect } from 'vitest'
import { CONFIG } from '../config.js'

describe('config', () => {
  it('pins the spec ports', () => {
    expect(CONFIG.sitlTcp.port).toBe(5760)
    expect(CONFIG.wsPort).toBe(8090)
    expect(CONFIG.telemetryHz).toBe(5)
  })
})
