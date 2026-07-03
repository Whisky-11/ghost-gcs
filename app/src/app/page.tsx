'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTelemetry } from '@/hooks/useTelemetry'
import { AttitudeIndicator } from '@/components/instruments/AttitudeIndicator'
import { Hsi } from '@/components/instruments/Hsi'
import { StatusChips } from '@/components/instruments/StatusChips'
import { Tapes } from '@/components/instruments/Tapes'
import { FlightControls } from '@/components/FlightControls'
import { MissionControls } from '@/components/MissionControls'
import { AlertsPanel } from '@/components/AlertsPanel'
import { Toasts } from '@/components/Toasts'
import type { Mission } from '@/lib/types'

// maplibre-gl touches window/document at module load — must stay client-only
// (ssr:false requires the dynamic() call to live in a Client Component, per
// Next 15/16's app router rules, hence this whole page is 'use client').
const VehicleMap = dynamic(() => import('@/components/VehicleMap'), { ssr: false })

const EMPTY_MISSION: Mission = { items: [] }

export default function Home() {
  const { state, wsStatus, alerts, rpc } = useTelemetry()

  // Mission editor state lives inside VehicleMap (Task 8); onMissionChange is
  // its escape hatch for observing the built mission up here, where
  // MissionControls needs it to gate upload/start/clear (Task 9).
  const [mission, setMission] = useState<Mission>(EMPTY_MISSION)
  // Client-tracked: true only after a successful uploadMission rpc. Any
  // further edit to the mission (add/remove/reorder/generate-survey/local
  // clear in the editor panel) invalidates it — the vehicle's currently
  // uploaded mission may no longer match what's shown in the editor.
  const [missionUploaded, setMissionUploaded] = useState(false)

  const handleMissionChange = useCallback((next: Mission) => {
    setMission(next)
    setMissionUploaded(false)
  }, [])

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
          <VehicleMap state={state} rpc={rpc} onMissionChange={handleMissionChange} />
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
          <MissionControls
            state={state}
            mission={mission}
            missionUploaded={missionUploaded}
            onMissionUploadedChange={setMissionUploaded}
            rpc={rpc}
          />
          <AlertsPanel alerts={alerts} rpc={rpc} />
        </aside>
      </div>
      <Toasts />
    </div>
  )
}
