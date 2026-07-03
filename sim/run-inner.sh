#!/bin/bash
VEHICLE=${1:-copter}
case "$VEHICLE" in
  copter) BIN=build/sitl/bin/arducopter; MODEL=quad ;;
  rover)  BIN=build/sitl/bin/ardurover;  MODEL=rover ;;
esac
exec $BIN --model $MODEL -w --home 29.3375,47.9744,10,0 --serial0 tcp:0.0.0.0:5760:wait
