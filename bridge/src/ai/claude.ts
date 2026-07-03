// ClaudeHeadless adapter (P1 Task 5). Spawns the local `claude` CLI in
// headless mode (`claude -p "<prompt>" --output-format json`) — this rides
// Ahmad's Claude Max subscription via the CLI, it is NEVER the Anthropic
// API and never touches an API key. This module is pure process-spawning +
// queueing + validation infra: it has no access to a VehicleLink or any
// command mutator, and nothing downstream of it may import command code
// into an AI code path (spec safety invariant 1 — the AI never commands the
// vehicle, it only ever produces data/text for a human to review).
//
// ClaudeHeadless discipline (Ahmad's standing rule, restated in the plan's
// Global Constraints): max 1 concurrent `claude -p` at a time (a FIFO queue
// below enforces this — no fanout), 120s default timeout, zod-validated
// JSON output with exactly ONE retry (validation error appended to the
// retry prompt), and the adapter NEVER throws synchronously — `ask`/
// `askJson` are always async functions, so a caller always gets a rejected
// Promise it can catch, never an exception it must wrap in try/catch around
// the call site itself.
//
// Confirmed headless CLI shape (live-tested against the real CLI, see the
// task report): `claude -p "<prompt>" --output-format json` prints ONE JSON
// object to stdout and exits 0 on success:
//   { "type": "result", "subtype": "success", "is_error": false, ..., "result": "<text>" }
// and either a non-zero exit code or `is_error: true` on failure. The
// adapter reads `.result` for the text; per the brief it also tolerates a
// bare JSON string (`"some text"`) as stdout, documented as a fallback in
// case a future CLI version or flag combination emits the text unwrapped.
import { spawn as spawnProcess } from 'node:child_process'
import type { ZodType } from 'zod'

export interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

/** Process-spawning seam. The default implementation shells out to
 * node:child_process `spawn` (never `exec`) with the prompt passed as an
 * argv element — never interpolated into a shell string — so there is no
 * shell-injection surface regardless of prompt content. Tests inject a fake
 * Spawner; the real `claude` CLI is never invoked in this task's tests. */
export type Spawner = (cmd: string, args: string[], input?: string) => Promise<SpawnResult>

export class ClaudeError extends Error {
  constructor(
    public code: 'TIMEOUT' | 'CLI_ERROR' | 'VALIDATION',
    msg?: string,
  ) {
    super(msg ?? code)
    this.name = 'ClaudeError'
  }
}

export interface ClaudeHeadless {
  /** Raw text result of one `claude -p` call, queued behind any in-flight
   * call (concurrency 1, FIFO). Rejects with ClaudeError('TIMEOUT') if no
   * response within timeoutMs, or ClaudeError('CLI_ERROR') on a non-zero
   * exit / `is_error: true` / unparseable --output-format json stdout. */
  ask(prompt: string): Promise<string>
  /** Like `ask`, but extracts a JSON value from the result text (accepts a
   * bare JSON object, a ```json fenced block, or the first balanced `{...}`
   * substring) and zod-validates it against `schema`. On validation failure
   * it re-asks EXACTLY ONCE with the validation error appended to the
   * prompt; a second failure rejects with ClaudeError('VALIDATION'). */
  askJson<T>(prompt: string, schema: ZodType<T>): Promise<T>
}

const DEFAULT_TIMEOUT_MS = 120_000
const CLI_COMMAND = 'claude'

/** Real Spawner backing `claude -p`. Uses node:child_process `spawn`
 * (argv array, `shell` not set) so the prompt is never parsed by a shell.
 * Not exercised by this task's tests (which all inject a fake Spawner) —
 * exists so `makeClaudeHeadless()` works out of the box against the real
 * CLI (the gated live smoke test in a later task uses this default). */
function createDefaultSpawner(): Spawner {
  return (cmd, args, input) =>
    new Promise((resolve, reject) => {
      const child = spawnProcess(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (err) => reject(err))
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
      if (input !== undefined) {
        child.stdin.write(input)
      }
      child.stdin.end()
    })
}

interface ClaudeCliResult {
  is_error?: boolean
  result?: string
}

/** Parses `claude -p ... --output-format json`'s stdout and returns the
 * text result. Tolerates `{ result: "..." }` (the documented real shape)
 * and a bare JSON string as a fallback. Throws (caller wraps in
 * ClaudeError('CLI_ERROR')) on unparseable JSON, `is_error: true`, or a
 * shape with no usable `.result`. */
function extractResultText(stdout: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`unparseable --output-format json stdout: ${stdout.slice(0, 200)}`)
  }
  if (typeof parsed === 'string') return parsed
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as ClaudeCliResult
    if (obj.is_error) {
      throw new Error(typeof obj.result === 'string' ? obj.result : 'claude cli reported is_error: true')
    }
    if (typeof obj.result === 'string') return obj.result
  }
  throw new Error(`--output-format json stdout had no usable .result: ${stdout.slice(0, 200)}`)
}

function tryJsonParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** Extracts a JSON value from free-form model text: a pure JSON document,
 * a ```json fenced block, or (fallback) the first balanced `{...}`
 * substring found by brace-counting (handles nested objects). Throws if
 * none of the three yield parseable JSON. */
function extractJsonBlock(text: string): unknown {
  const trimmed = text.trim()

  const direct = tryJsonParse(trimmed)
  if (direct.ok) return direct.value

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const fencedParsed = tryJsonParse(fenced[1].trim())
    if (fencedParsed.ok) return fencedParsed.value
  }

  const start = trimmed.indexOf('{')
  if (start !== -1) {
    let depth = 0
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++
      else if (trimmed[i] === '}') {
        depth--
        if (depth === 0) {
          const braced = tryJsonParse(trimmed.slice(start, i + 1))
          if (braced.ok) return braced.value
          break
        }
      }
    }
  }

  throw new Error('no valid JSON object found in response')
}

function tryValidate<T>(text: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown
  try {
    json = extractJsonBlock(text)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const result = schema.safeParse(json)
  if (result.success) return { ok: true, value: result.data }
  return { ok: false, error: result.error.message }
}

/** Races `promise` against `timeoutMs`, rejecting with
 * ClaudeError('TIMEOUT') if the timer fires first. On the real Spawner the
 * underlying `claude` child process is NOT force-killed when this fires
 * (the Spawner seam has no cancellation handle) — it is left to exit on
 * its own in the background; documented as a known limitation, harmless
 * here since flying is never gated on this call. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ClaudeError('TIMEOUT', `claude -p exceeded ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function makeClaudeHeadless(opts?: { spawn?: Spawner; timeoutMs?: number }): ClaudeHeadless {
  const spawner = opts?.spawn ?? createDefaultSpawner()
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // FIFO, concurrency-1 queue. `tail` is a promise that settles once the
  // previously-queued task has settled (success OR failure — the
  // ok/ok-shaped .then below intentionally swallows rejection so one
  // failed call never wedges the queue for everything queued after it).
  // A new task is chained off `tail`, so it cannot start running until the
  // prior task has fully settled — that's the concurrency-1 guarantee.
  let tail: Promise<void> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function runOnce(prompt: string): Promise<string> {
    const result = await withTimeout(spawner(CLI_COMMAND, ['-p', prompt, '--output-format', 'json']), timeoutMs)
    if (result.code !== 0) {
      throw new ClaudeError('CLI_ERROR', result.stderr || `claude exited with code ${result.code}`)
    }
    try {
      return extractResultText(result.stdout)
    } catch (err) {
      throw new ClaudeError('CLI_ERROR', err instanceof Error ? err.message : String(err))
    }
  }

  async function ask(prompt: string): Promise<string> {
    return enqueue(() => runOnce(prompt))
  }

  async function askJson<T>(prompt: string, schema: ZodType<T>): Promise<T> {
    const first = await ask(prompt)
    const firstAttempt = tryValidate(first, schema)
    if (firstAttempt.ok) return firstAttempt.value

    const retryPrompt = `${prompt}\n\nYour previous output failed validation: ${firstAttempt.error}. Return ONLY valid JSON matching the schema.`
    const second = await ask(retryPrompt)
    const secondAttempt = tryValidate(second, schema)
    if (secondAttempt.ok) return secondAttempt.value

    throw new ClaudeError('VALIDATION', `askJson failed after one retry: ${secondAttempt.error}`)
  }

  return { ask, askJson }
}
