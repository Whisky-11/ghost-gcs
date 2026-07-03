import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { common, type MavLinkData } from 'node-mavlink'
import { makeMissionProtocol, MissionError } from '../protocol.js'
import type { MissionItem } from '../model.js'

/** Fake VehicleLink: records every sent mission message and lets tests
 * script the request/ack handshake by hand — no real socket, no real
 * MAVLink wire bytes needed since protocol.ts only touches
 * send()/connected/'message', mirroring commands.test.ts's FakeLink. */
class FakeLink extends EventEmitter {
  connected = true
  sent: MavLinkData[] = []
  async send(msg: MavLinkData): Promise<void> {
    this.sent.push(msg)
  }
  emitMessage(msgName: string, data: Record<string, unknown>): void {
    this.emit('message', { msgName, data })
  }
}

const ITEMS: MissionItem[] = [
  { seq: 0, command: 'TAKEOFF', lat: 47.397, lng: 8.545, altM: 20 },
  { seq: 1, command: 'WAYPOINT', lat: 47.398, lng: 8.546, altM: 20 },
  { seq: 2, command: 'RTL', lat: 47.397, lng: 8.545, altM: 20 },
]

function lastSent(link: FakeLink): MavLinkData {
  return link.sent[link.sent.length - 1]!
}

describe('makeMissionProtocol', () => {
  let link: FakeLink

  beforeEach(() => {
    vi.useFakeTimers()
    link = new FakeLink()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('upload', () => {
    it('happy path: MISSION_COUNT includes +1 for the reserved home slot, answers wire seq=0 with a placeholder and app items at wireSeq=appSeq+1, resolves on accepted MISSION_ACK', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)

      expect(link.sent).toHaveLength(1)
      const count = lastSent(link) as common.MissionCount
      expect(count.count).toBe(4) // 3 app items + 1 reserved home slot
      expect(count.missionType).toBe(common.MavMissionType.MISSION)

      // Wire seq=0: ArduPilot's reserved home slot — placeholder content, not app item 0.
      link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
      let item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(0)
      expect(item.command).toBe(common.MavCmd.NAV_WAYPOINT)
      expect(item.x).toBe(0)
      expect(item.y).toBe(0)

      // Wire seq=1 -> app item seq=0 (TAKEOFF).
      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 })
      item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(1)
      expect(item.command).toBe(common.MavCmd.NAV_TAKEOFF)
      expect(item.frame).toBe(common.MavFrame.GLOBAL_RELATIVE_ALT_INT)
      expect(item.x).toBe(473970000)
      expect(item.y).toBe(85450000)
      expect(item.z).toBe(20)

      // Wire seq=2 -> app item seq=1 (WAYPOINT).
      link.emitMessage('MISSION_REQUEST_INT', { seq: 2 })
      item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(2)
      expect(item.command).toBe(common.MavCmd.NAV_WAYPOINT)

      // Wire seq=3 -> app item seq=2 (RTL).
      link.emitMessage('MISSION_REQUEST_INT', { seq: 3 })
      item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(3)
      expect(item.command).toBe(common.MavCmd.NAV_RETURN_TO_LAUNCH)

      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
      await expect(promise).resolves.toBeUndefined()
    })

    it('answers legacy MISSION_REQUEST the same as MISSION_REQUEST_INT', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)
      link.emitMessage('MISSION_REQUEST', { seq: 0 })
      expect((lastSent(link) as common.MissionItemInt).seq).toBe(0)
      link.emitMessage('MISSION_REQUEST', { seq: 1 })
      link.emitMessage('MISSION_REQUEST', { seq: 2 })
      link.emitMessage('MISSION_REQUEST', { seq: 3 })
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with UPLOAD_TIMEOUT when no MISSION_REQUEST_INT arrives within 10s', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)
      const assertion = expect(promise).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    })

    it('rejects with UPLOAD_TIMEOUT when progress stalls mid-transfer (timer resets per item)', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)
      link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
      await vi.advanceTimersByTimeAsync(9_000) // progress happened, not yet timed out
      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 }) // resets the timer again
      await vi.advanceTimersByTimeAsync(9_000) // still under 10s since the last reset -> still pending
      const assertion = expect(promise).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(1_000)
      await assertion
    })

    it('rejects with MISSION_REJECTED when the final MISSION_ACK reports a non-accepted result', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)
      link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 2 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 3 })
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.INVALID })
      await expect(promise).rejects.toMatchObject({ code: 'MISSION_REJECTED' })
    })

    it('throws NOT_CONNECTED and sends nothing when link is disconnected', async () => {
      link.connected = false
      const protocol = makeMissionProtocol({ link })
      await expect(protocol.upload(ITEMS)).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })

    it('throws MissionError instances (instanceof)', async () => {
      link.connected = false
      const protocol = makeMissionProtocol({ link })
      await expect(protocol.upload(ITEMS)).rejects.toBeInstanceOf(MissionError)
    })

    it('handles out-of-order MISSION_REQUEST_INT (wire seq=2 before seq=1) by resending the correct app item for each requested seq', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)

      // Vehicle asks for wire seq=2 (app item seq=1, WAYPOINT) before seq=1 (app item seq=0, TAKEOFF).
      link.emitMessage('MISSION_REQUEST_INT', { seq: 2 })
      let item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(2)
      expect(item.command).toBe(common.MavCmd.NAV_WAYPOINT)

      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 })
      item = lastSent(link) as common.MissionItemInt
      expect(item.seq).toBe(1)
      expect(item.command).toBe(common.MavCmd.NAV_TAKEOFF)

      link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 3 })
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
      await expect(promise).resolves.toBeUndefined()
    })

    it('re-requesting the same wire seq resends the item without prematurely finishing the transfer', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.upload(ITEMS)

      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 1 }) // vehicle re-asks for the same item (e.g. dropped packet)
      const takeoffSends = link.sent.filter(
        (m) => m instanceof common.MissionItemInt && m.seq === 1,
      )
      expect(takeoffSends).toHaveLength(2)
      expect(takeoffSends[0]).toEqual(takeoffSends[1])

      // Transfer must not have resolved/rejected yet — only 2 of 4 wire items sent, no ACK yet.
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )
      await Promise.resolve()
      expect(settled).toBe(false)

      link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 2 })
      link.emitMessage('MISSION_REQUEST_INT', { seq: 3 })
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
      await expect(promise).resolves.toBeUndefined()
    })
  })

  it('upload -> download round-trip: piping upload\'s captured wire items into download\'s handler reproduces the original app items exactly (proves the +/-1 home-slot offset is exactly inverse)', async () => {
    const uploadProtocol = makeMissionProtocol({ link })
    const uploadPromise = uploadProtocol.upload(ITEMS)

    // Drive the upload handshake to completion, capturing every MISSION_ITEM_INT sent (wire seq 0..3).
    link.emitMessage('MISSION_REQUEST_INT', { seq: 0 })
    link.emitMessage('MISSION_REQUEST_INT', { seq: 1 })
    link.emitMessage('MISSION_REQUEST_INT', { seq: 2 })
    link.emitMessage('MISSION_REQUEST_INT', { seq: 3 })
    link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
    await uploadPromise

    const wireItems = link.sent.filter((m): m is common.MissionItemInt => m instanceof common.MissionItemInt)
    expect(wireItems).toHaveLength(4)

    // Feed those exact wire items (as the vehicle would echo them back) through a fresh download().
    const downloadLink = new FakeLink()
    const downloadProtocol = makeMissionProtocol({ link: downloadLink })
    const downloadPromise = downloadProtocol.download()

    downloadLink.emitMessage('MISSION_COUNT', { count: wireItems.length })
    for (const wireItem of wireItems) {
      downloadLink.emitMessage('MISSION_ITEM_INT', {
        seq: wireItem.seq,
        command: wireItem.command,
        x: wireItem.x,
        y: wireItem.y,
        z: wireItem.z,
      })
    }

    const downloaded = await downloadPromise
    expect(downloaded).toEqual(ITEMS)
  })

  describe('download', () => {
    it('round-trips: MISSION_REQUEST_LIST -> MISSION_COUNT (includes reserved home slot) -> request/item loop -> home slot dropped + items renumbered to app-level seq, sends closing MISSION_ACK', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()

      expect(link.sent).toHaveLength(1)
      expect(link.sent[0]).toBeInstanceOf(common.MissionRequestList)

      // Vehicle reports 4 wire items: reserved home slot (0) + 3 real items (1-3).
      link.emitMessage('MISSION_COUNT', { count: 4 })
      let req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(0)

      // Wire seq=0: ArduPilot's reserved home slot — content is whatever the
      // vehicle's real home is, e.g. overwritten command/alt. Must be dropped.
      link.emitMessage('MISSION_ITEM_INT', {
        seq: 0,
        command: common.MavCmd.NAV_WAYPOINT,
        x: 293375000,
        y: 479743999,
        z: 10.1,
      })
      req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(1)

      link.emitMessage('MISSION_ITEM_INT', {
        seq: 1,
        command: common.MavCmd.NAV_TAKEOFF,
        x: 473970000,
        y: 85450000,
        z: 20,
      })
      req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(2)

      link.emitMessage('MISSION_ITEM_INT', {
        seq: 2,
        command: common.MavCmd.NAV_WAYPOINT,
        x: 473980000,
        y: 85460000,
        z: 20,
      })
      req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(3)

      link.emitMessage('MISSION_ITEM_INT', {
        seq: 3,
        command: common.MavCmd.NAV_RETURN_TO_LAUNCH,
        x: 473970000,
        y: 85450000,
        z: 20,
      })

      const items = await promise
      expect(items).toEqual([
        { seq: 0, command: 'TAKEOFF', lat: 47.397, lng: 8.545, altM: 20 },
        { seq: 1, command: 'WAYPOINT', lat: 47.398, lng: 8.546, altM: 20 },
        { seq: 2, command: 'RTL', lat: 47.397, lng: 8.545, altM: 20 },
      ])
      // Closing MISSION_ACK was sent after the last item.
      expect(link.sent[link.sent.length - 1]).toBeInstanceOf(common.MissionAck)
    })

    it('ignores a MISSION_ITEM_INT whose wireSeq does not match the expected next wire seq (stale/dup), then accepts the correct item', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()

      link.emitMessage('MISSION_COUNT', { count: 2 })
      let req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(0)

      // Stale/dup: vehicle re-sends wireSeq=0 after we've already moved on would be a no-op here since
      // nothing was accepted yet; simulate a genuinely stale item — wireSeq=1 arriving before wireSeq=0
      // was ever satisfied (e.g. a duplicated/out-of-order packet from a prior request).
      link.emitMessage('MISSION_ITEM_INT', { seq: 1, command: common.MavCmd.NAV_WAYPOINT, x: 1, y: 1, z: 1 })
      // Ignored: still expecting wireSeq=0, no new request sent (last sent is still the seq=0 request).
      expect(lastSent(link)).toBe(req)

      link.emitMessage('MISSION_ITEM_INT', { seq: 0, command: common.MavCmd.NAV_WAYPOINT, x: 0, y: 0, z: 0 })
      req = lastSent(link) as common.MissionRequestInt
      expect(req.seq).toBe(1)

      link.emitMessage('MISSION_ITEM_INT', {
        seq: 1,
        command: common.MavCmd.NAV_TAKEOFF,
        x: 473970000,
        y: 85450000,
        z: 20,
      })

      const items = await promise
      expect(items).toEqual([{ seq: 0, command: 'TAKEOFF', lat: 47.397, lng: 8.545, altM: 20 }])
    })

    it('resolves [] immediately on MISSION_COUNT count=0', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()
      link.emitMessage('MISSION_COUNT', { count: 0 })
      await expect(promise).resolves.toEqual([])
    })

    it('resolves [] immediately on MISSION_COUNT count=1 (only the reserved home slot, no real items)', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()
      link.emitMessage('MISSION_COUNT', { count: 1 })
      await expect(promise).resolves.toEqual([])
    })

    it('falls back to WAYPOINT for an unmapped command id', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()
      link.emitMessage('MISSION_COUNT', { count: 2 })
      link.emitMessage('MISSION_ITEM_INT', { seq: 0, command: common.MavCmd.NAV_WAYPOINT, x: 0, y: 0, z: 0 })
      link.emitMessage('MISSION_ITEM_INT', { seq: 1, command: 9999, x: 1, y: 1, z: 1 })
      const items = await promise
      expect(items[0]!.command).toBe('WAYPOINT')
    })

    it('rejects with DOWNLOAD_TIMEOUT when no MISSION_COUNT arrives within 10s', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.download()
      const assertion = expect(promise).rejects.toMatchObject({ code: 'DOWNLOAD_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    })

    it('throws NOT_CONNECTED and sends nothing when link is disconnected', async () => {
      link.connected = false
      const protocol = makeMissionProtocol({ link })
      await expect(protocol.download()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })

  describe('clear', () => {
    it('sends MISSION_CLEAR_ALL and resolves on accepted MISSION_ACK', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.clear()
      expect(link.sent[0]).toBeInstanceOf(common.MissionClearAll)
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ACCEPTED })
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with MISSION_REJECTED on a non-accepted MISSION_ACK', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.clear()
      link.emitMessage('MISSION_ACK', { type: common.MavMissionResult.ERROR })
      await expect(promise).rejects.toMatchObject({ code: 'MISSION_REJECTED' })
    })

    it('rejects with UPLOAD_TIMEOUT when no MISSION_ACK arrives within 10s', async () => {
      const protocol = makeMissionProtocol({ link })
      const promise = protocol.clear()
      const assertion = expect(promise).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(10_000)
      await assertion
    })

    it('throws NOT_CONNECTED and sends nothing when link is disconnected', async () => {
      link.connected = false
      const protocol = makeMissionProtocol({ link })
      await expect(protocol.clear()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })
})
