// Pure logic for the flight-controls panel (Task 9). No React, no I/O — every
// export here is a plain function/factory over plain values, kept separate
// from the (thin) FlightControls/ArmSlider/Toasts components so it's fully
// covered by node-env vitest without a DOM.
//
// Safety invariant 3 (spec): arming requires a deliberate confirm gesture —
// armSliderProgress/armSliderShouldFire back the drag-to-100%-then-fire
// ArmSlider; there is no programmatic "just call arm()" path wired to a
// single click anywhere in the UI.
import { TAKEOFF_ALT_MAX, TAKEOFF_ALT_MIN, type TelemetryState } from './types'

// ---------------------------------------------------------------------------
// controlAvailability — task-9 brief's BINDING contract, copied verbatim.
// ---------------------------------------------------------------------------

export interface ControlAvailability {
  canArm: boolean
  canDisarm: boolean
  canTakeoff: boolean
  canRtl: boolean
  modes: string[]
}

// UI-facing mode lists (brief's exact order) — a subset of the bridge's full
// COPTER_MODES/ROVER_MODES tables (state/telemetry.ts also knows STABILIZE's
// sibling AUTO/LAND etc.); this is deliberately the curated set the brief
// names for the dropdown, not every mode the vehicle firmware supports.
const COPTER_UI_MODES = ['GUIDED', 'LOITER', 'RTL', 'LAND', 'STABILIZE']
const ROVER_UI_MODES = ['MANUAL', 'HOLD', 'GUIDED', 'RTL', 'AUTO']

export function controlAvailability(state: TelemetryState | null): ControlAvailability {
  if (state === null) {
    return { canArm: false, canDisarm: false, canTakeoff: false, canRtl: false, modes: [] }
  }
  const modes = state.vehicleType === 'copter' ? COPTER_UI_MODES : state.vehicleType === 'rover' ? ROVER_UI_MODES : []
  return {
    canArm: state.connected && !state.armed,
    canDisarm: state.armed,
    canTakeoff: state.vehicleType === 'copter' && state.armed && state.mode === 'GUIDED',
    canRtl: state.armed,
    modes,
  }
}

// ---------------------------------------------------------------------------
// Disabled-button tooltip reasons — derived from the same gates above, kept
// as separate pure functions (not part of the brief's fixed
// ControlAvailability shape) so each button can show *why* it's disabled.
// Returns null when the action is available (no tooltip needed).
// ---------------------------------------------------------------------------

export function armDisabledReason(state: TelemetryState | null): string | null {
  if (state === null || !state.connected) return 'Not connected to vehicle'
  if (state.armed) return 'Already armed'
  return null
}

export function disarmDisabledReason(state: TelemetryState | null): string | null {
  if (state === null) return 'Not connected to vehicle'
  if (!state.armed) return 'Not armed'
  return null
}

export function takeoffDisabledReason(state: TelemetryState | null): string | null {
  if (state === null || !state.connected) return 'Not connected to vehicle'
  if (state.vehicleType !== 'copter') return 'Takeoff requires a copter'
  if (!state.armed) return 'Vehicle must be armed'
  if (state.mode !== 'GUIDED') return 'Requires GUIDED mode'
  return null
}

export function rtlDisabledReason(state: TelemetryState | null): string | null {
  if (state === null) return 'Not connected to vehicle'
  if (!state.armed) return 'Not armed'
  return null
}

// ---------------------------------------------------------------------------
// ArmSlider pure helpers — drag distance -> progress, and the fire gate.
// The component only wires pointer events to these; every branch here is
// covered without touching the DOM.
// ---------------------------------------------------------------------------

/** Linear drag progress in [0,1] over `width` px of travel. Non-positive
 * `width` (not yet laid out / measured) safely returns 0 instead of NaN or
 * Infinity. */
export function armSliderProgress(startX: number, currentX: number, width: number): number {
  if (width <= 0) return 0
  const raw = (currentX - startX) / width
  return Math.min(1, Math.max(0, raw))
}

export const ARM_FIRE_THRESHOLD = 1

/** True only once the slider has been dragged all the way to 100% — the
 * deliberate-confirm gesture spec invariant 3 requires. */
export function armSliderShouldFire(progress: number): boolean {
  return progress >= ARM_FIRE_THRESHOLD
}

// ---------------------------------------------------------------------------
// Takeoff altitude clamp — default 20, bounds mirror the bridge's own
// TAKEOFF_ALT_MIN/MAX (defense in depth: client clamps too, server still
// enforces its own bound).
// ---------------------------------------------------------------------------

export const TAKEOFF_ALT_DEFAULT = 20

export function clampTakeoffAlt(value: number): number {
  if (!Number.isFinite(value)) return TAKEOFF_ALT_DEFAULT
  return Math.min(TAKEOFF_ALT_MAX, Math.max(TAKEOFF_ALT_MIN, value))
}

// ---------------------------------------------------------------------------
// RPC error -> human-readable text. The wire client (lib/ws.ts) rejects with
// `Error(code)` only (the rpc_result's `message` field isn't surfaced past
// that layer), so the toast copy is built from a local code->text map here;
// unknown codes fall back to the raw code so nothing is ever silently blank.
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  NOT_CONNECTED: 'Not connected to the vehicle link',
  ALREADY_ARMED: 'Vehicle is already armed',
  NOT_ARMED: 'Vehicle is not armed',
  BAD_MODE: 'Vehicle is not in the required mode',
  BAD_PARAM: 'Parameter out of range',
  MODE_UNKNOWN: 'Unknown flight mode for this vehicle',
  ACK_FAILED: 'Vehicle rejected the command',
  ACK_TIMEOUT: 'Vehicle did not acknowledge the command in time',
  CONNECTION_CLOSED: 'Connection to the bridge was lost',
  CLOSED_BY_CLIENT: 'Connection was closed',
  BAD_REQUEST: 'Malformed request',
  INTERNAL: 'Internal bridge error',
}

export function describeRpcError(code: string): string {
  return ERROR_MESSAGES[code] ?? code
}

// ---------------------------------------------------------------------------
// Toast store — minimal reducer-style store, no dependency. `toastReducer` is
// the pure core; `createToastStore` wraps it with a subscriber list + a
// setTimeout-driven auto-expire, testable in node with fake timers.
// ---------------------------------------------------------------------------

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  text: string
}

export type ToastAction = { type: 'add'; toast: Toast } | { type: 'expire'; id: string }

export function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case 'add':
      return [...state, action.toast]
    case 'expire':
      return state.filter((t) => t.id !== action.id)
    default:
      return state
  }
}

export interface ToastStore {
  add(kind: ToastKind, text: string): string
  remove(id: string): void
  getToasts(): Toast[]
  subscribe(listener: () => void): () => void
}

export interface CreateToastStoreOptions {
  ttlMs?: number
  idFactory?: () => string
}

const DEFAULT_TOAST_TTL_MS = 4000

export function createToastStore(options: CreateToastStoreOptions = {}): ToastStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TOAST_TTL_MS
  const idFactory = options.idFactory ?? (() => crypto.randomUUID())
  let toasts: Toast[] = []
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function remove(id: string): void {
    toasts = toastReducer(toasts, { type: 'expire', id })
    emit()
  }

  function add(kind: ToastKind, text: string): string {
    const id = idFactory()
    toasts = toastReducer(toasts, { type: 'add', toast: { id, kind, text } })
    emit()
    setTimeout(() => remove(id), ttlMs)
    return id
  }

  function getToasts(): Toast[] {
    return toasts
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { add, remove, getToasts, subscribe }
}

// App-wide singleton the components share (FlightControls pushes, Toasts
// renders) — no timers/IO run until add() is actually called.
export const toastStore = createToastStore()
