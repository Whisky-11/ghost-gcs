# Falcon GCS — P0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simulated ArduPilot vehicle flying on screen under our own GCS — SITL + MAVLink bridge (link/state/commands/WS) + Next.js app (map/instruments/flight controls).

**Architecture:** ArduPilot SITL (docker, TCP 5760) ↔ `bridge/` Node/TS daemon (node-mavlink codec → pure TelemetryState reducers → ws JSON stream @5Hz + zod-validated RPC) ↔ `app/` Next.js UI (MapLibre dark map, SVG instruments, confirmed flight controls). AI/watchdog/missions are P1 — NOT in this plan.

**Tech Stack:** pnpm workspaces · Node 22 + TypeScript 5 · node-mavlink + mavlink-mappings · ws · zod · vitest · Next.js 15 + React 19 · maplibre-gl.

## Global Constraints

- **English-only UI** (spec: deliberate, no i18n layer).
- **No AI code paths reach VehicleLink mutators** (spec safety invariant 1) — P0 has no AI at all; do not scaffold any.
- Bridge validates every RPC against vehicle state; reject with typed errors (spec safety invariant 4). Arm requires UI confirmation (invariant 3).
- WS on `ws://localhost:8090`, app on `localhost:3000`, SITL TCP `localhost:5760` (spec values).
- Dependency discipline (Ahmad rule 1): every new dep registry-real, <12mo release, MIT/permissive, `pnpm audit --prod` clean — record the check in the Task 1 report.
- Pure logic (reducers, throttle, formatting, validation) MUST be unit-tested; library-facing I/O verified against real SITL in integration steps.
- Commits: lowercase conventional + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Library-API honesty rule:** `node-mavlink` names in this plan follow its documented README patterns; Task 3's spike step verifies them against the installed version — if a name differs, adapt to the real API and note it in the task report (do NOT force the plan's spelling).

## Execution order

Tasks 1→2→3→4→5→6 (bridge chain), then 7→8→9 (app chain), then 10 (golden path). Strictly sequential — each consumes the prior's interfaces.

---

### Task 1: Monorepo scaffold + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.nvmrc`, `tsconfig.base.json`, `README.md`
- Create: `bridge/package.json`, `bridge/tsconfig.json`, `bridge/vitest.config.ts`, `bridge/src/index.ts` (empty main), `bridge/src/config.ts`
- Test: `bridge/src/__tests__/config.test.ts`

**Interfaces:**
- Produces: `bridge/src/config.ts` → `export const CONFIG = { sitlTcp: { host: '127.0.0.1', port: 5760 }, wsPort: 8090, telemetryHz: 5 } as const`

- [ ] **Step 1: Root scaffold.** `package.json` (`"name":"falcon-gcs"`, private, `"packageManager":"pnpm@9.12.0"`, scripts `test`/`typecheck` fanning to workspaces via `pnpm -r`), `pnpm-workspace.yaml` (`packages: [bridge, app]`), `.nvmrc` = `22`, `.gitignore` (node_modules, dist, .next, .env*, *.log, .DS_Store), `tsconfig.base.json` (strict true, module NodeNext for bridge base), `README.md` (one-paragraph what-this-is + pointer to spec + run instructions placeholder-free: list the three terminals: sim, bridge, app — commands filled by later tasks amend it).
- [ ] **Step 2: Bridge package.** `bridge/package.json`: deps `node-mavlink`, `mavlink-mappings`, `ws`, `zod`; devDeps `typescript`, `vitest`, `@types/ws`, `@types/node`, `tsx`; scripts `"dev":"tsx watch src/index.ts"`, `"start":"tsx src/index.ts"`, `"test":"vitest run"`, `"typecheck":"tsc --noEmit"`. Run the 5-point dep check (registry, recency, license, tree, `pnpm audit --prod` at root) and record results.
- [ ] **Step 3: Failing test** `bridge/src/__tests__/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CONFIG } from '../config'
describe('config', () => {
  it('pins the spec ports', () => {
    expect(CONFIG.sitlTcp.port).toBe(5760)
    expect(CONFIG.wsPort).toBe(8090)
    expect(CONFIG.telemetryHz).toBe(5)
  })
})
```
- [ ] **Step 4:** Run `pnpm --filter bridge test` → FAIL (module not found). Implement `bridge/src/config.ts` exactly as the Produces block. Re-run → PASS. `pnpm -r typecheck` clean.
- [ ] **Step 5: Commit** `feat: monorepo scaffold + bridge package`

### Task 2: SITL simulation (docker) + heartbeat probe

**Files:**
- Create: `sim/Dockerfile`, `sim/run.sh`, `sim/README.md`
- Create: `bridge/scripts/probe-sitl.ts`

**Interfaces:**
- Produces: running container `falcon-sitl` exposing TCP 5760 speaking MAVLink; `sim/run.sh copter|rover` starts it; probe script prints decoded HEARTBEATs (used again by Task 3's spike).

- [ ] **Step 1: Dockerfile** — build ArduPilot SITL from source (arm64-native on Apple Silicon, no Rosetta):
```dockerfile
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y git python3 python3-pip python3-setuptools \
    gcc g++ make pkg-config libtool libxml2-dev libxslt1-dev curl && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --recurse-submodules --shallow-submodules \
    https://github.com/ArduPilot/ardupilot.git /ardupilot
WORKDIR /ardupilot
RUN pip3 install empy==3.3.4 pexpect future
RUN ./waf configure --board sitl && ./waf copter rover
EXPOSE 5760
COPY run-inner.sh /run-inner.sh
RUN chmod +x /run-inner.sh
ENTRYPOINT ["/run-inner.sh"]
```
`run-inner.sh` picks the binary by `$1` (default `copter`), Kuwait home coords, listens on all interfaces:
```bash
#!/bin/bash
VEHICLE=${1:-copter}
case "$VEHICLE" in
  copter) BIN=build/sitl/bin/arducopter; MODEL=quad ;;
  rover)  BIN=build/sitl/bin/ardurover;  MODEL=rover ;;
esac
exec $BIN --model $MODEL -w --home 29.3375,47.9744,10,0 --serial0 tcp:0.0.0.0:5760:wait
```
(If the installed ArduPilot version rejects `--serial0 tcp:0.0.0.0:5760:wait`, fall back to the version's documented SITL serial syntax — `--serial0 tcp:5760:wait` binds all interfaces on current master; verify with `docker logs` + the probe and record which form worked.)
- [ ] **Step 2: run.sh** — `docker build -t falcon-sitl sim/` (once) then `docker run --rm -p 5760:5760 --name falcon-sitl falcon-sitl ${1:-copter}`. `sim/README.md`: build time warning (~15 min once), copter vs rover, the native-macOS-build fallback pointer (spec risk item) with the three commands (`git clone ardupilot`, `./waf configure --board sitl`, `./waf copter`).
- [ ] **Step 3: Probe** `bridge/scripts/probe-sitl.ts` — minimal raw connection proving MAVLink flows before any abstraction:
```ts
import { connect } from 'node:net'
import { MavLinkPacketSplitter, MavLinkPacketParser } from 'node-mavlink'
import { minimal } from 'mavlink-mappings'
const socket = connect({ host: '127.0.0.1', port: 5760 }, () => console.log('tcp connected'))
const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())
reader.on('data', (pkt) => {
  if (pkt.header.msgid === minimal.Heartbeat.MSG_ID) {
    const hb = pkt.protocol.data(pkt.payload, minimal.Heartbeat)
    console.log('HEARTBEAT', { type: hb.type, autopilot: hb.autopilot, baseMode: hb.baseMode })
  }
})
```
- [ ] **Step 4: Verify for real.** `sim/run.sh copter` (background) → wait for boot → `pnpm --filter bridge exec tsx scripts/probe-sitl.ts` → expect HEARTBEAT lines within ~10s. Paste actual output in the report. Repeat once with `rover`.
- [ ] **Step 5: Commit** `feat: ardupilot sitl container + mavlink heartbeat probe`

### Task 3: VehicleLink — connection, registry decode, GCS heartbeat, stream rates

**Files:**
- Create: `bridge/src/mavlink/registry.ts`, `bridge/src/mavlink/link.ts`
- Test: `bridge/src/mavlink/__tests__/registry.test.ts` (unit) + integration steps vs SITL

**Interfaces:**
- Consumes: CONFIG (Task 1); running SITL (Task 2).
- Produces:
```ts
// registry.ts
export const REGISTRY: Record<number, MessageClass> // { ...minimal.REGISTRY, ...common.REGISTRY, ...ardupilotmega.REGISTRY }
export function decode(pkt: MavLinkPacket): { msgName: string; data: Record<string, unknown> } | null
// link.ts — EventEmitter
export class VehicleLink extends EventEmitter {
  connect(opts?: { host?: string; port?: number }): Promise<void>   // resolves on first HEARTBEAT
  disconnect(): void
  get connected(): boolean
  send(msg: MavLinkData): Promise<void>
  // events: 'message' ({msgName,data}), 'connected', 'disconnected', 'raw-error'
}
```
Behavior: on connect → start 1Hz GCS heartbeat (`minimal.Heartbeat` with `type=MavType.GCS`); request telemetry rates via `common.CommandLong` `MAV_CMD_SET_MESSAGE_INTERVAL` for GLOBAL_POSITION_INT(33)@4Hz, ATTITUDE(30)@8Hz, SYS_STATUS(1)@1Hz, GPS_RAW_INT(24)@1Hz, VFR_HUD(74)@4Hz (interval µs = 1e6/hz); auto-reconnect with 2s backoff while not explicitly disconnected.

- [ ] **Step 1: SPIKE (time-boxed 30 min).** Extend the Task 2 probe: send one GCS heartbeat and one SET_MESSAGE_INTERVAL through the parser's channel (`import { send } from 'node-mavlink'` or the documented `pkt.protocol` send path of the installed version) and confirm GLOBAL_POSITION_INT starts arriving at the requested rate. THIS step pins the real send API for the whole project — record the working snippet in the report per the Library-API honesty rule.
- [ ] **Step 2: Failing unit tests** for `registry.ts` — `decode()` returns `{msgName:'HEARTBEAT'}` for a HEARTBEAT packet built from fixture bytes, `null` for an unknown msgid; REGISTRY contains ids 0 (HEARTBEAT), 33 (GLOBAL_POSITION_INT), 30 (ATTITUDE). Build the fixture by serializing a `minimal.Heartbeat` in the test (round-trip through the lib — no hand-rolled bytes).
- [ ] **Step 3: Implement registry.ts + link.ts** per Produces (splitter/parser pipe from the probe; heartbeat interval + rate requests on 'connected'; reconnect timer; `removeAllListeners` + socket destroy on `disconnect()`). Unit tests green.
- [ ] **Step 4: Integration vs SITL** (documented commands in the report, not a vitest file yet): `tsx` one-off that connects, logs 5 seconds of `message` events → expect HEARTBEAT + GLOBAL_POSITION_INT + ATTITUDE + SYS_STATUS names. Paste output.
- [ ] **Step 5: Commit** `feat(bridge): vehicle link with registry decode, gcs heartbeat, stream rates`

### Task 4: TelemetryState — pure reducers

**Files:**
- Create: `bridge/src/state/telemetry.ts`
- Test: `bridge/src/state/__tests__/telemetry.test.ts`

**Interfaces:**
- Consumes: `decode()` output shape `{msgName, data}`.
- Produces:
```ts
export interface TelemetryState {
  connected: boolean
  lastHeartbeatMs: number | null
  vehicleType: 'copter' | 'rover' | 'unknown'
  armed: boolean
  mode: string                      // resolved name, e.g. 'GUIDED'
  position: { lat: number; lng: number; altM: number; relAltM: number } | null
  attitude: { rollDeg: number; pitchDeg: number; yawDeg: number } | null
  speed: { groundMps: number; airMps: number; climbMps: number } | null
  battery: { voltageV: number; remainingPct: number } | null
  gps: { fixType: number; satellites: number; hdop: number } | null
  home: { lat: number; lng: number; altM: number } | null
  statusTexts: Array<{ severity: number; text: string; tsMs: number }>  // ring, max 50
}
export function initialState(): TelemetryState
export function reduce(state: TelemetryState, msgName: string, data: Record<string, unknown>, nowMs: number): TelemetryState
export const COPTER_MODES: Record<number, string>   // 0 STABILIZE, 3 AUTO, 4 GUIDED, 5 LOITER, 6 RTL, 9 LAND
export const ROVER_MODES: Record<number, string>    // 0 MANUAL, 4 HOLD, 10 AUTO, 15 GUIDED, 11 RTL
export function modeName(vehicleType: TelemetryState['vehicleType'], customMode: number): string
```
Mapping rules (exact): HEARTBEAT → `armed = (baseMode & 128) !== 0` (MAV_MODE_FLAG_SAFETY_ARMED), `vehicleType` from `type` (2=copter/quad,10/11=rover), `mode = modeName(vehicleType, customMode)`, `lastHeartbeatMs = nowMs`. GLOBAL_POSITION_INT → position (`lat/1e7`, `lon/1e7`, `alt/1000`, `relativeAlt/1000`). ATTITUDE → degrees from radians. VFR_HUD → speed (`groundspeed`, `airspeed`, `climb`). SYS_STATUS → battery (`voltageBattery/1000`, `batteryRemaining`; -1 remaining → keep prior or null). GPS_RAW_INT → gps (`fixType`, `satellitesVisible`, `eph/100`). HOME_POSITION → home (same 1e7/1e3 scaling). STATUSTEXT → push `{severity, text, tsMs}` capped 50. Unknown msgName → return same state reference.

- [ ] **Step 1: Failing tests** — one per mapping rule above (10 tests min), plus: unknown message returns identical reference; statusTexts caps at 50; armed flag both ways; mode resolution copter GUIDED(4) + rover MANUAL(0) + unknown→`MODE(<n>)`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3: Commit** `feat(bridge): pure telemetry state reducers`

### Task 5: Commands — arm/disarm/mode/takeoff/rtl with state validation + ACK

**Files:**
- Create: `bridge/src/commands/commands.ts`
- Test: `bridge/src/commands/__tests__/commands.test.ts`

**Interfaces:**
- Consumes: `VehicleLink.send`, `TelemetryState`, `COPTER_MODES`/`ROVER_MODES` inverses.
- Produces:
```ts
export class CommandError extends Error { constructor(public code:
  'NOT_CONNECTED'|'ALREADY_ARMED'|'NOT_ARMED'|'BAD_MODE'|'MODE_UNKNOWN'|'ACK_FAILED'|'ACK_TIMEOUT', msg?: string) }
export interface CommandDeps { link: Pick<VehicleLink,'send'|'connected'> & EventEmitter; getState(): TelemetryState }
export function makeCommands(deps: CommandDeps): {
  arm(): Promise<void>; disarm(): Promise<void>
  setMode(mode: string): Promise<void>                 // name → customMode via vehicleType table
  takeoff(altM: number): Promise<void>                 // copter only; requires armed && mode==='GUIDED'
  rtl(): Promise<void>
}
```
Rules: every method throws `NOT_CONNECTED` when `!link.connected`. `arm()` throws `ALREADY_ARMED` if armed; sends `COMMAND_LONG(MAV_CMD_COMPONENT_ARM_DISARM, param1=1)` and awaits matching `COMMAND_ACK` (result 0=accepted else `ACK_FAILED`) with 5s `ACK_TIMEOUT`. `disarm()` mirror (param1=0, requires armed). `setMode(name)` → `COMMAND_LONG(MAV_CMD_DO_SET_MODE, param1=1 /*custom enabled*/, param2=customMode)`; unknown name → `MODE_UNKNOWN`. `takeoff(alt)` requires `vehicleType==='copter' && armed && mode==='GUIDED'` else `BAD_MODE`; sends `COMMAND_LONG(MAV_CMD_NAV_TAKEOFF, param7=altM)` + ACK. `rtl()` = `setMode('RTL')`. ACK correlation: listen for `message` events with `msgName==='COMMAND_ACK' && data.command === <sent cmd id>`.

- [ ] **Step 1: Failing tests** with a fake link (EventEmitter + recorded `send` + scripted ACK emission): happy arm (ACK 0), arm rejected when already armed, ACK result 4 → `ACK_FAILED`, no ACK → `ACK_TIMEOUT` (vi fake timers), takeoff guards (not copter / not armed / wrong mode), setMode name mapping copter+rover, disconnect guard on all five.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Integration vs SITL copter** (report evidence): connect → setMode GUIDED → arm → takeoff 20 → observe relAltM climbing in state → rtl → auto-disarm on land. Paste the state snapshots.
- [ ] **Step 4: Commit** `feat(bridge): validated vehicle commands with ack correlation`

### Task 6: WS server — telemetry stream + RPC + bridge main

**Files:**
- Create: `bridge/src/ws/schema.ts`, `bridge/src/ws/server.ts`
- Modify: `bridge/src/index.ts` (wire link+state+commands+ws)
- Test: `bridge/src/ws/__tests__/server.test.ts`

**Interfaces:**
- Produces (wire protocol — the app builds against THIS):
```ts
// server→client, ~5Hz + immediate on connect:
{ type: 'telemetry', state: TelemetryState }
// client→server:
{ type: 'rpc', id: string, method: 'arm'|'disarm'|'setMode'|'takeoff'|'rtl', params?: { mode?: string; altM?: number } }
// server→client responses:
{ type: 'rpc_result', id: string, ok: true } | { type: 'rpc_result', id: string, ok: false, code: string, message: string }
```
`schema.ts`: zod schemas `rpcRequestSchema`, `serverMessageSchema` + exported TS types. `server.ts`: `startWsServer({ port, getState, commands }): { close(): Promise<void> }` — throttles broadcasts to `CONFIG.telemetryHz` using a setInterval diff-agnostic broadcast (send latest snapshot each tick to all clients + once immediately on client connect); malformed client JSON → `{type:'rpc_result', ok:false, code:'BAD_REQUEST'}` when an id is recoverable, else ignore + log; CommandError maps `{code: e.code}`; unknown errors → `code:'INTERNAL'`. `index.ts`: construct VehicleLink, hold `state` updated via `reduce` on every `message` event, `makeCommands`, `startWsServer`, log lifecycle; SIGINT clean shutdown.

- [ ] **Step 1: Failing tests** (real `ws` client against server on an ephemeral port, fake commands/getState): receives telemetry immediately on connect; receives ≥2 ticks in 600ms at 5Hz; rpc arm ok:true routes to fake; CommandError surfaces code; malformed JSON doesn't crash server (subsequent rpc still works); zod rejects rpc with bad method.
- [ ] **Step 2:** FAIL → implement → PASS. `pnpm --filter bridge test` full suite green.
- [ ] **Step 3: Manual end-to-end:** SITL + `pnpm --filter bridge dev` + `npx wscat -c ws://localhost:8090` → see telemetry frames; send `{"type":"rpc","id":"1","method":"arm"}` (after a GUIDED setMode rpc) → `ok:true`. Evidence in report.
- [ ] **Step 4: Commit** `feat(bridge): ws telemetry stream + validated rpc + daemon main`

### Task 7: App scaffold + live map

**Files:**
- Create: `app/` via `pnpm create next-app@latest app --ts --app --no-tailwind --eslint --src-dir --import-alias "@/*"` (then prune boilerplate)
- Create: `app/src/lib/ws.ts`, `app/src/hooks/useTelemetry.ts`, `app/src/components/VehicleMap.tsx`, `app/src/app/page.tsx` (replace)
- Test: `app/src/lib/__tests__/ws.test.ts` (vitest node env — add vitest to app like bridge)

**Interfaces:**
- Consumes: Task 6 wire protocol verbatim (copy the TS types into `app/src/lib/types.ts` — single file, commented as mirror of bridge/src/ws/schema.ts).
- Produces: `useTelemetry(): { state: TelemetryState | null, wsStatus: 'connecting'|'open'|'closed', rpc(method, params?): Promise<void> }` — `rpc` rejects with `Error(code)` on `ok:false`; `ws.ts` exports the testable core `createWsClient(url, { onTelemetry, WebSocketImpl? })` with auto-reconnect (2s) and pending-rpc map keyed by id (crypto.randomUUID).

Map: `maplibre-gl` with CARTO dark style `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (free w/ attribution kept in the map attribution control). `VehicleMap` renders: vehicle marker (rotated SVG arrow by `attitude.yawDeg`), 200-point breadcrumb trail (GeoJSON line source updated per telemetry), home marker when set, auto-center-on-first-fix then user-pannable (a "recenter" button re-follows).

- [ ] **Step 1: Scaffold + deps** (`maplibre-gl`, dev `vitest`) + dep check. Dark page shell: full-viewport map + right sidebar div (instruments land Task 8) + top status bar (wsStatus + mode + armed placeholder chips fed from hook).
- [ ] **Step 2: Failing tests** for `createWsClient` with an injected fake WebSocketImpl: resolves rpc on matching id; rejects with code on ok:false; onTelemetry called with parsed state; reconnect schedules after close (fake timers).
- [ ] **Step 3:** FAIL → implement `ws.ts` + `useTelemetry` (thin hook over the core) → PASS. Typecheck + `next build` green.
- [ ] **Step 4: Manual verify** with SITL+bridge running: open localhost:3000 → vehicle appears over Kuwait home coords, yaw arrow sane, trail draws when flying (use Task 5's integration commands via wscat to take off). Screenshot in report.
- [ ] **Step 5: Commit** `feat(app): next scaffold, ws client, live vehicle map`

### Task 8: Instruments panel

**Files:**
- Create: `app/src/components/instruments/{AttitudeIndicator,Hsi,Tapes,StatusChips}.tsx`, `app/src/lib/format.ts`
- Modify: `app/src/app/page.tsx` (sidebar composition)
- Test: `app/src/lib/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `TelemetryState` from `useTelemetry`.
- Produces: pure `format.ts`: `fmtAlt(m: number): string` ("24.3 m"), `fmtSpeed(mps): string` ("5.2 m/s"), `fmtCoord(dd: number): string` (5 dp), `batteryColor(pct: number): 'ok'|'warn'|'crit'` (>30 ok, >15 warn, else crit), `gpsFixLabel(fixType: number): string` (0-1 'NO FIX', 2 '2D', 3 '3D', 4 'DGPS', 5-6 'RTK').

Components (SVG, no chart lib): `AttitudeIndicator` — artificial horizon (sky/ground split translated by pitch, rotated by roll, fixed wings reference); `Hsi` — compass rose rotated by −yaw with heading readout; `Tapes` — altitude (relAltM) + groundspeed vertical readouts; `StatusChips` — mode, ARMED/DISARMED (red/green), battery (voltage+pct, colored), GPS (fix label + sats), link (wsStatus + heartbeat age, stale >3s → red). All render "—" gracefully on null fields.

- [ ] **Step 1: Failing tests** for every `format.ts` function incl. boundary values (30/15 battery, fixType 0..6). FAIL → implement → PASS.
- [ ] **Step 2:** Build the four components + sidebar layout (dark theme, monospace readouts). Typecheck + build green. Manual: values move with SITL flight; unplug bridge → link chip goes red, instruments show "—".
- [ ] **Step 3: Commit** `feat(app): attitude/hsi/tapes/status instruments`

### Task 9: Flight controls

**Files:**
- Create: `app/src/components/FlightControls.tsx`, `app/src/components/ArmSlider.tsx`, `app/src/components/Toasts.tsx`
- Modify: `app/src/app/page.tsx`
- Test: `app/src/lib/__tests__/controls.test.ts` (exported pure helpers)

**Interfaces:**
- Consumes: `rpc()` from useTelemetry; TelemetryState for gating.
- Produces: exported pure `controlAvailability(state: TelemetryState | null): { canArm: boolean; canDisarm: boolean; canTakeoff: boolean; canRtl: boolean; modes: string[] }` — canArm: connected && !armed; canDisarm: armed; canTakeoff: copter && armed && mode==='GUIDED'; canRtl: armed; modes from vehicleType table (GUIDED/LOITER/RTL/LAND/STABILIZE for copter; MANUAL/HOLD/GUIDED/RTL/AUTO for rover).

UI: mode dropdown (rpc setMode); **ArmSlider** — drag-to-end slider that fires `arm` only at 100% then springs back (spec invariant 3: deliberate confirm; disarm is a double-click button labeled DISARM); Takeoff = numeric alt input (default 20, 2–120 clamp) + button; RTL button. Every rpc failure → toast with the error code + message; success → subtle toast. Buttons disabled per `controlAvailability` with title tooltips saying why.

- [ ] **Step 1: Failing tests** for `controlAvailability` (all gate combinations, both vehicle types, null state). FAIL → implement → PASS.
- [ ] **Step 2:** Components + wiring. Typecheck + build green.
- [ ] **Step 3: Manual golden mini-loop** (SITL copter): GUIDED → slide-arm → takeoff 20 → watch climb on tapes+map → RTL → auto-disarm. Evidence in report.
- [ ] **Step 4: Commit** `feat(app): flight controls with confirmed arming + rpc toasts`

### Task 10: Golden path runbook + README + rover pass

**Files:**
- Create: `docs/RUNBOOK.md`
- Modify: `README.md` (final three-terminal quickstart), `sim/README.md` (anything learned)

- [ ] **Step 1:** Write `docs/RUNBOOK.md`: exact three-terminal recipe (sim/run.sh copter · pnpm --filter bridge dev · pnpm --filter app dev), the copter golden path with expected instrument readings, the **rover pass** (run.sh rover → app shows rover modes → MANUAL/GUIDED arm + HOLD), troubleshooting table (SITL boot time, port 5760 busy, ws reconnect, map tiles offline).
- [ ] **Step 2: Execute the runbook top-to-bottom for real — both vehicles.** Fix any defect found in-session (no "minor, ignored"); each fix gets a test where the harness allows. Paste evidence per step in the report.
- [ ] **Step 3:** Full gates: `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter app build`, root `pnpm audit --prod` clean.
- [ ] **Step 4: Commit** `docs: p0 runbook + verified golden path (copter + rover)`

---

## Self-review notes

- **Spec coverage (P0 scope):** monorepo ✓(T1) SITL ✓(T2, incl. arm64-native + fallback note) link ✓(T3) state ✓(T4) commands+validation invariant ✓(T5) WS ✓(T6) map ✓(T7) instruments ✓(T8) controls+arm-confirm invariant ✓(T9) golden path incl. rover-in-sim ✓(T10). AI/watchdog/missions deliberately absent (P1 plan). Safety invariant 1 holds trivially (no AI code); invariant 2 is ArduPilot-side (documented in RUNBOOK troubleshooting scope); invariants 3+4 implemented (T9 slider, T5 typed guards).
- **Placeholders:** none — every step carries code, exact values, or a verify-with-evidence contract; the two upstream-variance points (SITL serial flag, node-mavlink send API) are handled with explicit spike/verify steps + the Library-API honesty rule rather than invented certainty.
- **Type consistency:** `TelemetryState` (T4) consumed by T5 deps, T6 protocol, T7 mirror types, T8/T9 props; `CommandError.code` union matches T6 rpc_result codes + T9 toasts; `CONFIG` values match spec ports everywhere.
