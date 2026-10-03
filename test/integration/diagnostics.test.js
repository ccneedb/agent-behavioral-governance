/**
 * Integration test: §34.1 **B2** — does `ctx.systemPrompt.context({name, order,
 * text})` accept a *non-enumerated finite* order and render into the assembled
 * prompt?
 *
 * B2 is the open assumption behind ARCHITECTURE-SPEC §28.3 channel A: the IEG
 * status line is only adopted if the runtime-context channel can carry it.
 * The test therefore mounts the **real** `@deepseek-ai/dsh-system-prompt`
 * registry and observes, rather than mocks, the host's own `context()`,
 * `assemble()`, and rendering code.
 *
 * Observed on `@deepseek-ai/dsh-system-prompt` 0.2.1-alpha.1 (the same seam IEG
 * declares in `lib/contract.d.ts`):
 *
 * - `context()` accepts **any finite `order`**, enumerated or not; only
 *   non-finite orders (`NaN`, `Infinity`) throw a `TypeError`.
 * - `8500` is non-enumerated: `getContextOrder('ieg:status')` is `undefined`
 *   (the host's `CONTEXT_ORDERS` knows only `SANDBOX_POLICY`, `APPROVAL_POLICY`,
 *   `SUBAGENT_DELEGATION`), yet the context registers and renders.
 * - The contribution appears in `assembly.contexts` and in the model-facing
 *   snapshot `renderContextSnapshot(assembly)`; it does **not** appear in
 *   `renderPrompt(assembly)`, which compiles *sections* only. Channel A
 *   therefore reaches the model through the runtime-context snapshot, not
 *   through the system-prompt text.
 * - Repeated snapshots do **not** accumulate: registration is keyed by name, a
 *   duplicate name in the same layer throws, and repeated `assemble()` calls
 *   with no intervening registration return an identical, single-entry
 *   snapshot. A function-valued `text` is re-evaluated per assembly, which is
 *   how one registration can track changing state without re-registering.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dshAvailable, loadCordis, loadSystemPrompt, dshVersion } from '../../test-support/dsh.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

/**
 * Boot the real prompt registry alone: B2 is entirely a system-prompt question,
 * so no other service is involved.
 *
 * @returns {Promise<{ ctx: any, renderPrompt: any, renderContextSnapshot: any, renderContextSections: any }>}
 */
async function bootSystemPrompt() {
  const { Context } = await loadCordis()
  const systemPrompt = await loadSystemPrompt()

  const ctx = new Context()
  await ctx.plugin(systemPrompt.default, { personaPrefix: '' })

  return {
    ctx,
    renderPrompt: systemPrompt.renderPrompt,
    renderContextSnapshot: systemPrompt.renderContextSnapshot,
    renderContextSections: systemPrompt.renderContextSections,
  }
}

test(`integration (B2): a non-enumerated finite order registers and renders (DSH ${dshVersion()})`, { skip }, async () => {
  const { ctx, renderPrompt, renderContextSnapshot } = await bootSystemPrompt()

  // `8500` is deliberately not one of the host's enumerated context orders.
  assert.equal(ctx.systemPrompt.getContextOrder('SANDBOX_POLICY'), 110, 'enumerated orders exist')
  assert.equal(
    ctx.systemPrompt.getContextOrder('ieg:status'),
    undefined,
    'ieg:status must be non-enumerated for this test to mean anything',
  )

  const text = 'ieg: diagnostics=3 last=ieg.mount warnings=0'
  assert.doesNotThrow(() => {
    ctx.systemPrompt.context({ name: 'ieg:status', order: 8500, text })
  })

  const assembly = await ctx.systemPrompt.assemble({})
  const entry = assembly.contexts.find((candidate) => candidate.name === 'ieg:status')
  assert.ok(entry, `ieg:status must be in assembly.contexts: ${JSON.stringify(assembly.contexts)}`)
  assert.equal(entry.text, text)

  const snapshot = renderContextSnapshot(assembly)
  assert.match(snapshot, /Current runtime context\. This snapshot supersedes earlier runtime-context snapshots\./)
  assert.ok(snapshot.includes(text), 'the status line must render into the runtime-context snapshot')

  // Channel A reaches the model through the context snapshot, not through the
  // compiled system-prompt sections. Recorded here because it changes how the
  // status line is expected to surface.
  assert.ok(!renderPrompt(assembly).includes(text), 'contexts are not part of renderPrompt section compilation')
})

test('integration (B2): any finite order is tolerated; non-finite orders throw', { skip }, async () => {
  const { ctx } = await bootSystemPrompt()

  for (const order of [-1, 0, 0.5, 1e9, Number.MAX_SAFE_INTEGER, 8500, 8500.25]) {
    assert.doesNotThrow(() => {
      ctx.systemPrompt.context({ name: `ieg:finite:${order}`, order, text: `finite ${order}` })
    }, `finite order ${order} must be accepted`)
  }

  const assembly = await ctx.systemPrompt.assemble({})
  const names = assembly.contexts.map((candidate) => candidate.name)
  for (const order of [-1, 0, 0.5, 1e9, Number.MAX_SAFE_INTEGER, 8500, 8500.25]) {
    assert.ok(names.includes(`ieg:finite:${order}`), `finite order ${order} must render`)
  }

  assert.throws(() => ctx.systemPrompt.context({ name: 'ieg:nan', order: Number.NaN, text: 'x' }), TypeError)
  assert.throws(() => ctx.systemPrompt.context({ name: 'ieg:inf', order: Number.POSITIVE_INFINITY, text: 'x' }), TypeError)
  assert.throws(
    () => ctx.systemPrompt.context({ name: 'ieg:neg-inf', order: Number.NEGATIVE_INFINITY, text: 'x' }),
    /finite number/,
  )
})

test('integration (B2): contexts are ordered ascending by order, stably for ties', { skip }, async () => {
  const { ctx } = await bootSystemPrompt()
  ctx.systemPrompt.context({ name: 'ieg:late', order: 8500, text: 'late' })
  ctx.systemPrompt.context({ name: 'ieg:early', order: 110, text: 'early' })
  ctx.systemPrompt.context({ name: 'ieg:mid', order: 110, text: 'mid' })
  ctx.systemPrompt.context({ name: 'ieg:first', order: -1, text: 'first' })

  const assembly = await ctx.systemPrompt.assemble({})
  assert.deepEqual(
    assembly.contexts.map((candidate) => candidate.name),
    ['ieg:first', 'ieg:early', 'ieg:mid', 'ieg:late'],
  )
})

test('integration (B2): repeated snapshots do not accumulate', { skip }, async () => {
  const { ctx, renderContextSnapshot } = await bootSystemPrompt()
  ctx.systemPrompt.context({ name: 'ieg:status', order: 8500, text: 'ieg: diagnostics=1 last=ieg.mount warnings=0' })

  const first = renderContextSnapshot(await ctx.systemPrompt.assemble({}))
  for (let index = 0; index < 5; index += 1) {
    const assembly = await ctx.systemPrompt.assemble({})
    assert.equal(assembly.contexts.length, 1, 'one registration must stay one entry across snapshots')
    assert.equal(renderContextSnapshot(assembly), first, 'unchanged state must render an identical snapshot')
  }

  // Accumulation is prevented by name: a second registration of the same name
  // in the same layer is rejected, and disposal makes re-registration work.
  assert.throws(() => {
    ctx.systemPrompt.context({ name: 'ieg:status', order: 8500, text: 'duplicate' })
  }, /already registered/)

  const dispose = ctx.systemPrompt.context({ name: 'ieg:reregistered', order: 8500, text: 'one' })
  dispose()
  const replacement = ctx.systemPrompt.context({ name: 'ieg:reregistered', order: 8500, text: 'two' })
  const assembly = await ctx.systemPrompt.assemble({})
  const matching = assembly.contexts.filter((candidate) => candidate.name === 'ieg:reregistered')
  assert.equal(matching.length, 1)
  assert.equal(matching[0].text, 'two')
  replacement()
})

test('integration (B2): a function-valued text tracks state without re-registration', { skip }, async () => {
  const { ctx, renderContextSnapshot } = await bootSystemPrompt()
  let state = 'diagnostics=1'
  ctx.systemPrompt.context({
    name: 'ieg:status',
    order: 8500,
    text: () => `ieg: ${state} last=ieg.mount warnings=0`,
  })

  const first = renderContextSnapshot(await ctx.systemPrompt.assemble({}))
  assert.ok(first.includes('ieg: diagnostics=1 last=ieg.mount warnings=0'))

  state = 'diagnostics=2'
  const second = renderContextSnapshot(await ctx.systemPrompt.assemble({}))
  assert.ok(second.includes('ieg: diagnostics=2 last=ieg.mount warnings=0'))
  assert.equal((await ctx.systemPrompt.assemble({})).contexts.length, 1)
})

test('integration (B2): renderContextSections names contributions and drops empty text', { skip }, async () => {
  const { ctx, renderContextSections } = await bootSystemPrompt()
  ctx.systemPrompt.context({ name: 'ieg:status', order: 8500, text: 'ieg: diagnostics=0 last=none warnings=0' })
  ctx.systemPrompt.context({ name: 'ieg:empty', order: 8501, text: '' })

  const sections = renderContextSections(await ctx.systemPrompt.assemble({}))
  assert.deepEqual(sections, [
    { name: 'ieg:status', text: 'ieg: diagnostics=0 last=none warnings=0' },
  ])
})

test('integration (B2): suppressRuntimeContext() removes the status line without unregistering it', { skip }, async () => {
  const { ctx, renderContextSnapshot } = await bootSystemPrompt()
  const dispose = ctx.systemPrompt.context({ name: 'ieg:status', order: 8500, text: 'ieg: diagnostics=1' })

  assert.ok(renderContextSnapshot(await ctx.systemPrompt.assemble({})).includes('ieg: diagnostics=1'))

  const unsuppress = ctx.systemPrompt.suppressRuntimeContext()
  const suppressed = await ctx.systemPrompt.assemble({})
  assert.deepEqual(suppressed.contexts, [])
  assert.equal(renderContextSnapshot(suppressed), '')

  // The registration is still owned; releasing the suppressor restores it,
  // which is the "behave correctly when the channel renders nothing" case of
  // §28.3 channel A.
  unsuppress()
  assert.ok(renderContextSnapshot(await ctx.systemPrompt.assemble({})).includes('ieg: diagnostics=1'))
  dispose()
})
