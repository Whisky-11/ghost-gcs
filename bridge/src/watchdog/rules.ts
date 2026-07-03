// Advisory watchdog rules engine (P1 Task 4). Pure function: reads a
// TelemetryState snapshot (+ the previous snapshot, + a caller-injected
// nowMs) and returns a list of advisory Alerts. No I/O, no timers, no
// MAVLink, and critically NO commands — this module can only ever produce
// data for the app/Claude narrator to display. Hard failsafes remain
// ArduPilot's job; this is a second, human/AI-facing pair of eyes only
// (spec safety invariant 2).
//
// Every alert is stable-keyed by `code` so the app can dedupe/replace a
// still-active alert across repeated evaluateWatchdog ticks instead of
// accumulating duplicates (e.g. LINK_STALE persists across many ticks as its
// age grows — same code, escalating severity).

import type { TelemetryState } from '../state/telemetry.js'

export type AlertSeverity = 'info' | 'warn' | 'critical'

export interface Alert {
  code: string
  severity: AlertSeverity
  message: string
  data?: Record<string, unknown>
}

// --- LINK_STALE ---------------------------------------------------------
const LINK_STALE_WARN_MS = 3_000
const LINK_STALE_CRIT_MS = 10_000

function evalLinkStale(state: TelemetryState, nowMs: number): Alert | null {
  // No heartbeat has ever been seen — nothing to call "stale" yet (a
  // never-connected link is a different condition, surfaced elsewhere).
  if (state.lastHeartbeatMs === null) return null
  const ageMs = nowMs - state.lastHeartbeatMs
  if (ageMs > LINK_STALE_CRIT_MS) {
    return {
      code: 'LINK_STALE',
      severity: 'critical',
      message: `no heartbeat for ${(ageMs / 1000).toFixed(1)}s`,
      data: { ageMs },
    }
  }
  if (ageMs > LINK_STALE_WARN_MS) {
    return {
      code: 'LINK_STALE',
      severity: 'warn',
      message: `no heartbeat for ${(ageMs / 1000).toFixed(1)}s`,
      data: { ageMs },
    }
  }
  return null
}

// --- BATTERY_LOW ---------------------------------------------------------
const BATTERY_WARN_PCT = 25
const BATTERY_CRIT_PCT = 15

function evalBatteryLow(state: TelemetryState): Alert | null {
  if (!state.battery) return null
  const pct = state.battery.remainingPct
  if (pct < BATTERY_CRIT_PCT) {
    return { code: 'BATTERY_LOW', severity: 'critical', message: `battery at ${pct}%`, data: { remainingPct: pct } }
  }
  if (pct < BATTERY_WARN_PCT) {
    return { code: 'BATTERY_LOW', severity: 'warn', message: `battery at ${pct}%`, data: { remainingPct: pct } }
  }
  return null
}

// --- GPS_DEGRADED ---------------------------------------------------------
const GPS_DEGRADED_MIN_FIX = 3 // MAV GPS_FIX_TYPE: <3 is no-fix/2D, 3 = 3D fix

function evalGpsDegraded(state: TelemetryState): Alert | null {
  if (!state.armed || !state.gps) return null
  if (state.gps.fixType < GPS_DEGRADED_MIN_FIX) {
    return {
      code: 'GPS_DEGRADED',
      severity: 'warn',
      message: `GPS fix type ${state.gps.fixType} while armed`,
      data: { fixType: state.gps.fixType },
    }
  }
  return null
}

// --- BATTERY_VS_HOME -------------------------------------------------------
// Advisory ONLY, NOT a failsafe. This is a deliberately naive "can I get
// home" hint, not a real energy model: it assumes a flat, aircraft-agnostic
// full-charge flight endurance constant (ASSUMED_FULL_FLIGHT_S) to convert
// remaining battery% into an estimated number of seconds of flight left, and
// compares that against straight-line time-to-home at the CURRENT
// groundspeed with a safety margin. It ignores wind, altitude changes, the
// actual (non-straight-line) return path, payload, and the battery's real
// (non-linear) discharge curve. It exists only to catch the obvious "you do
// not have enough energy left to get home" case as a heads-up — ArduPilot's
// own battery failsafe (RTL/LAND on low voltage/capacity) is the actual
// safety mechanism.
const ASSUMED_FULL_FLIGHT_S = 18 * 60 // 18 minutes at 100% battery — naive small-multirotor assumption
const RETURN_SAFETY_MARGIN = 1.25 // require 25% more estimated flight time than the naive time-to-home
const MIN_GROUNDSPEED_MPS = 0.5 // below this, "time to home" is ~meaningless (near-hover); skip the heuristic
const EARTH_RADIUS_M = 6_371_000
const DEG2RAD = Math.PI / 180

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * DEG2RAD
  const dLng = (b.lng - a.lng) * DEG2RAD
  const lat1 = a.lat * DEG2RAD
  const lat2 = b.lat * DEG2RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

function evalBatteryVsHome(state: TelemetryState): Alert | null {
  if (!state.armed) return null
  if (!state.battery || !state.position || !state.home || !state.speed) return null
  if (state.speed.groundMps < MIN_GROUNDSPEED_MPS) return null

  const distanceHomeM = haversineM(state.position, state.home)
  const timeToHomeS = distanceHomeM / state.speed.groundMps
  const estRemainingFlightS = (state.battery.remainingPct / 100) * ASSUMED_FULL_FLIGHT_S

  if (estRemainingFlightS < timeToHomeS * RETURN_SAFETY_MARGIN) {
    return {
      code: 'BATTERY_VS_HOME',
      severity: 'warn',
      message: `~${Math.round(estRemainingFlightS)}s of estimated flight left vs ~${Math.round(timeToHomeS)}s straight-line to home (advisory estimate, not a failsafe)`,
      data: {
        distanceHomeM,
        timeToHomeS,
        estRemainingFlightS,
        remainingPct: state.battery.remainingPct,
        groundMps: state.speed.groundMps,
      },
    }
  }
  return null
}

// --- STATUSTEXT_ERROR -------------------------------------------------------
const STATUSTEXT_ERROR_MAX_SEVERITY = 3 // MAV_SEVERITY: 0..3 = EMERGENCY/ALERT/CRITICAL/ERROR

function statusTextKey(entry: TelemetryState['statusTexts'][number]): string {
  return `${entry.tsMs}|${entry.severity}|${entry.text}`
}

function evalStatusTextErrors(state: TelemetryState, prev: TelemetryState | null): Alert[] {
  // No baseline to diff against on the first tick — don't retroactively
  // alert on whatever statusTexts happened to already be in the ring.
  if (!prev) return []
  const prevKeys = new Set(prev.statusTexts.map(statusTextKey))
  const alerts: Alert[] = []
  for (const entry of state.statusTexts) {
    if (entry.severity > STATUSTEXT_ERROR_MAX_SEVERITY) continue
    if (prevKeys.has(statusTextKey(entry))) continue
    alerts.push({
      code: 'STATUSTEXT_ERROR',
      severity: 'warn',
      message: entry.text,
      data: { severity: entry.severity, tsMs: entry.tsMs },
    })
  }
  return alerts
}

/** Deterministic, pure advisory rules over telemetry. Never commands the
 * vehicle — this module has no access to a VehicleLink or command mutators
 * and returns data only (spec safety invariant 1 + 2). */
export function evaluateWatchdog(state: TelemetryState, prev: TelemetryState | null, nowMs: number): Alert[] {
  const alerts: Alert[] = []

  const linkStale = evalLinkStale(state, nowMs)
  if (linkStale) alerts.push(linkStale)

  const batteryLow = evalBatteryLow(state)
  if (batteryLow) alerts.push(batteryLow)

  const gpsDegraded = evalGpsDegraded(state)
  if (gpsDegraded) alerts.push(gpsDegraded)

  const batteryVsHome = evalBatteryVsHome(state)
  if (batteryVsHome) alerts.push(batteryVsHome)

  alerts.push(...evalStatusTextErrors(state, prev))

  return alerts
}
