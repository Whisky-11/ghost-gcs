# GHOST GCS — P1 Missions + Advisory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan and fly autonomous missions from the GCS ("survey this polygon at 80m" → draft → review → upload → AUTO flight in SITL), with the GHOST advisory copilot (Claude via `claude -p` headless) drafting missions, narrating a deterministic watchdog, and writing post-flight debriefs.

**Architecture:** Extends P0. Bridge gains: mission protocol (MISSION_COUNT/MISSION_ITEM_INT/MISSION_ACK upload + MISSION_CURRENT tracking + start), pure survey-grid generator, deterministic watchdog rules over TelemetryState history, and a `ClaudeHeadless` adapter (spawned `claude -p --output-format json`, FIFO queue concurrency 1). App gains: mission editor (click waypoints / polygon survey), draft overlay, GHOST advisory panel, alert strip, debrief view, monochrome Ghost-Grey polish.

**Tech Stack:** unchanged (Node 22/TS, node-mavlink, ws, zod, Next 16, maplibre-gl, vitest). ZERO new runtime deps expected (advisory = child_process spawn).

## Global Constraints

- **Spec safety invariants remain absolute:** the AI NEVER commands the vehicle — advisory output is drafts/text ONLY; mission upload and start are explicit human actions (confirm when armed). No advisory code path may import or call `VehicleLink`/commands mutators — enforce by module layering (ai/ may not import mavlink/ or commands/) and assert it in review.
- **Watchdog alerts must never depend on AI availability or latency** — rules are pure/deterministic; AI narration is async decoration.
- **`claude -p` discipline (Ahmad's standing rule):** max 1 concurrent headless call (FIFO queue), 120s timeout, lean prompts, no fanout. Tests NEVER spawn the real CLI (injectable spawn seam + fixtures); the ONLY real calls are ≤3 smoke invocations in the final task, gated behind `GHOST_AI_SMOKE=1`.
- English-only UI; monochrome black/white/grey design language (Ghost Grey); status colors (red/amber/green) stay ONLY for safety states (armed, battery, link, alerts).
- Wire-protocol changes: bridge/src/ws/schema.ts stays the single source of truth; app/src/lib/types.ts mirrors verbatim; keep the compile-time AssertEqual guard pattern for any new state shape.
- Everything else from the P0 plan's Global Constraints carries over (TDD for pure logic, live-SITL integration evidence, gates before commit, kill stray bridges + fresh container before manual runs, commit style with the Co-Authored-By trailer).

## Execution order

P1-1 → P1-2 → P1-3 (bridge chain) → P1-4 (watchdog, bridge+app) → P1-5 (AI adapter) → P1-6 (mission editor UI) → P1-7 (advisory panel + debrief) → P1-8 (golden path + polish). Sequential, one worktree.

---

### Task P1-1: Mission model + survey-grid generator (pure)

**Files:** Create `bridge/src/missions/model.ts`, `bridge/src/missions/survey.ts`; Test `bridge/src/missions/__tests__/{model,survey}.test.ts`.

**Interfaces (Produces):**
```ts
// model.ts
export interface Waypoint { lat: number; lng: number; altM: number }   // relative alt
export interface Mission { items: Waypoint[]; speedMps?: number }      // ≤ 100 items (MISSION_MAX)
export const MISSION_MAX = 100
export function validateMission(m: Mission): { ok: true } | { ok: false; code: 'EMPTY'|'TOO_MANY'|'BAD_ALT'|'BAD_COORD'; message: string }
// alt bounds reuse 2..120; coords sane (|lat|<=90, |lng|<=180, not 0,0)
// survey.ts — lawnmower grid over a polygon
export function surveyGrid(polygon: Array<{lat:number;lng:number}>, opts: { altM: number; spacingM: number; angleDeg?: number }): Waypoint[]
// deterministic; spacingM 5..200 clamp; polygon >=3 vertices; returns [] on degenerate input
```
Survey algorithm (implement exactly): convert polygon to local meters (equirectangular around centroid: x=(lng−lng0)·111320·cos(lat0°), y=(lat−lat0)·110540); rotate by −angleDeg; compute bounding box; generate parallel sweep lines spaced `spacingM` along x; clip each line to the polygon (even-odd ray casting for segment-polygon intersections, sort intersection points by y); serpentine order (alternate direction per line); rotate back + convert to lat/lng with `altM`.

- [ ] TDD: validateMission all codes + happy; surveyGrid: axis-aligned rectangle → expected line count = ceil(width/spacing)+1 and serpentine order (first two lines reverse y-order), rotated 45° rectangle still fully inside polygon (every waypoint passes point-in-polygon), triangle works, degenerate (2 vertices) → [], spacing clamp. Property check: all generated points inside (or within 1e-6 of) the polygon.
- [ ] Commit `feat(bridge): mission model + survey grid generator`

### Task P1-2: Mission upload/start protocol (bridge)

**Files:** Create `bridge/src/missions/protocol.ts`; Modify `bridge/src/mavlink/link.ts` ONLY if a helper event is missing; Test `bridge/src/missions/__tests__/protocol.test.ts` (fake link) + live SITL integration evidence.

**Interfaces (Produces):**
```ts
export class MissionError extends Error { constructor(public code: 'NOT_CONNECTED'|'INVALID_MISSION'|'UPLOAD_TIMEOUT'|'UPLOAD_REJECTED'|'START_FAILED', msg?: string) }
export function makeMissionClient(deps: { link: VehicleLinkLike }): {
  upload(m: Mission): Promise<void>      // full MISSION_COUNT → (MISSION_REQUEST_INT|MISSION_REQUEST)* → MISSION_ITEM_INT* → MISSION_ACK(type 0) handshake; home/item0 handling per ArduPilot (item 0 = home placeholder; first real wp seq 1; use MAV_CMD_NAV_TAKEOFF as seq1 when vehicle copter? NO — keep P1 simple: mission = NAV_WAYPOINT items only, frame MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, plus optional DO_CHANGE_SPEED as seq after item0 when speedMps set)
  clear(): Promise<void>                  // MISSION_CLEAR_ALL + ack
  start(): Promise<void>                  // requires armed; sets mode AUTO via commands.setMode? NO import cycle — send MAV_CMD_MISSION_START via COMMAND_LONG + ack
}
```
10s overall upload timeout; per-request 3s retry (resend item on duplicate request — SITL retransmits); tolerate both MISSION_REQUEST and MISSION_REQUEST_INT. Track progress via 'message' MISSION_CURRENT → handled in P1-3 state.

- [ ] TDD vs scripted fake link (happy upload 3 items incl. request retransmit; ACK type≠0 → UPLOAD_REJECTED; timeout; clear; start ack). Then live SITL copter: upload a 4-wp square around home @30m, GUIDED arm takeoff 20, start() → AUTO, observe MISSION_CURRENT advance 1→4 and position trace the square; paste evidence. Container down after.
- [ ] Commit `feat(bridge): mission upload/start protocol with ack handshake`

### Task P1-3: Wire protocol v2 — mission RPC + mission/alert state

**Files:** Modify `bridge/src/ws/schema.ts`, `bridge/src/ws/server.ts`, `bridge/src/index.ts`, `bridge/src/state/telemetry.ts` (mission fields), `app/src/lib/types.ts` (mirror); Tests extend existing ws + state suites.

**Produces (binding wire additions):**
```ts
// TelemetryState gains: mission: { count: number; currentSeq: number | null; state: 'none'|'uploaded'|'running' }
// (reduce() handles MISSION_CURRENT; 'uploaded' set via bridge-local event after upload; running when mode==='AUTO' && currentSeq!=null)
// rpc methods extended: 'uploadMission' (params.mission: Mission), 'clearMission', 'startMission'
// rpc_result unchanged; MissionError codes surface like CommandError codes
```
zod schemas for Mission/Waypoint mirror model.ts bounds (alt 2..120, ≤100 items). AssertEqual guard extended.

- [ ] TDD (schema validation, rpc routing to fake missionClient, state reduce MISSION_CURRENT) → implement → full bridge suite + app typecheck (mirror update) green → Commit `feat(bridge): mission rpc + mission state on the wire`

### Task P1-4: Watchdog rules + alert strip

**Files:** Create `bridge/src/watchdog/rules.ts`; Modify `bridge/src/index.ts` (evaluate at 1Hz, attach to wire), `bridge/src/ws/schema.ts` + `app/src/lib/types.ts` (alerts field), `app/src/components/AlertStrip.tsx`, page composition; Tests both sides.

**Produces:**
```ts
export interface Alert { severity: 'info'|'warn'|'crit'; code: 'BATTERY_LOW'|'BATTERY_RTL_MARGIN'|'LINK_STALE'|'GPS_DEGRADED'|'MISSION_STALL'; message: string; tsMs: number }
export function evaluateAlerts(history: TelemetryState[], nowMs: number): Alert[]   // pure; history = last 60 snapshots @1Hz
```
Exact rules: BATTERY_LOW warn <30% crit <15%; BATTERY_RTL_MARGIN crit when remainingPct% minus estimated-return-consumption <10% (estimate: distanceHome(m)/8mps · 0.05%/s — constants exported for tests); LINK_STALE crit when lastHeartbeatMs older than 3s; GPS_DEGRADED warn fixType<3 or satellites<6 while armed; MISSION_STALL warn when mission.state==='running' and currentSeq unchanged AND groundspeed<0.5 for >30s. TelemetryState gains `alerts: Alert[]` on the wire (bridge computes, app renders). AlertStrip: top-of-map horizontal strip, crit red / warn amber, newest first, dismissable per alert (client-side dismiss keyed by code+tsMs).

- [ ] TDD rules exhaustively (each rule on/off boundary, hysteresis-free acceptance) → wire + UI → gates → Commit `feat: deterministic watchdog with alert strip`

### Task P1-5: ClaudeHeadless adapter (bridge/src/ai)

**Files:** Create `bridge/src/ai/claude-headless.ts`, `bridge/src/ai/prompts.ts`; Test `bridge/src/ai/__tests__/claude-headless.test.ts` (spawn seam fully mocked).

**Produces:**
```ts
export class AiError extends Error { constructor(public code: 'AI_UNAVAILABLE'|'AI_TIMEOUT'|'AI_BAD_OUTPUT', msg?: string) }
export function makeClaudeHeadless(opts?: { spawnImpl?: typeof child_process.spawn; timeoutMs?: number /*120s*/ }): {
  ask(prompt: string): Promise<string>                                    // plain text
  askJson<T>(prompt: string, schema: z.ZodType<T>): Promise<T>            // --output-format json; parse .result; zod; ONE retry appending the validation error
  queueDepth(): number
}
```
Spawn: `claude -p <prompt> --output-format json` (no shell; args array). FIFO queue concurrency 1 (Ahmad's rule). Missing binary (ENOENT) → AI_UNAVAILABLE. Non-zero exit → AI_UNAVAILABLE with stderr tail. `prompts.ts`: three builders — `missionDraftPrompt(nl, geometry, constraints)` (embeds the MissionDraft JSON schema + alt/count bounds and REQUIRES pure-JSON reply), `watchdogNarratePrompt(alert, stateSnapshot)`, `debriefPrompt(stats)`. MODULE LAYERING GUARD: ai/ imports NOTHING from mavlink/, commands/, missions/protocol — assert with a unit test that reads the file's imports (simple regex test on source, honest and effective).

- [ ] TDD (queue serialization order, timeout kill, ENOENT, bad JSON → retry-once → AI_BAD_OUTPUT, schema pass) → implement → Commit `feat(bridge): claude headless advisory adapter (queued, validated, isolated)`

### Task P1-6: Mission editor UI

**Files:** Create `app/src/components/MissionEditor.tsx`, `app/src/lib/mission-ui.ts` (pure helpers); Modify `VehicleMap.tsx` (draft overlay layer + click routing), page composition, `app/src/lib/types.ts` already carries Mission; Tests for pure helpers.

Behavior: modes `off | waypoints | polygon` (toolbar toggle). Waypoints mode: map click appends Waypoint at shared alt (panel numeric input 2–120, applies to subsequent points; per-point alt editable in list). Polygon mode: clicks build polygon; "Generate survey" (spacing input 10–200m default 40) calls the BRIDGE's generator? No — SHARE the pure code: extract survey.ts + model.ts into a tiny `packages/`? NO (YAGNI, workspace churn) — duplicate is worse: move survey generation server-side via a new rpc? Simplest honest path: the app POSTs nothing — add rpc `draftS