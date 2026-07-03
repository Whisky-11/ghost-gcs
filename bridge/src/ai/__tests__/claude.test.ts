import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { makeClaudeHeadless, ClaudeError, type Spawner, type SpawnResult } from '../claude.js'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Builds a SpawnResult mimicking the real `claude -p --output-format
 * json` shape, confirmed live: {type:"result",subtype:"success",
 * is_error:false,...,result:"<text>"}. */
function okResult(text: string): SpawnResult {
  return {
    code: 0,
    stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text }),
    stderr: '',
  }
}

describe('makeClaudeHeadless', () => {
  describe('ask', () => {
    it('returns the .result text from a successful spawn', async () => {
      const spawn: Spawner = async () => okResult('hello world')
      const claude = makeClaudeHeadless({ spawn })
      await expect(claude.ask('hi')).resolves.toBe('hello world')
    })

    it('tolerates a bare JSON string as stdout (documented fallback shape)', async () => {
      const spawn: Spawner = async () => ({ code: 0, stdout: JSON.stringify('bare text result'), stderr: '' })
      const claude = makeClaudeHeadless({ spawn })
      await expect(claude.ask('hi')).resolves.toBe('bare text result')
    })

    it('passes the prompt as an argv element, not a shell string', async () => {
      let seenCmd = ''
      let seenArgs: string[] = []
      const spawn: Spawner = async (cmd, args) => {
        seenCmd = cmd
        seenArgs = args
        return okResult('ok')
      }
      const claude = makeClaudeHeadless({ spawn })
      await claude.ask('some "quoted" & risky $(prompt)')
      expect(seenCmd).toBe('claude')
      expect(seenArgs).toEqual(['-p', 'some "quoted" & risky $(prompt)', '--output-format', 'json'])
    })

    it('rejects with ClaudeError CLI_ERROR on non-zero exit', async () => {
      const spawn: Spawner = async () => ({ code: 1, stdout: '', stderr: 'boom: claude not logged in' })
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.ask('hi').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('CLI_ERROR')
      expect((err as ClaudeError).message).toContain('not logged in')
    })

    it('rejects with ClaudeError CLI_ERROR when is_error is true even on exit 0', async () => {
      const spawn: Spawner = async () => ({
        code: 0,
        stdout: JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'gave up' }),
        stderr: '',
      })
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.ask('hi').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('CLI_ERROR')
    })

    it('rejects with ClaudeError CLI_ERROR on unparseable stdout', async () => {
      const spawn: Spawner = async () => ({ code: 0, stdout: 'not json at all', stderr: '' })
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.ask('hi').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('CLI_ERROR')
    })

    it('rejects with ClaudeError TIMEOUT when the spawn never resolves within timeoutMs', async () => {
      const spawn: Spawner = () => new Promise(() => {}) // never settles
      const claude = makeClaudeHeadless({ spawn, timeoutMs: 20 })
      const err = await claude.ask('hi').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('TIMEOUT')
    })

    it('never throws synchronously — always returns a Promise, even for a spawner that throws synchronously', () => {
      const spawn: Spawner = () => {
        throw new Error('sync boom')
      }
      const claude = makeClaudeHeadless({ spawn })
      let result: Promise<string> | undefined
      expect(() => {
        result = claude.ask('hi')
      }).not.toThrow()
      // swallow the (expected) rejection — this test only asserts the call
      // itself never throws synchronously.
      result?.catch(() => {})
    })

    it('serializes two concurrent asks via a FIFO, concurrency-1 queue', async () => {
      const calls: string[] = []
      let callCount = 0
      const d1 = deferred<SpawnResult>()
      const d2 = deferred<SpawnResult>()
      const spawn: Spawner = async () => {
        callCount++
        if (callCount === 1) {
          calls.push('start-1')
          return d1.promise
        }
        calls.push('start-2')
        return d2.promise
      }
      const claude = makeClaudeHeadless({ spawn })

      const p1 = claude.ask('first').then((r) => {
        calls.push('resolve-1')
        return r
      })
      const p2 = claude.ask('second').then((r) => {
        calls.push('resolve-2')
        return r
      })

      await tick()
      // second ask must NOT have spawned yet — it's queued behind the first.
      expect(calls).toEqual(['start-1'])
      expect(callCount).toBe(1)

      d1.resolve(okResult('one'))
      await p1
      await tick()
      // 'resolve-1' vs 'start-2' relative order is a microtask-scheduling
      // detail, not part of the contract — what matters (already asserted
      // above) is that start-2 never fires before d1 settles. Just confirm
      // both have now happened, in a queue-consistent order.
      expect(calls).toContain('resolve-1')
      expect(calls).toContain('start-2')
      expect(calls.indexOf('start-2')).toBeGreaterThan(calls.indexOf('start-1'))

      d2.resolve(okResult('two'))
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBe('one')
      expect(r2).toBe('two')
      expect(calls).toContain('resolve-2')
      expect(calls.indexOf('resolve-2')).toBeGreaterThan(calls.indexOf('start-2'))
    })

    it('keeps serving the queue after an earlier call fails', async () => {
      let callCount = 0
      const spawn: Spawner = async () => {
        callCount++
        if (callCount === 1) return { code: 1, stdout: '', stderr: 'first fails' }
        return okResult('second succeeds')
      }
      const claude = makeClaudeHeadless({ spawn })
      const p1 = claude.ask('first').catch((e: unknown) => e)
      const p2 = claude.ask('second')
      const [e1, r2] = await Promise.all([p1, p2])
      expect(e1).toBeInstanceOf(ClaudeError)
      expect(r2).toBe('second succeeds')
    })
  })

  describe('askJson', () => {
    const schema = z.object({ items: z.array(z.number()) })

    it('parses and validates a direct JSON result on the first attempt', async () => {
      const spawn: Spawner = async () => okResult(JSON.stringify({ items: [1, 2, 3] }))
      const claude = makeClaudeHeadless({ spawn })
      await expect(claude.askJson('give me items', schema)).resolves.toEqual({ items: [1, 2, 3] })
    })

    it('extracts JSON from a ```json fenced block', async () => {
      const spawn: Spawner = async () =>
        okResult('Sure, here you go:\n```json\n{"items": [4, 5]}\n```\nHope that helps!')
      const claude = makeClaudeHeadless({ spawn })
      await expect(claude.askJson('give me items', schema)).resolves.toEqual({ items: [4, 5] })
    })

    it('extracts the first balanced {...} block from prose', async () => {
      const spawn: Spawner = async () => okResult('here is the object: {"items": [7]} — done')
      const claude = makeClaudeHeadless({ spawn })
      await expect(claude.askJson('give me items', schema)).resolves.toEqual({ items: [7] })
    })

    it('retries exactly once on validation failure, appending the error, and succeeds on the second attempt', async () => {
      let call = 0
      const prompts: string[] = []
      const spawn: Spawner = async (_cmd, args) => {
        call++
        prompts.push(args[1])
        if (call === 1) return okResult(JSON.stringify({ items: ['not-a-number'] }))
        return okResult(JSON.stringify({ items: [1, 2] }))
      }
      const claude = makeClaudeHeadless({ spawn })
      const result = await claude.askJson('give me items', schema)
      expect(result).toEqual({ items: [1, 2] })
      expect(call).toBe(2)
      expect(prompts[1]).toContain('give me items')
      expect(prompts[1]).toContain('failed validation')
      expect(prompts[1]).toContain('Return ONLY valid JSON matching the schema')
    })

    it('rejects with ClaudeError VALIDATION when the retry also fails schema validation', async () => {
      const spawn: Spawner = async () => okResult(JSON.stringify({ items: ['bad', 'still-bad'] }))
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.askJson('give me items', schema).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('VALIDATION')
    })

    it('rejects with ClaudeError VALIDATION when the retry response has no JSON at all', async () => {
      let call = 0
      const spawn: Spawner = async () => {
        call++
        if (call === 1) return okResult('not json, sorry')
        return okResult('still not json')
      }
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.askJson('give me items', schema).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('VALIDATION')
      expect(call).toBe(2)
    })

    it('propagates a non-VALIDATION ClaudeError (e.g. CLI_ERROR) without retrying', async () => {
      let call = 0
      const spawn: Spawner = async () => {
        call++
        return { code: 1, stdout: '', stderr: 'cli exploded' }
      }
      const claude = makeClaudeHeadless({ spawn })
      const err = await claude.askJson('give me items', schema).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ClaudeError)
      expect((err as ClaudeError).code).toBe('CLI_ERROR')
      expect(call).toBe(1)
    })
  })
})
