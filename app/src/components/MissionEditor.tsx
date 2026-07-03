'use client'

// Floating mission-editor panel hosted by VehicleMap.tsx (which owns the
// underlying missionEditorReducer state + map click wiring — see
// lib/mission.ts). Purely presentational: every mutation is a callback prop
// so this component has no direct dependency on the reducer, the map, or
// the rpc client. Monochrome (black/white/grey) per the plan's UI
// constraint; English only.
import { useState, type CSSProperties } from 'react'
import { polygonToSurveyRequest, SURVEY_MIN_POLYGON_POINTS, type MissionEditorMode } from '@/lib/mission'
import { MISSION_ALT_MAX, MISSION_ALT_MIN, type LatLng, type Mission } from '@/lib/types'

const DEFAULT_SPACING_M = 25

interface MissionEditorProps {
  mode: MissionEditorMode
  mission: Mission
  polygonPoints: LatLng[]
  defaultAltM: number
  onDefaultAltMChange: (altM: number) => void
  onModeChange: (mode: MissionEditorMode) => void
  onRemoveWaypoint: (seq: number) => void
  onReorderWaypoint: (fromSeq: number, toSeq: number) => void
  onClearPolygon: () => void
  onClearMission: () => void
  /** Fired with a pre-validated survey request; throws/rejects surface as an
   * inline error here. VehicleMap.tsx's implementation calls the bridge's
   * surveyGrid RPC and dispatches the result back into the mission. */
  onGenerateSurvey: (polygon: LatLng[], altM: number, spacingM: number) => Promise<void>
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  zIndex: 1,
  width: 260,
  maxHeight: 'calc(100% - 32px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  borderRadius: 6,
  border: '1px solid #374151',
  background: 'rgba(17, 24, 39, 0.92)',
  color: '#f9fafb',
  fontFamily: 'monospace',
  fontSize: 12,
}

const headingStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: '#9ca3af',
  fontSize: 11,
}

const rowStyle: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' }

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '6px 8px',
    borderRadius: 4,
    border: `1px solid ${active ? '#f9fafb' : '#374151'}`,
    background: active ? '#f9fafb' : '#111827',
    color: active ? '#111827' : '#9ca3af',
    cursor: 'pointer',
  }
}

const smallButtonStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  padding: '3px 6px',
  borderRadius: 3,
  border: '1px solid #374151',
  background: '#111827',
  color: '#f9fafb',
  cursor: 'pointer',
}

const inputStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '5px 6px',
  background: '#0b0f14',
  color: '#f9fafb',
  border: '1px solid #374151',
  borderRadius: 4,
  width: '100%',
}

export function MissionEditor({
  mode,
  mission,
  polygonPoints,
  defaultAltM,
  onDefaultAltMChange,
  onModeChange,
  onRemoveWaypoint,
  onReorderWaypoint,
  onClearPolygon,
  onClearMission,
  onGenerateSurvey,
}: MissionEditorProps) {
  const [altInput, setAltInput] = useState(String(defaultAltM))
  const [spacingInput, setSpacingInput] = useState(String(DEFAULT_SPACING_M))
  const [surveyAltInput, setSurveyAltInput] = useState(String(defaultAltM))
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const items = [...mission.items].sort((a, b) => a.seq - b.seq)
  const canGenerate = polygonPoints.length >= SURVEY_MIN_POLYGON_POINTS

  async function handleGenerateSurvey(): Promise<void> {
    const altM = Number(surveyAltInput)
    const spacingM = Number(spacingInput)
    const result = polygonToSurveyRequest(polygonPoints, altM, spacingM)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setGenerating(true)
    try {
      await onGenerateSurvey(result.request.polygon, result.request.altM, result.request.spacingM)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Survey grid generation failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={panelStyle}>
      <span style={headingStyle}>Mission Editor</span>

      <div style={rowStyle}>
        <button type="button" style={modeButtonStyle(mode === 'waypoint')} onClick={() => onModeChange('waypoint')}>
          Waypoint
        </button>
        <button type="button" style={modeButtonStyle(mode === 'polygon')} onClick={() => onModeChange('polygon')}>
          Polygon
        </button>
      </div>

      {mode === 'waypoint' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={headingStyle}>Click alt (m)</span>
          <input
            type="number"
            min={MISSION_ALT_MIN}
            max={MISSION_ALT_MAX}
            value={altInput}
            onChange={(e) => setAltInput(e.target.value)}
            onBlur={() => {
              const parsed = Number(altInput)
              const clamped = Number.isFinite(parsed) ? Math.min(MISSION_ALT_MAX, Math.max(MISSION_ALT_MIN, parsed)) : defaultAltM
              setAltInput(String(clamped))
              onDefaultAltMChange(clamped)
            }}
            style={inputStyle}
          />
        </label>
      )}

      {mode === 'waypoint' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={headingStyle}>Waypoints ({items.length}) — click map to add</span>
          {items.length === 0 && <span style={{ color: '#9ca3af' }}>No waypoints yet.</span>}
          {items.map((it, index) => (
            <div key={it.seq} style={{ ...rowStyle, justifyContent: 'space-between' }}>
              <span>
                #{it.seq + 1} {it.command} {it.lat.toFixed(5)},{it.lng.toFixed(5)} @{it.altM}m
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  style={smallButtonStyle}
                  disabled={index === 0}
                  title="Move earlier"
                  onClick={() => onReorderWaypoint(it.seq, it.seq - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  style={smallButtonStyle}
                  disabled={index === items.length - 1}
                  title="Move later"
                  onClick={() => onReorderWaypoint(it.seq, it.seq + 1)}
                >
                  ↓
                </button>
                <button type="button" style={smallButtonStyle} title="Remove" onClick={() => onRemoveWaypoint(it.seq)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          {items.length > 0 && (
            <button type="button" style={smallButtonStyle} onClick={onClearMission}>
              Clear mission
            </button>
          )}
        </div>
      )}

      {mode === 'polygon' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={headingStyle}>
            Polygon ({polygonPoints.length} pt{polygonPoints.length === 1 ? '' : 's'}) — click map to draw
          </span>
          <div style={rowStyle}>
            <button type="button" style={smallButtonStyle} onClick={onClearPolygon} disabled={polygonPoints.length === 0}>
              Clear polygon
            </button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={headingStyle}>Survey alt (m)</span>
            <input
              type="number"
              min={MISSION_ALT_MIN}
              max={MISSION_ALT_MAX}
              value={surveyAltInput}
              onChange={(e) => setSurveyAltInput(e.target.value)}
              onBlur={() => {
                const parsed = Number(surveyAltInput)
                const clamped = Number.isFinite(parsed) ? Math.min(MISSION_ALT_MAX, Math.max(MISSION_ALT_MIN, parsed)) : defaultAltM
                setSurveyAltInput(String(clamped))
              }}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={headingStyle}>Line spacing (m)</span>
            <input
              type="number"
              min={1}
              value={spacingInput}
              onChange={(e) => setSpacingInput(e.target.value)}
              style={inputStyle}
            />
          </label>

          <button
            type="button"
            style={{
              ...smallButtonStyle,
              padding: '8px 10px',
              opacity: canGenerate && !generating ? 1 : 0.5,
              cursor: canGenerate && !generating ? 'pointer' : 'not-allowed',
            }}
            disabled={!canGenerate || generating}
            title={canGenerate ? 'Generate survey grid' : `Draw at least ${SURVEY_MIN_POLYGON_POINTS} points first`}
            onClick={() => void handleGenerateSurvey()}
          >
            {generating ? 'Generating…' : 'Generate Survey Grid'}
          </button>

          {error && <span style={{ color: '#f9fafb', background: '#374151', padding: '4px 6px', borderRadius: 3 }}>{error}</span>}
        </div>
      )}
    </div>
  )
}
