import { describe, expect, it, vi } from 'vitest'
import {
  ARM_FIRE_THRESHOLD,
  TAKEOFF_ALT_DEFAULT,
  armDisabledReason,
  armSliderProgress,
  armSliderShouldFire,
  clampTakeoffAlt,
  controlAvailability,
  createToastStore,
  describeRpcError,
  disarmDisabledReason,
  modeChangeNeedsConfirm,
  rtlDisabledReason,
  takeoffDisabledReason,
  toastReducer,
} from '../controls'
import type { TelemetryState } from '../types'

function makeState(overrides: Partial<TelemetryState> = {}): TelemetryState {
  return {
    connected: true,
    lastHeartbeatMs: 1_000,
    vehicleType: 'copter',
    armed: false,
    mode: 'STABILIZE',
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

describe('controlAvailability', () => {
  it('null state: everything disabled, no modes', () => {
    expect(controlAvailability(null)).toEqual({
      canArm: false,
      canDisarm: false,
      canTakeoff: false,
      canRtl: false,
      modes: [],
    })
  })

  it('disconnected disarmed copter: cannot arm (not connected)', () => {
    const a = controlAvailability(makeState({ connected: false, armed: false }))
    expect(a.canArm).toBe(false)
    expect(a.canDisarm).toBe(false)
    expect(a.canTakeoff).toBe(false)
    expect(a.canRtl).toBe(false)
  })

  it('disconnected but still-armed copter: canDisarm/canRtl follow armed only (brief\'s literal gates)', () => {
    const a = controlAvailability(makeState({ connected: false, armed: true, mode: 'GUIDED' }))
    expect(a.canArm).toBe(false)
    expect(a.canDisarm).toBe(true)
    expect(a.canRtl).toBe(true)
  })

  it('connected disarmed copter: can arm only, copter mode list', () => {
    const a = controlAvailability(makeState({ connected: true, armed: false, mode: 'GUIDED' }))
    expect(a).toEqual({
      canArm: true,
      canDisarm: false,
      canTakeoff: false,
      canRtl: false,
      modes: ['GUIDED', 'LOITER', 'RTL', 'LAND', 'STABILIZE'],
    })
  })

  it('connected armed copter in GUIDED: can disarm/takeoff/rtl, cannot arm', () => {
    const a = controlAvailability(makeState({ connected: true, armed: true, mode: 'GUIDED' }))
    expect(a.canArm).toBe(false)
    expect(a.canDisarm).toBe(true)
    expect(a.canTakeoff).toBe(true)
    expect(a.canRtl).toBe(true)
  })

  it('connected armed copter NOT in GUIDED: cannot takeoff', () => {
    expect(controlAvailability(makeState({ connected: true, armed: true, mode: 'LOITER' })).canTakeoff).toBe(false)
  })

  it('connected armed rover, even in "GUIDED": cannot takeoff (not a copter)', () => {
    const a = controlAvailability(makeState({ connected: true, armed: true, mode: 'GUIDED', vehicleType: 'rover' }))
    expect(a.canTakeoff).toBe(false)
    expect(a.canDisarm).toBe(true)
    expect(a.canRtl).toBe(true)
    expect(a.modes).toEqual(['MANUAL', 'HOLD', 'GUIDED', 'RTL', 'AUTO'])
  })

  it('connected disarmed rover: can arm, rover mode list', () => {
    const a = controlAvailability(makeState({ connected: true, armed: false, vehicleType: 'rover', mode: 'MANUAL' }))
    expect(a.canArm).toBe(true)
    expect(a.modes).toEqual(['MANUAL', 'HOLD', 'GUIDED', 'RTL', 'AUTO'])
  })

  it('unknown vehicleType: no modes offered', () => {
    expect(controlAvailability(makeState({ vehicleType: 'unknown' })).modes).toEqual([])
  })
})

describe('disabled-reason helpers', () => {
  it('armDisabledReason', () => {
    expect(armDisabledReason(null)).toBeTruthy()
    expect(armDisabledReason(makeState({ connected: false }))).toBeTruthy()
    expect(armDisabledReason(makeState({ connected: true, armed: true }))).toBeTruthy()
    expect(armDisabledReason(makeState({ connected: true, armed: false }))).toBeNull()
  })

  it('disarmDisabledReason', () => {
    expect(disarmDisabledReason(null)).toBeTruthy()
    expect(disarmDisabledReason(makeState({ armed: false }))).toBeTruthy()
    expect(disarmDisabledReason(makeState({ armed: true }))).toBeNull()
  })

  it('takeoffDisabledReason', () => {
    expect(
      takeoffDisabledReason(makeState({ vehicleType: 'rover', armed: true, mode: 'GUIDED' })),
    ).toBeTruthy()
    expect(
      takeoffDisabledReason(makeState({ vehicleType: 'copter', armed: false, mode: 'GUIDED' })),
    ).toBeTruthy()
    expect(
      takeoffDisabledReason(makeState({ vehicleType: 'copter', armed: true, mode: 'LOITER' })),
    ).toBeTruthy()
    expect(
      takeoffDisabledReason(makeState({ vehicleType: 'copter', armed: true, mode: 'GUIDED' })),
    ).toBeNull()
    expect(takeoffDisabledReason(null)).toBeTruthy()
  })

  it('rtlDisabledReason', () => {
    expect(rtlDisabledReason(null)).toBeTruthy()
    expect(rtlDisabledReason(makeState({ armed: false }))).toBeTruthy()
    expect(rtlDisabledReason(makeState({ armed: true }))).toBeNull()
  })
})

describe('modeChangeNeedsConfirm', () => {
  it('requires confirm when armed (spec invariant 3)', () => {
    expect(modeChangeNeedsConfirm(makeState({ armed: true }))).toBe(true)
  })

  it('fires immediately when disarmed (benign ground mode change)', () => {
    expect(modeChangeNeedsConfirm(makeState({ armed: false }))).toBe(false)
  })

  it('fires immediately when state is null (no vehicle to confirm against)', () => {
    expect(modeChangeNeedsConfirm(null)).toBe(false)
  })
})

describe('armSliderProgress', () => {
  it('is 0 at the start position', () => {
    expect(armSliderProgress(100, 100, 200)).toBe(0)
  })

  it('scales linearly with drag distance over the given width', () => {
    expect(armSliderProgress(0, 100, 200)).toBe(0.5)
    expect(armSliderProgress(0, 200, 200)).toBe(1)
  })

  it('clamps to [0,1] beyond the track', () => {
    expect(armSliderProgress(0, 500, 200)).toBe(1)
    expect(armSliderProgress(0, -500, 200)).toBe(0)
  })

  it('returns 0 for a non-positive width (unmeasured track)', () => {
    expect(armSliderProgress(0, 100, 0)).toBe(0)
    expect(armSliderProgress(0, 100, -10)).toBe(0)
  })
})

describe('armSliderShouldFire', () => {
  it('fires only at or above the confirm threshold (spec invariant 3)', () => {
    expect(armSliderShouldFire(0)).toBe(false)
    expect(armSliderShouldFire(0.99)).toBe(false)
    expect(armSliderShouldFire(1)).toBe(true)
    expect(armSliderShouldFire(ARM_FIRE_THRESHOLD)).toBe(true)
  })
})

describe('clampTakeoffAlt', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampTakeoffAlt(20)).toBe(20)
    expect(clampTakeoffAlt(2)).toBe(2)
    expect(clampTakeoffAlt(120)).toBe(120)
  })

  it('clamps below the 2m minimum', () => {
    expect(clampTakeoffAlt(0)).toBe(2)
    expect(clampTakeoffAlt(-5)).toBe(2)
  })

  it('clamps above the 120m maximum', () => {
    expect(clampTakeoffAlt(500)).toBe(120)
  })

  it('falls back to the default (20) for non-finite input', () => {
    expect(clampTakeoffAlt(NaN)).toBe(TAKEOFF_ALT_DEFAULT)
    expect(clampTakeoffAlt(Infinity)).toBe(TAKEOFF_ALT_DEFAULT)
  })
})

describe('describeRpcError', () => {
  it('maps known codes to friendly text', () => {
    expect(describeRpcError('ALREADY_ARMED')).not.toBe('ALREADY_ARMED')
    expect(describeRpcError('ACK_TIMEOUT')).not.toBe('ACK_TIMEOUT')
    expect(describeRpcError('NOT_CONNECTED')).not.toBe('NOT_CONNECTED')
  })

  it('falls back to the raw code for unmapped codes', () => {
    expect(describeRpcError('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('toastReducer', () => {
  it('add appends a toast', () => {
    const t = { id: '1', kind: 'success' as const, text: 'ok' }
    expect(toastReducer([], { type: 'add', toast: t })).toEqual([t])
  })

  it('expire removes only the matching id', () => {
    const t1 = { id: '1', kind: 'success' as const, text: 'a' }
    const t2 = { id: '2', kind: 'error' as const, text: 'b' }
    expect(toastReducer([t1, t2], { type: 'expire', id: '1' })).toEqual([t2])
  })

  it('expire is a no-op for an unknown id', () => {
    const t1 = { id: '1', kind: 'success' as const, text: 'a' }
    expect(toastReducer([t1], { type: 'expire', id: 'nope' })).toEqual([t1])
  })
})

describe('createToastStore', () => {
  it('add stores the toast and notifies subscribers; auto-expires after ttlMs', () => {
    vi.useFakeTimers()
    try {
      const store = createToastStore({ ttlMs: 1000, idFactory: () => 'fixed-id' })
      const listener = vi.fn()
      store.subscribe(listener)

      const id = store.add('success', 'Armed')
      expect(id).toBe('fixed-id')
      expect(store.getToasts()).toEqual([{ id: 'fixed-id', kind: 'success', text: 'Armed' }])
      expect(listener).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(999)
      expect(store.getToasts()).toHaveLength(1)

      vi.advanceTimersByTime(1)
      expect(store.getToasts()).toEqual([])
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remove() removes before the ttl fires', () => {
    vi.useFakeTimers()
    try {
      const store = createToastStore({ ttlMs: 5000, idFactory: () => 'x' })
      const id = store.add('error', 'ALREADY_ARMED: Vehicle is already armed')
      store.remove(id)
      expect(store.getToasts()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('subscribe returns an unsubscribe function', () => {
    const store = createToastStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.add('error', 'x')
    expect(listener).not.toHaveBeenCalled()
  })
})
