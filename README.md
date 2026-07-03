# Falcon GCS

A self-built ground control station for ArduPilot vehicles — connects to a simulated (and later real) drone/rover over MAVLink, shows live telemetry on a map, and (in later phases) plans missions and layers an AI copilot on top. Personal project; see the full design spec at `docs/superpowers/specs/2026-07-03-falcon-gcs-design.md`.

P0 (this branch) is done: SITL + bridge + app, live copter/rover telemetry,
a dark map, full instrument panel, and confirmed flight controls (arm/mode
changes require deliberate confirmation while armed). AI/watchdog/missions
are P1, not in this branch.

## Running it

Three terminals, in order (each waits on the previous):

1. **Sim** — `sim/run.sh copter` (or `sim/run.sh rover`) — builds the `falcon-sitl` Docker image once (~15–20 min first time) and starts ArduPilot SITL on TCP `localhost:5760`. Details: `sim/README.md`.
2. **Bridge** — `pnpm --filter bridge dev` — the Node/TS MAVLink↔WebSocket daemon; connects to SITL and serves telemetry + validated RPC on `ws://localhost:8090` (`bridge/`). Wait for `[bridge] ws server listening on ws://localhost:8090` before starting the app.
3. **App** — `pnpm --filter app dev` — the Next.js GCS UI at `http://localhost:3000` (`app/`): live dark map, attitude/HSI/tapes/status instruments, and flight controls (mode select, arm slider, DISARM, takeoff altitude, RTL).

**Before any run**, clear stray processes from a previous session (SITL is
single-client on TCP `5760`):

```bash
pkill -f 'tsx.*bridge/src/index.ts'; pkill -f 'tsx watch'
docker rm -f falcon-sitl 2>/dev/null
```

Full walkthrough (exact golden-path sequence, expected instrument readings,
the rover pass, and a troubleshooting table) is in **`docs/RUNBOOK.md`** —
executed end-to-end against live SITL for both vehicle types while writing
it.

## Development

```bash
pnpm install       # once
pnpm -r test        # unit tests, both workspaces
pnpm -r typecheck   # both workspaces
pnpm --filter app build   # production build
pnpm audit --prod   # dependency vulnerability gate
```
