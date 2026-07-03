# Falcon GCS

A self-built ground control station for ArduPilot vehicles — connects to a simulated (and later real) drone/rover over MAVLink, shows live telemetry on a map, and (in later phases) plans missions and layers an AI copilot on top. Personal project; see the full design spec at `docs/superpowers/specs/2026-07-03-falcon-gcs-design.md`.

## Running it (P0)

Three terminals:

1. **Sim** — `sim/run.sh copter` (or `rover`) — builds the `falcon-sitl` Docker image once (~15+ min first time) and starts ArduPilot SITL on TCP `localhost:5760`. Details: `sim/README.md`. Quick sanity check: `pnpm --filter bridge exec tsx scripts/probe-sitl.ts` prints decoded HEARTBEATs.
2. **Bridge** — `pnpm --filter bridge dev` — the Node/TS MAVLink↔WebSocket daemon; connects to SITL and serves the telemetry/RPC WS API on `ws://localhost:8090` (`bridge/`).
3. **App** — `pnpm --filter app dev` — the Next.js GCS UI at `http://localhost:3000` (`app/`); live map now, instruments + flight controls land in later tasks.

This file will be amended with concrete commands as each piece lands.
