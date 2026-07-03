import { describe, expect, it } from 'vitest'
import { draftGeometryFromEditor, ghostReducer, initialGhostState, type GhostDraftData, type GhostState } from '../ghost'
import type { LatLng, Mission, MissionItem } from '../types'

function item(seq: number, lat = 29.3, lng = 47.9): MissionItem {
  return { seq, command: 'WAYPOINT', lat, lng, altM: 30 }
}

const DRAFT_DATA: GhostDraftData = { items: [item(0)], notes: 'survey the drawn box at 60m' }

describe('ghostReducer', () => {
  it('starts idle for all three kinds', () => {
    expect(initialGhostState.draft).toEqual({ status: 'idle' })
    expect(initialGhostState.narrate).toEqual({ status: 'idle' })
    expect(initialGhostState.debrief).toEqual({ status: 'idle' })
  })

  it('draft/start transitions only draft to pending, leaving narrate/debrief untouched', () => {
    const next = ghostReducer(initialGhostState, { type: 'draft/start' })
    expect(next.draft).toEqual({ status: 'pending' })
    expect(next.narrate).toBe(initialGhostState.narrate)
    expect(next.debrief).toBe(initialGhostState.debrief)
  })

  it('draft/success carries the returned items+notes into a done state', () => {
    const pending: GhostState = ghostReducer(initialGhostState, { type: 'draft/start' })
    const done = ghostReducer(pending, { type: 'draft/success', data: DRAFT_DATA })
    expect(done.draft).toEqual({ status: 'done', data: DRAFT_DATA })
  })

  it('draft/error carries a message into an error state', () => {
    const pending = ghostReducer(initialGhostState, { type: 'draft/start' })
    const errored = ghostReducer(pending, { type: 'draft/error', message: 'AI unavailable' })
    expect(errored.draft).toEqual({ status: 'error', message: 'AI unavailable' })
  })

  it('draft/reset returns to idle from done or error', () => {
    const done = ghostReducer(initialGhostState, { type: 'draft/success', data: DRAFT_DATA })
    expect(ghostReducer(done, { type: 'draft/reset' }).draft).toEqual({ status: 'idle' })
    const errored = ghostReducer(initialGhostState, { type: 'draft/error', message: 'x' })
    expect(ghostReducer(errored, { type: 'draft/reset' }).draft).toEqual({ status: 'idle' })
  })

  it('narrate transitions (start/success/error) are independent of draft/debrief', () => {
    let state = ghostReducer(initialGhostState, { type: 'narrate/start' })
    expect(state.narrate).toEqual({ status: 'pending' })
    state = ghostReducer(state, { type: 'narrate/success', data: 'battery is nominal' })
    expect(state.narrate).toEqual({ status: 'done', data: 'battery is nominal' })
    expect(state.draft).toEqual({ status: 'idle' })
    expect(state.debrief).toEqual({ status: 'idle' })

    const errored = ghostReducer(state, { type: 'narrate/error', message: 'AI unavailable' })
    expect(errored.narrate).toEqual({ status: 'error', message: 'AI unavailable' })
  })

  it('debrief transitions (start/success/error/reset) are independent of draft/narrate', () => {
    let state = ghostReducer(initialGhostState, { type: 'debrief/start' })
    expect(state.debrief).toEqual({ status: 'pending' })
    state = ghostReducer(state, { type: 'debrief/success', data: 'flew for 90s, peak alt 40m' })
    expect(state.debrief).toEqual({ status: 'done', data: 'flew for 90s, peak alt 40m' })
    state = ghostReducer(state, { type: 'debrief/error', message: 'AI unavailable' })
    expect(state.debrief).toEqual({ status: 'error', message: 'AI unavailable' })
    state = ghostReducer(state, { type: 'debrief/reset' })
    expect(state.debrief).toEqual({ status: 'idle' })
  })

  it('all three kinds can be in-flight/resolved independently at once', () => {
    let state = initialGhostState
    state = ghostReducer(state, { type: 'draft/start' })
    state = ghostReducer(state, { type: 'narrate/success', data: 'answer' })
    state = ghostReducer(state, { type: 'debrief/error', message: 'AI unavailable' })
    expect(state.draft).toEqual({ status: 'pending' })
    expect(state.narrate).toEqual({ status: 'done', data: 'answer' })
    expect(state.debrief).toEqual({ status: 'error', message: 'AI unavailable' })
  })

  it('an unknown action type is a no-op (returns the same state reference)', () => {
    const state = initialGhostState
    // @ts-expect-error deliberately unrecognized action for the default-case test
    const next = ghostReducer(state, { type: 'nonsense' })
    expect(next).toBe(state)
  })
})

describe('draftGeometryFromEditor', () => {
  const poly: LatLng[] = [
    { lat: 1, lng: 1 },
    { lat: 2, lng: 1 },
    { lat: 2, lng: 2 },
  ]
  const mission: Mission = { items: [item(0, 10, 20), item(1, 11, 21)] }
  const emptyMission: Mission = { items: [] }

  it('prefers the drawn polygon when present', () => {
    expect(draftGeometryFromEditor(poly, mission)).toBe(poly)
  })

  it('falls back to mission waypoints as a point set when no polygon is drawn', () => {
    expect(draftGeometryFromEditor([], mission)).toEqual([
      { lat: 10, lng: 20 },
      { lat: 11, lng: 21 },
    ])
  })

  it('returns null when the editor is completely empty', () => {
    expect(draftGeometryFromEditor([], emptyMission)).toBeNull()
  })
})
