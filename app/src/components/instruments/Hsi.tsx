// Horizontal Situation Indicator: compass rose rotated by -yaw (so the
// current heading always points "up") with a numeric heading readout below.
// Hand-drawn SVG. Null-tolerant: level, un-rotated rose + "—" readout when
// yaw is missing.

const SIZE = 180
const CENTER = SIZE / 2
const RADIUS = CENTER - 14

const CARDINALS: Array<{ label: string; deg: number }> = [
  { label: 'N', deg: 0 },
  { label: 'E', deg: 90 },
  { label: 'S', deg: 180 },
  { label: 'W', deg: 270 },
]

interface HsiProps {
  yawDeg: number | null
}

export function Hsi({ yawDeg }: HsiProps) {
  const yaw = yawDeg ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="heading indicator">
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 8} fill="var(--panel)" stroke="var(--border)" strokeWidth={2} />

        <g transform={`rotate(${-yaw} ${CENTER} ${CENTER})`}>
          {/* Minor ticks every 30deg */}
          {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => {
            const rad = (deg * Math.PI) / 180
            const x1 = CENTER + Math.sin(rad) * (RADIUS - 6)
            const y1 = CENTER - Math.cos(rad) * (RADIUS - 6)
            const x2 = CENTER + Math.sin(rad) * RADIUS
            const y2 = CENTER - Math.cos(rad) * RADIUS
            return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg-dim)" strokeWidth={1} />
          })}
          {CARDINALS.map(({ label, deg }) => {
            const rad = (deg * Math.PI) / 180
            const x = CENTER + Math.sin(rad) * (RADIUS - 18)
            const y = CENTER - Math.cos(rad) * (RADIUS - 18)
            return (
              <text
                key={label}
                x={x}
                y={y}
                fill="var(--fg)"
                fontSize={13}
                fontFamily="monospace"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {label}
              </text>
            )
          })}
        </g>

        {/* Fixed vehicle-heading marker (does not rotate). */}
        <polygon
          points={`${CENTER},${CENTER - RADIUS - 6} ${CENTER - 6},${CENTER - RADIUS + 8} ${CENTER + 6},${CENTER - RADIUS + 8}`}
          fill="var(--accent)"
        />
        <circle cx={CENTER} cy={CENTER} r={2.5} fill="var(--accent)" />
      </svg>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg-dim)' }}>
        HDG {yawDeg === null ? '—' : `${yawDeg.toFixed(0)}°`}
      </span>
    </div>
  )
}
