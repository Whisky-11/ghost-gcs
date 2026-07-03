// AI feature prompt builders + flight-stats + mission-draft schema (P1 Task
// 6). Pure logic only — no I/O, no MAVLink, no ClaudeHeadless import. This
// module's only job is to (a) turn structured inputs into lean prompt
// strings for ClaudeHeadless (Task 5) to send, and (b) validate/compute the
// structured data those prompts are anchored to. Nothing here can reach a
// VehicleLink or command mutator (spec safety invariant 1 — the AI never
// commands the vehicle, only ever produces data/text for a human to
// review).
import { z, type ZodType } from 'zod'
import { MISSION_ALT_MIN_M, MISSION_ALT_MAX_M, type MissionItem } from '../missions/model.js'
import type { LatLng } from '../missions/survey.js'
import type { TelemetryState } from '../state/telemetry.js'
import type { Alert } from '../watchdog/rules.js'

/** Safety framing prepended to every prompt sent to Claude, regardless of
 * feature. Repeats the spec's safety invariants in plain language so the
 * model's own behavior stays anchored even though the *real* enforcement
 * is structural (no AI code path can import command/mission-upload code,
 * and missionDraftSchema below hard-rejects anything a human hasn't
 * reviewed into an uploadable shape). */
export const AI_SYSTEM_PREAMBLE =
  'You are GHOST, an advisory copilot for a ground control station (GCS) operating real ArduPilot vehicles. ' +
  'You are STRICTLY ADVISORY: you NEVER command the vehicle — you have no access to arm/disarm/mode/mission-upload ' +
  'controls and cannot cause anything to happen to the aircraft. You only ever produce data (e.g. a mission draft) ' +
  'or text (narration, answers, debriefs) for a human operator to read and act on. Any mission you draft is a DRAFT ' +
  'ONLY: a human operator must review every waypoint and explicitly upload it before it can ever fly — you never ' +
  'upload it yourself.'

// --- missionDraftSchema ----------------------------------------------------
// Deliberately NARROWER than Mission/MissionItem (missions/model.ts):
// drafts may ONLY contain WAYPOINT items with altM in the same
// [MISSION_ALT_MIN_M, MISSION_ALT_MAX_M] bounds validateMission enforces.
// TAKEOFF/RTL/LAND are refused here — a human operator adds those
// deliberately when reviewing the draft, not the model. A hallucinated
// TAKEOFF or an out-of-bounds altitude fails schema validation, which
// (per ClaudeHeadless.askJson, Task 5) triggers exactly one retry with the
// validation error appended, then surfaces as an "AI unavailable"-style
// failure to the caller rather than ever reaching mission upload.
const missionDraftItemSchema = z.object({
  seq: z.number().int().min(0),
  command: z.literal('WAYPOINT'),
  lat: z.number(),
  lng: z.number(),
  altM: z.number().min(MISSION_ALT_MIN_M).max(MISSION_ALT_MAX_M),
})

export const missionDraftSchema: ZodType<{ items: MissionItem[]; notes: string }> = z.object({
  items: z.array(missionDraftItemSchema),
  notes: z.string(),
})

// --- buildMissionDraftPrompt ------------------------------------------------
export interface MissionDraftPromptInput {
  request: string
  geometry: LatLng[] | null
  home: LatLng | null
  vehicleType: string
}

function formatGeometry(geometry: LatLng[] | null): string {
  if (!geometry || geometry.length === 0) {
    return (
      'No geometry has been drawn on the map. Do NOT fabricate a polygon or invent coordinates — if the request ' +
      'needs an area to survey, say so in "notes" and return an empty items array instead of guessing bounds.'
    )
  }
  const points = geometry.map((p, i) => `  [${i}] lat=${p.lat}, lng=${p.lng}`).join('\n')
  return `Drawn operating geometry (polygon, ${geometry.length} vertices, WGS84 lat/lng, in order):\n${points}`
}

/** Builds the prompt for drafting a mission from an English request. MUST
 * (per the plan brief): instruct WAYPOINT-only output confined inside the
 * drawn geometry, altM bounds 2-120, and that a human reviews the draft
 * before upload — missionDraftSchema above is the structural backstop if
 * the model ignores any of this. */
export function buildMissionDraftPrompt(input: MissionDraftPromptInput): string {
  const { request, geometry, home, vehicleType } = input
  const homeText = home ? `Home position: lat=${home.lat}, lng=${home.lng}` : 'Home position: unknown.'

  return `${AI_SYSTEM_PREAMBLE}

TASK: Draft a mission from the operator's request below for a ${vehicleType} vehicle.

Operator request: "${request}"

${formatGeometry(geometry)}

${homeText}

STRICT RULES for this draft (violating any of these makes the draft unusable — it will be rejected by validation
and the operator will never see it):
- Output ONLY items with command "WAYPOINT". Do not include TAKEOFF, RTL, or LAND items — the human operator adds
  those deliberately when reviewing the draft.
- Every waypoint's lat/lng MUST fall inside the drawn geometry above.
- Every waypoint's altM MUST be between ${MISSION_ALT_MIN_M} and ${MISSION_ALT_MAX_M} (meters), inclusive.
- This is a DRAFT ONLY. It is never uploaded automatically — a human operator reviews every waypoint before upload.

Respond with ONLY a JSON object matching this exact shape (no prose, no markdown fence):
{"items": [{"seq": 0, "command": "WAYPOINT", "lat": <number>, "lng": <number>, "altM": <number>}, ...], "notes": "<short plain-text rationale>"}`
}

// --- buildNarratePrompt ------------------------------------------------
function summarizeState(state: TelemetryState): string {
  const lines: string[] = [
    `connected=${state.connected} armed=${state.armed} mode=${state.mode || '(none)'} vehicleType=${state.vehicleType}`,
  ]
  if (state.position) {
    lines.push(
      `position: lat=${state.position.lat}, lng=${state.position.lng}, altM=${state.position.altM}, relAltM=${state.position.relAltM}`,
    )
  }
  if (state.speed) {
    lines.push(`speed: groundMps=${state.speed.groundMps}, airMps=${state.speed.airMps}, climbMps=${state.speed.climbMps}`)
  }
  if (state.battery) {
    lines.push(`battery: voltageV=${state.battery.voltageV}, remainingPct=${state.battery.remainingPct}`)
  }
  if (state.gps) {
    lines.push(`gps: fixType=${state.gps.fixType}, satellites=${state.gps.satellites}, hdop=${state.gps.hdop}`)
  }
  if (state.home) {
    lines.push(`home: lat=${state.home.lat}, lng=${state.home.lng}, altM=${state.home.altM}`)
  }
  return lines.join('\n')
}

export interface NarratePromptInput {
  alert?: Alert
  question?: string
  state: TelemetryState
}

/** Builds the prompt for the watchdog narrator / Q&A feature. Exactly one
 * of `alert`/`question` is expected to be set by the caller (an alert push
 * or an operator-typed question); if neither is given, falls back to a
 * generic one-line status narration. */
export function buildNarratePrompt(input: NarratePromptInput): string {
  const { alert, question, state } = input
  const stateText = summarizeState(state)

  let focusText: string
  if (alert) {
    const dataText = alert.data ? `\n  data: ${JSON.stringify(alert.data)}` : ''
    focusText =
      `A watchdog rule fired. Alert:\n  code: ${alert.code}\n  severity: ${alert.severity}\n  message: ${alert.message}${dataText}\n\n` +
      'Explain in one short plain-text paragraph (no markdown) what this means for the operator and what to watch ' +
      'for next. Describe the situation — do not tell the operator to issue a specific vehicle command.'
  } else if (question) {
    focusText =
      `Operator question: "${question}"\n\n` +
      'Answer in one short plain-text paragraph (no markdown) using only the telemetry above. If the telemetry ' +
      "doesn't contain enough information to answer, say so plainly instead of guessing."
  } else {
    focusText = 'Give a one-sentence plain-text status narration of the telemetry above.'
  }

  return `${AI_SYSTEM_PREAMBLE}

Current telemetry snapshot:
${stateText}

${focusText}`
}

// --- FlightStats + computeFlightStats ------------------------------------
export interface FlightStats {
  durationSec: number
  maxAltM: number
  maxGroundMps: number
  minBatteryPct: number
  modeChanges: string[]
  alertHistory: Alert[]
  waypointsFlown: number
}

/** Pure reducer over a telemetry sample buffer (e.g. every telemetry frame
 * broadcast during a flight, collected by the caller) plus the alerts the
 * watchdog raised over the same window.
 *
 * Field-by-field decisions (TelemetryState carries no per-sample
 * timestamp other than lastHeartbeatMs — see state/telemetry.ts):
 *   - durationSec: the span (max - min) of `lastHeartbeatMs` across every
 *     sample that has one, in seconds. Chosen over "samples.length /
 *     telemetryHz" because it's exact regardless of any gaps or jitter in
 *     when samples were pushed into the buffer, and lastHeartbeatMs is the
 *     only wall-clock signal TelemetryState actually carries. Needs at
 *     least two timestamped samples to have a meaningful span; otherwise 0.
 *   - maxAltM: the highest `position.relAltM` seen (relative-to-home
 *     altitude — the number the operator actually cares about, vs. AMSL).
 *   - maxGroundMps: the highest `speed.groundMps` seen.
 *   - minBatteryPct: the lowest `battery.remainingPct` seen; defaults to
 *     100 when no sample ever carried battery data (nothing observed to
 *     have dropped — avoids a false "0%" reading when SYS_STATUS was
 *     simply never sampled).
 *   - modeChanges: the sequence of DISTINCT consecutive `mode` values
 *     across the buffer (e.g. ['GUIDED', 'AUTO', 'RTL']), deduping runs of
 *     the same mode and skipping the empty string (TelemetryState's
 *     pre-first-heartbeat initial mode, not a real flight mode).
 *   - waypointsFlown: TelemetryState does NOT decode MISSION_CURRENT (no
 *     per-waypoint-reached telemetry is currently wired into the reducer
 *     in state/telemetry.ts), so an exact "how many waypoints did the
 *     vehicle reach" figure isn't derivable from this input. As a
 *     documented, pure, and testable ADVISORY PROXY — never treated as a
 *     precise count — this counts the number of times the vehicle
 *     TRANSITIONED INTO 'AUTO' mode (i.e. distinct AUTO-mode "runs" in the
 *     buffer), which roughly corresponds to how many times a mission was
 *     flown/attempted. This is surfaced to the debrief prompt as
 *     "waypoints flown (approx.)" and the prompt itself is phrased so the
 *     model doesn't over-claim precision from it.
 *   - alertHistory: the given `alerts` array, passed through unchanged —
 *     the caller (WS/index wiring, a later task) already owns collecting
 *     the watchdog's Alert[] over the flight window; this function doesn't
 *     re-derive alerts from telemetry.
 */
export function computeFlightStats(samples: TelemetryState[], alerts: Alert[]): FlightStats {
  const heartbeatTimes = samples
    .map((s) => s.lastHeartbeatMs)
    .filter((t): t is number => t !== null)
  const durationSec = heartbeatTimes.length >= 2 ? (Math.max(...heartbeatTimes) - Math.min(...heartbeatTimes)) / 1000 : 0

  let maxAltM = 0
  let maxGroundMps = 0
  let minBatteryPct = 100
  let sawBattery = false
  const modeChanges: string[] = []
  let lastMode = ''
  let wasAuto = false
  let waypointsFlown = 0

  for (const s of samples) {
    if (s.position && s.position.relAltM > maxAltM) maxAltM = s.position.relAltM
    if (s.speed && s.speed.groundMps > maxGroundMps) maxGroundMps = s.speed.groundMps
    if (s.battery) {
      sawBattery = true
      if (s.battery.remainingPct < minBatteryPct) minBatteryPct = s.battery.remainingPct
    }
    if (s.mode && s.mode !== lastMode) {
      modeChanges.push(s.mode)
      lastMode = s.mode
    }
    const isAuto = s.mode === 'AUTO'
    if (isAuto && !wasAuto) waypointsFlown++
    wasAuto = isAuto
  }

  if (!sawBattery) minBatteryPct = 100

  return {
    durationSec,
    maxAltM,
    maxGroundMps,
    minBatteryPct,
    modeChanges,
    alertHistory: alerts,
    waypointsFlown,
  }
}

// --- buildDebriefPrompt ------------------------------------------------
/** Builds the post-flight debrief prompt from computed FlightStats. */
export function buildDebriefPrompt(stats: FlightStats): string {
  const { durationSec, maxAltM, maxGroundMps, minBatteryPct, modeChanges, alertHistory, waypointsFlown } = stats
  const modeChangesText = modeChanges.length > 0 ? modeChanges.join(' -> ') : '(no mode changes recorded)'
  const alertsText =
    alertHistory.length > 0
      ? alertHistory.map((a) => `  [${a.severity}] ${a.code}: ${a.message}`).join('\n')
      : '  (no alerts raised)'

  return `${AI_SYSTEM_PREAMBLE}

TASK: Write a short post-flight debrief (plain text, 2-4 sentences, no markdown) from the flight statistics below.
Be factual and reference the numbers given; do not speculate about causes the data doesn't support. "waypoints
flown" is an approximate proxy (count of AUTO-mode runs), not an exact per-waypoint count — phrase it as such.

Flight statistics:
  duration: ${durationSec}s
  max altitude: ${maxAltM}m
  max groundspeed: ${maxGroundMps} m/s
  min battery: ${minBatteryPct}%
  waypoints flown (approx.): ${waypointsFlown}
  mode changes: ${modeChangesText}

Alerts raised during the flight:
${alertsText}`
}
