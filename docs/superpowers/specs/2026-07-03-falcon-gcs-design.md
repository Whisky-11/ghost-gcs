# Falcon GCS — Design Spec

> Project renamed Falcon → GHOST (2026-07-03, Ahmad). Falcon references below are historical.

**Date:** 2026-07-03 · **Owner:** Ahmad Sharaf (personal passion project) · **Status:** Approved (conversation 2026-07-03)

## What this is

A self-built **ground control station** for ArduPilot vehicles — the app that connects to a drone/rover over MAVLink, shows live telemetry on a map, plans and uploads missions, and layers an **AI copilot** on top (Claude, via **`claude -p` headless** on Ahmad's Max subscription — deliberately NOT the Anthropic API; zero marginal AI cost).

It expresses Ahmad's identity: mechatronics + robotics + AI + aviation. **English-only UI** (deliberate — aviation's language; also distinguishes this from Force AI's Arabic-first client work).

Working name **Falcon GCS** — rename is a one-file constant.

## Goals / Non-goals

**Goals**
- Fly a simulated ArduPilot vehicle (SITL) from my own GCS on day one; drive a real self-built **rover** with the same app in phase 2 (legal in Kuwait, unlike hobby drones — real drone remains a someday-chapter pending DGCA authorization or travel).
- AI copilot that drafts missions from natural language, narrates/explains a rules-based flight watchdog, and writes post-flight debriefs.
- Everything runs locally on the Mac. No cloud services, no keys, no recurring cost beyond the existing Claude Max plan.

**Non-goals (deliberate)**
- No multi-user/auth/tenancy — single operator, localhost.
- No Arabic/i18n layer.
- No autonomous AI control of the vehicle — ever (see Safety invariants).
- Not a QGroundControl replacement for the world; it's *mine*.

## Architecture

```
ArduPilot SITL (docker / native macOS build) ──UDP 14550──┐
Rover (phase 2: SiK 915MHz radio → USB serial) ───────────┤
                                                          ▼
                              bridge/  — Node 22 + TypeScript daemon
                              • MAVLink codec (node-mavlink + mavlink-mappings)
                              • Vehicle state store (last-known telemetry, ~5Hz throttle)
                              • WebSocket server (ws): telemetry stream + command RPC
                              • Mission protocol (upload/download, MISSION_ITEM_INT)
                              • Rules watchdog (deterministic alerts)
                              • ClaudeHeadless adapter (spawns `claude -p`, queued, max 1 concurrent)
                                                          ▼  ws://localhost:8090
                              app/  — Next.js 15 GCS UI (localhost:3000)
                              • MapLibre GL dark map, vehicle marker + trail + home
                              • Instruments: attitude indicator, HSI, alt/speed tapes, battery, GPS, link
                              • Mission editor: click-waypoints + polygon survey-grid generator
                              • AI copilot panel: mission drafts, watchdog narration, Q&A, debrief
                              • Connect / Arm / Disarm / Mode / Takeoff / RTL controls (confirmations)
```

Monorepo: `bridge/`, `app/`, `sim/` (SITL compose + native-build notes), `docs/`. pnpm workspaces.

### Unit boundaries (each independently testable)

| Unit | Responsibility | Interface |
|---|---|---|
| `bridge/src/mavlink/` | encode/decode, connection lifecycle (UDP now, serial phase 2) | `VehicleLink` events: `telemetry(TelemetryState)`, `missionAck`, `statusText`; methods: `arm()`, `setMode(m)`, `takeoff(alt)`, `rtl()`, `uploadMission(items)` |
| `bridge/src/state/` | merge MAVLink messages → one `TelemetryState` snapshot (position, attitude, battery, gps, mode, armed, home, link) | pure reducers, unit-tested |
| `bridge/src/ws/` | WS server: JSON `{type:'telemetry',...}` stream @5Hz + `{type:'rpc', id, method, params}` request/response | schema-validated (zod) both directions |
| `bridge/src/watchdog/` | deterministic rules → `Alert{severity, code, message, data}` (battery-vs-distance-home, geofence proximity, link loss, GPS degradation) | pure function of `TelemetryState` history; unit-tested |
| `bridge/src/ai/` | `ClaudeHeadless.ask(prompt, schema?)` → spawn `claude -p <prompt> --output-format json`, parse, zod-validate, ONE retry with validation error appended; FIFO queue, concurrency 1, timeout 120s | never throws into the safety path; AI unavailable = features degrade, flying unaffected |
| `bridge/src/missions/` | mission model + survey-grid generator (polygon + alt + spacing → lawnmower waypoints; PURE, heavily tested) + MAVLink mission upload sequencing | |
| `app/src/` | UI; consumes WS only | components take plain props; geometry/math helpers exported pure for tests |

### AI copilot contract

- **Mission Draft**: prompt = system context (vehicle type, home, constraints) + user NL request + drawn geometry (GeoJSON) + JSON schema of `MissionDraft{items: Waypoint[{lat,lng,altM,cmd}], speedMps?, notes}`. Response zod-validated. Rendered as dashed overlay. **Upload only on explicit user click.**
- **Watchdog narration / Q&A**: alert or user question + current `TelemetryState` snapshot → prose answer. Async; alerts themselves display instantly from the rules engine (never wait on AI).
- **Debrief**: computed flight stats (durations, max alt/speed, battery curve, mode changes, alert history) → readable report.
- Discipline: single-flight queue (Ahmad's standing 1–2 concurrent `claude -p` rule), lean prompts, no fanout, no loops.

### Safety invariants (binding on every phase)

1. **The AI never commands the vehicle.** No AI code path reaches `VehicleLink` mutators. Drafts require explicit human Upload; advice is text.
2. Hard failsafes (battery RTL, geofence) live in **ArduPilot parameters**, not in our code; the watchdog is advisory.
3. Arm and mode-change UI actions require confirmation; Arm requires a typed/slider confirm.
4. Bridge validates every RPC against vehicle state (e.g. no takeoff unless armed + GUIDED) — reject with typed errors.

## Simulation setup

- SITL via docker (x86 images run under Rosetta on Apple Silicon — verify performance in P0 task 1; **fallback: native macOS ArduPilot SITL build**, documented in `sim/README.md`). Copter target for flying; **Rover target from day one** (proves the phase-2 path in sim).
- Bridge connects UDP 14550 (SITL default broadcast).

## Testing

- Unit: state reducers, watchdog rules, survey-grid generator, mission sequencing, WS schemas, ClaudeHeadless parse/retry (claude CLI mocked via injectable spawn).
- Integration: bridge against live SITL in docker — connect, stream telemetry, arm, takeoff (copter), waypoint mission round-trip. Runs locally + CI-able.
- App: pure-helper tests (geometry, formatting) per the node-env vitest pattern; visual/manual for the map.
- AI calls are NEVER exercised in tests against the real CLI (injectable adapter + fixtures).

## Phases

- **P0 — Foundations:** monorepo, SITL running, bridge (link + state + WS), app (map + instruments + connect/arm/mode/takeoff/RTL). *Win: a simulated drone flying on my screen under my app.*
- **P1 — Missions + AI:** mission editor + survey generator + upload/execute; ClaudeHeadless + the three AI features; watchdog.
- **P2 — Rover hardware:** BOM (~$250: Pixhawk-class FC e.g. SpeedyBee/Matek with ArduPilot Rover, M8N/M10 GPS, SiK 915MHz telemetry pair, RC, chassis/ESC/motors, LiPo + charger), serial `VehicleLink` transport, field drive.
- **P3 — Extras:** telemetry PWA view, Zero voice hook, log-file (.bin) deep analysis, drone chapter when legal.

Each phase gets its own bite-sized plan; P0 first.

## Risks / open items

- `node-mavlink` maturity/typing vs raw dialect handling — P0 task verifies with a spike test against SITL before deep integration (fallback: `mavlink` (pymavlink-style JS port) or minimal hand-rolled dialect subset for the ~15 messages we need).
- SITL-on-Apple-Silicon performance (docker/Rosetta) — verified in P0; native build fallback documented.
- `claude -p` latency (seconds per call) — acceptable by design (no AI in safety/immediacy paths).
- Phase-2 serial permissions on macOS + SiK pairing — phase-2 plan concern, not P0.
