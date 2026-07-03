# GHOST GCS — app

Next.js 16 / React 19 GCS UI. Connects to the `bridge/` WebSocket server
(`ws://localhost:8090` by default, override via `NEXT_PUBLIC_BRIDGE_WS_URL`)
and renders live vehicle telemetry on a MapLibre dark map.

See the root `README.md` and `docs/superpowers/specs/2026-07-03-falcon-gcs-design.md`
for the full picture (this is one of three pieces: sim / bridge / app).

## Dev

```bash
pnpm --filter app dev     # http://localhost:3000 — needs bridge (+ sim) running for live data
pnpm --filter app test    # vitest — ws.ts client core, node-testable
pnpm --filter app typecheck
pnpm --filter app build   # does not require the bridge running
```

## Layout

- `src/lib/types.ts` — hand-kept TS mirror of the bridge's wire protocol (`bridge/src/ws/schema.ts`).
- `src/lib/ws.ts` — `createWsClient()`, the node-testable WS client core (injectable `WebSocketImpl`, 2s auto-reconnect, pending-rpc map).
- `src/hooks/useTelemetry.ts` — thin React hook wrapping `createWsClient`.
- `src/components/VehicleMap.tsx` — MapLibre dark map: vehicle marker (yaw-rotated), 200-point breadcrumb trail, home marker, auto-center + recenter.
- `src/app/page.tsx` — page shell: top status bar + map + sidebar (instruments/flight controls land in later tasks).
