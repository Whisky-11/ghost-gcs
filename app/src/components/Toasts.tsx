// Thin renderer over lib/controls.ts's toastStore (reducer-style, tested in
// node without a DOM). Fixed-position stack, auto-expires via the store's
// own ttl timer — this component just re-renders when the store notifies.

'use client'

import { useSyncExternalStore } from 'react'
import { toastStore } from '@/lib/controls'

export function Toasts() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getToasts, toastStore.getToasts)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
        maxWidth: 320,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '8px 12px',
            borderRadius: 4,
            border: `1px solid ${t.kind === 'error' ? 'var(--crit)' : 'var(--ok)'}`,
            color: t.kind === 'error' ? 'var(--crit)' : 'var(--ok)',
            background: 'var(--panel)',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
