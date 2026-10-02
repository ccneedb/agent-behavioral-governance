/**
 * v0.2.0 integration: the observability surface.
 *
 * Proves the two channels the operator actually sees — the bounded runtime
 * context status line (channel A) and the read-only `abg_status` /
 * `abg_questions` tools (channel B) — work against the **real**
 * `dsh-system-prompt` and against the stub composition.
 *
 * The compatibility half of the integration suite lives in
 * `test/integration/compatibility.test.js` and is wired by task-6.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dshAvailable, loadCordis, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import * as abg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

/**
 * A minimal stand-in for the Cordis context that records what ABG registers.
 *
 * @returns {{
 *   ctx: AbgContext,
 *   listeners: Map<string, Array<(...args: any[]) => any>>,
 *   tools: any[],
 *   logs: Array<{ level: string, message: string }>,
 *   mountTools: () => void,
 * }}
 */
function stubContext() {
  /** @type {Map<string, Array<(...args: any[]) => any>>} */
  const listeners = new Map()
  /** @type {any[]} */
  const tools = []
  /** @type {Array<{ level: string, message: string }>} */
  const logs = []
  /** @type {Array<{ services: readonly string[], callback: (ctx: any) => void }>} */
  const injections = []

  const record = (/** @type {string} */ level) => (/** @type {string} */ message) => {
    logs.push({ level, message })
  }

  const ctx = {
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    systemPrompt: { section: () => () => {}, getSectionOrder: () => 500 },
    on: (/** @type {string} */ name, /** @type {any} */ handler) => {
      const existing = listeners.get(name) ?? []
      listeners.set(name, [...existing, handler])
      return () => {}
    },
    get: () => undefined,
    inject: (/** @type {readonly string[]} */ services, /** @type {any} */ callback) => {
      injections.push({ services, callback })
    },
  }

  return {
    ctx,
    listeners,
    tools,
    logs,
    mountTools: () => {
      for (const injection of injections) {
        if (injection.services.includes('tools')) {
          injection.callback({
            tools: {
              guard: () => {},
              register: (/** @type {any} */ definition) => {
                tools.push(definition)
                return () => {}
              },
            },
          })
        }
      }
    },
  }
}

const agentA = { id: 'agent-a', session: { id: 'session-a' } }
const agentB = { id: 'agent-b', session: { id: 'session-b' } }

test('channel B: abg_status reports the mount record, the module set, and the diagnostic ring', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { policy: 'deny' }, preStep: { requireBeforeMutation: false } })
  stub.mountTools()

  const status = stub.tools.find((tool) => tool.name === 'abg_status')
  assert.ok(status, 'abg_status must be registered')

  const before = await status.execute({}, { agent: agentA })
  assert.equal(before.mount.mounted, true)
  assert.deepEqual(
    [...before.mount.modules].sort(),
    ['information-integrity', 'project-governance', 'user-attention', 'workspace-governance'],
  )
  assert.equal(before.mount.sectionName, 'abg:governance')
  assert.equal(before.mount.promptVersion, abg.PROMPT_VERSION)
  assert.ok(before.mount.promptBytes > 0)
  assert.equal(before.compatibility.verdict, 'PENDING')
  assert.match(before.status_line, /^abg: diagnostics=/)

  // A denial is captured by the sink, not only narrated to a logger.
  const handler = stub.listeners.get('tools/pre-execute')[0]
  const decision = await handler({ name: 'write', arguments: { file_path: '/repo/a.md' }, agent: agentA }, async () => ({
    kind: 'allow',
  }))
  assert.equal(decision.kind, 'deny')

  const after = await status.execute({}, { agent: agentA })
  assert.ok(
    after.diagnostics.some((entry) => entry.code === 'abg.workspace_mutation_blocked'),
    'the denial must appear in the diagnostic ring',
  )
  assert.ok(after.diagnostic_counts['abg.workspace_mutation_blocked'] >= 1)
  assert.ok(after.diagnostics.some((entry) => entry.code === 'abg.mount'))
})

test('channel B: abg_questions reports the calling agent ledger without side effects', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { userAttention: { enforceBatchCompleteness: true } })
  stub.mountTools()

  const questionTool = stub.tools.find((tool) => tool.name === 'record_question')
  const questionsTool = stub.tools.find((tool) => tool.name === 'abg_questions')
  assert.ok(questionsTool, 'abg_questions must be registered')

  await questionTool.execute({ id: 'q1', question: 'Which database?', kind: 'deterministic-blocker' }, { agent: agentA })

  const report = await questionsTool.execute({}, { agent: agentA })
  assert.deepEqual(report.blockers, ['q1'])
  assert.equal(report.recommended_batch[0].id, 'q1')
  assert.match(report.guidance, /one ask_user_question call/)

  // A read must not move the ledger's metrics (prepareBatch would have).
  const again = await questionsTool.execute({}, { agent: agentA })
  assert.deepEqual(again.metrics, report.metrics)

  // The ledger is per agent.
  const other = await questionsTool.execute({}, { agent: agentB })
  assert.deepEqual(other.blockers, [])
})

test('channel A: the governance status line rides the runtime-context channel of the real host', { skip }, async () => {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(abg, { diagnostics: true })

  const assembly = await ctx.systemPrompt.assemble({})
  const contextNames = (assembly.contexts ?? []).map((/** @type {{ name: string }} */ entry) => entry.name)
  assert.ok(
    contextNames.includes(abg.STATUS_CONTEXT_NAME),
    `expected ${abg.STATUS_CONTEXT_NAME} among ${contextNames.join(', ') || '(none)'}`,
  )

  // It renders through the runtime-context snapshot, not the compiled prompt.
  const snapshot = systemPromptModule.renderContextSnapshot(assembly)
  assert.match(snapshot, /abg: diagnostics=/)
  const prompt = systemPromptModule.renderPrompt(assembly)
  assert.doesNotMatch(prompt, /abg: diagnostics=/, 'the status line must not enter the compiled system prompt')
})

test('channel A: repeated assemblies do not accumulate status snapshots', { skip }, async () => {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(abg, { diagnostics: true })

  const first = await ctx.systemPrompt.assemble({})
  const second = await ctx.systemPrompt.assemble({})
  const count = (/** @type {any} */ assembly) =>
    (assembly.contexts ?? []).filter((/** @type {{ name: string }} */ entry) => entry.name === abg.STATUS_CONTEXT_NAME).length

  assert.equal(count(first), 1)
  assert.equal(count(second), 1, 'one registration must yield exactly one context entry per assembly')
})

test('compatibility: the composition root observes the real assembly through the waterfall', { skip }, async () => {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await ctx.plugin(abg, {})

  const assembly = await ctx.systemPrompt.assemble({})
  const names = assembly.sections.map((section) => section.name)
  assert.ok(names.includes('harness:identity'), 'the host prompt must survive the observation')
  assert.ok(names.includes(abg.SECTION_NAME), 'ABG must still contribute its own section')

  const result = await ctx.tools.execute({
    callId: 'c-status',
    name: abg.STATUS_TOOL_NAME,
    arguments: {},
    signal: new AbortController().signal,
  })
  assert.equal(result.isError ?? false, false, `abg_status failed: ${JSON.stringify(result).slice(0, 200)}`)

  const report = /** @type {any} */ (result).value
  assert.notEqual(report.compatibility.verdict, 'PENDING', 'the adapter must have observed the real assembly')
  assert.equal(report.compatibility.verdict, 'COMPATIBLE')
  assert.ok(report.compatibility.sectionNames.includes(abg.SECTION_NAME))
  assert.equal(report.mount.moduleCount, 4)
})

test('compatibility: a malformed assembly never throws and never blocks the waterfall', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  const listener = stub.listeners.get('system-prompt/assemble')[0]
  assert.ok(listener, 'the compatibility adapter must bind the assemble waterfall')

  let proceeded = 0
  const next = async () => {
    proceeded += 1
    return { sections: [] }
  }
  const payloads = [undefined, null, 42, 'nope', {}, { sections: 'nope' }, { sections: [{}] }]
  for (const payload of payloads) await listener(payload, undefined, next)

  assert.equal(proceeded, payloads.length, 'every observation must still reach the host waterfall')
})
