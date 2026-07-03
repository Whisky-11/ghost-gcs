// Mode dropdown + ArmSlider + DISARM (double-click) + takeoff altitude input
// + RTL — wired to useTelemetry's rpc(). Gating comes from lib/controls.ts's
// pure controlAvailability(); every button also carries a title tooltip
// explaining why it's disabled. Every rpc call surfaces a toast (success or
// the failure's error code + friendly text).

'use client'

import { useState, type CSSProperties } from 'react'
import { ArmSlider } from './ArmSlider'
import {
  TAKEOFF_ALT_DEFAULT,
  armDisabledReason,
  clampTakeoffAlt,
  controlAvailability,
  describeRpcError,
  disarmDisabledReason,
  rtlDisabledReason,
  takeoffDisabledReason,
  toastStore,
} from '@/lib/controls'
import { TAKEOFF_ALT_MAX, TAKEOFF_ALT_MIN, type RpcMethod, type RpcParams, type TelemetryState } from '@/lib/types'

interface FlightControlsProps {
  state: TelemetryState | null
  rpc(method: RpcMethod, params?: RpcParams): Promise<void>
}

function buttonStyle(enabled: boolean): CSSProperties {
  return {
    fontFamily: 'monospace',
    fontSize: 13,
    padding: '9px 12px',
    borderRadius: 4,
    border: `1px solid ${enabled ? 'var(--fg-dim)' : 'var(--border)'}`,
    background: enabled ? 'var(--panel)' : 'var(--bg)',
    color: enabled ? 'var(--fg)' : 'var(--fg-dim)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    width: '100%',
  }
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'monospace',
  fontSize: 11,
  color: 'var(--fg-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const inputStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
  padding: '7px 8px',
  background: 'var(--panel)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 4,
}

export function FlightControls({ state, rpc }: FlightControlsProps) {
  const availability = controlAvailability(state)
  const [altInput, setAltInput] = useState(String(TAKEOFF_ALT_DEFAULT))

  async function run(method: RpcMethod, params: RpcParams | undefined, successText: string): Promise<void> {
    try {
      await rpc(method, params)
      toastStore.add('success', successText)
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      toastStore.add('error', `${code}: ${describeRpcError(code)}`)
    }
  }

  function commitAlt(): number {
    const parsed = Number(altInput)
    const clamped = clampTakeoffAlt(parsed)
    setAltInput(String(clamped))
    return clamped
  }

  const modeDisabledReason = !state?.connected ? 'Not connected to vehicle' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg-dim)', textTransform: 'uppercase' }}>
        Flight Controls
      </span>

      <label style={fieldLabelStyle}>
        Mode
        <select
          value={state?.mode ?? ''}
          disabled={!state?.connected || availability.modes.length === 0}
          title={modeDisabledReason ?? undefined}
          onChange={(e) => void run('setMode', { mode: e.target.value }, `Mode set to ${e.target.value}`)}
          style={inputStyle}
        >
          {state?.mode && !availability.modes.includes(state.mode) && <option value={state.mode}>{state.mode}</option>}
          {availability.modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div style={fieldLabelStyle}>
        Arm
        <ArmSlider
          disabled={!availability.canArm}
          disabledReason={armDisabledReason(state)}
          onArm={() => void run('arm', undefined, 'Armed')}
        />
      </div>

      <button
        type="button"
        disabled={!availability.canDisarm}
        title={disarmDisabledReason(state) ?? 'Double-click to disarm'}
        onDoubleClick={() => void run('disarm', undefined, 'Disarmed')}
        style={buttonStyle(availability.canDisarm)}
      >
        DISARM
      </button>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ ...fieldLabelStyle, flex: 1 }}>
          Takeoff Alt (m)
          <input
            type="number"
            min={TAKEOFF_ALT_MIN}
            max={TAKEOFF_ALT_MAX}
            value={altInput}
            onChange={(e) => setAltInput(e.target.value)}
            onBlur={commitAlt}
            style={inputStyle}
          />
        </label>
        <button
          type="button"
          disabled={!availability.canTakeoff}
          title={takeoffDisabledReason(state) ?? 'Command takeoff'}
          onClick={() => {
            const altM = commitAlt()
            void run('takeoff', { altM }, `Takeoff to ${altM}m`)
          }}
          style={{ ...buttonStyle(availability.canTakeoff), width: 'auto', padding: '9px 14px', flexShrink: 0 }}
        >
          TAKEOFF
        </button>
      </div>

      <button
        type="button"
        disabled={!availability.canRtl}
        title={rtlDisabledReason(state) ?? 'Return to launch'}
        onClick={() => void run('rtl', undefined, 'RTL commanded')}
        style={buttonStyle(availability.canRtl)}
      >
        RTL
      </button>
    </div>
  )
}
