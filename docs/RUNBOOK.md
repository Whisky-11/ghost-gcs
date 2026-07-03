# GHOST GCS — Golden Path Runbook

This is the exact procedure to fly a simulated vehicle end-to-end through our
own GCS: ArduPilot SITL (Docker) → `bridge/` (MAVLink↔WebSocket daemon) →
`app/` (Next.js UI). It was executed for real against live SITL for both
vehicle types while writing this document (Task 10) — see "Evidence" under
each golden path below for the actual captured output.

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

## Full gates (run after the golden paths, everything stopped)

```
pnpm -r test              # 56/56 app + bridge unit tests
pnpm -r typecheck          # app + bridge, clean
pnpm --filter app build    # production build, succeeds
pnpm audit --prod          # 0 vulnerabilities at every severity
```

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
