// Row of status chips: mode, armed state, battery, GPS fix, and link health.
// The link chip is heartbeat-age aware (linkStatus() in lib/format.ts) and
// ticks a 1s interval purely to force a re-render so the displayed age keeps
// advancing even when no new telemetry frame has arrived (a genuinely stale
// link stops producing frames, so something has to drive the clock).

'use client'

import { useEffect, useState } from 'react'
import { batteryColor, gpsFixLabel, linkStatus } from '@/lib/format'
import type { Battery, Gps } from '@/lib/types'
import type { WsStatus } from '@/lib/ws'

type ChipTone = 'ok' | 'warn' | 'crit' | 'neutral'

const TONE_COLORS: Record<ChipTone, { fg: string; border: string }> = {
  ok: { fg: 'var(--ok)', border: 'var(--ok)' },
  warn: { fg: 'var(--warn)', border: 'var(--warn)' },
  crit: { fg: 'var(--crit)', border: 'var(--crit)' },
  neutral: { fg: 'var(--fg-dim)', border: 'var(--border)' },
}

export function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const { fg, border } = TONE_COLORS[tone]
  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: 12,
        padding: '3px 8px',
        borderRadius: 4,
        border: `1px solid ${border}`,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

interface StatusChipsProps {
  mode: string | null
  armed: boolean | null
  battery: Battery | null
  gps: Gps | null
  wsStatus: WsStatus
  lastHeartbeatMs: number | null
}

export function StatusChips({ mode, armed, battery, gps, wsStatus, lastHeartbeatMs }: StatusChipsProps) {
  // Re-render every second so the link chip's heartbeat age keeps ticking
  // even between telemetry frames.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const armedTone: ChipTone = armed === null ? 'neutral' : armed ? 'crit' : 'ok'

  const batteryTone: ChipTone = battery === null ? 'neutral' : batteryColor(battery.remainingPct)
  const batteryLabel =
    battery === null ? 'BATT —' : `BATT ${battery.voltageV.toFixed(1)}V ${battery.remainingPct.toFixed(0)}%`

  const gpsTone: ChipTone = gps === null ? 'neutral' : gps.fixType >= 3 ? 'ok' : gps.fixType >= 2 ? 'warn' : 'crit'
  const gpsLabel = gps === null ? 'GPS —' : `GPS ${gpsFixLabel(gps.fixType)} ${gps.satellites}sat`

  const wsTone: ChipTone = wsStatus === 'open' ? linkStatus(lastHeartbeatMs, nowMs) : wsStatus === 'connecting' ? 'warn' : 'crit'
  const ageS = lastHeartbeatMs === null ? null : Math.max(0, (nowMs - lastHeartbeatMs) / 1000)
  const linkLabel = wsStatus !== 'open' ? `LINK ${wsStatus.toUpperCase()}` : `LINK ${ageS === null ? '—' : `${ageS.toFixed(1)}s`}`

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Chip label={`MODE ${mode ?? '—'}`} tone="neutral" />
      <Chip label={armed === null ? 'ARMED —' : armed ? 'ARMED' : 'DISARMED'} tone={armedTone} />
      <Chip label={batteryLabel} tone={batteryTone} />
      <Chip label={gpsLabel} tone={gpsTone} />
      <Chip label={linkLabel} tone={wsTone} />
    </div>
  )
}
