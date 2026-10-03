/**
 * Integration test: mount IEG alongside the **real** `dsh-system-prompt` and
 * `dsh-tools` services and assert the seams actually fire.
 *
 * This is the strongest available verification short of booting a full agent
 * loop, because it uses the host's own assembly and dispatch code rather than
 * mocks. It covers:
 *
 * - the additive prompt section renders and does not replace the host prompt;
 * - the section never sets `complete` (which would make a second one fatal);
 * - `tools/pre-execute` really gates a mutation through the host pipeline;
 * - `ctx.tools.guard` really denies, and cannot be undone by a later allow.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dshAvailable, loadCordis, loadSystemPrompt, loadTools, dshVersion } from '../../test-support/dsh.js'
import * as ieg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

/**
 * Boot a minimal but real composition: the prompt registry, the tool registry,
 * and IEG.
 *
 * @param {unknown} [iegConfig]
 * @returns {Promise<{ ctx: any, SystemPrompt: any, renderPrompt: any }>}
 */
async function bootComposition(iegConfig) {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()

  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await ctx.plugin(ieg, iegConfig)
  return { ctx, SystemPrompt: systemPromptModule.default, renderPrompt: systemPromptModule.renderPrompt }
}

/**
 * Register a trivial tool so the pipeline has something to dispatch.
 *
 * @param {any} ctx
 * @param {string} name
 * @returns {void}
 */
function registerTool(ctx, name) {
  ctx.tools.register({
    name,
    description: name,
    parameters: { type: 'object', properties: { file_path: { type: 'string' }, command: { type: 'string' } } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({ ok: true }),
  })
}

/**
 * Declare orientation through IEG's own tool, dispatched by the **real** tool
 * registry. Used by the tests that exercise the workspace policy, because the
 * orientation requirement deliberately outranks it.
 *
 * @param {any} ctx
 * @returns {Promise<void>}
 */
async function recordOrientation(ctx) {
  const signal = new AbortController().signal
  const result = await ctx.tools.execute({
    callId: 'c-orientation',
    name: 'record_orientation',
    arguments: {
      intent: 'govern project work',
      objective: 'keep the workspace coherent',
      scope: 'this session',
      terminology: [{ term: 'widget', definition: 'the core entity' }],
      plan: ['inspect', 'reconcile', 'verify'],
    },
    signal,
  })
  assert.equal(result.isError ?? false, false, `record_orientation failed: ${JSON.stringify(result).slice(0, 200)}`)
}

test(`integration: IEG mounts against real host services (DSH ${dshVersion()})`, { skip }, async () => {
  const { ctx } = await bootComposition()
  assert.ok(ctx.systemPrompt, 'the real prompt registry is mounted')
  assert.ok(ctx.tools, 'the real tool registry is mounted')
})

test('integration: IEG registers its orientation tool into the real registry', { skip }, async () => {
  const { ctx } = await bootComposition()
  assert.ok(ctx.tools.get('record_orientation'), 'the orientation tool must be discoverable by the agent')
})

test('integration: the real pipeline refuses a mutation until orientation is recorded', { skip }, async () => {
  // The requirement is opt-in (ARCHITECTURE-SPEC §34.2 Q1), so this case states
  // it rather than inheriting it from the default.
  const { ctx } = await bootComposition({
    workspace: { policy: 'allow' },
    preStep: { requireBeforeMutation: true },
  })
  registerTool(ctx, 'write')
  const signal = new AbortController().signal
  const call = (callId) =>
    ctx.tools.execute({ callId, name: 'write', arguments: { file_path: '/repo/x' }, signal })

  // Policy is `allow`, yet the first write is still refused: the requirement is
  // independent of the workspace policy.
  const refused = await call('c-before')
  assert.equal(refused.isError, true)
  assert.match(refused.error.message, /record the project orientation/)

  await recordOrientation(ctx)

  const allowed = await call('c-after')
  assert.equal(allowed.isError ?? false, false, 'after recording, the policy governs')
})

test('integration: the IEG section renders, additively, and never replaces the host prompt', { skip }, async () => {
  const { ctx, renderPrompt } = await bootComposition()
  const assembly = await ctx.systemPrompt.assemble({})

  const names = assembly.sections.map((section) => section.name)
  assert.ok(names.includes(ieg.SECTION_NAME), `expected ${ieg.SECTION_NAME} in ${names.join(', ')}`)

  // The host's own identity section must survive: IEG is additive, so it must
  // never set `complete`, which would restore one section as the sole prompt.
  assert.ok(names.includes('harness:identity'), 'the host harness identity section must remain')

  const rendered = renderPrompt(assembly)
  assert.match(rendered, /Information Environment Governance \(IEG\)/)
  assert.match(rendered, /### project-governance/)
  assert.match(rendered, /### workspace-governance/)

  // Governance text is literal, so no `{{ }}` may survive into the prompt.
  assert.doesNotMatch(rendered, /\{\{|\}\}/)
})

test('integration: the section order is the configured finite number', { skip }, async () => {
  const { ctx } = await bootComposition({ sectionOrder: 8500 })
  const assembly = await ctx.systemPrompt.assemble({})
  const section = assembly.sections.find((candidate) => candidate.name === ieg.SECTION_NAME)
  assert.ok(section)
  // Sections arrive in ascending order; IEG sits after the host's persona prefix.
  const order = assembly.sections.map((candidate) => candidate.name)
  assert.ok(order.indexOf('deployment:persona-prefix') < order.indexOf(ieg.SECTION_NAME))
  assert.ok(order.indexOf(ieg.SECTION_NAME) < order.indexOf('deployment:persona-suffix'))
})

test('integration: a second complete section is fatal, which is why IEG never sets one', { skip }, async () => {
  const { ctx } = await bootComposition()
  // Prove the host really does fail on two effective complete sections, so the
  // "never set complete" rule is a correctness requirement and not a style note.
  ctx.systemPrompt.section({ name: 'rogue:a', order: 1, text: 'A', complete: true })
  ctx.systemPrompt.section({ name: 'rogue:b', order: 2, text: 'B', complete: true })
  await assert.rejects(() => ctx.systemPrompt.assemble({}))
})

test('integration: the host tool pipeline enforces the IEG mutation gate', { skip }, async () => {
  const { ctx } = await bootComposition({ workspace: { policy: 'deny', protectedPaths: ['/repo/secrets'] } })
  for (const name of ['read', 'write', 'edit']) registerTool(ctx, name)

  const signal = new AbortController().signal
  const call = (name, args) => ctx.tools.execute({ callId: `c-${name}-${Math.random()}`, name, arguments: args, signal })

  // Read-only inspection passes untouched.
  const read = await call('read', { file_path: '/repo/src/index.ts' })
  assert.equal(read.isError ?? false, false)

  // Orientation is recorded first, because its requirement outranks the policy
  // and this test isolates the policy path.
  await recordOrientation(ctx)

  // A persistent mutation is refused, with the IEG reason surfaced to the model.
  const write = await call('write', { file_path: '/repo/src/new.ts' })
  assert.equal(write.isError, true)
  assert.match(write.error.message, /ieg:/)

  // A protected target is refused even though the same policy would gate others.
  const protectedWrite = await call('write', { file_path: '/repo/secrets/key.pem' })
  assert.equal(protectedWrite.isError, true)
  assert.match(protectedWrite.error.message, /protected path/)
})

test('integration: with the ask policy the host resolves the decision itself', { skip }, async () => {
  // `ask` is what the tool registry passes to ctx.approval. Here no approval
  // service is mounted, and the host documents that a missing approval channel
  // degrades `ask` to denial — which is the fail-closed behaviour IEG relies on.
  const { ctx } = await bootComposition({ workspace: { policy: 'ask' } })
  registerTool(ctx, 'write')
  await recordOrientation(ctx)

  const signal = new AbortController().signal
  const result = await ctx.tools.execute({
    callId: 'c-ask',
    name: 'write',
    arguments: { file_path: '/repo/src/x.ts' },
    signal,
  })
  assert.equal(result.isError, true, 'ask without an approval channel must fail closed')
})

test('integration: the monotonic guard denies a protected mutation the gate would allow', { skip }, async () => {
  // policy `allow` means the pre-execute gate admits everything, so only the
  // guard can stop a protected write — proving the backstop is independent.
  const { ctx } = await bootComposition({
    workspace: { policy: 'allow', mutatingTools: ['write'], protectedPaths: ['/repo/secrets'] },
  })
  registerTool(ctx, 'write')
  await recordOrientation(ctx)

  const signal = new AbortController().signal
  const allowed = await ctx.tools.execute({
    callId: 'c-guard-ok',
    name: 'write',
    arguments: { file_path: '/repo/src/ok.ts' },
    signal,
  })
  assert.equal(allowed.isError ?? false, false)

  const denied = await ctx.tools.execute({
    callId: 'c-guard-deny',
    name: 'write',
    arguments: { file_path: '/repo/secrets/key.pem' },
    signal,
  })
  assert.equal(denied.isError, true)
  assert.match(denied.error.message, /protected path/)
})

test('integration: disabling IEG leaves the host prompt intact', { skip }, async () => {
  const { ctx, renderPrompt } = await bootComposition({ enabled: false })
  const assembly = await ctx.systemPrompt.assemble({})
  assert.ok(assembly.sections.some((section) => section.name === 'harness:identity'))
  assert.doesNotMatch(renderPrompt(assembly), /Information Environment Governance \(IEG\)/)
})

test('integration: a disabled module disappears from the live prompt', { skip }, async () => {
  const { ctx, renderPrompt } = await bootComposition({ modules: { 'workspace-governance': { enabled: false } } })
  const rendered = renderPrompt(await ctx.systemPrompt.assemble({}))
  assert.match(rendered, /### project-governance/)
  assert.doesNotMatch(rendered, /### workspace-governance/)
})
