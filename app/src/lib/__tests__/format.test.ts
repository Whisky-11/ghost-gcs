import { describe, expect, it } from 'vitest'
import { batteryColor, fmtAlt, fmtCoord, fmtSpeed, gpsFixLabel, linkStatus } from '../format'

describe('fmtAlt', () => {
  it('formats meters to 1 decimal with unit suffix', () => {
    expect(fmtAlt(24.3)).toBe('24.3 m')
    expect(fmtAlt(0)).toBe('0.0 m')
    expect(fmtAlt(-1.25)).toBe('-1.3 m')
    expect(fmtAlt(100)).toBe('100.0 m')
  })
})

describe('fmtSpeed', () => {
  it('formats m/s to 1 decimal with unit suffix', () => {
    expect(fmtSpeed(5.2)).toBe('5.2 m/s')
    expect(fmtSpeed(0)).toBe('0.0 m/s')
    expect(fmtSpeed(12.96)).toBe('13.0 m/s')
  })
})

describe('fmtCoord', () => {
  it('formats a decimal-degree coordinate to 5 decimal places', () => {
    expect(fmtCoord(29.3375)).toBe('29.33750')
    expect(fmtCoord(47.97440001)).toBe('47.97440')
    expect(fmtCoord(-29.123456)).toBe('-29.12346')
    expect(fmtCoord(0)).toBe('0.00000')
  })
})

describe('batteryColor', () => {
  it('is ok strictly above 30%', () => {
    expect(batteryColor(100)).toBe('ok')
    expect(batteryColor(30.1)).toBe('ok')
  })

  it('is warn at the 30% boundary down to just above 15%', () => {
    expect(batteryColor(30)).toBe('warn')
    expect(batteryColor(20)).toBe('warn')
    expect(batteryColor(15.1)).toBe('warn')
  })

  it('is crit at the 15% boundary and below', () => {
    expect(batteryColor(15)).toBe('crit')
    expect(batteryColor(5)).toBe('crit')
    expect(batteryColor(0)).toBe('crit')
  })
})

describe('gpsFixLabel', () => {
  it('maps every documented fixType 0-6', () => {
    expect(gpsFixLabel(0)).toBe('NO FIX')
    expect(gpsFixLabel(1)).toBe('NO FIX')
    expect(gpsFixLabel(2)).toBe('2D')
    expect(gpsFixLabel(3)).toBe('3D')
    expect(gpsFixLabel(4)).toBe('DGPS')
    expect(gpsFixLabel(5)).toBe('RTK')
    expect(gpsFixLabel(6)).toBe('RTK')
  })

  it('falls back gracefully for an undocumented fixType', () => {
    expect(gpsFixLabel(7)).toBe('FIX(7)')
    expect(gpsFixLabel(-1)).toBe('FIX(-1)')
  })
})

describe('linkStatus', () => {
  it('is crit when no heartbeat has ever been received', () => {
    expect(linkStatus(null, 1_000_000)).toBe('crit')
  })

  it('is ok up to and including 3000ms of age', () => {
    expect(linkStatus(1_000_000, 1_000_000)).toBe('ok')
    expect(linkStatus(1_000_000, 1_002_999)).toBe('ok')
    expect(linkStatus(1_000_000, 1_003_000)).toBe('ok')
  })

  it('is crit past 3000ms of age', () => {
    expect(linkStatus(1_000_000, 1_003_001)).toBe('crit')
    expect(linkStatus(1_000_000, 1_010_000)).toBe('crit')
  })
})
