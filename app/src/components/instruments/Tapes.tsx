// Vertical readout tapes for altitude (relAltM) and groundspeed. Hand-drawn
// SVG, no chart lib. Each tape scrolls its own scale so the current value
// always sits centered against a fixed pointer — null-tolerant, rendering a
// flat scale + "—" readout when the value is missing.

import { fmtAlt, fmtSpeed } from '@/lib/format'

const TAPE_WIDTH = 66
const TAPE_HEIGHT = 160

interface VerticalTapeProps {
  value: number | null
  tickStep: number
  visibleRange: number
  format: (v: number) => string
  label: string
}

function VerticalTape({ value, tickStep, visibleRange, format, label }: VerticalTapeProps) {
  const center = TAPE_HEIGHT / 2
  const pxPerUnit = TAPE_HEIGHT / visibleRange
  const v = value ?? 0

  const start = Math.ceil((v - visibleRange / 2) / tickStep) * tickStep
  const end = v + visibleRange / 2
  const ticks: number[] = []
  for (let t = start; t <= end; t += tickStep) ticks.push(t)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg
        width={TAPE_WIDTH}
        height={TAPE_HEIGHT}
        viewBox={`0 0 ${TAPE_WIDTH} ${TAPE_HEIGHT}`}
        role="img"
        aria-label={`${label} tape`}
      >
        <rect x={0} y={0} width={TAPE_WIDTH} height={TAPE_HEIGHT} fill="var(--panel)" stroke="var(--border)" />
        {ticks.map((t) => {
          const y = center - (t - v) * pxPerUnit
          const isMajor = Math.abs(Math.round(t / tickStep)) % 2 === 0
          return (
            <g key={t}>
              <line
                x1={TAPE_WIDTH - (isMajor ? 16 : 9)}
                y1={y}
                x2={TAPE_WIDTH}
                y2={y}
                stroke="var(--fg-dim)"
                strokeWidth={1}
              />
              {isMajor && (
                <text
                  x={TAPE_WIDTH - 20}
                  y={y}
                  fontSize={9}
                  fontFamily="monospace"
                  fill="var(--fg-dim)"
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {t.toFixed(0)}
                </text>
              )}
            </g>
          )
        })}
        {/* Fixed center pointer — the value scrolls past this. */}
        <line x1={0} y1={center} x2={TAPE_WIDTH} y2={center} stroke="var(--accent)" strokeWidth={1.5} />
        <polygon
          points={`${TAPE_WIDTH},${center - 6} ${TAPE_WIDTH - 9},${center} ${TAPE_WIDTH},${center + 6}`}
          fill="var(--accent)"
        />
      </svg>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg)' }}>
        {label} {value === null ? '—' : format(value)}
      </span>
    </div>
  )
}

interface TapesProps {
  relAltM: number | null
  groundMps: number | null
}

export function Tapes({ relAltM, groundMps }: TapesProps) {
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
      <VerticalTape value={relAltM} tickStep={5} visibleRange={20} format={fmtAlt} label="ALT" />
      <VerticalTape value={groundMps} tickStep={2} visibleRange={8} format={fmtSpeed} label="GS" />
    </div>
  )
}
