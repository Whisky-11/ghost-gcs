import { describe, expect, it, vi } from 'vitest'
import { explainErrorText, isAiErrorCode, mergeAlertTimestamps, sortAlertsForDisplay } from '../alerts'
import type { Alert } from '../types'

function alert(code: string, severity: Alert['severity']): Alert {
  return { code, severity, message: `${code} message` }
}

describe('sortAlertsForDisplay', () => {
  it('critical sorts before warn sorts before info', () => {
    const alerts = [alert('A', 'info'), alert('B', 'critical'), alert('C', 'warn')]
    const sorted = sortAlertsForDisplay(alerts, new Map())
    expect(sorted.map((a) => a.code)).toEqual(['B', 'C', 'A'])
  })

  it('within the same severity, most-recently-first-seen sorts first', () => {
    const alerts = [alert('OLD', 'warn'), alert('NEW', 'warn')]
    const firstSeen = new Map([
      ['OLD', 1000],
      ['NEW', 5000],
    ])
    const sorted = sortAlertsForDisplay(alerts, firstSeen)
    expect(sorted.map((a) => a.code)).toEqual(['NEW', 'OLD'])
  })

  it('a code missing from firstSeenByCode sorts as oldest within its tier', () => {
    const alerts = [alert('TRACKED', 'critical'), alert('UNTRACKED', 'critical')]
    const firstSeen = new Map([['TRACKED', 5000]])
    const sorted = sortAlertsForDisplay(alerts, firstSeen)
    expect(sorted.map((a) => a.code)).toEqual(['TRACKED', 'UNTRACKED'])
  })

  it('does not mutate the input array', () => {
    const alerts = [alert('A', 'info'), alert('B', 'critical')]
    const copy = [...alerts]
    sortAlertsForDisplay(alerts, new Map())
    expect(alerts).toEqual(copy)
  })

  it('empty input returns empty output', () => {
    expect(sortAlertsForDisplay([], new Map())).toEqual([])
  })
})

describe('mergeAlertTimestamps', () => {
  it('stamps a newly-seen code with nowMs', () => {
    const next = mergeAlertTimestamps(new Map(), [alert('NEW', 'warn')], 1234)
    expect(next.get('NEW')).toBe(1234)
  })

  it('keeps the original timestamp for an already-tracked code', () => {
    const prev = new Map([['SEEN', 100]])
    const next = mergeAlertTimestamps(prev, [alert('SEEN', 'warn')], 9999)
    expect(next.get('SEEN')).toBe(100)
  })

  it('drops codes no longer present in alerts', () => {
    const prev = new Map([
      ['GONE', 100],
      ['STILL_HERE', 200],
    ])
    const next = mergeAlertTimestamps(prev, [alert('STILL_HERE', 'warn')], 9999)
    expect(next.has('GONE')).toBe(false)
    expect(next.get('STILL_HERE')).toBe(200)
  })

  it('a code that reappears after being dropped is stamped as new again', () => {
    const prev = new Map<string, number>() // RECURRING already dropped from a prior tick
    const next = mergeAlertTimestamps(prev, [alert('RECURRING', 'critical')], 7000)
    expect(next.get('RECURRING')).toBe(7000)
  })

  it('does not mutate prev', () => {
    const prev = new Map([['A', 1]])
    mergeAlertTimestamps(prev, [alert('B', 'warn')], 2)
    expect(prev.has('B')).toBe(false)
    expect(prev.size).toBe(1)
  })
})

describe('isAiErrorCode', () => {
  it('true for AI_* codes', () => {
    expect(isAiErrorCode('AI_TIMEOUT')).toBe(true)
    expect(isAiErrorCode('AI_VALIDATION')).toBe(true)
    expect(isAiErrorCode('AI_UNAVAILABLE')).toBe(true)
  })

  it('false for non-AI codes', () => {
    expect(isAiErrorCode('NOT_CONNECTED')).toBe(false)
    expect(isAiErrorCode('BAD_REQUEST')).toBe(false)
  })
})

describe('explainErrorText', () => {
  it('AI_* codes always read "AI unavailable", regardless of the fallback describer', () => {
    const describe = vi.fn(() => 'should not be used')
    expect(explainErrorText('AI_TIMEOUT', describe)).toBe('AI unavailable')
    expect(explainErrorText('AI_VALIDATION', describe)).toBe('AI unavailable')
    expect(explainErrorText('AI_UNAVAILABLE', describe)).toBe('AI unavailable')
    expect(describe).not.toHaveBeenCalled()
  })

  it('non-AI codes delegate to the provided describer', () => {
    const describe = vi.fn(() => 'Not connected to the vehicle link')
    expect(explainErrorText('NOT_CONNECTED', describe)).toBe('Not connected to the vehicle link')
    expect(describe).toHaveBeenCalledWith('NOT_CONNECTED')
  })
})
