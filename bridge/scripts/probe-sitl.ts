// Minimal raw connection proving MAVLink flows before any abstraction.
// Connects to a running SITL container (sim/run.sh copter|rover) over TCP
// and prints decoded HEARTBEAT messages. Used again by Task 3's spike.
import { connect } from 'node:net'
import { MavLinkPacketSplitter, MavLinkPacketParser } from 'node-mavlink'
import { minimal } from 'mavlink-mappings'

const socket = connect({ host: '127.0.0.1', port: 5760 }, () => console.log('tcp connected'))
const reader = socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser())

reader.on('data', (pkt) => {
  if (pkt.header.msgid === minimal.Heartbeat.MSG_ID) {
    const hb = pkt.protocol.data(pkt.payload, minimal.Heartbeat)
    console.log('HEARTBEAT', { type: hb.type, autopilot: hb.autopilot, baseMode: hb.baseMode })
  }
})

socket.on('error', (err) => {
  console.error('tcp error', err)
  process.exit(1)
})
