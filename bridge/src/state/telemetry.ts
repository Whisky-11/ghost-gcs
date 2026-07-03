// Pure reducers over decode() output ({ msgName, data }, see mavlink/registry.ts).
// No I/O, no timers — nowMs is always injected by the caller. Unknown msgName
// returns the exact same state reference (reference-equality) so callers can
// cheaply skip re-renders / re-broadcasts on messages we don't track.

export interface TelemetryState {
  connected: boolean
  lastHeartbeatMs: number | null
  vehicleType: 'copter' | 'rover' | 'unknown'
  armed: boolean
  mode: string // resolved name, e.g. 'GUIDED'
  position: { lat: number; lng: number; altM: number; relAltM: number } | null
  attitude: { rollDeg: number; pitchDeg: number; yawDeg: number } | null
  speed: { groundMps: number; airMps: number; climbMps: number } | null
  battery: { voltageV: number; remainingPct: number } | null
  gps: { fixType: number; satellites: number; hdop: number } | null
  home: { lat: number; lng: number; altM: number } | null
  statusTexts: Array<{ severity: number; text: string; tsMs: number }> // ring, max 50
}

// MAV_MODE_FLAG_SAFETY_ARMED (mavlink common.xml bit 7 of base_mode).
const MAV_MODE_FLAG_SAFETY_ARMED = 128
const STATUS_TEXT_CAP = 50
const RAD_TO_DEG = 180 / Math.PI

// MAV_TYPE values (minimal.MavType) that map to each vehicleType.
const COPTER_MAV_TYPES = new Set([2 /* QUADROTOR */, 13, 14, 15 /* HEXA/OCTO/TRICOPTER */])
const ROVER_MAV_TYPES = new Set([10 /* GROUND_ROVER */, 11 /* SURFACE_BOAT */])

export const COPTER_MODES: Record<number, string> = {
  0: 'STABILIZE',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  9: 'LAND',
}

export const ROVER_MODES: Record<number, string> = {
  0: 'MANUAL',
  4: 'HOLD',
  10: 'AUTO',
  11: 'RTL',
  15: 'GUIDED',
}

export function modeName(vehicleType: TelemetryState['vehicleType'], customMode: number): string {
  const table = vehicleType === 'copter' ? COPTER_MODES : vehicleType === 'rover' ? ROVER_MODES : null
  return table?.[customMode] ?? `MODE(${customMode})`
}

function vehicleTypeFromMavType(mavType: number): TelemetryState['vehicleType'] {
  if (COPTER_MAV_TYPES.has(mavType)) return 'copter'
  if (ROVER_MAV_TYPES.has(mavType)) return 'rover'
  return 'unknown'
}

export function initialState(): TelemetryState {
  return {
    connected: false,
    lastHeartbeatMs: null,
    vehicleType: 'unknown',
    armed: false,
    mode: '',
    position: null,
    attitude: null,
    speed: null,
    battery: null,
    gps: null,
    home: null,
    statusTexts: [],
  }
}

export function reduce(
  state: TelemetryState,
  msgName: string,
  data: Record<string, unknown>,
  nowMs: number,
): TelemetryState {
  switch (msgName) {
    case 'HEARTBEAT': {
      const vehicleType = vehicleTypeFromMavType(data.type as number)
      const baseMode = data.baseMode as number
      return {
        ...state,
        armed: (baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0,
        vehicleType,
        mode: modeName(vehicleType, data.customMode as number),
        lastHeartbeatMs: nowMs,
      }
    }

    case 'GLOBAL_POSITION_INT': {
      return {
        ...state,
        position: {
          lat: (data.lat as number) / 1e7,
          lng: (data.lon as number) / 1e7,
          altM: (data.alt as number) / 1000,
          relAltM: (data.relativeAlt as number) / 1000,
        },
      }
    }

    case 'ATTITUDE': {
      return {
        ...state,
        attitude: {
          rollDeg: (data.roll as number) * RAD_TO_DEG,
          pitchDeg: (data.pitch as number) * RAD_TO_DEG,
          yawDeg: (data.yaw as number) * RAD_TO_DEG,
        },
      }
    }

    case 'VFR_HUD': {
      return {
        ...state,
        speed: {
          groundMps: data.groundspeed as number,
          airMps: data.airspeed as number,
          climbMps: data.climb as number,
        },
      }
    }

    case 'SYS_STATUS': {
      const voltageV = (data.voltageBattery as number) / 1000
      const batteryRemaining = data.batteryRemaining as number
      // -1 means "not sent by autopilot" — keep the prior remainingPct (voltage
      // still refreshes) if we have one, otherwise there's nothing to show yet.
      if (batteryRemaining === -1) {
        return {
          ...state,
          battery: state.battery ? { voltageV, remainingPct: state.battery.remainingPct } : null,
        }
      }
      return {
        ...state,
        battery: { voltageV, remainingPct: batteryRemaining },
      }
    }

    case 'GPS_RAW_INT': {
      return {
        ...state,
        gps: {
          fixType: data.fixType as number,
          satellites: data.satellitesVisible as number,
          hdop: (data.eph as number) / 100,
        },
      }
    }

    case 'HOME_POSITION': {
      // Real dialect field names are latitude/longitude/altitude (not lat/lon/
      // relativeAlt like GLOBAL_POSITION_INT) — same 1e7/1e3 scaling, different
      // spelling. Verified against the installed mavlink-mappings dist.
      return {
        ...state,
        home: {
          lat: (data.latitude as number) / 1e7,
          lng: (data.longitude as number) / 1e7,
          altM: (data.altitude as number) / 1000,
        },
      }
    }

    case 'STATUSTEXT': {
      const entry = { severity: data.severity as number, text: data.text as string, tsMs: nowMs }
      const statusTexts = [...state.statusTexts, entry]
      if (statusTexts.length > STATUS_TEXT_CAP) statusTexts.splice(0, statusTexts.length - STATUS_TEXT_CAP)
      return { ...state, statusTexts }
    }

    default:
      return state
  }
}
