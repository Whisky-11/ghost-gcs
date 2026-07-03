# ArduPilot SITL container

Builds ArduPilot's SITL binaries (`arducopter`, `ardurover`) from source, natively for
arm64 (Apple Silicon, no Rosetta needed on Docker Desktop/OrbStack). MAVLink is exposed
on TCP `5760` — the port pinned in the plan spec (`CONFIG.sitlTcp.port`).

## Build time

**First build takes ~15-20+ minutes** (git clone of the ardupilot tree + submodules,
apt packages, then `./waf configure && ./waf copter rover` compiling both vehicle
firmwares from source). Subsequent runs reuse the cached image — only rebuilds if the
Dockerfile changes.

## Usage

```bash
sim/run.sh copter   # arducopter, model=quad
sim/run.sh rover     # ardurover, model=rover
```

`run.sh` builds the `falcon-sitl` image once (if not already built) then runs it:

```bash
docker build -t falcon-sitl sim/
docker run --rm -p 5760:5760 --name falcon-sitl falcon-sitl copter   # or rover
```

Home location is pinned to Kuwait (`29.3375,47.9744,10,0`). The container's
`ENTRYPOINT` (`run-inner.sh`) picks the binary from `$1` (defaults to `copter`) and
starts SITL with `--serial0 tcp:0.0.0.0:5760:wait` — SITL blocks waiting for a TCP
client to connect on 5760 before it starts running the flight loop, then boots in a
few seconds once something connects (e.g. the probe script below, or a GCS).

**SITL serial flag note:** the plan's default flag is
`--serial0 tcp:0.0.0.0:5760:wait`. If the installed ArduPilot version rejects the
`0.0.0.0` host form, the documented fallback is `--serial0 tcp:5760:wait` (binds all
interfaces on current master). Whichever form actually worked against the built image
is recorded in `.superpowers/sdd/task-2-report.md`.

## Verifying MAVLink flows

```bash
sim/run.sh copter &                                    # boot the container
pnpm --filter bridge exec tsx scripts/probe-sitl.ts     # connect + print HEARTBEATs
```

Expect `tcp connected` immediately, then decoded `HEARTBEAT` lines within ~10s of the
probe connecting (the `:wait` flag means SITL only starts ticking once a client is
attached).

## Native macOS build fallback

If running ArduPilot SITL in Docker becomes a blocker (e.g. Docker perf/networking
issues), ArduPilot SITL also builds and runs directly on macOS. This was NOT needed for
Task 2 (Docker/OrbStack build arm64-native and worked), but is documented here as the
spec's noted risk-mitigation path:

```bash
git clone --recurse-submodules https://github.com/ArduPilot/ardupilot.git
cd ardupilot
./waf configure --board sitl
./waf copter
```

Then run the resulting `build/sitl/bin/arducopter` binary directly with the same
`--model`, `--home`, and `--serial0` flags used in `run-inner.sh`.
