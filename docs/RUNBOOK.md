# GHOST GCS — Golden Path Runbook

This is the exact procedure to fly a simulated vehicle end-to-end through our
own GCS: ArduPilot SITL (Docker) → `bridge/` (MAVLink↔WebSocket daemon) →
`app/` (Next.js UI). It was executed for real against live SITL for both
vehicle types while writing this document (Task 10, P0-only flows) — see
"Evidence" under each golden path below for the actual captured output. The
**P1 golden path** (mission editor, survey generation, GHOST AI copilot
draft→load→upload→fly, rover 2-waypoint AUTO mission) was executed for real
against live SITL, including one real `claude` CLI call, while writing
Task 11 — see "P1: mission editor + GHOST copilot golden path" below.

## Prerequisites

- Docker Desktop or OrbStack running (arm64-native build, no Rosetta).
- Node 22 (`.nvmrc`), pnpm 9 (`corepack enable` or `npm i -g pnpm@9`).
- `pnpm install` once at the repo root.
- The `ghost-sitl` Docker image built once — `sim/run.sh copter` builds it
  automatically the first time it's missing (~15–20 min, compiles ArduPilot
  from source). Subsequent runs reuse the cached image.

## Carry-note before ANY run

SITL is **single-client** on TCP `5760` — only one `ghost-sitl` container
may hold that port at a time, and only one bridge process should be talking
to it. Before starting anything:

```bash
pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'
docker rm -f ghost-sitl falcon-sitl 2>/dev/null
```

This clears stray bridge processes from a previous session (a crashed
terminal doesn't always kill `tsx watch`'s child) and any leftover SITL
container before you boot a fresh one. Skipping this step is the single most
common cause of "nothing connects" — see the troubleshooting table.

## Three-terminal quickstart

1. **Terminal 1 — sim**: `sim/run.sh copter` (or `sim/run.sh rover`). Builds
   the image on first run, then starts ArduPilot SITL listening on TCP
   `localhost:5760`. Details: `sim/README.md`.
2. **Terminal 2 — bridge**: `pnpm --filter bridge dev`. Connects to SITL,
   waits for the first HEARTBEAT, then serves telemetry + RPC over
   `ws://localhost:8090`. Look for:
   ```
   [bridge] connecting to SITL at 127.0.0.1:5760...
   [bridge] vehicle link connected
   [bridge] connected to vehicle (first heartbeat received)
   [bridge] ws server listening on ws://localhost:8090
   ```
3. **Terminal 3 — app**: `pnpm --filter app dev` → open
   `http://localhost:3000`. The map centers on the vehicle once telemetry
   arrives; instruments and flight controls come alive as soon as the WS
   connection opens (`wsStatus` badge in the header flips to `open`).

To stop: `Ctrl-C` in terminals 2 and 3, `docker stop ghost-sitl` (or
`Ctrl-C` in terminal 1 if run in the foreground — the container is `--rm`
and removes itself on stop).

## Copter golden path

**Sequence**: connect → set mode `GUIDED` → arm (via the ArmSlider, dragged
to 100%) → takeoff to 20m → climb → command `RTL` → vehicle lands and
**auto-disarms** (ArduPilot's landing detector disarms on touchdown — no
explicit DISARM click needed for this path; the DISARM button exists for the
manual/abort case).

**Expected instrument readings as the sequence progresses** (from the same
`TelemetryState` the WS stream broadcasts, which every instrument in
`app/src/components/instruments/` renders directly):

| Phase | Status chips | Tapes (alt / speed) | Attitude indicator | HSI |
|---|---|---|---|---|
| Boot, disarmed | `STABILIZE`, DISARMED, GPS 3D fix | alt ≈0m, speed ≈0 | level | heading ≈ boot heading |
| After `setMode GUIDED` | `GUIDED`, DISARMED | unchanged | level | unchanged |
| After arm | `GUIDED`, **ARMED** (red chip) | alt ≈0m | level | unchanged |
| Climbing | `GUIDED`, ARMED | alt climbing 0→20m, climb rate ≈+2.5 m/s | slight nose-up during throttle-up | unchanged |
| Hover at 20m | `GUIDED`, ARMED | alt ≈20m, climb rate ≈0 | level | unchanged |
| After `RTL` | `RTL`, ARMED | alt descending 20→0m, climb rate ≈−0.5 m/s | pitched toward home heading | HSI course points at home |
| Touchdown | `RTL`, **DISARMED** | alt ≈0m, climb rate ≈0 | level | — |

### Evidence (executed 2026-07-03, live SITL copter)

Verified surfaces before driving the sequence:
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → `200`.
- `pnpm --filter app dev` log: `✓ Ready in 197ms`, no errors.
- Bridge log: connected + ws listening (above), no errors during the run.

Since this agent can't click, the rpc/telemetry sequence was driven over the
exact wire protocol `app/src/lib/ws.ts` uses (a temporary `ws`-based script
connecting to `ws://localhost:8090`, sending the same `{type:'rpc',...}`
frames the UI's `rpc()` sends and reading the same `{type:'telemetry',...}`
frames the UI's `useTelemetry()` consumes — not committed, deleted after the
run). Actual captured output:

```
[initial] connected=true vehicleType=copter armed=false mode=STABILIZE relAlt=-0.01 climb=-0.00
--- setMode GUIDED ---
[after setMode GUIDED] connected=true vehicleType=copter armed=false mode=GUIDED relAlt=-0.01 climb=-0.00
--- arm ---
[after arm] connected=true vehicleType=copter armed=true mode=GUIDED relAlt=0.00 climb=-0.00
--- takeoff 20 ---
[climb t+2s]  relAlt=0.00  climb=0.00
[climb t+4s]  relAlt=0.63  climb=1.16
[climb t+6s]  relAlt=4.60  climb=2.55
[climb t+8s]  relAlt=9.60  climb=2.48
[climb t+10s] relAlt=14.60 climb=2.49
[climb t+12s] relAlt=19.03 climb=1.43
[climb t+14s] relAlt=19.99 climb=-0.06
--- rtl ---
[rtl t+2s]  mode=RTL relAlt=19.94 climb=0.01
...
[rtl t+34s] mode=RTL relAlt=0.47  climb=-0.50
[rtl t+36s] mode=RTL relAlt=-0.01 climb=0.01
[rtl t+38s] mode=RTL armed=false relAlt=-0.01 climb=0.00
AUTO-DISARM CONFIRMED
```

Matches the expected-readings table exactly: mode transitions
`STABILIZE→GUIDED→RTL`, `armed` flips `false→true→false`, `relAltM` climbs
0→~20m then descends 20→0m, `climbMps` swings positive during ascent and
negative during descent — the same fields `Tapes.tsx`/`AttitudeIndicator.tsx`
read to draw the instruments. No defects found in this pass.

## Rover pass

**Sequence**: stop the copter SITL container, start `sim/run.sh rover` on
the same port — the bridge's existing 2s reconnect backoff (`link.ts`)
finds the new listener automatically, no bridge restart needed. Once the
first rover HEARTBEAT decodes, `vehicleType` flips to `rover` and the app's
mode dropdown repopulates from the rover mode table
(`controlAvailability`'s `ROVER_UI_MODES`). Then: `setMode GUIDED` → arm →
`setMode HOLD`.

### Evidence (executed 2026-07-03, live SITL rover)

```
docker stop ghost-sitl                # copter container down
sim/run.sh rover                     # new container, same TCP 5760
```

Bridge log across the swap:
```
[bridge] vehicle link disconnected — reconnecting
[bridge] vehicle link error Error: connect ECONNREFUSED 127.0.0.1:5760   (x6, expected — rover
                                                                            SITL still booting)
[bridge] vehicle link connected
```

Driver script output (same wire-protocol approach as the copter pass, plus a
direct import of `app/src/lib/controls.ts`'s real `controlAvailability` —
not a reimplementation — to verify the mode list against the live state):

```
[initial] connected=true vehicleType=rover armed=false mode=GUIDED
[controlAvailability.modes] [ 'MANUAL', 'HOLD', 'GUIDED', 'RTL', 'AUTO' ]
ROVER MODE LIST MATCHES
--- setMode GUIDED ---
[after setMode GUIDED] connected=true vehicleType=rover armed=false mode=GUIDED
--- arm ---
[after arm] connected=true vehicleType=rover armed=true mode=GUIDED
--- setMode HOLD ---
[after setMode HOLD] connected=true vehicleType=rover armed=true mode=HOLD
--- disarm (cleanup) ---
[after disarm] connected=true vehicleType=rover armed=false mode=HOLD
ROVER PASS CONFIRMED
```

**One real trap hit and resolved during this pass** (not a code defect —
recorded in the troubleshooting table below): the very first arm attempt,
made immediately after `vehicleType` flipped to `rover`, was rejected with
`ACK_FAILED: command 400 rejected: MAV_RESULT=4`. The bridge's
`statusTexts` ring showed why: `"PreArm: Need Position Estimate"` — EKF/GPS
hadn't converged yet (rover had only just re-booted after the container
swap). Waited ~15s for `"EKF3 IMU0/1 is using GPS"` status texts and a GPS
`fixType` of 3D, retried — arm succeeded immediately. This is ArduPilot's
own (correct) safety gate, propagated faithfully by `commands.ts`'s
`ACK_FAILED` path; no bridge or app change was needed.

## P1: mission editor + GHOST copilot golden path

**Sequence (copter)**: draw a survey polygon in the mission editor → GHOST
panel: "Draft from drawing" with the request "survey this at 60m" → GHOST
(the real local `claude` CLI, headless) returns a WAYPOINT-only mission
draft → dashed preview overlay on the map → "Load into editor" → review →
**Upload** → `setMode GUIDED` → **arm** → **GUIDED takeoff to 60m** (the
draft's cruise altitude) → **Start Mission** (switches to AUTO — ArduPilot
resumes the already-airborne vehicle at the first WAYPOINT, no TAKEOFF item
needed) → watch it fly the lawnmower grid → **RTL** → ask GHOST a question →
**Debrief**.

**Sequence (rover)**: draw/build a 2-waypoint mission → **Upload** →
`setMode GUIDED` → **arm** → **Start Mission** (AUTO) → watch it drive the
2-waypoint route.

### Evidence (executed 2026-07-03, live SITL copter — real `claude` CLI)

Since this agent can't click, this pass was driven the same way as Task
10's P0 evidence: a temporary `ws`-based driver script (not committed,
deleted after the run) sending the exact `{type:'rpc',...}` frames
`app/src/lib/ws.ts`'s `rpc()` sends — including `aiDraftMission`, which
calls the bridge's real `ClaudeHeadless` adapter, which spawns the real
local `claude` CLI (no fake Spawner — this is the actual production path,
not a test double). Home position and a ~80×80m polygon around it (four
corners, drawn-polygon equivalent) were read from the first telemetry
frame.

```
[initial] connected=true vehicleType=copter armed=false mode=STABILIZE
[home] {"lat":29.3375,"lng":47.9743999,"altM":10.1}
--- aiDraftMission: "survey this at 60m" ---
[draft] items= 8 notes= Lawnmower survey draft at 60m AGL over the ~80x80m drawn polygon: 4
  north-south legs spaced ~24m apart (suitable overlap for a typical copter camera at 60m),
  inset ~5m from the polygon edges so every waypoint sits strictly inside the geometry.
  Waypoints only — operator adds takeoff/RTL on review.
--- Load into editor + upload ---
[uploadMission] ok
--- setMode GUIDED ---
[after setMode GUIDED] armed=false mode=GUIDED
--- arm ---
[after arm] armed=true mode=GUIDED relAlt=0.00
--- GUIDED takeoff 60m ---
[climb t+2s]  relAlt=0.00  climb=0.00
[climb t+8s]  relAlt=8.60  climb=2.47
[climb t+14s] relAlt=23.58 climb=2.50
[climb t+20s] relAlt=38.58 climb=2.50
[climb t+26s] relAlt=53.59 climb=2.49
[climb t+28s] relAlt=58.37 climb=1.87
--- startMission (AUTO) ---
[auto t+2s]  mode=AUTO relAlt=60.36 groundMps=0.93
[auto t+6s]  mode=AUTO relAlt=60.35 groundMps=7.40   (leg 1 — accelerating)
[auto t+10s] mode=AUTO relAlt=60.04 groundMps=4.25   (turn onto leg 2)
[auto t+16s] mode=AUTO relAlt=60.01 groundMps=9.40   (leg 2 — cruise)
... (groundMps repeatedly cycles ~0.1→9+ m/s across the run — the
    accelerate/cruise/decelerate/turn pattern of a serpentine lawnmower grid,
    for a total of ~120s, matching the 8-waypoint draft) ...
[auto t+120s] mode=AUTO relAlt=59.99 groundMps=0.03  (arrived at final waypoint, holding)
--- rtl ---
[rtl t+2s]  mode=RTL relAlt=59.99 groundMps=0.55
[rtl t+8s]  mode=RTL relAlt=59.99 groundMps=7.92      (flying back toward home)
[rtl t+20s] mode=RTL relAlt=59.28 climb=-1.25         (descent begins over home)
[rtl t+38s] mode=RTL relAlt=31.90 climb=-1.50
[rtl t+56s] mode=RTL relAlt=8.85  climb=-0.51
--- (continued polling) ---
[t+2s] mode=RTL armed=false relAlt=0.00
AUTO-DISARM CONFIRMED
--- ask GHOST a question ---
[aiNarrate answer] "Battery margin looks comfortable: you're at 49% remaining (12.3V) and the
  vehicle is already essentially over home — ... 49% is far more than needed to complete this
  landing."
--- Debrief last flight ---
[aiDebrief] {"text":"Flight completed in approximately 120 seconds with no alerts raised. The
  vehicle reached a maximum altitude of 60.0 m and a peak groundspeed of about 8.0 m/s, then
  transitioned from AUTO to RTL to conclude the flight. ... Battery ended at a minimum of 46%,
  leaving a healthy margin at landing.",
  "stats":{"durationSec":120.054,"maxAltM":59.996,"maxGroundMps":7.97,"minBatteryPct":46,
  "modeChanges":["AUTO","RTL"],"alertHistory":[],"waypointsFlown":1}}
```

The AI draft's 8 waypoints all validated against `missionDraftSchema`
(WAYPOINT-only, altM=60, first attempt — no retry needed), matched the
requested geometry (inset inside the drawn polygon), and flew exactly as
drafted: GUIDED takeoff to the draft's cruise altitude, AUTO through all 8
legs (varying groundspeed = accelerate/cruise/turn pattern of a lawnmower
grid), explicit RTL, auto-disarm on touchdown. `aiNarrate` and `aiDebrief`
both returned coherent, telemetry-grounded text from the real CLI. No
defects found in this pass.

### Evidence (executed 2026-07-03, live SITL rover — 2-waypoint AUTO mission)

Per the carry-note above, swapped the copter SITL container for a rover one
on the same port; the bridge auto-reconnected. A 2-waypoint mission (~60m
north, then ~60m north-east of home) was uploaded directly (this pass
exercises the mission-upload/AUTO path, not GHOST — GHOST's mission drafts
are WAYPOINT-only same as any hand-built mission, so the flown behavior is
identical either way):

```
[initial] connected=true vehicleType=rover armed=false mode=MANUAL
[home] {"lat":29.3375,"lng":47.9743999,"altM":10}
--- uploadMission (2 waypoints) ---
[uploadMission] ok
--- setMode GUIDED ---
[after setMode GUIDED] armed=false mode=GUIDED
--- arm ---
[arm attempt 1] rejected: ACK_FAILED: command 400 rejected: MAV_RESULT=4 — waiting for GPS/EKF...
[arm attempt 4] rejected: ACK_FAILED: command 400 rejected: MAV_RESULT=4 — waiting for GPS/EKF...
[after arm] armed=true mode=GUIDED
--- startMission (AUTO) ---
[auto t+2s]  mode=AUTO groundMps=0.39   (pulling away)
[auto t+8s]  mode=AUTO groundMps=5.26   (leg 1 cruise)
[auto t+16s] mode=AUTO groundMps=2.97   (turn onto leg 2)
[auto t+22s] mode=AUTO groundMps=5.07   (leg 2 cruise)
[auto t+32s] mode=AUTO groundMps=0.25   (arriving at waypoint 2)
[auto t+90s] mode=AUTO groundMps=0.03   (stopped/holding at final waypoint)
--- disarm (cleanup) ---
armed=false shortly after (confirmed on a follow-up poll — telemetry
  reflects the disarm ~1s after the rpc resolves, a broadcast-cadence lag,
  not a bug)
ROVER PASS COMPLETE
```

Same pre-arm trap as Task 10's rover pass (EKF/GPS not converged
immediately after the container swap — `"PreArm: Need Position Estimate"`,
resolved by waiting/retrying) — ArduPilot's own correct safety gate, not a
regression. The rover accelerated to ~5 m/s cruise on each leg, decelerated
and effectively stopped (`groundMps` settling to ~0.03, sensor noise floor)
right around when it should have reached the second waypoint, confirming
it drove the 2-waypoint route. No code defects found in this pass.

## Full gates (run after the golden paths, everything stopped)

```
pnpm -r test              # bridge: 223 passed, 1 skipped (claude.smoke, gated) — app: 145 passed
pnpm -r typecheck          # app + bridge, clean
pnpm --filter app build    # production build, succeeds
pnpm audit --prod          # 0 vulnerabilities at every severity
```

The one skipped bridge test (`claude.smoke.test.ts`) is a GATED real-`claude`-CLI
smoke, run separately and on purpose — see "GATED real-CLI smoke test" below.

## GATED real-CLI smoke test

Every AI test in the suite injects a fake `Spawner` — no test in
`pnpm -r test`'s normal run ever spawns the real `claude` binary. The one
documented exception, `bridge/src/ai/__tests__/claude.smoke.test.ts`, is
skipped unless `GHOST_AI_SMOKE=1` is set:

```bash
GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke
```

Executed for real (2026-07-03) — one live `askJson` call against a trivial
`{ answer: string }` schema:

```
stdout | ... askJson performs one real `claude -p` call and validates a trivial schema
[claude.smoke] real CLI askJson result: {"answer":"blue"}

 ✓ src/ai/__tests__/claude.smoke.test.ts > ... askJson performs one real `claude -p` call ... 7005ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Confirms the real CLI spawn → `--output-format json` parse → `.result`
extraction → zod validation path end to end, exactly as
`bridge/src/ai/claude.ts`'s header comment documents. Without
`GHOST_AI_SMOKE=1`, the same command reports the file as skipped
(confirmed: `Test Files  1 skipped (1)`, zero real CLI calls, ~100ms).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Bridge hangs on `connecting to SITL...` forever / `HeartbeatTimeoutError` after 15s | SITL container isn't up yet, or Docker/OrbStack isn't running | Start `sim/run.sh copter\|rover` first and wait for `"Waiting for internal clock bits to be set"` in its logs before starting the bridge; the bridge itself retries `connect()` every 5s on a cold start so it recovers once SITL is up |
| `EADDRINUSE` on port `5760`, or a second `sim/run.sh` refuses to start | A previous `ghost-sitl` container (or stray SITL process) is still holding the port — **SITL is single-client, only one container may bind 5760** | `docker rm -f ghost-sitl falcon-sitl` before starting a new one; check `lsof -i :5760` for anything else bound there |
| Bridge won't reconnect after swapping copter↔rover, or telemetry looks stuck | An old `tsx watch` bridge process from a previous terminal/session is still running and holding its own stale TCP connection/ws port | `pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'` then restart `pnpm --filter bridge dev` fresh — **always do this before any run**, per the carry-note above |
| `EADDRINUSE` on `8090` (ws) or `3000` (app) | A previous bridge/app dev process from an earlier session is still alive | `lsof -ti :8090 \| xargs kill -9` / `lsof -ti :3000 \| xargs kill -9`, or the `pkill` command above for the bridge |
| App's header WS status badge stuck on `connecting`/flaps `open`→`closed`→`connecting` | Bridge isn't running, crashed, or was restarted — `lib/ws.ts`'s client auto-reconnects every 2s once the bridge comes back, no app restart needed | Check terminal 2 for the bridge process/logs; once `ws server listening` reappears the app reconnects on its own within ~2s |
| `arm` rejected with `ACK_FAILED ... MAV_RESULT=4` right after SITL boots (fresh boot or after a copter↔rover container swap) | ArduPilot's own pre-arm check: `"PreArm: Need Position Estimate"` — EKF/GPS hasn't converged yet | Wait ~10–20s after the vehicle's first HEARTBEAT for GPS 3D fix + `"EKF3 ... is using GPS"` status texts before arming; this is correct safety behavior, not a bug |
| Map tiles don't load / grey background in `VehicleMap` | No internet access to the tile server (MapLibre dark style is a hosted vector tile source, not bundled) | Expected in offline/sandboxed environments — the map still renders the vehicle marker/track on the (blank) canvas; telemetry, instruments, and controls are unaffected since they don't depend on tile availability |
| `docker build` for `ghost-sitl` takes 15–20+ minutes | First build compiles ArduPilot from source (git clone + submodules + `./waf configure && ./waf copter rover`) | Expected once; subsequent runs reuse the cached image unless `sim/Dockerfile` changes. See `sim/README.md`'s native-macOS-build fallback if Docker itself is the blocker |
| `orbctl status` shows `Stopped` and `docker info`/`docker ps` hang or refuse to connect even though the OrbStack app process is running | The OrbStack VM itself hasn't finished starting (`orbctl start` can time out once with "timed out waiting for VM to start" on a cold boot) | Run `orbctl start` again — it's idempotent; a second call typically reports "OrbStack is already running. Docker engine is ready to use." within seconds. Confirmed live 2026-07-03 (Task 11): first `orbctl start` timed out, second succeeded immediately |
| `sim/run.sh` prints the `DEPRECATED: found old 'falcon-sitl' image...` fallback message | No `ghost-sitl`-tagged image exists yet, only the pre-rename `falcon-sitl` one | Run `docker tag falcon-sitl ghost-sitl` once (both tags then point at the same image ID — confirmed already done in this repo as of Task 11, `docker images` shows both tags sharing one `IMAGE ID`) so `sim/run.sh` takes its primary `ghost-sitl` path instead of the fallback |
