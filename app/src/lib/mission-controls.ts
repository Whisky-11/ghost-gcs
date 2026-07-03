// Pure logic for the mission-controls panel (Task 9). No React, no I/O —
// mirrors lib/controls.ts's split (gating helper + disabled-reason text +
// confirm-gate constant), kept separate from the (thin) MissionControls
// component so it's fully covered by node-env vitest without a DOM.
//
// Safety invariant 3 (spec, carried from FlightControls): starting an AUTO
// mission is a deliberate confirm gesture, never a bare click — see
// MISSION_START_CONFIRM_TEXT below, wired the same way FlightControls stages
// an armed mode-change behind an inline Confirm/Cancel.
import { MISSION_MAX_ITEMS, type Mission, type TelemetryState } from './types'

// ---------------------------------------------------------------------------
// missionControlAvailability — task-9 BINDING contract (3-arg form: state,
// hasMission, missionUploaded).
// ---------------------------------------------------------------------------

export interface MissionControlAvailability {
  canUpload: boolean
  canStart: boolean
  canClear: boolean
}

export function missionControlAvailability(
  state: TelemetryState | null,
  hasMission: boolean,
  missionUploaded: boolean,
): MissionControlAvailability {
  const connected = state?.connected ?? false
  return {
    canUpload: connected && hasMission,
    canStart: connected && (state?.armed ?? false) && missionUploaded,
    canClear: connected,
  }
}

// ---------------------------------------------------------------------------
// Client-side oversized-mission gate (defense in depth, mirrors the bridge's
// MISSION_MAX_ITEMS hard take-cap — see types.ts). A mission over the cap is
// treated as "nothing valid to upload" for gating purposes so the button
// disables with a clear reason instead of round-tripping an rpc the bridge
// will reject anyway.
// ---------------------------------------------------------------------------

export function missionExceedsMax(mission: Mission): boolean {
  return mission.items.length > MISSION_MAX_ITEMS
}

export function hasUploadableMission(mission: Mission): boolean {
  return mission.items.length > 0 && !missionExceedsMax(mission)
}

// ---------------------------------------------------------------------------
// Disabled-button tooltip reasons — separate pure functions (not part of the
// brief's fixed MissionControlAvailability shape) so each button can show
// *why* it's disabled. Returns null when the action is available.
// ---------------------------------------------------------------------------

export function uploadDisabledReason(state: TelemetryState | null, mission: Mission): string | null {
  if (!(state?.connected ?? false)) return 'Not connected to vehicle'
  if (mission.items.length === 0) return 'No mission to upload — add waypoints or generate a survey grid'
  if (missionExceedsMax(mission)) return `Mission has ${mission.items.length} items, exceeds max of ${MISSION_MAX_ITEMS}`
  return null
}

export function startDisabledReason(state: TelemetryState | null, missionUploaded: boolean): string | null {
  if (!(state?.connected ?? false)) return 'Not connected to vehicle'
  if (!(state?.armed ?? false)) return 'Vehicle must be armed'
  if (!missionUploaded) return 'Upload a mission first'
  return null
}

export function clearDisabledReason(state: TelemetryState | null): string | null {
  if (!(state?.connected ?? false)) return 'Not connected to vehicle'
  return null
}

// ---------------------------------------------------------------------------
// Start-mission confirm gate — the deliberate-confirm gesture spec invariant
// 3 requires for any command that puts the vehicle in AUTO.
// ---------------------------------------------------------------------------

export const MISSION_START_CONFIRM_TEXT = 'Start AUTO mission?'
