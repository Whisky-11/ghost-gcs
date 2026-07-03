// All dialect classes are imported through node-mavlink's re-export barrel
// (`node-mavlink` does `export * from 'mavlink-mappings'`), not directly from
// `mavlink-mappings`. This guarantees the classes used here are the exact same
// class identity node-mavlink uses internally for `pkt.protocol.data(...)`
// (instanceof/class-identity safety — see Task 3 Step 0 in the task brief).
import type { MavLinkData, MavLinkDataConstructor, MavLinkPacket } from 'node-mavlink'
import { minimal, common, ardupilotmega } from 'node-mavlink'

export type MessageClass = MavLinkDataConstructor<MavLinkData>

export const REGISTRY: Record<number, MessageClass> = {
  ...minimal.REGISTRY,
  ...common.REGISTRY,
  ...ardupilotmega.REGISTRY,
}

export function decode(pkt: MavLinkPacket): { msgName: string; data: Record<string, unknown> } | null {
  const clazz = REGISTRY[pkt.header.msgid]
  if (!clazz) return null
  const decoded = pkt.protocol.data(pkt.payload, clazz)
  return { msgName: clazz.MSG_NAME, data: { ...(decoded as unknown as Record<string, unknown>) } }
}
