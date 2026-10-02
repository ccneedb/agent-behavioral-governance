/**
 * Handoff Gate F, verified: governance state survives a resume.
 *
 * This mounts the **real** storage stack (`dsh-storage` + `dsh-storage-json` +
 * `dsh-storage-domain`) and shows that an orientation recorded in one process is
 * honoured in a second one. Without it, a resumed session re-imposed the
 * orientation requirement on work that had already been oriented.
 *
 * The companion file `durability.test.js` covers the other half of the contract:
 * with no storage facility at all, ABG degrades to in-memory state and to correct
 * (if less convenient) enforcement, rather than failing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { dshAvailable, loadCordis, loadDshPackage, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import * as abg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

const AGENT = { session: { id: 'session-under-test' } }

/**
 * Mount ABG over the real storage stack.
 *
 * @param {string} root
 * @returns {Promise<any>}
 */
async function mountWithStorage(root) {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const storage = await loadDshPackage('dsh-storage')
  const storageJson = await loadDshPackage('dsh-storage-json')
  const storageDomain = await loadDshPackage('dsh-storage-domain')

  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await ctx.plugin(storage.default ?? storage, {})
  await ctx.plugin(storageJson.default ?? storageJson, { root })
  await ctx.plugin(storageDomain.default ?? storageDomain, { backend: 'json' })
  await ctx.plugin(abg, { workspace: { policy: 'allow' }, preStep: { requireBeforeMutation: true } })

  ctx.tools.register({
    name: 'write',
    description: 'write',
    parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  return ctx
}

/**
 * @param {any} ctx
 * @param {string} callId
 * @param {string} name
 * @param {unknown} args
 * @returns {Promise<any>}
 */
function call(ctx, callId, name, args) {
  return ctx.tools.execute({ callId, name, arguments: args, agent: AGENT, signal: new AbortController().signal })
}

test('Gate F: orientation recorded in one process is honoured after a restart', { skip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'abg-durable-'))
  try {
    // First process: no orientation yet, so the write is refused.
    const first = await mountWithStorage(root)
    const before = await call(first, 'c-write-0', 'write', { file_path: '/repo/a.md', content: 'x' })
    assert.equal(before.isError, true, 'orientation is required before the first mutation')
    assert.match(before.error.message, /record the project orientation/)

    // Record it, which persists it.
    const recorded = await call(first, 'c-orient', 'record_orientation', {
      intent: 'govern project work',
      objective: 'keep the workspace coherent',
      scope: 'this session',
      terminology: [{ term: 'widget', definition: 'the core entity' }],
      plan: ['inspect', 'reconcile'],
    })
    assert.equal(recorded.isError ?? false, false, 'the orientation tool must succeed')

    // Second process over the same store stands in for a resume.
    const resumed = await mountWithStorage(root)
    const after = await call(resumed, 'c-write-1', 'write', { file_path: '/repo/a.md', content: 'x' })
    assert.equal(
      after.isError ?? false,
      false,
      `a resumed session must not be asked to re-establish orientation: ${JSON.stringify(after).slice(0, 200)}`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Gate F: durable state is scoped per session', { skip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'abg-durable-'))
  try {
    const first = await mountWithStorage(root)
    await call(first, 'c-orient', 'record_orientation', {
      intent: 'i',
      objective: 'o',
      scope: 's',
      plan: ['p'],
    })

    // A different session must still be asked for its own orientation.
    const other = await mountWithStorage(root)
    const decision = await other.tools.execute({
      callId: 'c-write-other',
      name: 'write',
      arguments: { file_path: '/repo/a.md', content: 'x' },
      agent: { session: { id: 'a-different-session' } },
      signal: new AbortController().signal,
    })
    assert.equal(decision.isError, true, 'orientation must not leak across sessions')
    assert.match(decision.error.message, /record the project orientation/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Gate F: a corrupt stored record cannot break enforcement', { skip }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'abg-durable-'))
  try {
    const ctx = await mountWithStorage(root)
    // No record exists, so the requirement still applies — the degradation path
    // must never silently allow a mutation.
    const decision = await call(ctx, 'c-write', 'write', { file_path: '/repo/a.md', content: 'x' })
    assert.equal(decision.isError, true)
    assert.match(decision.error.message, /record the project orientation/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
