// Pure logic for the AlertsPanel (Task 9). No React, no I/O.
//
// The wire Alert (types.ts, mirrored from bridge/src/watchdog/rules.ts) has
// no timestamp — the bridge pushes the full *current* active-alert set on
// every real change, not an append-only event log (see server.ts's
// pushAlerts dedupe-by-code-set). "Newest first" therefore can't be derived
// from the payload alone: AlertsPanel tracks each code's client-observed
// first-seen time (mergeAlertTimestamps, called from a useEffect keyed on the
// alerts prop) and sortAlertsForDisplay uses that as the tiebreaker under a
// primary severity sort.
import type { Alert, AlertSeverity } from './types'

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 2, warn: 1, info: 0 }

/** Highest severity first, then most-recently-first-seen first (per the
 * code-keyed `firstSeenByCode` map) within the same severity tier. A code
 * missing from the map (not yet observed by mergeAlertTimestamps, e.g. the
 * very first render before its effect runs) sorts as oldest — not a
 * correctness issue, just a one-tick ordering nudge until the effect fires. */
export function sortAlertsForDisplay(alerts: Alert[], firstSeenByCode: ReadonlyMap<string, number>): Alert[] {
  return [...alerts].sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (sevDiff !== 0) return sevDiff
    const aTime = firstSeenByCode.get(a.code) ?? 0
    const bTime = firstSeenByCode.get(b.code) ?? 0
    return bTime - aTime
  })
}

/** Returns an updated first-seen map: codes already tracked keep their
 * original timestamp, newly-appearing codes are stamped with `nowMs`, and
 * codes no longer present in `alerts` are dropped (so a re-triggered alert
 * reads as "new" again, matching the bridge's own code-set-based identity —
 * see server.ts's pushAlerts). Never mutates `prev`. */
export function mergeAlertTimestamps(
  prev: ReadonlyMap<string, number>,
  alerts: Alert[],
  nowMs: number,
): Map<string, number> {
  const next = new Map<string, number>()
  for (const a of alerts) {
    next.set(a.code, prev.get(a.code) ?? nowMs)
  }
  return next
}

// ---------------------------------------------------------------------------
// aiNarrate "explain" error text — AI failures degrade to a clear "AI
// unavailable" state (spec: "flying is never affected") rather than exposing
// the raw AI_TIMEOUT/AI_VALIDATION/AI_UNAVAILABLE code distinction to the
// operator; non-AI rpc errors (e.g. NOT_CONNECTED) fall back to the shared
// describeRpcError map in lib/controls.ts.
// ---------------------------------------------------------------------------

export function isAiErrorCode(code: string): boolean {
  return code.startsWith('AI_')
}

export function explainErrorText(code: string, describeRpcError: (code: string) => string): string {
  return isAiErrorCode(code) ? 'AI unavailable' : describeRpcError(code)
}
