// Upload / start / clear controls for the mission built in the map's
// MissionEditor (Task 9). Gating comes from lib/mission-controls.ts's pure
// missionControlAvailability(); every button also carries a title tooltip
// explaining why it's disabled — same pattern as FlightControls.tsx.
//
// Spec safety invariant: the AI never commands the vehicle, and mission
// upload/AUTO-start are explicit human UI actions. Start additionally goes
// behind a deliberate confirm gesture (mirrors FlightControls' armed
// mode-change confirm) — there is no single-click path to AUTO here.

'use client'

import { useState, type CSSProperties } from 'react'
import { describeRpcError, toastStore } from '@/lib/controls'
import {
  MISSION_START_CONFIRM_TEXT,
  clearDisabledReason,
  hasUploadableMission,
  missionControlAvailability,
  startDisabledReason,
  uploadDisabledReason,
} from '@/lib/mission-controls'
import type { Mission, RpcMethod, RpcParams, TelemetryState } from '@/lib/types'

interface MissionControlsProps {
  state: TelemetryState | null
  /** The mission currently built in the map's editor (VehicleMap's
   * onMissionChange escape hatch, lifted to page.tsx). */
  mission: Mission
  /** Client-tracked: true once uploadMission has succeeded, reset to false
   * on any further edit or on a successful clearMission. */
  missionUploaded: boolean
  onMissionUploadedChange: (uploaded: boolean) => void
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
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

export function MissionControls({ state, mission, missionUploaded, onMissionUploadedChange, rpc }: MissionControlsProps) {
  const hasMission = hasUploadableMission(mission)
  const availability = missionControlAvailability(state, hasMission, missionUploaded)
  const [pendingStart, setPendingStart] = useState(false)

  async function run(method: RpcMethod, params: RpcParams | undefined, successText: string, onSuccess?: () => void): Promise<void> {
    try {
      await rpc(method, params)
      toastStore.add('success', successText)
      onSuccess?.()
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      toastStore.add('error', `${code}: ${describeRpcError(code)}`)
    }
  }

  function handleUpload(): void {
    void run('uploadMission', { mission }, `Uploaded ${mission.items.length}-item mission`, () => onMissionUploadedChange(true))
  }

  function requestStart(): void {
    setPendingStart(true)
  }

  function confirmStart(): void {
    setPendingStart(false)
    void run('startMission', undefined, 'AUTO mission started')
  }

  function cancelStart(): void {
    setPendingStart(false)
  }

  function handleClear(): void {
    void run('clearMission', undefined, 'Mission cleared from vehicle', () => onMissionUploadedChange(false))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg-dim)', textTransform: 'uppercase' }}>
        Mission Controls
      </span>

      <button
        type="button"
        disabled={!availability.canUpload}
        title={uploadDisabledReason(state, mission) ?? 'Upload the built mission to the vehicle'}
        onClick={handleUpload}
        style={buttonStyle(availability.canUpload)}
      >
        UPLOAD MISSION{mission.items.length > 0 ? ` (${mission.items.length})` : ''}
      </button>

      {pendingStart ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: 12 }}>
          <span style={{ color: 'var(--fg)' }}>{MISSION_START_CONFIRM_TEXT}</span>
          <button
            type="button"
            onClick={confirmStart}
            style={{ ...buttonStyle(true), width: 'auto', padding: '4px 10px', border: '1px solid var(--crit)' }}
          >
            Confirm
          </button>
          <button type="button" onClick={cancelStart} style={{ ...buttonStyle(true), width: 'auto', padding: '4px 10px' }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!availability.canStart}
          title={startDisabledReason(state, missionUploaded) ?? MISSION_START_CONFIRM_TEXT}
          onClick={requestStart}
          style={buttonStyle(availability.canStart)}
        >
          START MISSION (AUTO)
        </button>
      )}

      <button
        type="button"
        disabled={!availability.canClear}
        title={clearDisabledReason(state) ?? 'Clear the uploaded mission from the vehicle'}
        onClick={handleClear}
        style={buttonStyle(availability.canClear)}
      >
        CLEAR MISSION
      </button>
    </div>
  )
}
