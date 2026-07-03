// GATED real-CLI smoke test (P1 Task 11). This is the ONLY test in the
// entire suite that spawns the real `claude` binary — every other AI test
// (claude.test.ts, features.test.ts) injects a fake Spawner and never
// touches the network or the local CLI, per the plan's Global Constraints
// ("Tests NEVER call the real `claude` CLI ... At most ONE live headless
// smoke call in the final task, gated + documented").
//
// Skipped unless GHOST_AI_SMOKE=1 is set, so:
//   - `pnpm --filter bridge test` (no env) does NOT run it — vitest reports
//     it "skipped", zero real CLI calls, zero added latency to CI/local runs.
//   - `GHOST_AI_SMOKE=1 pnpm --filter bridge test claude.smoke` runs it for
//     real: spawns `claude -p "<prompt>" --output-format json` (via
//     makeClaudeHeadless's default Spawner — no injected fake here, that's
//     the whole point), parses `.result`, and zod-validates a trivial
//     `{ answer: string }` schema — proving the real CLI + json + zod path
//     end to end, exactly as `bridge/src/ai/claude.ts`'s header comment
//     documents happened live during Task 5.
//
// Requires: the `claude` CLI on PATH and logged in (Ahmad's Claude Max
// plan — no API key). If the CLI isn't logged in, this test fails with a
// ClaudeError('CLI_ERROR') containing the CLI's stderr; that failure is
// informative on its own (it's gated, so it never blocks a normal run).
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { makeClaudeHeadless } from '../claude.js'

const RUN_SMOKE = process.env.GHOST_AI_SMOKE === '1'

describe('ClaudeHeadless real-CLI smoke (GATED, GHOST_AI_SMOKE=1 only)', () => {
  it.skipIf(!RUN_SMOKE)(
    'askJson performs one real `claude -p` call and validates a trivial schema',
    async () => {
      const claude = makeClaudeHeadless({ timeoutMs: 120_000 })
      const schema = z.object({ answer: z.string() })
      const result = await claude.askJson(
        'Reply with ONLY a JSON object of the exact shape {"answer": "<one word>"} — no prose, no markdown fence. ' +
          'The one word must be the color of a cloudless daytime sky.',
        schema,
      )
      expect(typeof result.answer).toBe('string')
      expect(result.answer.length).toBeGreaterThan(0)
      // eslint-disable-next-line no-console
      console.log('[claude.smoke] real CLI askJson result:', JSON.stringify(result))
    },
    150_000,
  )
})
