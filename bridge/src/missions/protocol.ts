// MAVLink mission upload/download/clear protocol (P1 Task 3). Talks the
// standard mission-transfer message set — MISSION_COUNT(44) /
// MISSION_REQUEST_INT(51) / MISSION_ITEM_INT(73) / MISSION_ACK(47) /
// MISSION_REQUEST_LIST(43) / MISSION_CLEAR_ALL(45) — against a fake or real
// VehicleLink. Field names + msgids verified against the installed
// mavlink-mappings dist (see Task 3 report); classes come through
// node-mavlink's `common` re-export barrel, never `mavlink-mappings` direct,
// for class-identity safety (same rule as mavlink/registry.ts).
//
// AI never touches this module (spec safety invariant 1) — upload/download/
// clear are explicit human UI actions the app sequences over separate RPCs.
//
// ArduPilot reserved home slot (verified live against SITL, see Task 3
// report): wire seq=0 in a mission transfer is ALWAYS the vehicle's home
// position — ArduPilot ignores/overwrites whatever a GCS uploads there
// (command forced to NAV_WAYPOINT, x/y/z forced to the real home lat/lng/alt)
// and ordinary items pass through untouched from wire seq=1 onward. Because
// of this, `MissionItem.seq` (app-level, 0-based, per model.ts's contiguity
// rule — the first real command, e.g. TAKEOFF, is seq=0) is NOT the same
// number as the wire seq sent over MAVLink: this module transparently
// prepends a zero-filled placeholder at wire seq=0 on upload() (its content
// is irrelevant — ArduPilot discards it) and strips wire seq=0 back off +
// renumbers on download(), so callers never see or think about the home
// slot. A naive 1:1 seq mapping (tried first, see report) silently drops the
// first uploaded item's command/altitude into the home slot — this bit us
// live before the offset was added.
import type { EventEmitter } from 'node:events'
import { common, type MavLinkData } from 'node-mavlink'
import type { VehicleLink } from '../mavlink/link.js'
import type { MissionItem, MissionItemCommand } from './model.js'

export class MissionError extends Error {
  constructor(
    public code: 'NOT_CONNECTED' | 'UPLOAD_TIMEOUT' | 'MISSION_REJECTED' | 'DOWNLOAD_TIMEOUT',
    msg?: string,
  ) {
    super(msg ?? code)
    this.name = 'MissionError'
  }
}

export interface MissionUploadDeps {
  link: Pick<VehicleLink, 'send' | 'connected'> & EventEmitter
}

// MissionUploadDeps only exposes send/connected (same restriction as
// commands.ts's CommandDeps) — no live sysid/compid to plumb through, so
// this hardcodes the same documented SITL default (sysid=1, compid=1) that
// commands.ts's TARGET_SYSTEM/TARGET_COMPONENT use.
const TARGET_SYSTEM = 1
const TARGET_COMPONENT = 1

// 10s per-item timeout (brief): the timer resets on every request-received/
// item-sent step, not just once at the start of the transfer — a slow but
// progressing transfer of many items should not itself time out.
const ITEM_TIMEOUT_MS = 10_000

const COMMAND_IDS: Record<MissionItemCommand, common.MavCmd> = {
  WAYPOINT: common.MavCmd.NAV_WAYPOINT,
  TAKEOFF: common.MavCmd.NAV_TAKEOFF,
  RTL: common.MavCmd.NAV_RETURN_TO_LAUNCH,
  LAND: common.MavCmd.NAV_LAND,
}

const COMMAND_NAMES: Partial<Record<common.MavCmd, MissionItemCommand>> = Object.fromEntries(
  Object.entries(COMMAND_IDS).map(([name, id]) => [id, name as MissionItemCommand]),
)

type DecodedMessage = { msgName: string; data: Record<string, unknown> }

function assertConnected(deps: MissionUploadDeps): void {
  if (!deps.link.connected) throw new MissionError('NOT_CONNECTED')
}

/** Builds a MISSION_ITEM_INT for `item` at explicit wire `seq` (the caller
 * offsets app-level seq -> wire seq by +1 to skip the reserved home slot). */
function toMissionItemInt(item: MissionItem, wireSeq: number): common.MissionItemInt {
  const m = new common.MissionItemInt()
  m.targetSystem = TARGET_SYSTEM
  m.targetComponent = TARGET_COMPONENT
  m.seq = wireSeq
  m.frame = common.MavFrame.GLOBAL_RELATIVE_ALT_INT
  m.command = COMMAND_IDS[item.command]
  m.current = 0
  m.autocontinue = 1
  m.param1 = 0
  m.param2 = 0
  m.param3 = 0
  m.param4 = 0
  m.x = Math.round(item.lat * 1e7)
  m.y = Math.round(item.lng * 1e7)
  m.z = item.altM
  m.missionType = common.MavMissionType.MISSION
  return m
}

/** The wire seq=0 slot ArduPilot reserves for home. Content is irrelevant —
 * ArduPilot overwrites/ignores it on upload — but the transfer protocol
 * still requires a well-formed item to be sent for that seq. */
function makeHomePlaceholderItem(): common.MissionItemInt {
  const m = new common.MissionItemInt()
  m.targetSystem = TARGET_SYSTEM
  m.targetComponent = TARGET_COMPONENT
  m.seq = 0
  m.frame = common.MavFrame.GLOBAL_RELATIVE_ALT_INT
  m.command = common.MavCmd.NAV_WAYPOINT
  m.current = 0
  m.autocontinue = 1
  m.param1 = 0
  m.param2 = 0
  m.param3 = 0
  m.param4 = 0
  m.x = 0
  m.y = 0
  m.z = 0
  m.missionType = common.MavMissionType.MISSION
  return m
}

// Unknown/unmapped commands fall back to WAYPOINT rather than throwing —
// download() must never blow up on an item the app doesn't have a button for.
function fromMissionItemInt(data: Record<string, unknown>, appSeq: number): MissionItem {
  const command = COMMAND_NAMES[data.command as common.MavCmd] ?? 'WAYPOINT'
  return {
    seq: appSeq,
    command,
    lat: (data.x as number) / 1e7,
    lng: (data.y as number) / 1e7,
    altM: data.z as number,
  }
}

export function makeMissionProtocol(deps: MissionUploadDeps): {
  upload(items: MissionItem[]): Promise<void>
  download(): Promise<MissionItem[]>
  clear(): Promise<void>
} {
  /** Uploads `items` via MISSION_COUNT → (MISSION_REQUEST_INT → MISSION_ITEM_INT)*
   * → MISSION_ACK. Resolves once the vehicle's final MISSION_ACK reports
   * MAV_MISSION_ACCEPTED; rejects MISSION_REJECTED for any other MISSION_ACK
   * result, or UPLOAD_TIMEOUT if 10s pass with no progress. Listens for both
   * MISSION_REQUEST_INT and the legacy MISSION_REQUEST (some ArduPilot
   * builds/paths can still emit the float variant) — both carry the same
   * `seq` field, so they're handled identically.
   *
   * Wire seq is `items[i].seq + 1` — wire seq=0 is ArduPilot's reserved home
   * slot (see the module header comment); a placeholder is sent for it
   * transparently and the caller's `items` are never renumbered. */
  async function upload(items: MissionItem[]): Promise<void> {
    assertConnected(deps)
    const byAppSeq = new Map(items.map((it) => [it.seq, it]))
    const wireCount = items.length + 1

    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>

      const cleanup = (): void => {
        clearTimeout(timer)
        deps.link.removeListener('message', onMessage)
      }

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const resetTimer = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          finish(() =>
            reject(new MissionError('UPLOAD_TIMEOUT', `no progress on mission upload within ${ITEM_TIMEOUT_MS}ms`)),
          )
        }, ITEM_TIMEOUT_MS)
      }

      const sendItem = (wireSeq: number): void => {
        if (wireSeq === 0) {
          resetTimer()
          deps.link.send(makeHomePlaceholderItem() as unknown as MavLinkData).catch((err: unknown) => {
            finish(() => reject(err instanceof Error ? err : new Error(String(err))))
          })
          return
        }
        const item = byAppSeq.get(wireSeq - 1)
        if (!item) return // request for a seq we didn't send — ignore, let the timeout surface it
        resetTimer()
        deps.link.send(toMissionItemInt(item, wireSeq) as unknown as MavLinkData).catch((err: unknown) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        })
      }

      const onMessage = (msg: DecodedMessage): void => {
        if (settled) return
        if (msg.msgName === 'MISSION_REQUEST_INT' || msg.msgName === 'MISSION_REQUEST') {
          sendItem(msg.data.seq as number)
          return
        }
        if (msg.msgName === 'MISSION_ACK') {
          const result = msg.data.type as number
          if (result === common.MavMissionResult.ACCEPTED) {
            finish(() => resolve())
          } else {
            finish(() => reject(new MissionError('MISSION_REJECTED', `mission upload rejected: MAV_MISSION_RESULT=${result}`)))
          }
        }
      }

      deps.link.on('message', onMessage)
      resetTimer()

      const count = new common.MissionCount()
      count.targetSystem = TARGET_SYSTEM
      count.targetComponent = TARGET_COMPONENT
      count.count = wireCount
      count.missionType = common.MavMissionType.MISSION
      deps.link.send(count as unknown as MavLinkData).catch((err: unknown) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      })
    })
  }

  /** Downloads the current on-vehicle mission via MISSION_REQUEST_LIST →
   * MISSION_COUNT → (MISSION_REQUEST_INT → MISSION_ITEM_INT)* → MISSION_ACK
   * (closes the read transaction, per the MAVLink mission protocol). Wire
   * seq=0 (ArduPilot's reserved home slot — see module header) is fetched
   * (the protocol requires reading the full count) but dropped, and the
   * remaining items are renumbered back to app-level 0-based seq, mirroring
   * upload()'s offset so download() undoes exactly what upload() did.
   * Resolves with items sorted by (app-level) seq; a MISSION_COUNT of 0 or 1
   * (nothing but the home slot) resolves immediately with []. Rejects
   * DOWNLOAD_TIMEOUT if 10s pass with no progress. */
  async function download(): Promise<MissionItem[]> {
    assertConnected(deps)

    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      let expectedCount: number | null = null
      let nextWireSeq = 0
      const items: MissionItem[] = []

      const cleanup = (): void => {
        clearTimeout(timer)
        deps.link.removeListener('message', onMessage)
      }

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const resetTimer = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          finish(() =>
            reject(new MissionError('DOWNLOAD_TIMEOUT', `no progress on mission download within ${ITEM_TIMEOUT_MS}ms`)),
          )
        }, ITEM_TIMEOUT_MS)
      }

      const requestNext = (): void => {
        resetTimer()
        const req = new common.MissionRequestInt()
        req.targetSystem = TARGET_SYSTEM
        req.targetComponent = TARGET_COMPONENT
        req.seq = nextWireSeq
        req.missionType = common.MavMissionType.MISSION
        deps.link.send(req as unknown as MavLinkData).catch((err: unknown) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        })
      }

      const finishTransaction = (): void => {
        const ack = new common.MissionAck()
        ack.targetSystem = TARGET_SYSTEM
        ack.targetComponent = TARGET_COMPONENT
        ack.type = common.MavMissionResult.ACCEPTED
        ack.missionType = common.MavMissionType.MISSION
        // Best-effort close of the read transaction — a dropped final ACK
        // doesn't invalidate the items we already have, so no timeout gate.
        deps.link.send(ack as unknown as MavLinkData).catch(() => {})
        finish(() => resolve([...items].sort((a, b) => a.seq - b.seq)))
      }

      const onMessage = (msg: DecodedMessage): void => {
        if (settled) return
        if (msg.msgName === 'MISSION_COUNT') {
          expectedCount = msg.data.count as number
          if (expectedCount <= 1) {
            // 0 = nothing at all; 1 = only the reserved home slot, no real items.
            finish(() => resolve([]))
            return
          }
          requestNext()
          return
        }
        if (msg.msgName === 'MISSION_ITEM_INT') {
          const wireSeq = msg.data.seq as number
          if (wireSeq > 0) {
            items.push(fromMissionItemInt(msg.data, wireSeq - 1))
          } // wireSeq === 0 is the home slot — fetched (protocol requires it) but dropped
          nextWireSeq += 1
          if (expectedCount !== null && nextWireSeq >= expectedCount) {
            finishTransaction()
            return
          }
          requestNext()
        }
      }

      deps.link.on('message', onMessage)
      resetTimer()

      const reqList = new common.MissionRequestList()
      reqList.targetSystem = TARGET_SYSTEM
      reqList.targetComponent = TARGET_COMPONENT
      reqList.missionType = common.MavMissionType.MISSION
      deps.link.send(reqList as unknown as MavLinkData).catch((err: unknown) => {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      })
    })
  }

  /** Clears the on-vehicle mission via MISSION_CLEAR_ALL, waiting for the
   * MISSION_ACK it triggers. Reuses UPLOAD_TIMEOUT on timeout and
   * MISSION_REJECTED on a non-accepted result — MissionError's code union
   * (per the brief) has no dedicated CLEAR_* variant, and a clear is a write
   * op like upload. */
  async function clear(): Promise<void> {
    assertConnected(deps)

    return new Promise((resolve, reject) => {
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timer)
        deps.link.removeListener('message', onMessage)
      }

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new MissionError('UPLOAD_TIMEOUT', `no MISSION_ACK for MISSION_CLEAR_ALL within ${ITEM_TIMEOUT_MS}ms`))
      }, ITEM_TIMEOUT_MS)

      const onMessage = (msg: DecodedMessage): void => {
        if (settled) return
        if (msg.msgName !== 'MISSION_ACK') return
        settled = true
        cleanup()
        const result = msg.data.type as number
        if (result === common.MavMissionResult.ACCEPTED) {
          resolve()
        } else {
          reject(new MissionError('MISSION_REJECTED', `mission clear rejected: MAV_MISSION_RESULT=${result}`))
        }
      }

      deps.link.on('message', onMessage)

      const clearAll = new common.MissionClearAll()
      clearAll.targetSystem = TARGET_SYSTEM
      clearAll.targetComponent = TARGET_COMPONENT
      clearAll.missionType = common.MavMissionType.MISSION
      deps.link.send(clearAll as unknown as MavLinkData).catch((err: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    })
  }

  return { upload, download, clear }
}
