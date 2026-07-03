'use client'

import dynamic from 'next/dynamic'
import { useTelemetry } from '@/hooks/useTelemetry'
import type { WsStatus } from '@/lib/ws'

// maplibre-gl touches window/document at module load — must stay client-only
// (ssr:false requires the dynamic() call to live in a Client Component, per
// Next 15/16's app router rules, hence this whole page is 'use client').
const VehicleMap = dynamic(() => import('@/components/VehicleMap'), { ssr: false })

export default function Home() {
  const { state, wsStatus } = useTelemetry()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopStatusBar wsStatus={wsStatus} mode={state?.mode ?? null} armed={state?.armed ?? null} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <VehicleMap state={state} />
        </div>
        {/* Sidebar shell — instruments (Task 8) + flight controls (Task 9) land here. */}
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 16,
            overflowY: 'auto',
          }}
        >
          <p style={{ color: 'var(--fg-dim)', fontFamily: 'monospace', fontSize: 13 }}>
            Instruments + flight controls land in Task 8/9.
          </p>
        </aside>
      </div>
    </div>
  )
}

function TopStatusBar({
  wsStatus,
  mode,
  armed,
}: {
  wsStatus: WsStatus
  mode: string | null
  armed: boolean | null
}) {
  const wsTone = wsStatus === 'open' ? 'ok' : wsStatus === 'connecting' ? 'warn' : 'crit'
  const armedTone = armed === null ? 'neutral' : armed ? 'crit' : 'ok'
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        flexShrink: 0,
      }}
    >
      <strong style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--accent)' }}>FALCON GCS</strong>
      <Chip label={`WS ${wsStatus.toUpperCase()}`} tone={wsTone} />
      <Chip label={`MODE ${mode ?? '—'}`} tone="neutral" />
      <Chip label={armed === null ? 'ARMED —' : armed ? 'ARMED' : 'DISARMED'} tone={armedTone} />
    </header>
  )
}

type ChipTone = 'ok' | 'warn' | 'crit' | 'neutral'

// Placeholder chip — Task 8's StatusChips.tsx replaces this with the full
// instrument-panel version (battery/GPS/link-age aware).
function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const colors: Record<ChipTone, { fg: string; border: string }> = {
    ok: { fg: 'var(--ok)', border: 'var(--ok)' },
    warn: { fg: 'var(--warn)', border: 'var(--warn)' },
    crit: { fg: 'var(--crit)', border: 'var(--crit)' },
    neutral: { fg: 'var(--fg-dim)', border: 'var(--border)' },
  }
  const { fg, border } = colors[tone]
  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: 12,
        padding: '3px 8px',
        borderRadius: 4,
        border: `1px solid ${border}`,
        color: fg,
      }}
    >
      {label}
    </span>
  )
}
