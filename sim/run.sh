#!/bin/bash
# Build (once) and run the ArduPilot SITL container.
# Usage: sim/run.sh [copter|rover]
set -euo pipefail
cd "$(dirname "$0")"

VEHICLE=${1:-copter}

if [ -z "$(docker images -q falcon-sitl 2>/dev/null)" ]; then
  echo "Building falcon-sitl image (first build ~15+ min, builds ArduPilot from source)..."
  docker build -t falcon-sitl .
fi

docker run --rm -p 5760:5760 --name falcon-sitl falcon-sitl "$VEHICLE"
