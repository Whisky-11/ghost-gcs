// Advisory watchdog-alert panel (Task 9) — renders the bridge's pushed
// `alerts` (rules-based, advisory-only per spec safety invariant 2; never a
// failsafe), newest/highest-severity first, monochrome severity styling.
// Each alert has an "Explain" button wired to the aiNarrate RPC — the first
// AI feature in the UI. AI failures (AI_* rpc error codes) degrade to a
// clear "AI unavailable" inline state; flying is never affected (spec).

'use client'

import { useState, type CSSProperties } from 'react'
import { describeRpcError } from '@/lib/controls'
import { explainErrorText, mergeAlertTimestamps, sortAlertsForDisplay } from '@/lib/alerts'
import type { Alert, RpcMethod, RpcParams } from '@/lib/types'

interface AlertsPanelProps {
  alerts: Alert[]
  rpc<T = void>(method: RpcMethod, params?: RpcParams): Promise<T>
}

type ExplainState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string }

const IDLE: ExplainState = { status: 'idle' }

const panelHeadingStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'var(--fg-dim)',
  textTransform: 'uppercase',
}

const explainButtonStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 3,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  flexShrink: 0,
}

function severityStyle(severity: Alert['severity']): CSSProperties {
  switch (severity) {
    case 'critical':
      // Inverted + bordered — the loudest monochrome treatment available.
      return { background: 'var(--fg)', color: 'var(--bg)', border: '2px solid var(--fg)' }
    case 'warn':
      // "White-on-grey".
      return { background: 'var(--border)', color: 'var(--fg)', border: '1px solid var(--fg-dim)' }
    case 'info':
    default:
      return { background: 'var(--panel)', color: 'var(--fg-dim)', border: '1px solid var(--border)' }
  }
}

export function AlertsPanel({ alerts, rpc }: AlertsPanelProps) {
  const [explain, setExplain] = useState<Record<string, ExplainState>>({})

  // Derived state that must update the moment `alerts` changes (React docs'
  // "adjusting state when a prop changes" pattern) — an effect here would
  // cost an extra render + trip the set-state-in-effect lint rule for no
  // benefit, since this is pure derivation from the incoming prop, not a
  // subscription to anything external.
  const [prevAlerts, setPrevAlerts] = useState(alerts)
  const [firstSeenByCode, setFirstSeenByCode] = useState<Map<string, number>>(() => mergeAlertTimestamps(new Map(), alerts, Date.now()))
  if (alerts !== prevAlerts) {
    setPrevAlerts(alerts)
    setFirstSeenByCode((prev) => mergeAlertTimestamps(prev, alerts, Date.now()))
  }

  const sorted = sortAlertsForDisplay(alerts, firstSeenByCode)

  async function explainAlert(code: string): Promise<void> {
    setExplain((prev) => ({ ...prev, [code]: { status: 'pending' } }))
    try {
      const result = await rpc<{ text: string }>('aiNarrate', { alertCode: code })
      setExplain((prev) => ({ ...prev, [code]: { status: 'done', text: result.text } }))
    } catch (err) {
      const rawCode = err instanceof Error ? err.message : 'UNKNOWN'
      setExplain((prev) => ({ ...prev, [code]: { status: 'error', text: explainErrorText(rawCode, describeRpcError) } }))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={panelHeadingStyle}>Advisory Alerts{sorted.length > 0 ? ` (${sorted.length})` : ''}</span>

      {sorted.length === 0 && (
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--fg-dim)' }}>No active alerts.</span>
      )}

      {sorted.map((alert) => {
        const state = explain[alert.code] ?? IDLE
        return (
          <div
            key={alert.code}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '8px 10px',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: 12,
              ...severityStyle(alert.severity),
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10, opacity: 0.85 }}>
                  {alert.severity} · {alert.code}
                </span>
                <span>{alert.message}</span>
              </div>
              <button
                type="button"
                disabled={state.status === 'pending'}
                title="Ask GHOST to explain this alert"
                onClick={() => void explainAlert(alert.code)}
                style={{ ...explainButtonStyle, opacity: state.status === 'pending' ? 0.6 : 1 }}
              >
                {state.status === 'pending' ? '…' : 'Explain'}
              </button>
            </div>

            {state.status === 'pending' && <span style={{ opacity: 0.7 }}>GHOST is thinking…</span>}
            {state.status === 'done' && <span style={{ opacity: 0.9 }}>{state.text}</span>}
            {state.status === 'error' && <span style={{ opacity: 0.9 }}>{state.text}</span>}
          </div>
        )
      })}
    </div>
  )
}
