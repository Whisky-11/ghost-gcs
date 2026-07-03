import { describe, it, expect } from 'vitest'
import { generateSurveyGrid, pointInPolygon, type LatLng, type SurveyParams } from '../survey.js'

// Independent (not implementation-shared) equirectangular helpers, used only
// to build fixtures and cross-check numeric expectations in meters. Kuwait
// coords (~29N) are used throughout — that's where the cos(lat) longitude
// scaling factor is significant (~0.87) and easy to get silently wrong.
const EARTH_RADIUS_M = 6_371_000
const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
const KUWAIT_ORIGIN: LatLng = { lat: 29.33, lng: 47.97 }

function offset(origin: LatLng, xM: number, yM: number): LatLng {
  const cosLat0 = Math.cos(origin.lat * DEG2RAD)
  return {
    lat: origin.lat + (yM / EARTH_RADIUS_M) * RAD2DEG,
    lng: origin.lng + (xM / (EARTH_RADIUS_M * cosLat0)) * RAD2DEG,
  }
}

/** Flat-earth meter distance local to `origin`, precise enough for the small
 * (hundreds-of-meters) spans used in these fixtures. */
function metersBetween(origin: LatLng, a: LatLng, b: LatLng): number {
  const cosLat0 = Math.cos(origin.lat * DEG2RAD)
  const ax = (a.lng - origin.lng) * DEG2RAD * cosLat0 * EARTH_RADIUS_M
  const ay = (a.lat - origin.lat) * DEG2RAD * EARTH_RADIUS_M
  const bx = (b.lng - origin.lng) * DEG2RAD * cosLat0 * EARTH_RADIUS_M
  const by = (b.lat - origin.lat) * DEG2RAD * EARTH_RADIUS_M
  return Math.hypot(bx - ax, by - ay)
}

/** 200m x 200m square centered on KUWAIT_ORIGIN. */
function kuwaitSquare(): LatLng[] {
  return [
    offset(KUWAIT_ORIGIN, -100, -100),
    offset(KUWAIT_ORIGIN, 100, -100),
    offset(KUWAIT_ORIGIN, 100, 100),
    offset(KUWAIT_ORIGIN, -100, 100),
  ]
}

/** Right triangle (legs 200m) centered-ish on KUWAIT_ORIGIN's neighborhood. */
function kuwaitTriangle(): LatLng[] {
  return [
    offset(KUWAIT_ORIGIN, -100, -100),
    offset(KUWAIT_ORIGIN, 100, -100),
    offset(KUWAIT_ORIGIN, -100, 100),
  ]
}

function expectAllInside(items: { lat: number; lng: number }[], polygon: LatLng[]): void {
  for (const it of items) {
    expect(pointInPolygon({ lat: it.lat, lng: it.lng }, polygon)).toBe(true)
  }
}

/** Serpentine sanity check: the turn connecting the end of one pass to the
 * start of the next should be short (adjacent row, opposite ends), not a
 * long diagonal back across the whole survey area. */
function expectSerpentineTurns(items: LatLng[], passSize: number, origin: LatLng): void {
  const passCount = items.length / passSize
  for (let i = 0; i < passCount - 1; i++) {
    const thisPassEnd = items[i * passSize + (passSize - 1)]!
    const nextPassStart = items[(i + 1) * passSize]!
    const nextPassEnd = items[(i + 1) * passSize + (passSize - 1)]!
    const turnDist = metersBetween(origin, thisPassEnd, nextPassStart)
    const acrossDist = metersBetween(origin, thisPassEnd, nextPassEnd)
    expect(turnDist).toBeLessThan(acrossDist)
  }
}

describe('pointInPolygon', () => {
  const square: LatLng[] = kuwaitSquare()

  it('reports a clearly interior point as inside', () => {
    expect(pointInPolygon(KUWAIT_ORIGIN, square)).toBe(true)
  })

  it('reports a clearly exterior point as outside', () => {
    expect(pointInPolygon(offset(KUWAIT_ORIGIN, 1000, 1000), square)).toBe(false)
  })

  it('treats a polygon vertex as inside (boundary-inclusive)', () => {
    expect(pointInPolygon(square[0]!, square)).toBe(true)
  })

  it('treats the midpoint of an edge as inside (boundary-inclusive)', () => {
    const midpoint = offset(KUWAIT_ORIGIN, 0, -100) // midpoint of the bottom edge
    expect(pointInPolygon(midpoint, square)).toBe(true)
  })
})

describe('generateSurveyGrid', () => {
  it('throws on a degenerate polygon (<3 points)', () => {
    const params: SurveyParams = {
      polygon: [KUWAIT_ORIGIN, offset(KUWAIT_ORIGIN, 10, 0)],
      altM: 30,
      spacingM: 40,
    }
    expect(() => generateSurveyGrid(params)).toThrow()
  })

  it('throws on non-positive spacing', () => {
    const params: SurveyParams = { polygon: kuwaitSquare(), altM: 30, spacingM: 0 }
    expect(() => generateSurveyGrid(params)).toThrow()
  })

  it('square @ 50m-class spacing (40m): expected pass count, serpentine order, correct spacing', () => {
    const polygon = kuwaitSquare()
    const items = generateSurveyGrid({ polygon, altM: 30, spacingM: 40, headingDeg: 0 })

    // theta=0 -> u (travel) = north/lat axis, v (row) = east/lng axis.
    // vMin=-100,vMax=100, maxExtent=100 -> rows at 0,+-40,+-80 = 5 passes.
    expect(items.length).toBe(10)
    for (const it of items) {
      expect(it.command).toBe('WAYPOINT')
      expect(it.altM).toBe(30)
    }
    expect(items.map((it) => it.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

    expectAllInside(items, polygon)

    // Each pass is a full north-south sweep (-100..100 in y); direction must
    // alternate: pass 0 ascending lat (south->north), pass 1 descending, etc.
    for (let pass = 0; pass < 5; pass++) {
      const a = items[pass * 2]!
      const b = items[pass * 2 + 1]!
      if (pass % 2 === 0) {
        expect(a.lat).toBeLessThan(b.lat)
      } else {
        expect(a.lat).toBeGreaterThan(b.lat)
      }
    }

    // Spacing correctness: consecutive passes' east-west offset differs by
    // exactly spacingM (not just "some number of passes").
    const rowLngOf = (pass: number) => items[pass * 2]!.lng
    for (let pass = 0; pass < 4; pass++) {
      const a = offset(KUWAIT_ORIGIN, 0, 0)
      const gapM = metersBetween(
        KUWAIT_ORIGIN,
        { lat: a.lat, lng: rowLngOf(pass) },
        { lat: a.lat, lng: rowLngOf(pass + 1) },
      )
      expect(gapM).toBeCloseTo(40, 1)
    }

    // Total east-west span of the 5 rows: 4 gaps * 40m = 160m.
    const totalSpanM = metersBetween(
      KUWAIT_ORIGIN,
      { lat: KUWAIT_ORIGIN.lat, lng: rowLngOf(0) },
      { lat: KUWAIT_ORIGIN.lat, lng: rowLngOf(4) },
    )
    expect(totalSpanM).toBeCloseTo(160, 0)

    expectSerpentineTurns(items, 2, KUWAIT_ORIGIN)
  })

  it('a rotated heading (30deg) still covers the square with correct pass count', () => {
    const polygon = kuwaitSquare()
    const items = generateSurveyGrid({ polygon, altM: 25, spacingM: 40, headingDeg: 30 })

    // v = x*cos30 - y*sin30 over the 4 corners -> vMin=-136.60, vMax=136.60
    // (no vertex sits on a row value) -> rows at 0,+-40,+-80,+-120 = 7 passes,
    // each a single interval since the square is convex.
    expect(items.length).toBe(14)
    expectAllInside(items, polygon)
    expectSerpentineTurns(items, 2, KUWAIT_ORIGIN)

    for (let pass = 0; pass < items.length / 2 - 1; pass++) {
      const a0 = items[pass * 2]!
      const b0 = items[pass * 2 + 1]!
      const a1 = items[(pass + 1) * 2]!
      const b1 = items[(pass + 1) * 2 + 1]!
      // direction alternates: the (a,b) ordering flips sign of travel each pass
      const dir0 = Math.sign(b0.lat - a0.lat) || Math.sign(b0.lng - a0.lng)
      const dir1 = Math.sign(b1.lat - a1.lat) || Math.sign(b1.lng - a1.lng)
      expect(dir0).not.toBe(dir1)
    }
  })

  it('triangle (odd/asymmetric clip): default heading = longest-edge bearing, waypoints stay inside, pass widths vary', () => {
    const polygon = kuwaitTriangle()
    const items = generateSurveyGrid({ polygon, altM: 20, spacingM: 30 })

    expect(items.length).toBeGreaterThan(0)
    expect(items.length % 2).toBe(0)
    expectAllInside(items, polygon)

    const passSize = 2
    const passCount = items.length / passSize
    const passLengths: number[] = []
    for (let pass = 0; pass < passCount; pass++) {
      const a = items[pass * passSize]!
      const b = items[pass * passSize + 1]!
      passLengths.push(metersBetween(KUWAIT_ORIGIN, a, b))
    }
    // A triangle tapers: passes must NOT all be the same length (that would
    // indicate the clip degenerated to the square/rectangle case).
    const distinct = new Set(passLengths.map((l) => Math.round(l)))
    expect(distinct.size).toBeGreaterThan(1)

    expectSerpentineTurns(items, passSize, KUWAIT_ORIGIN)
  })

  it('spacing larger than the polygon still yields >=1 line through the centroid', () => {
    const polygon = kuwaitSquare()
    const items = generateSurveyGrid({ polygon, altM: 15, spacingM: 1000, headingDeg: 0 })

    expect(items.length).toBe(2)
    expectAllInside(items, polygon)

    // The single row is v=0 (the centroid's row coordinate), so both
    // waypoints must share the centroid's longitude (heading=0 -> v=east axis).
    const centroid = KUWAIT_ORIGIN // arithmetic mean of a symmetric square == its center
    expect(items[0]!.lng).toBeCloseTo(centroid.lng, 6)
    expect(items[1]!.lng).toBeCloseTo(centroid.lng, 6)

    // And it should span the full width of the polygon (south to north edge).
    const spanM = metersBetween(KUWAIT_ORIGIN, items[0]!, items[1]!)
    expect(spanM).toBeCloseTo(200, 0)
  })

  it('seq is always 0-based contiguous regardless of pass count', () => {
    const items = generateSurveyGrid({
      polygon: kuwaitSquare(),
      altM: 30,
      spacingM: 25,
      headingDeg: 0,
    })
    expect(items.map((it) => it.seq)).toEqual(items.map((_, i) => i))
  })
})
