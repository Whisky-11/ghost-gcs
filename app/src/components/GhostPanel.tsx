// GHOST advisory panel (Task 10) — the copilot's home in the UI. Three
// features, each independently pending/done/error via lib/ghost.ts's pure
// reducer:
//   1. Mission draft — an English request + "Draft from drawing" (sends the
//      current polygon/waypoint geometry) -> aiDraftMission -> a dashed
//      preview overlay on the map (GhostDraftOverlay.tsx, rendered by
//      VehicleMap.tsx from `draftPreviewItems`, lifted up through
//      onDraftItemsChange below) + a "Load into editor" button.
//   2. Ask box — a free-form question -> aiNarrate -> an answer.
//   3. Debrief — "Debrief last flight" -> aiDebrief -> a readable report.
//
// AI-never-uploads (spec safety invariant 1), verified structurally here:
// this component's ONLY rpc calls are 'aiDraftMission' | 'aiNarrate' |
// 'aiDebrief' — there is no 'uploadMission'/'startMission'/'arm'/'disarm'/
// 'setMode'/'takeoff'/'rtl' call anywhere in this file. "Load into editor"
// below is `onLoadIntoEditor`, a PLAIN CALLBACK PROP (no rpc involved) that
// page.tsx wires to VehicleMap's `loadMissionRequest` prop — a purely local
// mission-editor mutation the human then reviews and uploads themselves via
// Task 9's MissionControls. GHOST never calls uploadMission/startMission
// itself, from this panel or anywhere else.
//
// AI failures degrade to a clear "AI unavailable" state (reusing Task 9's
// AlertsPanel error mapping — explainErrorText + describeRpcError) rather
// than affecting flying in any way. Monochrome; English only.

'use client'

import { useEffect, useReducer, useState, type CSSProperties } from 'react'
import { describeRpcError } from '@/lib/controls'
import { explainErrorText } from '@/lib/alerts'
import { draftGeometryFromEditor, ghostReducer, initialGhostState, type GhostDraftData } from '@/lib/ghost'
import type { LatLng, Mission, MissionItem, RpcMethod, RpcParams } from '@/lib/types'

interface GhostPanelProps {
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
  /** Current in-progress survey polygon, lifted from VehicleMap's editor
   * state (page.tsx's onPolygonPointsChange) — used only to build the
   * geometry sent with "draft from drawing"; never mutated here. */
  polygonPoints: LatLng[]
  /** Current working mission, already lifted to page.tsx for Task 9's
   * MissionControls — reused here as the geometry fallback when no polygon
   * is drawn (see lib/ghost.ts's draftGeometryFromEditor). */
  mission: Mission
  /** Fired whenever the visible draft-preview items change (a new draft, a
   * cleared/reset draft, or a draft just loaded into the editor) so page.tsx
   * can feed VehicleMap's GhostDraftOverlay. Purely a rendering hand-off —
   * not a mission mutation. */
  onDraftItemsChange: (items: MissionItem[]) => void
  /** The ONLY way this panel ever touches the working mission: a plain
   * local callback, never an rpc call. Wired by page.tsx to VehicleMap's
   * loadMissionRequest prop, which dispatches missionEditorReducer's
   * `setMissionItems` — the same local mutation the survey-grid generator
   * already uses. */
  onLoadIntoEditor: (items: MissionItem[]) => void
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 6,
  // Dashed border echoes the draft-preview overlay's dashed styling —
  // ties GHOST's "not yet committed" visual language together.
  border: '1px dashed var(--fg-dim)',
  background: 'var(--panel)',
}

const headerRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }

const headingStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'var(--fg-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const sectionLabelStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  color: 'var(--fg-dim)',
  textTransform: 'uppercase',
}

const textAreaStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '6px 8px',
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  resize: 'vertical',
  minHeight: 44,
  width: '100%',
}

const buttonStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '7px 10px',
  borderRadius: 4,
  border: '1px solid var(--fg-dim)',
  background: 'var(--panel)',
  color: 'var(--fg)',
  cursor: 'pointer',
}

function disabledButtonStyle(disabled: boolean): CSSProperties {
  // Full `border` longhand (not just `borderColor`) in both branches — mixing
  // the `border` shorthand with a standalone `borderColor` override made
  // React warn on toggling disabled<->enabled ("Removing a style property
  // during rerender (borderColor) when a conflicting property is set
  // (border)"), caught live via the three Ask/Draft/Debrief buttons that all
  // share this helper (Task 10 manual verification, 2026-07-03).
  return disabled
    ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed', border: '1px solid var(--border)' }
    : buttonStyle
}

const responseBoxStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  padding: '8px 10px',
  borderRadius: 4,
  background: 'var(--border)',
  color: 'var(--fg)',
  whiteSpace: 'pre-wrap',
}

/** Subtle monochrome ghost glyph — outline only, uses currentColor so it
 * inherits the panel's text color rather than introducing a new hue. */
function GhostGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M12 3c-4.4 0-8 3.6-8 8v9l2.4-2 2.4 2 2.2-2 2.2 2 2.4-2 2.4 2v-9c0-4.4-3.6-8-8-8z" />
      <circle cx="9.3" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function GhostPanel({ rpc, polygonPoints, mission, onDraftItemsChange, onLoadIntoEditor }: GhostPanelProps) {
  const [state, dispatch] = useReducer(ghostReducer, initialGhostState)
  const [draftRequest, setDraftRequest] = useState('')
  const [question, setQuestion] = useState('')

  // Keeps VehicleMap's GhostDraftOverlay in sync with the draft's lifecycle:
  // shows the preview once a draft resolves, clears it on idle/pending/error
  // (a stale preview from a previous draft would be misleading while a new
  // one is in flight or failed).
  useEffect(() => {
    onDraftItemsChange(state.draft.status === 'done' ? state.draft.data.items : [])
    // onDraftItemsChange is a stable setState setter from page.tsx; omitting
    // it from deps avoids re-running this effect on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.draft])

  async function handleDraftFromDrawing(): Promise<void> {
    const request = draftRequest.trim()
    if (!request) return
    dispatch({ type: 'draft/start' })
    try {
      const geometry = draftGeometryFromEditor(polygonPoints, mission)
      const data = await rpc<GhostDraftData>('aiDraftMission', { request, geometry })
      dispatch({ type: 'draft/success', data })
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      dispatch({ type: 'draft/error', message: explainErrorText(code, describeRpcError) })
    }
  }

  function handleClearDraft(): void {
    dispatch({ type: 'draft/reset' })
  }

  function handleLoadIntoEditor(): void {
    if (state.draft.status !== 'done') return
    onLoadIntoEditor(state.draft.data.items)
    // The draft has been handed to the editor — a human now owns reviewing
    // and uploading it (Task 9's MissionControls). Clear the panel's own
    // draft state so "Load into editor" can't be double-fired against a
    // stale response.
    dispatch({ type: 'draft/reset' })
  }

  async function handleAsk(): Promise<void> {
    const q = question.trim()
    if (!q) return
    dispatch({ type: 'narrate/start' })
    try {
      const result = await rpc<{ text: string }>('aiNarrate', { question: q })
      dispatch({ type: 'narrate/success', data: result.text })
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      dispatch({ type: 'narrate/error', message: explainErrorText(code, describeRpcError) })
    }
  }

  async function handleDebrief(): Promise<void> {
    dispatch({ type: 'debrief/start' })
    try {
      const result = await rpc<{ text: string }>('aiDebrief')
      dispatch({ type: 'debrief/success', data: result.text })
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN'
      dispatch({ type: 'debrief/error', message: explainErrorText(code, describeRpcError) })
    }
  }

  const draftPending = state.draft.status === 'pending'
  const narratePending = state.narrate.status === 'pending'
  const debriefPending = state.debrief.status === 'pending'

  return (
    <div style={panelStyle}>
      <div style={headerRowStyle}>
        <GhostGlyph />
        <span style={headingStyle}>GHOST</span>
        <span style={{ ...sectionLabelStyle, textTransform: 'none', opacity: 0.75 }}>advisory copilot</span>
      </div>

      {/* --- 1. Mission draft ------------------------------------------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={sectionLabelStyle}>Draft a mission</span>
        <textarea
          value={draftRequest}
          onChange={(e) => setDraftRequest(e.target.value)}
          placeholder='e.g. "survey this area at 60m"'
          style={textAreaStyle}
          disabled={draftPending}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={disabledButtonStyle(draftPending || !draftRequest.trim())}
            disabled={draftPending || !draftRequest.trim()}
            title="Sends the current drawn polygon (or mission waypoints) plus your request to GHOST"
            onClick={() => void handleDraftFromDrawing()}
          >
            {draftPending ? 'GHOST is drafting…' : 'Draft from drawing'}
          </button>
          {state.draft.status !== 'idle' && (
            <button type="button" style={buttonStyle} onClick={handleClearDraft} disabled={draftPending}>
              Clear
            </button>
          )}
        </div>

        {state.draft.status === 'error' && <div style={responseBoxStyle}>{state.draft.message}</div>}

        {state.draft.status === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={responseBoxStyle}>
              {state.draft.data.items.length} waypoint{state.draft.data.items.length === 1 ? '' : 's'} drafted (dashed
              preview on map).{'\n'}
              {state.draft.data.notes}
            </div>
            <button
              type="button"
              style={disabledButtonStyle(state.draft.data.items.length === 0)}
              disabled={state.draft.data.items.length === 0}
              title="Copies the draft into the mission editor — you still review + upload it yourself"
              onClick={handleLoadIntoEditor}
            >
              Load into editor
            </button>
          </div>
        )}
      </div>

      {/* --- 2. Ask box ---------------------------------------------------- */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={sectionLabelStyle}>Ask GHOST</span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. how's our battery margin to get home?"
          style={{ ...textAreaStyle, minHeight: 32 }}
          disabled={narratePending}
        />
        <button
          type="button"
          style={disabledButtonStyle(narratePending || !question.trim())}
          disabled={narratePending || !question.trim()}
          onClick={() => void handleAsk()}
        >
          {narratePending ? 'GHOST is thinking…' : 'Ask'}
        </button>
        {state.narrate.status === 'error' && <div style={responseBoxStyle}>{state.narrate.message}</div>}
        {state.narrate.status === 'done' && <div style={responseBoxStyle}>{state.narrate.data}</div>}
      </div>

      {/* --- 3. Debrief ------------------------------------------------ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={sectionLabelStyle}>Debrief</span>
        <button type="button" style={disabledButtonStyle(debriefPending)} disabled={debriefPending} onClick={() => void handleDebrief()}>
          {debriefPending ? 'GHOST is writing the debrief…' : 'Debrief last flight'}
        </button>
        {state.debrief.status === 'error' && <div style={responseBoxStyle}>{state.debrief.message}</div>}
        {state.debrief.status === 'done' && <div style={responseBoxStyle}>{state.debrief.data}</div>}
      </div>
    </div>
  )
}
