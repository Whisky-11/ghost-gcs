// Mission model + validation (P1 Task 1). Pure logic — no MAVLink, no I/O.
// Mirrors the altitude bounds enforced client-side by app/src/lib/types.ts
// (TAKEOFF_ALT_MIN/MAX = 2/120) as a local const per the plan's constraint
// that bridge and app stay independently deployable (no cross-import).
export const MISSION_ALT_MIN_M = 2
export const MISSION_ALT_MAX_M = 120
// Hard take-cap on external-input arrays (scaling-from-day-1 rule) — a
// mission this large is not a real flight plan and would otherwise let an
// unbounded payload (malicious or buggy AI draft/import) reach validation
// and, eventually, the vehicle. Enforced in both layers: schema.ts's
// missionSchema.items (structural, wire-level) and here (semantic, same
// defense-in-depth pairing as the altM bound).
export const MISSION_MAX_ITEMS = 1000

export type MissionItemCommand = 'WAYPOINT' | 'TAKEOFF' | 'RTL' | 'LAND'

export interface MissionItem {
  seq: number
  command: MissionItemCommand
  lat: number
  lng: number
  altM: number
}

export interface Mission {
  items: MissionItem[]
}

const TERMINAL_COMMANDS: ReadonlySet<MissionItemCommand> = new Set(['RTL', 'LAND'])
const ALT_BOUNDED_COMMANDS: ReadonlySet<MissionItemCommand> = new Set(['TAKEOFF', 'WAYPOINT'])

/** Validates structural + safety rules. Returns the first violation found
 * (order: empty → too many items → seq contiguity → alt bounds →
 * terminal-item placement) — callers surface one clear error rather than a
 * list. */
export function validateMission(m: Mission): { ok: true } | { ok: false; error: string } {
  const { items } = m

  if (items.length === 0) {
    return { ok: false, error: 'mission must have at least one item' }
  }

  if (items.length > MISSION_MAX_ITEMS) {
    return { ok: false, error: `mission has ${items.length} items, exceeds max of ${MISSION_MAX_ITEMS}` }
  }

  const seqError = validateSeqContiguity(items)
  if (seqError) return { ok: false, error: seqError }

  for (const it of items) {
    if (ALT_BOUNDED_COMMANDS.has(it.command)) {
      if (it.altM < MISSION_ALT_MIN_M || it.altM > MISSION_ALT_MAX_M) {
        return {
          ok: false,
          error: `item seq=${it.seq} (${it.command}) altM=${it.altM} out of bounds [${MISSION_ALT_MIN_M}, ${MISSION_ALT_MAX_M}]`,
        }
      }
    }
  }

  const lastIndex = items.length - 1
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!
    if (TERMINAL_COMMANDS.has(it.command) && i !== lastIndex) {
      return {
        ok: false,
        error: `item seq=${it.seq} (${it.command}) must be the last item in the mission`,
      }
    }
  }

  return { ok: true }
}

/** Non-fatal advisories: a copter mission SHOULD start with TAKEOFF and
 * SHOULD end with a terminal RTL/LAND item, but neither is a hard error —
 * some vehicles/operators intentionally omit them. Empty missions produce
 * no warnings (validateMission already owns that as a hard error). */
export function missionWarnings(m: Mission): string[] {
  const { items } = m
  if (items.length === 0) return []

  const warnings: string[] = []

  if (items[0]!.command !== 'TAKEOFF') {
    warnings.push('mission does not start with a TAKEOFF item')
  }

  if (!TERMINAL_COMMANDS.has(items[items.length - 1]!.command)) {
    warnings.push('mission has no terminal RTL/LAND item')
  }

  return warnings
}

/** Seq values must form the contiguous set {0, ..., n-1} — items may be
 * given out of array order, but every index in range must be present
 * exactly once. */
function validateSeqContiguity(items: MissionItem[]): string | null {
  const seen = new Set<number>()
  for (const it of items) {
    if (seen.has(it.seq)) {
      return `duplicate seq ${it.seq}`
    }
    seen.add(it.seq)
  }

  for (let i = 0; i < items.length; i++) {
    if (!seen.has(i)) {
      return `seq must be contiguous 0..${items.length - 1}; missing ${i}`
    }
  }

  return null
}
