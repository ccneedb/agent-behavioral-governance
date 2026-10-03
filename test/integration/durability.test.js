/**
 * Handoff Gate F: "Compaction, resume, fork, and relevant lifecycle transitions
 * preserve governance state correctly."
 *
 * This file verifies the **degradation** half of the contract: IEG's in-process
 * state is created inside `apply()`, and here **no storage facility is mounted**,
 * so `ctx.storageDomain` is absent and the durability layer falls back to no
 * persistence by design. A session resumed in a new process therefore begins with
 * empty ledgers, and with `requireBeforeMutation: true` its first write is refused
 * until orientation is recorded again. That is the accepted fail-open behaviour —
 * enforcement continues correctly, only less conveniently — and it is what makes
 * the durable path necessary.
 *
 * `durability-storage.test.js` mounts the **real** storage stack and verifies the
 * required behaviour (orientation survives a resume, is scoped per session, and
 * cannot be corrupted into allowing a mutation). This file must not restate that
 * assertion: in a composition with no storage there is nothing for state to
 * survive in, so the assertion belongs to the file that mounts a store.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dshAvailable, loadCordis, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import * as ieg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

/**
 * Mount a fresh IEG instance, as a resumed session would.
 *
 * @returns {Promise<any>}
 */
async function mountFresh() {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await ctx.plugin(ieg, { workspace: { policy: 'allow' }, preStep: { requireBeforeMutation: true } })
  ctx.tools.register({
    name: 'write',
    description: 'write',
    parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  return ctx
}

test('Gate F (no storage): a fresh process has no memory of orientation, which is the accepted degradation', { skip }, async () => {
  const first = await mountFresh()
  const signal = new AbortController().signal
  await first.tools.execute({
    callId: 'c-orient',
    name: 'record_orientation',
    arguments: { intent: 'i', objective: 'o', scope: 's' },
    signal,
  })
  const allowed = await first.tools.execute({
    callId: 'c-write-1',
    name: 'write',
    arguments: { file_path: '/repo/a.md', content: 'x' },
    signal,
  })
  assert.equal(allowed.isError ?? false, false, 'orientation was recorded, so the write proceeds')

  // A second mount stands in for the same session resumed in a new process.
  const resumed = await mountFresh()
  const afterResume = await resumed.tools.execute({
    callId: 'c-write-2',
    name: 'write',
    arguments: { file_path: '/repo/a.md', content: 'x' },
    signal,
  })
  assert.equal(
    afterResume.isError,
    true,
    'with no store, the resumed process refuses the write: enforcement degrades safely rather than silently allowing it',
  )
  assert.match(afterResume.error.message, /record the project orientation/)
})
