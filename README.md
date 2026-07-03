# Falcon GCS

A self-built ground control station for ArduPilot vehicles — connects to a simulated (and later real) drone/rover over MAVLink, shows live telemetry on a map, and (in later phases) plans missions and layers an AI copilot on top. Personal project; see the full design spec at `docs/superpowers/specs/2026-07-03-falcon-gcs-design.md`.

## Running it (P0)

Three terminals:

1. **Sim** — start ArduPilot SITL (see `sim/README.md`, added in a later task).
2. **Bridge** — the Node/TS MAVLink↔WebSocket daemon (`bridge/`, commands added in a later task).
3. **App** — the Next.js GCS UI (`app/`, added in a later task).

This file will be amended with concrete commands as each piece lands.
