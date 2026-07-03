// Artificial horizon: sky/ground split translated by pitch, rotated by roll,
// with a fixed wings reference overlay. Hand-drawn SVG — no chart lib (dep
// discipline). Null-tolerant: renders "—" pitch/roll readout and a level,
// un-rotated horizon when attitude is missing.

const SIZE = 180
const CENTER = SIZE / 2
// px of vertical translation per degree of pitch — clamped so extreme pitch
// doesn't scroll the horizon fully off the visible disc.
const PX_PER_DEG_PITCH = 3
const MAX_PITCH_TRANSLATE = 90

// Sky/ground rect geometry, exported so the "no gap at the horizon" invariant
// is testable without a DOM: SKY_RECT's bottom edge (y + height) must equal
// CENTER, meeting GROUND_RECT's top edge (y) exactly. Both rects live inside
// the same rotate+translate <g> (see JSX below), so they move together —
// this boundary is invariant across every pitch/roll value, not just at 0.
export const SKY_RECT = { x: -SIZE, y: -SIZE * 2, width: SIZE * 3, height: SIZE * 2 + CENTER }
export const GROUND_RECT = { x: -SIZE, y: CENTER, width: SIZE * 3, height: SIZE * 2 }

interface AttitudeIndicatorProps {
  rollDeg: number | null
  pitchDeg: number | null
}

export function AttitudeIndicator({ rollDeg, pitchDeg }: AttitudeIndicatorProps) {
  const roll = rollDeg ?? 0
  const pitch = pitchDeg ?? 0
  const translateY = Math.max(-MAX_PITCH_TRANSLATE, Math.min(MAX_PITCH_TRANSLATE, pitch * PX_PER_DEG_PITCH))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="attitude indicator">
        <defs>
          <clipPath id="ai-disc-clip">
            <circle cx={CENTER} cy={CENTER} r={CENTER - 4} />
          </clipPath>
        </defs>

        <g clipPath="url(#ai-disc-clip)">
          {/* Rotated by roll, translated by pitch — oversized so rotation never reveals a gap. */}
          <g transform={`rotate(${-roll} ${CENTER} ${CENTER}) translate(0 ${translateY})`}>
            <rect {...SKY_RECT} fill="#1d4ed8" />
            <rect {...GROUND_RECT} fill="#78350f" />
            <line x1={-SIZE} y1={CENTER} x2={SIZE * 2} y2={CENTER} stroke="#f9fafb" strokeWidth={2} />
            {/* Pitch ladder ticks every 10deg from -30 to +30 */}
            {[-30, -20, -10, 10, 20, 30].map((deg) => (
              <line
                key={deg}
                x1={CENTER - 20}
                y1={CENTER - deg * PX_PER_DEG_PITCH}
                x2={CENTER + 20}
                y2={CENTER - deg * PX_PER_DEG_PITCH}
                stroke="#f9fafb"
                strokeWidth={1}
                opacity={0.7}
              />
            ))}
          </g>
        </g>

        <circle cx={CENTER} cy={CENTER} r={CENTER - 4} fill="none" stroke="var(--border)" strokeWidth={2} />

        {/* Fixed wings reference (does not rotate/translate). */}
        <g stroke="var(--accent)" strokeWidth={3} strokeLinecap="round">
          <line x1={CENTER - 40} y1={CENTER} x2={CENTER - 14} y2={CENTER} />
          <line x1={CENTER + 14} y1={CENTER} x2={CENTER + 40} y2={CENTER} />
          <circle cx={CENTER} cy={CENTER} r={2.5} fill="var(--accent)" />
        </g>
      </svg>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg-dim)' }}>
        R {rollDeg === null ? '—' : `${rollDeg.toFixed(0)}°`} / P {pitchDeg === null ? '—' : `${pitchDeg.toFixed(0)}°`}
      </span>
    </div>
  )
}
