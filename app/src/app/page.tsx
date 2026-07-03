'use client'

import dynamic from 'next/dynamic'
import { useTelemetry } from '@/hooks/useTelemetry'
import { AttitudeIndicator } from '@/components/instruments/AttitudeIndicator'
import { Hsi } from '@/components/instruments/Hsi'
import { StatusChips } from '@/components/instruments/StatusChips'
import { Tapes } from '@/components/instruments/Tapes'
import { FlightControls } from '@/components/FlightControls'
import { Toasts } from '@/components/Toasts'

// maplibre-gl touches window/document at module load — must stay client-only
// (ssr:false requires the dynamic() call to live in a Client Component, per
// Next 15/16's app router rules, hence this whole page is 'use client').
const VehicleMap = dynamic(() => import('@/components/VehicleMap'), { ssr: false })

export default function Home() {
  const { state, wsStatus, rpc } = useTelemetry()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--accent)' }}>GHOST GCS</strong>
        <StatusChips
          mode={state?.mode ?? null}
          armed={state?.armed ?? null}
          battery={state?.battery ?? null}
          gps={state?.gps ?? null}
          wsStatus={wsStatus}
          lastHeartbeatMs={state?.lastHeartbeatMs ?? null}
        />
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <VehicleMap state={state} rpc={rpc} />
        </div>
        <aside
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 16,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <AttitudeIndicator rollDeg={state?.attitude?.rollDeg ?? null} pitchDeg={state?.attitude?.pitchDeg ?? null} />
            <Hsi yawDeg={state?.attitude?.yawDeg ?? null} />
          </div>
          <Tapes relAltM={state?.position?.relAltM ?? null} groundMps={state?.speed?.groundMps ?? null} />
          <FlightControls state={state} rpc={rpc} />
        </aside>
      </div>
      <Toasts />
    </div>
  )
}
