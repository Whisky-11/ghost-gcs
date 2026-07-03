#!/bin/bash
# Build (once) and run the ArduPilot SITL container.
# Usage: sim/run.sh [copter|rover]
set -euo pipefail
cd "$(dirname "$0")"

VEHICLE=${1:-copter}

# Renamed image: falcon-sitl -> ghost-sitl (project renamed Falcon -> GHOST,
# 2026-07-03). Prefer the new tag; fall back to a pre-existing falcon-sitl
# image (from before the rename) rather than rebuilding from scratch. Run
# `docker tag falcon-sitl ghost-sitl` once to adopt the new name and drop
# this fallback.
IMAGE=ghost-sitl
if [ -z "$(docker images -q ghost-sitl 2>/dev/null)" ] && [ -n "$(docker images -q falcon-sitl 2>/dev/null)" ]; then
  echo "DEPRECATED: found old 'falcon-sitl' image, no 'ghost-sitl' image yet — using falcon-sitl for this run. Run 'docker tag falcon-sitl ghost-sitl' to adopt the new name (see sim/README.md)."
  IMAGE=falcon-sitl
elif [ -z "$(docker images -q ghost-sitl 2>/dev/null)" ]; then
  echo "Building ghost-sitl image (first build ~15+ min, builds ArduPilot from source)..."
  docker build -t ghost-sitl .
fi

docker run --rm -p 5760:5760 --name "$IMAGE" "$IMAGE" "$VEHICLE"
