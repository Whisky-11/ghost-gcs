import { describe, expect, it } from 'vitest'
import {
  addWaypoint,
  createEmptyMission,
  initialMissionEditorState,
  missionEditorReducer,
  missionToLineCoordinates,
  polygonToLineCoordinates,
  polygonToSurveyRequest,
  removeWaypoint,
  reorderWaypoint,
  type MissionEditorState,
} from '../mission'
import type { LatLng, Mission, MissionItem } from '../types'

function item(seq: number, lat = 29 + seq, lng = 47 + seq, altM = 20): MissionItem {
  return { seq, command: 'WAYPOINT', lat, lng, altM }
}

function mission(...items: MissionItem[]): Mission {
  return { items }
}

const PT_A: LatLng = { lat: 29.1, lng: 47.1 }
const PT_B: LatLng = { lat: 29.2, lng: 47.2 }
const PT_C: LatLng = { lat: 29.3, lng: 47.3 }

describe('addWaypoint', () => {
  it('appends a WAYPOINT item with seq = current length on an empty mission', () => {
    const m = addWaypoint(createEmptyMission(), PT_A, 20)
    expect(m.items).toEqual([{ seq: 0, command: 'WAYPOINT', lat: PT_A.lat, lng: PT_A.lng, altM: 20 }])
  })

  it('appends after existing items, preserving them', () => {
    const start = mission(item(0), item(1))
    const m = addWaypoint(start, PT_C, 30)
    expect(m.items).toHaveLength(3)
    expect(m.items[2]).toEqual({ seq: 2, command: 'WAYPOINT', lat: PT_C.lat, lng: PT_C.lng, altM: 30 })
    // originals untouched
    expect(m.items[0]).toEqual(item(0))
    expect(m.items[1]).toEqual(item(1))
  })

  it('does not mutate the input mission', () => {
    const start = mission(item(0))
    addWaypoint(start, PT_A, 20)
    expect(start.items).toHaveLength(1)
  })

  it('accepts an explicit command override', () => {
    const m = addWaypoint(createEmptyMission(), PT_A, 5, 'TAKEOFF')
    expect(m.items[0]!.command).toBe('TAKEOFF')
  })
})

describe('removeWaypoint', () => {
  it('removes the item with the matching seq and reseqs the rest contiguously', () => {
    const start = mission(item(0), item(1), item(2))
    const m = removeWaypoint(start, 1)
    expect(m.items.map((it) => it.seq)).toEqual([0, 1])
    // the surviving items are the original seq-0 and seq-2 items, reseq'd
    expect(m.items[0]).toMatchObject({ seq: 0, lat: item(0).lat })
    expect(m.items[1]).toMatchObject({ seq: 1, lat: item(2).lat })
  })

  it('removing the first item shifts every remaining seq down by one', () => {
    const start = mission(item(0), item(1), item(2))
    const m = removeWaypoint(start, 0)
    expect(m.items.map((it) => it.seq)).toEqual([0, 1])
    expect(m.items[0]).toMatchObject({ lat: item(1).lat })
  })

  it('is a no-op (still reseq-normalized) when seq is not found', () => {
    const start = mission(item(0), item(1))
    const m = removeWaypoint(start, 99)
    expect(m.items.map((it) => it.seq)).toEqual([0, 1])
    expect(m.items).toHaveLength(2)
  })

  it('removing the only item yields an empty mission', () => {
    const m = removeWaypoint(mission(item(0)), 0)
    expect(m.items).toEqual([])
  })

  it('does not mutate the input mission', () => {
    const start = mission(item(0), item(1))
    removeWaypoint(start, 0)
    expect(start.items).toHaveLength(2)
  })
})

describe('reorderWaypoint', () => {
  it('moves an item later in the sequence', () => {
    const start = mission(item(0), item(1), item(2))
    const m = reorderWaypoint(start, 0, 2)
    // original seq-0 item now lands last
    expect(m.items.map((it) => it.lat)).toEqual([item(1).lat, item(2).lat, item(0).lat])
    expect(m.items.map((it) => it.seq)).toEqual([0, 1, 2])
  })

  it('moves an item earlier in the sequence', () => {
    const start = mission(item(0), item(1), item(2))
    const m = reorderWaypoint(start, 2, 0)
    expect(m.items.map((it) => it.lat)).toEqual([item(2).lat, item(0).lat, item(1).lat])
    expect(m.items.map((it) => it.seq)).toEqual([0, 1, 2])
  })

  it('clamps an out-of-range target position instead of throwing', () => {
    const start = mission(item(0), item(1), item(2))
    const m = reorderWaypoint(start, 0, 999)
    expect(m.items.map((it) => it.lat)).toEqual([item(1).lat, item(2).lat, item(0).lat])
  })

  it('is a no-op (still reseq-normalized) when fromSeq is not found', () => {
    const start = mission(item(0), item(1))
    const m = reorderWaypoint(start, 99, 0)
    expect(m.items.map((it) => it.lat)).toEqual([item(0).lat, item(1).lat])
  })

  it('does not mutate the input mission', () => {
    const start = mission(item(0), item(1), item(2))
    reorderWaypoint(start, 0, 2)
    expect(start.items.map((it) => it.seq)).toEqual([0, 1, 2])
    expect(start.items[0]).toEqual(item(0))
  })
})

describe('polygonToSurveyRequest', () => {
  it('accepts a valid triangle + positive spacing + in-bounds altitude', () => {
    const result = polygonToSurveyRequest([PT_A, PT_B, PT_C], 40, 25)
    expect(result).toEqual({ ok: true, request: { polygon: [PT_A, PT_B, PT_C], altM: 40, spacingM: 25 } })
  })

  it('rejects a polygon with fewer than 3 points', () => {
    const result = polygonToSurveyRequest([PT_A, PT_B], 40, 25)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at least 3 points/)
  })

  it('rejects zero or negative spacing', () => {
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 40, 0).ok).toBe(false)
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 40, -5).ok).toBe(false)
  })

  it('rejects an altitude below MISSION_ALT_MIN or above MISSION_ALT_MAX', () => {
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 1, 25).ok).toBe(false)
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 121, 25).ok).toBe(false)
  })

  it('accepts the inclusive altitude boundaries (2 and 120)', () => {
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 2, 25).ok).toBe(true)
    expect(polygonToSurveyRequest([PT_A, PT_B, PT_C], 120, 25).ok).toBe(true)
  })
})

describe('missionToLineCoordinates', () => {
  it('returns [lng,lat] pairs in seq order regardless of input array order', () => {
    const start = mission(item(2), item(0), item(1))
    expect(missionToLineCoordinates(start)).toEqual([
      [item(0).lng, item(0).lat],
      [item(1).lng, item(1).lat],
      [item(2).lng, item(2).lat],
    ])
  })

  it('returns an empty array for an empty mission', () => {
    expect(missionToLineCoordinates(createEmptyMission())).toEqual([])
  })
})

describe('polygonToLineCoordinates', () => {
  it('leaves an open polyline as-is when closed=false', () => {
    expect(polygonToLineCoordinates([PT_A, PT_B, PT_C], false)).toEqual([
      [PT_A.lng, PT_A.lat],
      [PT_B.lng, PT_B.lat],
      [PT_C.lng, PT_C.lat],
    ])
  })

  it('appends the first point again to close the ring when closed=true', () => {
    const coords = polygonToLineCoordinates([PT_A, PT_B, PT_C], true)
    expect(coords).toHaveLength(4)
    expect(coords[3]).toEqual(coords[0])
  })

  it('returns an empty array for an empty polygon even when closed', () => {
    expect(polygonToLineCoordinates([], true)).toEqual([])
  })
})

describe('missionEditorReducer', () => {
  it('starts in waypoint mode with an empty mission and no polygon points', () => {
    expect(initialMissionEditorState).toEqual({ mode: 'waypoint', mission: { items: [] }, polygonPoints: [] })
  })

  it('setMode switches the mode without touching mission/polygon state', () => {
    const s = missionEditorReducer(initialMissionEditorState, { type: 'setMode', mode: 'polygon' })
    expect(s.mode).toBe('polygon')
    expect(s.mission).toEqual({ items: [] })
    expect(s.polygonPoints).toEqual([])
  })

  it('mapClick in waypoint mode appends a mission waypoint', () => {
    const s = missionEditorReducer(initialMissionEditorState, { type: 'mapClick', latlng: PT_A, altM: 15 })
    expect(s.mission.items).toEqual([{ seq: 0, command: 'WAYPOINT', lat: PT_A.lat, lng: PT_A.lng, altM: 15 }])
    expect(s.polygonPoints).toEqual([])
  })

  it('mapClick in polygon mode appends a polygon vertex, not a mission waypoint', () => {
    const polygonState: MissionEditorState = { ...initialMissionEditorState, mode: 'polygon' }
    const s = missionEditorReducer(polygonState, { type: 'mapClick', latlng: PT_A, altM: 15 })
    expect(s.polygonPoints).toEqual([PT_A])
    expect(s.mission.items).toEqual([])
  })

  it('accumulates multiple polygon clicks in order', () => {
    let s: MissionEditorState = { ...initialMissionEditorState, mode: 'polygon' }
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_A, altM: 15 })
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_B, altM: 15 })
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_C, altM: 15 })
    expect(s.polygonPoints).toEqual([PT_A, PT_B, PT_C])
  })

  it('removeWaypoint action delegates to the pure removeWaypoint helper', () => {
    let s = initialMissionEditorState
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_A, altM: 10 })
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_B, altM: 10 })
    s = missionEditorReducer(s, { type: 'removeWaypoint', seq: 0 })
    expect(s.mission.items).toEqual([{ seq: 0, command: 'WAYPOINT', lat: PT_B.lat, lng: PT_B.lng, altM: 10 }])
  })

  it('reorderWaypoint action delegates to the pure reorderWaypoint helper', () => {
    let s = initialMissionEditorState
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_A, altM: 10 })
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_B, altM: 10 })
    s = missionEditorReducer(s, { type: 'reorderWaypoint', fromSeq: 0, toSeq: 1 })
    expect(s.mission.items.map((it) => it.lat)).toEqual([PT_B.lat, PT_A.lat])
  })

  it('clearPolygon empties polygonPoints without touching the mission', () => {
    let s: MissionEditorState = { ...initialMissionEditorState, mode: 'polygon' }
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_A, altM: 10 })
    s = missionEditorReducer(s, { type: 'clearPolygon' })
    expect(s.polygonPoints).toEqual([])
  })

  it('clearMission empties the mission without touching polygonPoints', () => {
    let s: MissionEditorState = { ...initialMissionEditorState, mode: 'polygon' }
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_A, altM: 10 })
    s = missionEditorReducer(s, { type: 'setMode', mode: 'waypoint' })
    s = missionEditorReducer(s, { type: 'mapClick', latlng: PT_B, altM: 10 })
    s = missionEditorReducer(s, { type: 'clearMission' })
    expect(s.mission.items).toEqual([])
    expect(s.polygonPoints).toEqual([PT_A])
  })

  it('setMissionItems replaces the mission, clears the polygon, and resets mode to waypoint', () => {
    let s: MissionEditorState = { ...initialMissionEditorState, mode: 'polygon', polygonPoints: [PT_A, PT_B, PT_C] }
    const surveyItems: MissionItem[] = [item(0), item(1), item(2)]
    s = missionEditorReducer(s, { type: 'setMissionItems', items: surveyItems })
    expect(s.mission.items).toEqual(surveyItems)
    expect(s.polygonPoints).toEqual([])
    expect(s.mode).toBe('waypoint')
  })
})
