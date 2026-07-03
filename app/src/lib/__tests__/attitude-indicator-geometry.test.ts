import { describe, expect, it } from 'vitest'
import { GROUND_RECT, SKY_RECT } from '../../components/instruments/AttitudeIndicator'

// Regression for: sky rect used to stop short of the horizon (y in
// [-SIZE*2, 0]) while the ground rect started at CENTER, leaving
// y in (0, CENTER) unpainted — the top half of the horizon disc rendered
// blank. The rects must meet exactly at CENTER with no gap or overlap.

describe('attitude indicator sky/ground rect geometry', () => {
  it('sky rect bottom edge meets the ground rect top edge exactly', () => {
    const skyBottom = SKY_RECT.y + SKY_RECT.height
    expect(skyBottom).toBe(GROUND_RECT.y)
  })

  it('ground rect starts exactly at CENTER (90, half of SIZE 180)', () => {
    expect(GROUND_RECT.y).toBe(90)
  })

  it('sky rect covers the full negative-y region up to CENTER', () => {
    expect(SKY_RECT.y).toBe(-360)
    expect(SKY_RECT.y + SKY_RECT.height).toBe(90)
  })
})
