// Drag-to-100%-then-fire slider (spec safety invariant 3: arming requires a
// deliberate confirm gesture — no single click anywhere arms the vehicle).
// The math lives in lib/controls.ts's armSliderProgress/armSliderShouldFire
// (pure, node-testable); this component is thin pointer-event wiring +
// rendering, always springing the thumb back to 0 whether or not it fired.

'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { armSliderProgress, armSliderShouldFire } from '@/lib/controls'

const TRACK_WIDTH = 240
const TRACK_HEIGHT = 44
const THUMB_SIZE = 36
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - 4 // 2px padding each side

interface ArmSliderProps {
  disabled: boolean
  disabledReason: string | null
  onArm(): void
}

export function ArmSlider({ disabled, disabledReason, onArm }: ArmSliderProps) {
  const [progress, setProgress] = useState(0)
  // `dragging` drives the thumb's CSS transition (no easing mid-drag, spring
  // back once released/fired) — kept as real state, not a ref, since refs
  // must never be read during render (react-hooks/refs).
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const firedRef = useRef(false)

  function endDrag(): void {
    firedRef.current = false
    setDragging(false)
    setProgress(0)
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    firedRef.current = false
    startXRef.current = e.clientX
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging || firedRef.current) return
    const p = armSliderProgress(startXRef.current, e.clientX, TRAVEL)
    setProgress(p)
    if (armSliderShouldFire(p)) {
      firedRef.current = true
      onArm()
      // Deliberate confirm fired — always spring back, never stay "armed"
      // visually parked at 100%.
      endDrag()
    }
  }

  function handlePointerUp(): void {
    if (!dragging) return
    endDrag()
  }

  const thumbX = 2 + progress * TRAVEL

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        role="slider"
        aria-label="Slide to arm"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-disabled={disabled}
        title={disabled ? (disabledReason ?? undefined) : 'Drag to the end to arm'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: 'relative',
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          border: `1px solid ${disabled ? 'var(--border)' : 'var(--crit)'}`,
          background: 'var(--bg)',
          touchAction: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          userSelect: 'none',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontSize: 12,
            letterSpacing: 1,
            color: 'var(--fg-dim)',
            pointerEvents: 'none',
          }}
        >
          {disabled ? 'ARM' : 'SLIDE TO ARM →'}
        </span>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: thumbX,
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: '50%',
            background: disabled ? 'var(--panel)' : 'var(--crit)',
            border: '1px solid var(--border)',
            transition: dragging ? 'none' : 'left 150ms ease-out',
          }}
        />
      </div>
      {disabled && disabledReason && (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--fg-dim)' }}>{disabledReason}</span>
      )}
    </div>
  )
}
