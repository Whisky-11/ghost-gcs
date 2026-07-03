// Pure formatting + status-color helpers for the instruments panel (Task 8).
// No React, no I/O — every function takes plain values and returns plain
// values, so they're unit-testable in isolation and reusable from any
// component. Callers own the null-tolerance ("—" on missing telemetry
// fields) — these formatters assume a real number/finite value.

export function fmtAlt(m: number): string {
  return `${m.toFixed(1)} m`
}

export function fmtSpeed(mps: number): string {
  return `${mps.toFixed(1)} m/s`
}

export function fmtCoord(dd: number): string {
  return dd.toFixed(5)
}

export type Tone = 'ok' | 'warn' | 'crit'

// >30 ok, >15 warn, else crit (task-8 brief thresholds).
export function batteryColor(pct: number): Tone {
  if (pct > 30) return 'ok'
  if (pct > 15) return 'warn'
  return 'crit'
}

// MAV_GPS_FIX_TYPE-ish bucketing used by the GPS status chip.
const GPS_FIX_LABELS: Record<number, string> = {
  0: 'NO FIX',
  1: 'NO FIX',
  2: '2D',
  3: '3D',
  4: 'DGPS',
  5: 'RTK',
  6: 'RTK',
}

export function gpsFixLabel(fixType: number): string {
  return GPS_FIX_LABELS[fixType] ?? `FIX(${fixType})`
}

const LINK_STALE_MS = 3000

// Heartbeat-age staleness for the link status chip. `nowMs` is always
// injected by the caller (never Date.now() internally) so this stays a pure,
// easily-tested function; the component ticks a 1s interval to re-render and
// pass a fresh nowMs. No heartbeat ever received (null) is treated as crit.
export function linkStatus(lastHeartbeatMs: number | null, nowMs: number): Tone {
  if (lastHeartbeatMs === null) return 'crit'
  return nowMs - lastHeartbeatMs > LINK_STALE_MS ? 'crit' : 'ok'
}
