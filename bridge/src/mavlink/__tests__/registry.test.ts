import { describe, it, expect } from 'vitest'
import { MavLinkPacket, MavLinkProtocolV2 } from 'node-mavlink'
import { minimal } from 'node-mavlink'
import { REGISTRY, decode } from '../registry.js'

// Build a real MavLink packet by round-tripping a minimal.Heartbeat through the
// library's own serialize/header/payload/crc — no hand-rolled bytes.
function buildHeartbeatPacket(): MavLinkPacket {
  const hb = new minimal.Heartbeat()
  hb.type = minimal.MavType.GCS
  hb.autopilot = minimal.MavAutopilot.INVALID
  const protocol = new MavLinkProtocolV2(254, 1)
  const buffer = protocol.serialize(hb, 0)
  const header = protocol.header(buffer)
  const payload = protocol.payload(buffer)
  const crc = protocol.crc(buffer)
  return new MavLinkPacket(buffer, header, payload, crc, protocol)
}

describe('REGISTRY', () => {
  it('contains HEARTBEAT (0), SYS_STATUS (1)... GLOBAL_POSITION_INT (33), ATTITUDE (30)', () => {
    expect(REGISTRY[0]?.MSG_NAME).toBe('HEARTBEAT')
    expect(REGISTRY[33]?.MSG_NAME).toBe('GLOBAL_POSITION_INT')
    expect(REGISTRY[30]?.MSG_NAME).toBe('ATTITUDE')
  })
})

describe('decode', () => {
  it('decodes a HEARTBEAT packet built from fixture bytes', () => {
    const pkt = buildHeartbeatPacket()
    const result = decode(pkt)
    expect(result).not.toBeNull()
    expect(result?.msgName).toBe('HEARTBEAT')
    expect(result?.data.type).toBe(minimal.MavType.GCS)
    expect(result?.data.autopilot).toBe(minimal.MavAutopilot.INVALID)
  })

  it('returns null for an unknown msgid', () => {
    const pkt = buildHeartbeatPacket()
    // Simulate an unregistered message id by rerouting the same, otherwise-valid
    // packet — decode() must consult REGISTRY before attempting to decode payload.
    pkt.header.msgid = 999999
    expect(decode(pkt)).toBeNull()
  })
})
