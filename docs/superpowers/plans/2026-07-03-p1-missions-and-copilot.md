# GHOST GCS — P1: Missions + Headless Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Plan a mission by clicking waypoints or drawing a survey polygon, upload it to the simulated vehicle, watch it fly the mission in AUTO — and get an AI copilot (Claude via `claude -p` headless) that drafts missions from English, narrates a rules-based flight watchdog, and writes post-flight debriefs.

**Architecture:** Extends the P0 bridge + app. Bridge gains: mission model + survey-grid generator (pure) + MAVLink mission-upload protocol + AUTO start + a rules watchdog (pure) + a ClaudeHeadless adapter (spawns `claude -p`, queued, zod-validated). WS protocol extends with mission RPCs + watchdog-alert push + AI-request RPCs. App gains: mission editor (click waypoints + draw polygon → survey grid), mission overlay, upload/start controls, and the **GHOST advisory** panel (mission drafts, watchdog narration, Q&A, debrief). Monochrome black/white/grey UI.

**Tech Stack:** unchanged from P0 (Node 22/TS, node-mavlink, ws, zod, vitest, Next 16/React 19, maplibre-gl) + the local `claude` CLI (headless, no API key — rides Ahmad's Max plan).

## Global Constraints

- **The AI never commands the vehicle** (spec safety invariant 1). AI produces DATA (mission drafts) and TEXT (advice) only. Mission upload + AUTO-start are explicit human UI actions with confirmation. No AI code path may import or call the bridge command mutators or mission-upload. A task that wires AI→command is a plan failure.
- **Watchdog is advisory** (spec invariant 2): rules in code raise alerts + Claude narrates; hard failsafes stay in ArduPilot. The watchdog never commands.
- **ClaudeHeadless discipline** (Ahmad's standing rule): max 1 concurrent `claude -p`; FIFO queue; lean prompts; no fanout; 120s timeout; zod-validate output with ONE retry (validation error appended). AI unavailable/errored = feature degrades to a clear "AI unavailable" state; flying is never affected.
- **`claude -p` is spawned, never the API.** `claude -p "<prompt>" --output-format json` → parse `.result` → zod. Config = "claude CLI on PATH + logged in"; no keys.
- **Tests NEVER call the real `claude` CLI** — the adapter takes an injectable spawn/exec seam; all AI tests use fixtures. At most ONE live headless smoke call in the final task, gated + documented, to prove the real CLI path.
- Pure logic (survey generator, mission model, watchdog rules, prompt builders, response parsers) fully unit-tested. Mission upload + AUTO verified against live SITL with pasted evidence.
- English-only UI; monochrome (black/white/grey + existing status colors).
- Wire-protocol additions get the same `AssertEqual` compile-guard discipline as P0 (schema.ts ↔ app types.ts stay machine-verified where possible).
- Carry-note from P0 for any manual SITL run: `pkill -f 'tsx.*bridge/src/index.ts'` + `docker rm -f ghost-sitl` first (single-client TCP 5760). Image tagged `ghost-sitl` (fallback `falcon-sitl` in run.sh).
- Commits: lowercase conventional + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Execution order

Bridge core first (1→2→3→4), then AI adapter (5→6), then WS wiring (7), then app (8→9→10), then live end-to-end + docs (11). Sequential.

---

### Task 1: Mission model + waypoint types

**Files:**
- Create: `bridge/src/missions/model.ts`
- Test: `bridge/src/missions/__tests__/model.test.ts`

**Interfaces:**
```ts
export type MissionItemCommand = 'WAYPOINT' | 'TAKEOFF' | 'RTL' | 'LAND'
export interface MissionItem { seq: number; command: MissionItemCommand; lat: number; lng: number; altM: number; }
export interface Mission { items: MissionItem[] }
export function validateMission(m: Mission): { ok: true } | { ok: false; error: string }
// rules: seq must be 0..n-1 contiguous; altM within 2..120 for TAKEOFF/WAYPOINT; a copter mission SHOULD start with TAKEOFF (warn-not-error captured in a separate `missionWarnings(m): string[]`); RTL/LAND only as last item
export function missionWarnings(m: Mission): string[]
```
- [ ] Failing tests (contiguous seq, alt bounds, empty mission, RTL-not-last error, warnings for missing-takeoff + terminal item) → implement → PASS → commit `feat(bridge): mission model + validation`.

### Task 2: Survey-grid generator (pure, the crown jewel)

**Files:**
- Create: `bridge/src/missions/survey.ts`
- Test: `bridge/src/missions/__tests__/survey.test.ts`

**Interfaces:**
```ts
export interface LatLng { lat: number; lng: number }
export interface SurveyParams { polygon: LatLng[]; altM: number; spacingM: number; headingDeg?: number }
export function generateSurveyGrid(p: SurveyParams): MissionItem[]
// lawnmower/boustrophedon: fill the polygon with parallel lines spacingM apart (default heading = longest-edge bearing),
// clip each line to the polygon, alternate direction each pass, emit WAYPOINT items at altM. seq starts at 0.
// Pure geometry — use a local equirectangular projection around the polygon centroid (meters), generate, unproject.
```
- [ ] Failing tests: a simple square polygon at 50m spacing → expected pass count + serpentine ordering (first pass L→R, second R→L); a rotated heading; a triangle (odd clip); spacing larger than polygon → ≥1 line through centroid; degenerate (<3 points) → throws. Assert waypoints lie INSIDE the polygon (point-in-polygon check in the test). → implement → PASS → commit `feat(bridge): survey-grid lawnmower generator`.

### Task 3: MAVLink mission upload + download + AUTO start

**Files:**
- Create: `bridge/src/missions/protocol.ts`
- Modify: `bridge/src/commands/commands.ts` (add `startMission()` = setMode AUTO + arm-aware, and `uploadMission(items)`)
- Test: `bridge/src/missions/__tests__/protocol.int.test.ts` (unit w/ fake link) + live SITL integration step

**Interfaces:**
```ts
export interface MissionUploadDeps { link: Pick<VehicleLink,'send'|'connected'> & EventEmitter }
export function makeMissionProtocol(deps: MissionUploadDeps): {
  upload(items: MissionItem[]): Promise<void>   // MISSION_COUNT → MISSION_REQUEST_INT loop → MISSION_ITEM_INT → MISSION_ACK; 10s per-item timeout; typed MissionError
  download(): Promise<MissionItem[]>            // MISSION_REQUEST_LIST → items
  clear(): Promise<void>                        // MISSION_CLEAR_ALL
}
export class MissionError extends Error { constructor(public code: 'NOT_CONNECTED'|'UPLOAD_TIMEOUT'|'MISSION_REJECTED'|'DOWNLOAD_TIMEOUT', msg?: string) }
```
Item mapping: MISSION_ITEM_INT with frame GLOBAL_RELATIVE_ALT_INT, command per MissionItemCommand (WAYPOINT=16, TAKEOFF=22, RTL=20, LAND=21), x=lat*1e7, y=lng*1e7, z=altM. AUTO start = commands.ts `startMission()`: requires connected + (copter: armed; needs a mission uploaded — caller sequences upload→arm→start). Sequencing (upload→arm→AUTO) is done by the APP over separate RPCs (not chained in the bridge — P0 arm-ACK-vs-state lesson).
- [ ] Unit tests (fake link scripting the request/ack handshake: happy 3-item upload, per-item timeout, MISSION_ACK error result → MISSION_REJECTED, disconnect guard, download round-trip). → implement → PASS.
- [ ] Live SITL copter integration: upload a 4-item mission (TAKEOFF 20, 2×WAYPOINT, RTL) → GUIDED→arm→AUTO → observe vehicle fly waypoints (position marches toward each) → RTL. Paste state snapshots. → commit `feat(bridge): mavlink mission upload/download + auto start`.

### Task 4: Watchdog rules engine (pure)

**Files:**
- Create: `bridge/src/watchdog/rules.ts`
- Test: `bridge/src/watchdog/__tests__/rules.test.ts`

**Interfaces:**
```ts
export type AlertSeverity = 'info' | 'warn' | 'critical'
export interface Alert { code: string; severity: AlertSeverity; message: string; data?: Record<string, unknown> }
export function evaluateWatchdog(state: TelemetryState, prev: TelemetryState | null, nowMs: number): Alert[]
// deterministic rules (advisory only): LINK_STALE (lastHeartbeatMs age >3s → warn, >10s → critical);
// BATTERY_LOW (remainingPct <25 → warn, <15 → critical); GPS_DEGRADED (fixType <3 while armed → warn);
// BATTERY_VS_HOME (armed + moving away: if a naive "energy to return" heuristic — distance-home / groundspeed vs battery% — is short → warn; keep the heuristic SIMPLE + documented as advisory, NOT a failsafe);
// STATUSTEXT_ERROR (a new severity<=3 STATUSTEXT since prev → surface as warn). Each alert stable-keyed by code so the app can dedupe.
```
- [ ] Failing tests per rule incl. thresholds + the battery-vs-home heuristic both directions + no-alerts-when-nominal + dedupe key stability. → implement → PASS → commit `feat(bridge): advisory watchdog rules engine`.

### Task 5: ClaudeHeadless adapter (spawn + queue + validate)

**Files:**
- Create: `bridge/src/ai/claude.ts`
- Test: `bridge/src/ai/__tests__/claude.test.ts`

**Interfaces:**
```ts
export interface SpawnResult { code: number; stdout: string; stderr: string }
export type Spawner = (cmd: string, args: string[], input?: string) => Promise<SpawnResult>
export interface ClaudeHeadless {
  ask(prompt: string): Promise<string>                                  // raw text result
  askJson<T>(prompt: string, schema: ZodType<T>): Promise<T>            // json result, zod-validated, ONE retry with error appended
}
export function makeClaudeHeadless(opts?: { spawn?: Spawner; timeoutMs?: number }): ClaudeHeadless
```
Behavior: spawns `claude -p <prompt> --output-format json`, parses stdout JSON, reads `.result` (Claude Code headless json shape — the adapter tolerates both `{result: "..."}` and a bare string, documented); FIFO queue enforcing concurrency 1 (a second ask waits for the first); 120s default timeout → throws `ClaudeError('TIMEOUT')`; non-zero exit → `ClaudeError('CLI_ERROR', stderr)`; askJson: extract first JSON block from result, zod-parse; on failure re-ask ONCE with "Your previous output failed validation: <err>. Return ONLY valid JSON matching the schema." appended; second failure → `ClaudeError('VALIDATION')`. Never throws synchronously; callers wrap.
- [ ] Failing tests with an injected fake Spawner: queue serializes 2 concurrent asks (assert ordering via a deferred fake); timeout; CLI error; askJson happy; askJson retry-then-succeed; askJson retry-then-fail → VALIDATION. → implement → PASS → commit `feat(bridge): claude headless adapter (spawn, queue, zod-validate)`.

### Task 6: AI features — mission draft, narrate, debrief (prompt builders + parsers, pure)

**Files:**
- Create: `bridge/src/ai/features.ts`
- Test: `bridge/src/ai/__tests__/features.test.ts`

**Interfaces:**
```ts
export const missionDraftSchema: ZodType<{ items: MissionItem[]; notes: string }>   // reuse MissionItem
export function buildMissionDraftPrompt(input: { request: string; geometry: LatLng[] | null; home: LatLng | null; vehicleType: string }): string
export function buildNarratePrompt(input: { alert?: Alert; question?: string; state: TelemetryState }): string
export function buildDebriefPrompt(stats: FlightStats): string
export interface FlightStats { durationSec: number; maxAltM: number; maxGroundMps: number; minBatteryPct: number; modeChanges: string[]; alertHistory: Alert[]; waypointsFlown: number }
export function computeFlightStats(samples: TelemetryState[], alerts: Alert[]): FlightStats  // pure, from a telemetry sample buffer
export const AI_SYSTEM_PREAMBLE: string  // "You are GHOST, an advisory copilot for a ground control station. You NEVER command the vehicle. ..." — safety framing baked into every prompt
```
Prompt builders emit lean, schema-anchored prompts. `computeFlightStats` is pure over a sample array. Draft prompt MUST instruct: output only WAYPOINT items within the drawn geometry, altM 2-120, and that the human reviews before upload.
- [ ] Failing tests: computeFlightStats math (duration, maxima, mode-change extraction, waypoint count); draft prompt contains geometry + bounds + review instruction; missionDraftSchema accepts valid + rejects out-of-bounds alt; narrate/debrief prompts include the state/stats. → implement → PASS → commit `feat(bridge): ai feature prompt builders + flight-stats + draft schema`.

### Task 7: WS protocol extension — mission RPCs, watchdog push, AI RPCs

**Files:**
- Modify: `bridge/src/ws/schema.ts` (new message types), `bridge/src/ws/server.ts`, `bridge/src/index.ts` (wire missions + watchdog eval loop + ClaudeHeadless + features)
- Test: `bridge/src/ws/__tests__/server.test.ts` (extend)

**Interfaces (wire additions):**
```ts
// client→server RPCs (extend method union): 'uploadMission'(params.mission), 'startMission', 'clearMission', 'downloadMission',
//   'aiDraftMission'(params.request, params.geometry), 'aiNarrate'(params.question? | params.alertCode?), 'aiDebrief'
// server→client push: { type:'alerts', alerts: Alert[] }  (broadcast when watchdog set changes)
// server→client AI results ride the existing rpc_result: ok:true carries a `data` field (mission draft / text) — extend rpc_result to { ok:true, data?: unknown }
```
index.ts: keep a rolling telemetry sample buffer (cap ~600 = 2min@5Hz) for debrief; run `evaluateWatchdog` on each state update, broadcast `alerts` on change (dedupe by code set); AI RPCs call features+ClaudeHeadless, return via rpc_result data (AI errors → ok:false code 'AI_UNAVAILABLE'|'AI_TIMEOUT'|'AI_VALIDATION', never crash). uploadMission/startMission/etc. → mission protocol + commands; **NO chaining** (app sequences). AI RPC handlers must NOT touch command mutators (invariant 1 — a test asserts aiDraftMission never calls link.send).
- [ ] Extend server tests: uploadMission routes to fake mission protocol; alerts broadcast on watchdog change; aiDraftMission returns draft data via injected fake ClaudeHeadless + asserts no command sent; AI error → ok:false AI_* code. → implement → PASS. → commit `feat(bridge): ws mission rpcs + watchdog alerts + ai rpcs`.

### Task 8: App — mission editor (waypoints + polygon draw + survey overlay)

**Files:**
- Create: `app/src/lib/mission.ts` (client mission model mirror + pure editor helpers), `app/src/components/MissionEditor.tsx`, `app/src/components/MissionOverlay.tsx`
- Modify: `app/src/lib/types.ts` (mirror new wire types + Alert), `app/src/components/VehicleMap.tsx` (host the overlay + click/draw modes), `app/src/hooks/useTelemetry.ts` (expose alerts + the new rpc methods)
- Test: `app/src/lib/__tests__/mission.test.ts`

**Interfaces:** pure helpers `addWaypoint(mission, latlng, altM)`, `removeWaypoint(mission, seq)` (reseq), `reorderWaypoint`, `polygonToSurveyRequest(polygon, altM, spacingM)` (client-side pre-validate before sending ai...no: survey generation is bridge-side; the app sends the polygon + params via an RPC? DECISION: add a bridge RPC `surveyGrid`(polygon, altM, spacingM) → returns MissionItem[] using Task 2's generator — pure, fast, no AI. Add it in Task 7's scope note / or here as a tiny bridge addition — implementer: add `surveyGrid` RPC to schema+server calling generateSurveyGrid, it's pure). Editor modes: 'waypoint' (click adds), 'polygon' (click builds polygon, close → survey params popover → surveyGrid RPC → preview mission). Overlay draws mission line + numbered markers + polygon.
- [ ] Failing tests for the pure mission helpers (add/remove/reseq/reorder). → implement editor+overlay+map wiring → typecheck+build+lint green. Manual: draw polygon → survey grid appears as overlay. → commit `feat(app): mission editor with waypoints + survey polygon`.

### Task 9: App — mission controls (upload/start/clear) + alerts display

**Files:**
- Create: `app/src/components/MissionControls.tsx`, `app/src/components/AlertsPanel.tsx`
- Modify: `app/src/app/page.tsx`
- Test: `app/src/lib/__tests__/mission-controls.test.ts` (pure gating helper)

**Interfaces:** `missionControlAvailability(state, hasMission): { canUpload, canStart, canClear }` (canUpload: connected && hasMission; canStart: connected && armed && missionUploaded; canClear: connected). Upload button → uploadMission RPC → toast; Start → confirm ("Start AUTO mission?") → startMission; Clear → clearMission. AlertsPanel renders the pushed `alerts` (severity-colored within monochrome: info=grey, warn=white-on-grey, critical=inverted), newest first, with a "narrate" button per alert → aiNarrate RPC → shows GHOST's explanation inline.
- [ ] Failing tests for gating helper → implement → gates green. Manual: upload+start a mission in sim, watch it fly; kill link → LINK_STALE alert appears. → commit `feat(app): mission controls + advisory alerts panel`.

### Task 10: App — GHOST advisory panel (draft / Q&A / debrief)

**Files:**
- Create: `app/src/components/GhostPanel.tsx`, `app/src/lib/ghost.ts` (client state for AI request lifecycle)
- Modify: `app/src/app/page.tsx`
- Test: `app/src/lib/__tests__/ghost.test.ts`

**Interfaces:** `ghost.ts` pure request-state reducer (`idle|pending|done|error` per request kind). Panel: (1) mission-draft input — English text box + "draft from drawing" (uses current polygon/waypoints) → aiDraftMission → renders returned draft as a DASHED preview overlay (distinct from a committed mission) + "Load into editor" button (human then uploads via Task 9 — AI never uploads); (2) ask box → aiNarrate free question → answer; (3) "Debrief last flight" → aiDebrief → readable report. Every AI call shows pending spinner + a clear "AI unavailable" state on error. Monochrome; GHOST responses in a distinct panel styling. Copy is English.
- [ ] Failing tests for the request-state reducer (transitions, error) → implement → gates green. Manual (with live claude CLI available): draft a mission from a drawn box, load it, upload, fly it. → commit `feat(app): ghost advisory panel — draft, q&a, debrief`.

### Task 11: Live end-to-end + one real headless smoke + docs

**Files:**
- Modify: `docs/RUNBOOK.md` (P1 flows), `README.md` (P1 features + GHOST panel), `bridge/src/ai/__tests__/claude.smoke.test.ts` (gated real-CLI smoke, skipped unless GHOST_AI_SMOKE=1)

- [ ] **Live full-stack golden path** (per RUNBOOK carry-notes): SITL copter + bridge + app → draw a survey polygon → survey grid overlay → (if claude CLI logged in) draft a mission from English → load → upload → arm → start AUTO → watch it fly the grid → RTL → debrief. Rover pass: a 2-waypoint AUTO rover mission. Paste evidence. Fix any defect in-session (Rule A).
- [ ] **One gated real `claude -p` smoke** (`GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke`): a single askJson call with a trivial schema proving the real CLI path + json parse + zod works end to end. Document the exact command + that it's the ONLY real-CLI call in the suite. If the CLI isn't logged in in this environment, document the manual command for Ahmad + skip.
- [ ] Final gates: `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter app build`, `pnpm audit --prod` clean. Stop everything. → commit `docs: p1 runbook + verified missions + ghost copilot golden path`.

---

## Self-review notes

- **Spec coverage (P1):** mission editor+upload+AUTO (T1-3,8-9) ✓; survey generator (T2) ✓; watchdog advisory (T4,9) ✓; ClaudeHeadless discipline (T5) ✓; three AI features draft/narrate/debrief (T6,10) ✓; AI-never-commands invariant enforced + tested (T7 assertion, T10 human-in-loop) ✓; tests never hit real CLI except one gated smoke (T11) ✓.
- **Safety invariants:** 1 (AI never commands) — structural + tested in T7; 2 (watchdog advisory, failsafes ArduPilot-side) — T4 is pure eval, no mutators; 3 (confirmations) — mission start confirmed (T9), AI drafts require human load+upload (T10); 4 (RPC validation) — mission RPCs validated in bridge (T3 MissionError, T7 schema).
- **Placeholders:** none — every task carries interfaces + test cases + a verify-with-evidence contract. The one design decision surfaced inline (survey generation as a pure `surveyGrid` RPC, not AI) is resolved explicitly in T8.
- **Type consistency:** `MissionItem` defined T1, reused T2/T3/T6/T8; `Alert` T4 → T7 push → T8 mirror → T9 panel; `rpc_result.data` extension T7 consumed by T10; `TelemetryState` sample buffer T7 → computeFlightStats T6.
