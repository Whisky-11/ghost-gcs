// Survey-grid (lawnmower/boustrophedon) generator (P1 Task 2). Pure geometry —
// no MAVLink, no I/O, no external deps (hand-rolled math per dep discipline).
//
// Approach: project the polygon to local planar meters with an equirectangular
// projection centered on the polygon centroid (longitude scaled by cos(lat) so
// east-west distances are correct off the equator — Kuwait sits at ~29N, where
// that factor is ~0.87 and matters), rotate into a heading-aligned frame,
// sweep parallel "rows" spacingM apart, clip each row to the polygon with a
// standard even-odd scanline crossing test, alternate row direction
// (serpentine), then rotate + unproject each waypoint back to lat/lng.

import type { MissionItem } from './model.js'

export interface LatLng {
  lat: number
  lng: number
}

export interface SurveyParams {
  polygon: LatLng[]
  altM: number
  spacingM: number
  /** Compass bearing (degrees, clockwise from north) of the sweep line
   * direction. Defaults to the bearing of the polygon's longest edge. */
  headingDeg?: number
}

const EARTH_RADIUS_M = 6_371_000
const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI
/** Tolerance (meters) for boundary/extent comparisons — guards against
 * floating-point noise from the projection + rotation round trips. */
const EPS_M = 1e-6

interface LocalPoint {
  x: number // meters east of the projection origin
  y: number // meters north of the projection origin
}

interface RotatedPoint {
  u: number // meters along the sweep heading (row travel direction)
  v: number // meters perpendicular to the heading (row spacing axis)
}

/**
 * Generates a lawnmower/boustrophedon survey grid covering `polygon`,
 * emitting WAYPOINT MissionItems at `altM`, seq starting at 0.
 *
 * Rows run parallel to `headingDeg` (default: bearing of the polygon's
 * longest edge), spaced `spacingM` apart, centered on the polygon centroid
 * so that even when `spacingM` exceeds the polygon's extent at least one row
 * (through the centroid) is produced. Consecutive rows alternate direction
 * (serpentine) so the path never "resets" across the survey area.
 *
 * Throws on a degenerate polygon (<3 points) or non-positive spacing.
 */
export function generateSurveyGrid(p: SurveyParams): MissionItem[] {
  const { polygon, altM, spacingM } = p

  if (polygon.length < 3) {
    throw new Error('generateSurveyGrid: polygon must have at least 3 points')
  }
  if (!(spacingM > 0)) {
    throw new Error('generateSurveyGrid: spacingM must be > 0')
  }

  const origin = centroidOf(polygon)
  const cosLat0 = Math.cos(origin.lat * DEG2RAD)
  const local = polygon.map((pt) => projectToLocal(pt, origin, cosLat0))

  const thetaRad =
    p.headingDeg !== undefined ? p.headingDeg * DEG2RAD : longestEdgeBearingRad(local)

  const rotatedPoly = local.map((pt) => rotate(pt, thetaRad))

  const vValues = rotatedPoly.map((pt) => pt.v)
  const vMin = Math.min(...vValues)
  const vMax = Math.max(...vValues)

  const rowVs = candidateRows(vMin, vMax, spacingM)

  // Clip every row against the polygon; drop rows with no crossings (e.g. a
  // row that falls exactly outside the polygon's extent after rounding).
  const rowsWithSegments = rowVs
    .map((v) => ({ v, intervals: intervalsForRow(v, rotatedPoly) }))
    .filter((row) => row.intervals.length > 0)

  const items: MissionItem[] = []
  let seq = 0

  rowsWithSegments.forEach((row, rowIndex) => {
    const forward = rowIndex % 2 === 0
    const orderedIntervals = forward ? row.intervals : [...row.intervals].reverse()

    for (const [uLo, uHi] of orderedIntervals) {
      const uOrder = forward ? [uLo, uHi] : [uHi, uLo]
      for (const u of uOrder) {
        // rotate() is a self-inverse involution (see below): feeding (u,v) in
        // through the same x/y-shaped matrix maps back to local (x,y) meters.
        const unrotated = rotate({ x: u, y: row.v }, thetaRad)
        const localPoint: LocalPoint = { x: unrotated.u, y: unrotated.v }
        const latLng = unprojectFromLocal(localPoint, origin, cosLat0)
        items.push({ seq: seq++, command: 'WAYPOINT', lat: latLng.lat, lng: latLng.lng, altM })
      }
    }
  })

  return items
}

/**
 * Even-odd ray-casting point-in-polygon test, inclusive of the boundary
 * (within `epsilonDeg`). Boundary-inclusive is required here: survey grid
 * waypoints are, by construction, exact intersections of a sweep line with a
 * polygon edge — a strict interior-only test would reject them on floating
 * point noise alone.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[], epsilonDeg = 1e-9): boolean {
  if (isOnBoundary(point, polygon, epsilonDeg)) return true

  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = polygon[i]!
    const pj = polygon[j]!
    const intersects =
      pi.lat > point.lat !== pj.lat > point.lat &&
      point.lng < ((pj.lng - pi.lng) * (point.lat - pi.lat)) / (pj.lat - pi.lat) + pi.lng
    if (intersects) inside = !inside
  }
  return inside
}

function isOnBoundary(point: LatLng, polygon: LatLng[], epsilonDeg: number): boolean {
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (distanceToSegmentDeg(point, polygon[j]!, polygon[i]!) <= epsilonDeg) return true
  }
  return false
}

function distanceToSegmentDeg(p: LatLng, a: LatLng, b: LatLng): number {
  const abx = b.lng - a.lng
  const aby = b.lat - a.lat
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat)
  const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * abx + (p.lat - a.lat) * aby) / lenSq))
  const projLng = a.lng + t * abx
  const projLat = a.lat + t * aby
  return Math.hypot(p.lng - projLng, p.lat - projLat)
}

function centroidOf(polygon: LatLng[]): LatLng {
  const sum = polygon.reduce(
    (acc, pt) => ({ lat: acc.lat + pt.lat, lng: acc.lng + pt.lng }),
    { lat: 0, lng: 0 },
  )
  return { lat: sum.lat / polygon.length, lng: sum.lng / polygon.length }
}

/** Local equirectangular projection about `origin`, in meters. Longitude is
 * scaled by cos(origin.lat) — at Kuwait's ~29N that factor is ~0.87; skipping
 * it would compress/stretch east-west spacing and drift waypoints. */
function projectToLocal(pt: LatLng, origin: LatLng, cosLat0: number): LocalPoint {
  return {
    x: (pt.lng - origin.lng) * DEG2RAD * cosLat0 * EARTH_RADIUS_M,
    y: (pt.lat - origin.lat) * DEG2RAD * EARTH_RADIUS_M,
  }
}

function unprojectFromLocal(pt: LocalPoint, origin: LatLng, cosLat0: number): LatLng {
  return {
    lat: origin.lat + (pt.y / EARTH_RADIUS_M) * RAD2DEG,
    lng: origin.lng + (pt.x / (EARTH_RADIUS_M * cosLat0)) * RAD2DEG,
  }
}

/**
 * Rotates local meters (x=east, y=north) into a heading-aligned frame where
 * `u` runs along the heading (compass bearing, clockwise from north) and `v`
 * runs perpendicular to it (the row-spacing axis).
 *
 * u = x*sinθ + y*cosθ
 * v = x*cosθ - y*sinθ
 *
 * This 2x2 matrix has determinant -1 and squares to the identity, i.e. it is
 * its own inverse — applying it a second time (feeding u where x was and v
 * where y was) maps back to the original (x,y) frame. That lets the same
 * function serve as both the forward rotation and the unrotation step.
 */
function rotate(pt: LocalPoint, thetaRad: number): RotatedPoint {
  const s = Math.sin(thetaRad)
  const c = Math.cos(thetaRad)
  return {
    u: pt.x * s + pt.y * c,
    v: pt.x * c - pt.y * s,
  }
}

function longestEdgeBearingRad(local: LocalPoint[]): number {
  let bestLenSq = -1
  let bestBearing = 0
  const n = local.length
  for (let i = 0; i < n; i++) {
    const a = local[i]!
    const b = local[(i + 1) % n]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq > bestLenSq) {
      bestLenSq = lenSq
      bestBearing = Math.atan2(dx, dy) // compass bearing: atan2(east, north)
    }
  }
  return bestBearing
}

/** Row v-coordinates: centered on v=0 (the centroid — projection origin maps
 * to (0,0)), stepping outward by `spacingM` in both directions until past
 * [vMin,vMax]. v=0 is always included, guaranteeing at least one row even
 * when spacingM exceeds the polygon's extent. */
function candidateRows(vMin: number, vMax: number, spacingM: number): number[] {
  const rows = [0]
  const maxExtent = Math.max(Math.abs(vMin), Math.abs(vMax))
  for (let k = 1; k * spacingM <= maxExtent + EPS_M; k++) {
    const vPos = k * spacingM
    const vNeg = -vPos
    if (vPos >= vMin - EPS_M && vPos <= vMax + EPS_M) rows.push(vPos)
    if (vNeg >= vMin - EPS_M && vNeg <= vMax + EPS_M) rows.push(vNeg)
  }
  rows.sort((a, b) => a - b)
  return rows
}

/** Even-odd scanline crossing test against a horizontal-in-(u,v) row at
 * v=vk, returning sorted (uLo,uHi) inside-intervals. Handles convex and
 * concave simple polygons alike (a concave polygon can yield >1 interval per
 * row). */
function intervalsForRow(vk: number, rotatedPoly: RotatedPoint[]): [number, number][] {
  const crossings: number[] = []
  const n = rotatedPoly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = rotatedPoly[i]!
    const pj = rotatedPoly[j]!
    const iBelow = pi.v <= vk
    const jBelow = pj.v <= vk
    if (iBelow !== jBelow) {
      const t = (vk - pi.v) / (pj.v - pi.v)
      crossings.push(pi.u + t * (pj.u - pi.u))
    }
  }
  crossings.sort((a, b) => a - b)

  const intervals: [number, number][] = []
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    intervals.push([crossings[i]!, crossings[i + 1]!])
  }
  return intervals
}
