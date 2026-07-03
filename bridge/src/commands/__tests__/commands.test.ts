import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { common, type MavLinkData } from 'node-mavlink'
import { makeCommands, CommandError } from '../commands.js'
import { initialState, type TelemetryState } from '../../state/telemetry.js'

/** Fake VehicleLink: records every sent CommandLong and lets tests script
 * COMMAND_ACK 'message' events by hand — no real socket, no real MAVLink
 * wire bytes needed since commands.ts only touches send()/connected/'message'. */
class FakeLink extends EventEmitter {
  connected = true
  sent: common.CommandLong[] = []
  async send(msg: MavLinkData): Promise<void> {
    this.sent.push(msg as common.CommandLong)
  }
  ack(command: number, result: number): void {
    this.emit('message', { msgName: 'COMMAND_ACK', data: { command, result } })
  }
}

function makeDeps(link: FakeLink, state: Partial<TelemetryState>) {
  const fullState: TelemetryState = { ...initialState(), ...state }
  return { link, getState: () => fullState }
}

describe('commands', () => {
  let link: FakeLink

  beforeEach(() => {
    vi.useFakeTimers()
    link = new FakeLink()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('arm', () => {
    it('sends COMPONENT_ARM_DISARM param1=1 and resolves on ACK result=0 (accepted)', async () => {
      const commands = makeCommands(makeDeps(link, { armed: false }))
      const promise = commands.arm()
      expect(link.sent).toHaveLength(1)
      expect(link.sent[0]!.command).toBe(common.MavCmd.COMPONENT_ARM_DISARM)
      expect(link.sent[0]!._param1).toBe(1)
      link.ack(common.MavCmd.COMPONENT_ARM_DISARM, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with ALREADY_ARMED without sending when already armed', async () => {
      const commands = makeCommands(makeDeps(link, { armed: true }))
      await expect(commands.arm()).rejects.toMatchObject({ code: 'ALREADY_ARMED' })
      expect(link.sent).toHaveLength(0)
    })

    it('rejects with ACK_FAILED when ACK result=4 (MAV_RESULT_FAILED)', async () => {
      const commands = makeCommands(makeDeps(link, { armed: false }))
      const promise = commands.arm()
      link.ack(common.MavCmd.COMPONENT_ARM_DISARM, common.MavResult.FAILED)
      await expect(promise).rejects.toMatchObject({ code: 'ACK_FAILED' })
    })

    it('rejects with ACK_TIMEOUT when no ACK arrives within 5s', async () => {
      const commands = makeCommands(makeDeps(link, { armed: false }))
      const promise = commands.arm()
      const assertion = expect(promise).rejects.toMatchObject({ code: 'ACK_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(5000)
      await assertion
    })

    it('throws NOT_CONNECTED and sends nothing when link is disconnected', async () => {
      link.connected = false
      const commands = makeCommands(makeDeps(link, { armed: false }))
      await expect(commands.arm()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })

  describe('disarm', () => {
    it('sends COMPONENT_ARM_DISARM param1=0 and resolves on ACK result=0', async () => {
      const commands = makeCommands(makeDeps(link, { armed: true }))
      const promise = commands.disarm()
      expect(link.sent[0]!.command).toBe(common.MavCmd.COMPONENT_ARM_DISARM)
      expect(link.sent[0]!._param1).toBe(0)
      link.ack(common.MavCmd.COMPONENT_ARM_DISARM, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with NOT_ARMED without sending when not armed', async () => {
      const commands = makeCommands(makeDeps(link, { armed: false }))
      await expect(commands.disarm()).rejects.toMatchObject({ code: 'NOT_ARMED' })
      expect(link.sent).toHaveLength(0)
    })

    it('throws NOT_CONNECTED when link is disconnected', async () => {
      link.connected = false
      const commands = makeCommands(makeDeps(link, { armed: true }))
      await expect(commands.disarm()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })

  describe('setMode', () => {
    it('maps a copter mode name to its customMode and resolves on ACK', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter' }))
      const promise = commands.setMode('GUIDED')
      expect(link.sent[0]!.command).toBe(common.MavCmd.DO_SET_MODE)
      expect(link.sent[0]!._param1).toBe(1)
      expect(link.sent[0]!._param2).toBe(4) // COPTER_MODES[4] === 'GUIDED'
      link.ack(common.MavCmd.DO_SET_MODE, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('maps a rover mode name to its customMode', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'rover' }))
      const promise = commands.setMode('GUIDED')
      expect(link.sent[0]!._param2).toBe(15) // ROVER_MODES[15] === 'GUIDED'
      link.ack(common.MavCmd.DO_SET_MODE, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with MODE_UNKNOWN for a name not in the vehicle-type table, without sending', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter' }))
      await expect(commands.setMode('NOT_A_MODE')).rejects.toMatchObject({ code: 'MODE_UNKNOWN' })
      expect(link.sent).toHaveLength(0)
    })

    it('throws NOT_CONNECTED when link is disconnected', async () => {
      link.connected = false
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter' }))
      await expect(commands.setMode('GUIDED')).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })

  describe('takeoff', () => {
    it('sends NAV_TAKEOFF param7=altM and resolves on ACK when copter+armed+GUIDED', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter', armed: true, mode: 'GUIDED' }))
      const promise = commands.takeoff(20)
      expect(link.sent[0]!.command).toBe(common.MavCmd.NAV_TAKEOFF)
      expect(link.sent[0]!._param7).toBe(20)
      link.ack(common.MavCmd.NAV_TAKEOFF, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with BAD_MODE for a non-copter vehicle, without sending', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'rover', armed: true, mode: 'GUIDED' }))
      await expect(commands.takeoff(20)).rejects.toMatchObject({ code: 'BAD_MODE' })
      expect(link.sent).toHaveLength(0)
    })

    it('rejects with BAD_MODE when not armed, without sending', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter', armed: false, mode: 'GUIDED' }))
      await expect(commands.takeoff(20)).rejects.toMatchObject({ code: 'BAD_MODE' })
      expect(link.sent).toHaveLength(0)
    })

    it('rejects with BAD_MODE when mode is not GUIDED, without sending', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter', armed: true, mode: 'LOITER' }))
      await expect(commands.takeoff(20)).rejects.toMatchObject({ code: 'BAD_MODE' })
      expect(link.sent).toHaveLength(0)
    })

    it('throws NOT_CONNECTED when link is disconnected', async () => {
      link.connected = false
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter', armed: true, mode: 'GUIDED' }))
      await expect(commands.takeoff(20)).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })

  describe('rtl', () => {
    it('delegates to setMode("RTL") and resolves on ACK', async () => {
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter' }))
      const promise = commands.rtl()
      expect(link.sent[0]!.command).toBe(common.MavCmd.DO_SET_MODE)
      expect(link.sent[0]!._param2).toBe(6) // COPTER_MODES[6] === 'RTL'
      link.ack(common.MavCmd.DO_SET_MODE, common.MavResult.ACCEPTED)
      await expect(promise).resolves.toBeUndefined()
    })

    it('throws NOT_CONNECTED when link is disconnected', async () => {
      link.connected = false
      const commands = makeCommands(makeDeps(link, { vehicleType: 'copter' }))
      await expect(commands.rtl()).rejects.toMatchObject({ code: 'NOT_CONNECTED' })
      expect(link.sent).toHaveLength(0)
    })
  })
})
