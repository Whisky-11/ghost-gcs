# GHOST GCS

A self-built ground control station for ArduPilot vehicles — connects to a simulated (and later real) drone/rover over MAVLink, shows live telemetry on a map, lets you plan and fly missions, and layers a headless AI copilot ("GHOST") on top. Personal project; see the full design spec at `docs/superpowers/specs/2026-07-03-falcon-gcs-design.md` and the P1 plan at `docs/superpowers/plans/2026-07-03-p1-missions-and-copilot.md`.

**P0** (telemetry + flight controls) and **P1** (missions + GHOST copilot)
are both done on this branch:

- SITL + bridge + app, live copter/rover telemetry, a dark map, full
  instrument panel, and confirmed flight controls (arm/mode changes require
  deliberate confirmation while armed).
- **Mission editor** — click to add waypoints, or draw a survey polygon and
  generate a lawnmower/boustrophedon survey grid at a chosen altitude and
  line spacing. Upload/start/clear a mission against the live vehicle; a
  copter flies it in AUTO after a manual GUIDED arm + takeoff (ArduPilot
  resumes the mission at the first WAYPOINT once airborne — no TAKEOFF item
  is needed in an AI-drafted or hand-built waypoint-only mission).
- **Advisory watchdog** — a pure rules engine (link staleness, low battery,
  degraded GPS, a simple battery-vs-distance-to-home heuristic, new
  STATUSTEXT errors) pushes alerts to the app; it only ever advises, never
  commands — ArduPilot's own failsafes remain the real safety net.
- **GHOST advisory copilot** — a panel in the app, backed by the local
  `claude` CLI running headless (`claude -p ... --output-format json`,
  rides your Claude subscription, no API key). Three features, each
  independently pending/done/error:
  1. **Draft a mission** — describe a mission in English (e.g. "survey this
     at 60m"), optionally with a drawn polygon/waypoints as geometry — GHOST
     returns a WAYPOINT-only draft (dashed preview on the map) that a human
     reviews and explicitly loads into the editor before uploading.
  2. **Ask GHOST** — a free-form question, answered from the current
     telemetry snapshot.
  3. **Debrief** — a plain-text summary of the last flight (duration, max
     altitude/speed, battery low-water mark, mode changes, alerts).

  **Spec safety invariant 1 (the AI never commands the vehicle) is enforced
  structurally, not just by convention, on both ends of the wire**: on the
  bridge, an AI RPC handler only ever receives a `WsAi` value that has no
  `commands`/`missions` field in scope at all (`bridge/src/ws/server.ts`);
  on the client, `GhostPanel`'s `aiRpc` prop is typed to accept only
  `'aiDraftMission' | 'aiNarrate' | 'aiDebrief'`
  (`app/src/components/GhostPanel.tsx`) — a call like
  `aiRpc('uploadMission', ...)` or `aiRpc('arm')` from that component is a
  **compile error**, not a runtime check. AI failures (CLI not logged in,
  timeout, schema-validation failure) degrade to a clear "AI unavailable"
  message; flying is never affected.

## Running it

Three terminals, in order (each waits on the previous):

1. **Sim** — `sim/run.sh copter` (or `sim/run.sh rover`) — builds the `ghost-sitl` Docker image once (~15–20 min first time) and starts ArduPilot SITL on TCP `localhost:5760`. Details: `sim/README.md`.
2. **Bridge** — `pnpm --filter bridge dev` — the Node/TS MAVLink↔WebSocket daemon; connects to SITL and serves telemetry + validated RPC on `ws://localhost:8090` (`bridge/`). Wait for `[bridge] ws server listening on ws://localhost:8090` before starting the app.
3. **App** — `pnpm --filter app dev` — the Next.js GCS UI at `http://localhost:3000` (`app/`): live dark map, attitude/HSI/tapes/status instruments, flight controls, the mission editor (waypoints + survey polygon), and the GHOST panel (draft/ask/debrief).

The GHOST panel's three AI features require the `claude` CLI on `PATH` and
logged in (`claude /login` once) — no API key needed. If the CLI isn't
available or isn't logged in, the three GHOST features degrade to an
"AI unavailable" message; every other feature (telemetry, flight controls,
mission editor/upload/AUTO) is completely unaffected.

**Before any run**, clear stray processes from a previous session (SITL is
single-client on TCP `5760`):

```bash
pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'
docker rm -f ghost-sitl falcon-sitl 2>/dev/null
```

Full walkthrough (exact golden-path sequences for both mission types,
expected instrument readings, the rover pass, and a troubleshooting table)
is in **`docs/RUNBOOK.md`** — executed end-to-end against live SITL for
both vehicle types, including a real `claude` CLI mission draft, while
writing it.

## Development

```bash
pnpm install       # once
pnpm -r test        # unit tests, both workspaces
pnpm -r typecheck   # both workspaces
pnpm --filter app build   # production build
pnpm audit --prod   # dependency vulnerability gate
```

Every AI test in the suite (`bridge/src/ai/__tests__/claude.test.ts`,
`features.test.ts`) injects a fake `Spawner` — the real `claude` CLI is
never invoked by `pnpm -r test`. The **one exception** is
`bridge/src/ai/__tests__/claude.smoke.test.ts`, gated behind an env var and
skipped by default:

```bash
GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke
```

This makes exactly one real `claude -p ... --output-format json` call with
a trivial `{ answer: string }` schema, proving the real CLI + JSON-parse +
zod-validate path end to end. Requires the `claude` CLI on `PATH` and
logged in. Without `GHOST_AI_SMOKE=1` set, vitest reports the test file as
skipped and makes zero real CLI calls.

## Licenses

`bridge/`'s MAVLink stack — `node-mavlink` and `mavlink-mappings` — is
**LGPL-2.1**. Fine for this personal, non-distributed project (used as an
unmodified dependency, not statically linked into a distributed binary). All
other dependencies (Next.js, React, maplibre-gl, ws, zod, vitest, etc.) are
MIT or another permissive license.
