/**
 * Wiring test: mount ABG on a stub Cordis context and assert it binds to the
 * correct verified event names with the correct decision shapes.
 *
 * `agent/pre-step` is dispatched by the agent loop, which needs a full
 * session/LLM composition to exercise end to end. This test therefore verifies
 * the *wiring and decision logic* — the right event, the right handler arity,
 * the right return shape — and leaves live dispatch to the composition test and
 * the profile load test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as abg from '../../lib/index.js'

/**
 * A minimal stand-in for the Cordis context that records what ABG registers.
 *
 * @returns {{
 *   ctx: AbgContext,
 *   listeners: Map<string, Array<(...args: any[]) => any>>,
 *   sections: any[],
 *   injections: Array<{ services: readonly string[], callback: (ctx: any) => void }>,
 *   guards: Array<(execution: any) => string | undefined>,
 *   logs: Array<{ level: string, message: string }>,
 *   effects: Array<{ action: () => (() => void) | void, label?: string }>,
 * }}
 */
function stubContext() {
  /** @type {Map<string, Array<(...args: any[]) => any>>} */
  const listeners = new Map()
  /** @type {any[]} */
  const sections = []
  /** @type {Array<{ services: readonly string[], callback: (ctx: any) => void }>} */
  const injections = []
  /** @type {Array<(execution: any) => string | undefined>} */
  const guards = []
  /** @type {Array<any>} */
  const tools = []
  /** @type {Array<{ level: string, message: string }>} */
  const logs = []
  /** @type {Array<{ action: () => (() => void) | void, label?: string }>} */
  const effects = []
  /** @type {Array<{ kind: string, path: string, handler: (req: unknown, res: any) => unknown }>} */
  const routes = []

  /** @param {string} level */
  const record = (level) => (/** @type {string} */ message) => {
    logs.push({ level, message })
  }

  const ctx = {
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    systemPrompt: {
      section: (/** @type {any} */ section) => {
        sections.push(section)
        return () => {}
      },
      getSectionOrder: () => 500,
    },
    on: (/** @type {string} */ name, /** @type {any} */ handler) => {
      const existing = listeners.get(name) ?? []
      listeners.set(name, [...existing, handler])
      return () => {}
    },
    get: () => undefined,
    inject: (/** @type {readonly string[]} */ services, /** @type {any} */ callback) => {
      injections.push({ services, callback })
    },
    effect: (/** @type {any} */ action, /** @type {string} */ label) => {
      effects.push({ action, label })
      return () => {}
    },
  }

  return {
    ctx,
    listeners,
    sections,
    injections,
    guards,
    tools,
    logs,
    effects,
    routes,
    /** Simulate the tool registry becoming available. */
    mountTools: () => {
      for (const injection of injections) {
        if (injection.services.includes('tools')) {
          injection.callback({
            tools: {
              guard: (/** @type {any} */ guard) => guards.push(guard),
              register: (/** @type {any} */ definition) => {
                tools.push(definition)
                return () => {}
              },
            },
          })
        }
      }
    },
    /** Simulate the web server becoming available (the Web GUI composition). */
    mountWebserver: () => {
      for (const injection of injections) {
        if (injection.services.includes('webServer')) {
          injection.callback({
            webServer: {
              register: (/** @type {any} */ route) => {
                routes.push(route)
                return () => {}
              },
            },
          })
        }
      }
    },
    /** Record orientation through the tool ABG registered, as an agent would. */
    recordOrientation: async () => {
      const tool = tools.find((candidate) => candidate.name === 'record_orientation')
      if (tool === undefined) throw new Error('ABG did not register the orientation tool')
      return tool.execute({ intent: 'i', objective: 'o', scope: 's', terminology: [{ term: 't', definition: 'd' }], plan: ['step'] })
    },
  }
}

test('ABG registers exactly one additive prompt section', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})

  assert.equal(stub.sections.length, 1, 'exactly one section: the composition pattern depends on it')
  const section = stub.sections[0]
  assert.equal(section.name, abg.SECTION_NAME)
  assert.equal(section.order, 8500)
  assert.equal(section.interpolate, false, 'governance text is literal')
  assert.equal(section.complete, undefined, 'complete would replace the host prompt')
  assert.equal(typeof section.text, 'function')
  assert.match(section.text({}), /Agent Behavioral Governance \(ABG\)/)
})

test('ABG binds to the verified event names only', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  assert.deepEqual(
    [...stub.listeners.keys()].sort(),
    ['agent/pre-step', 'system-prompt/assemble', 'tools/pre-execute'],
  )
  for (const handlers of stub.listeners.values()) assert.equal(handlers.length, 1)
})

test('ABG requests the tool registry through ctx.inject, not eagerly', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { protectedPaths: ['/repo/secrets'] } })

  assert.deepEqual(
    stub.injections.map((injection) => injection.services.join(',')).sort(),
    ['tools', 'webServer'],
    'every optional service is requested through ctx.inject, never read eagerly',
  )
  assert.equal(stub.guards.length, 0, 'no guard before the registry exists')
  assert.equal(stub.tools.length, 0, 'no tool before the registry exists')

  stub.mountTools()
  assert.equal(stub.guards.length, 1, 'the guard attaches once the registry is available')
  assert.match(String(stub.guards[0]({ name: 'write', arguments: { file_path: '/repo/secrets/k' } })), /protected path/)
  assert.deepEqual(
    stub.tools.map((tool) => tool.name).sort(),
    ['abg_questions', 'abg_report_issue', 'abg_status', 'record_orientation', 'record_question'],
    'ABG registers exactly its own five tools: two capture tools and three read-only surfaces',
  )
})

test('criterion #3: batching is backed by ledger state, not prose', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { userAttention: { enforceBatchCompleteness: true } })
  stub.mountTools()

  const handler = stub.listeners.get('tools/pre-execute')[0]
  const allow = async () => ({ kind: 'allow' })
  const questionTool = stub.tools.find((tool) => tool.name === 'record_question')

  // With nothing registered, any batch is accepted.
  const free = await handler({ name: 'ask_user_question', arguments: { questions: [{ id: 'a' }] } }, allow)
  assert.equal(free.kind, 'allow')

  // Register two blockers.
  await questionTool.execute({ id: 'q1', question: 'Which database?', kind: 'deterministic-blocker' })
  await questionTool.execute({ id: 'q2', question: 'Which region?', kind: 'deterministic-blocker' })

  // A batch that omits them is refused, and the refusal names them.
  const refused = await handler({ name: 'ask_user_question', arguments: { questions: [{ id: 'z' }] } }, allow)
  assert.equal(refused.kind, 'deny')
  assert.match(refused.reason, /omits 2 registered question/)
  assert.match(refused.reason, /q1/)
  assert.match(refused.reason, /q2/)
  assert.ok(stub.logs.some((entry) => entry.message.includes('question_batch_blocked')))

  // A batch carrying both is accepted, and retires them.
  const complete = await handler(
    { name: 'ask_user_question', arguments: { questions: [{ id: 'q1' }, { id: 'q2' }] } },
    allow,
  )
  assert.equal(complete.kind, 'allow')

  // Nothing is owed any more, so a later batch is free again.
  const after = await handler({ name: 'ask_user_question', arguments: { questions: [{ id: 'later' }] } }, allow)
  assert.equal(after.kind, 'allow')
})

test('criterion #3: the completeness rule can be disabled', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { userAttention: { enforceBatchCompleteness: false } })
  stub.mountTools()
  const questionTool = stub.tools.find((tool) => tool.name === 'record_question')
  await questionTool.execute({ id: 'q1', question: 'Which database?', kind: 'deterministic-blocker' })

  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'ask_user_question', arguments: { questions: [{ id: 'other' }] } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'allow')
})

test('criterion #3: a deferred question does not block a batch', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { userAttention: { enforceBatchCompleteness: true } })
  stub.mountTools()
  const questionTool = stub.tools.find((tool) => tool.name === 'record_question')
  // Non-blocking uncertainty is deferred rather than asked (PR-05).
  await questionTool.execute({ id: 'n1', question: 'Which font?', kind: 'non-blocking-uncertainty' })

  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'ask_user_question', arguments: { questions: [{ id: 'real' }] } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'allow')
})

test('the orientation requirement refuses the first mutation until orientation is recorded', async () => {
  const stub = stubContext()
  // The requirement is opt-in (ARCHITECTURE-SPEC §34.2 Q1), so this case states
  // it rather than inheriting it from the default.
  abg.apply(stub.ctx, { workspace: { policy: 'allow' }, preStep: { requireBeforeMutation: true } })
  stub.mountTools()

  const handler = stub.listeners.get('tools/pre-execute')[0]
  let proceeded = 0
  const next = async () => {
    proceeded += 1
    return { kind: 'allow' }
  }

  // A write is refused outright, even though the workspace policy is `allow`,
  // because orientation has not been declared.
  const refused = await handler({ name: 'write', arguments: { file_path: '/repo/x' } }, next)
  assert.equal(refused.kind, 'deny')
  assert.match(refused.reason, /record the project orientation/)
  assert.match(refused.reason, /record_orientation/)
  assert.equal(proceeded, 0)
  assert.ok(stub.logs.some((entry) => entry.message.includes('orientation_required')))

  // Read-only inspection is never blocked by the requirement.
  const read = await handler({ name: 'read', arguments: { file_path: '/repo/x' } }, next)
  assert.equal(read.kind, 'allow')
  assert.equal(proceeded, 1)

  // After recording, the same write proceeds to the policy.
  await stub.recordOrientation()
  const allowed = await handler({ name: 'write', arguments: { file_path: '/repo/x' } }, next)
  assert.equal(allowed.kind, 'allow')
  assert.equal(proceeded, 2)
})

test('the orientation requirement is off by default, so the first write is not denied', async () => {
  const stub = stubContext()
  // No `preStep` override: the non-intrusive default from ARCHITECTURE-SPEC
  // §34.2 Q1 applies, and a write proceeds straight to the workspace policy.
  abg.apply(stub.ctx, { workspace: { policy: 'allow' } })
  stub.mountTools()

  const handler = stub.listeners.get('tools/pre-execute')[0]
  const decision = await handler({ name: 'write', arguments: { file_path: '/repo/x' } }, async () => ({ kind: 'allow' }))
  assert.equal(decision.kind, 'allow')
  assert.equal(
    stub.logs.some((entry) => entry.message.includes('orientation_required')),
    false,
    'the default must not impose the orientation requirement',
  )
})

test('a protected path is refused even when orientation is missing, and never asks', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { policy: 'ask', protectedPaths: ['/repo/secrets'] } })
  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'write', arguments: { file_path: '/repo/secrets/k' } },
    async () => ({ kind: 'allow' }),
  )
  // Protected paths outrank the orientation requirement: never an `ask`, never
  // routed to the user for a decision the policy has already made.
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /protected path/)
})

test('the orientation tool rejects an incomplete declaration', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  stub.mountTools()
  const tool = stub.tools[0]

  await assert.rejects(() => tool.execute({ intent: 'i', objective: 'o' }), /"scope" is required/)
  await assert.rejects(() => tool.execute({ intent: '  ', objective: 'o', scope: 's' }), /"intent" is required/)
  await assert.rejects(
    () => tool.execute({ intent: 'i', objective: 'o', scope: 's', plan: 'not-an-array' }),
    /"plan" must be an array/,
  )

  const recorded = await tool.execute({
    intent: 'improve the widget service',
    objective: 'align docs with v2',
    scope: 'documentation only',
    terminology: [{ term: 'widget', definition: 'the core entity' }],
    plan: ['read the docs', 'reconcile contradictions'],
  })
  assert.equal(recorded.recorded, true)
  assert.equal(recorded.oriented, true)
  assert.deepEqual(recorded.plan, ['read the docs', 'reconcile contradictions'])
})

test('the pre-step gate admits by default and rejects only when configured to', async () => {
  // Default gate is `off`: an unoriented project still proceeds (P6).
  const off = stubContext()
  abg.apply(off.ctx, {})
  let proceeded = 0
  const offDecision = await off.listeners.get('agent/pre-step')[0](
    { agent: {}, messages: [], turn: 1, step: 1 },
    async () => {
      proceeded += 1
      return { kind: 'enter', messages: [] }
    },
  )
  assert.equal(proceeded, 1, 'next() must be called when not rejecting')
  assert.equal(offDecision.kind, 'enter')

  // `reject` blocks the step: the turn ends with the durable reason `blocked`.
  const strict = stubContext()
  abg.apply(strict.ctx, { preStep: { orientationGate: 'reject' } })
  let proceededStrict = 0
  const strictDecision = await strict.listeners.get('agent/pre-step')[0](
    { agent: {}, messages: [], turn: 1, step: 1 },
    async () => {
      proceededStrict += 1
      return { kind: 'enter', messages: [] }
    },
  )
  assert.deepEqual(strictDecision, { kind: 'reject' })
  assert.equal(proceededStrict, 0, 'next() must not be called when rejecting')
  assert.ok(strict.logs.some((entry) => entry.message.includes('pre_step_rejected')))
})

test('the pre-step handler has the waterfall arity the host dispatches', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  const handler = stub.listeners.get('agent/pre-step')[0]
  // payload + next
  assert.equal(handler.length, 2)
  assert.equal(stub.listeners.get('tools/pre-execute')[0].length, 2)
})

test('the mutation gate lets inspection through and gates mutation', async () => {
  const stub = stubContext()
  // The orientation requirement is disabled here so this test isolates the
  // workspace policy; it has its own test above.
  abg.apply(stub.ctx, { workspace: { policy: 'deny' }, preStep: { requireBeforeMutation: false } })
  const handler = stub.listeners.get('tools/pre-execute')[0]

  let readProceeded = 0
  const read = await handler({ name: 'read', arguments: { file_path: '/a' } }, async () => {
    readProceeded += 1
    return { kind: 'allow' }
  })
  assert.equal(readProceeded, 1)
  assert.equal(read.kind, 'allow')

  let writeProceeded = 0
  const write = await handler({ name: 'write', arguments: { file_path: '/a' } }, async () => {
    writeProceeded += 1
    return { kind: 'allow' }
  })
  assert.equal(writeProceeded, 0)
  assert.equal(write.kind, 'deny')
  assert.ok(stub.logs.some((entry) => entry.message.includes('workspace_mutation_blocked')))
})

test('the ask policy emits the host approval request rather than a denial', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { policy: 'ask' }, preStep: { requireBeforeMutation: false } })
  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'write', arguments: { file_path: '/a' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'ask')
  assert.ok(stub.logs.some((entry) => entry.message.includes('workspace_mutation_gated')))
})

test('the ask_user_question batch size is observed without gating the call', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { policy: 'deny' } })
  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'ask_user_question', arguments: { questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    async () => ({ kind: 'allow' }),
  )
  // Not a mutating tool, so it proceeds — ABG measures, it does not block.
  assert.equal(decision.kind, 'allow')
  assert.ok(stub.logs.some((entry) => entry.message.includes('question_submitted questions=3')))
})

test('the mount diagnostic is emitted with the modules and section placement', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  const mount = stub.logs.find((entry) => entry.message.startsWith('abg: governance mounted'))
  assert.ok(mount, 'the mount diagnostic is the load-verification signal')
  assert.match(mount.message, /modules=project-governance,information-integrity,user-attention,workspace-governance/)
  assert.match(mount.message, /section=abg:governance@8500/)
  assert.match(mount.message, /workspace=ask/)
})

test('a disabled plugin registers nothing and says so', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { enabled: false })
  assert.equal(stub.sections.length, 0)
  assert.equal(stub.listeners.size, 0)
  assert.ok(stub.logs.some((entry) => entry.message.includes('disabled by configuration')))
})

test('diagnostics can be silenced without changing enforcement', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { diagnostics: false, workspace: { policy: 'deny' } })
  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'write', arguments: { file_path: '/a' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'deny', 'enforcement still applies')
  assert.equal(stub.logs.length, 0, 'nothing is logged')
})

/* ── §26.2: apply() must not throw ───────────────────────────────────────── */

test('an invalid configuration is reported read-only instead of unmounting silently', async () => {
  const stub = stubContext()
  // §26.2: the host reports a throwing entry as "N entry did not activate" and
  // carries on, so ABG must degrade to a diagnostic it can be seen through.
  assert.doesNotThrow(() => abg.apply(stub.ctx, { nope: 1 }))

  // Fail-safe: no prompt section and no enforcement from an unvalidated config.
  assert.equal(stub.sections.length, 0, 'no section without a validated configuration')
  assert.equal(stub.listeners.size, 0, 'no enforcement from an unvalidated configuration')

  // Observable: the fault reaches the transcript through the read-only tool.
  stub.mountTools()
  const status = stub.tools.find((tool) => tool.name === abg.STATUS_TOOL_NAME)
  assert.ok(status, 'the read-only status tool must be registered so the fault is visible')
  const report = await status.execute({}, {})
  assert.equal(report.mount.mounted, false)
  assert.match(report.mount.configError, /unknown key/)
  assert.equal(report.diagnostics[0].code, 'abg.config_invalid')
  assert.ok(stub.logs.some((entry) => entry.message.includes('config_invalid')))
})

test('a failing capability degrades to a diagnostic and the rest of the plugin still binds', () => {
  const stub = stubContext()
  stub.ctx.systemPrompt.section = () => {
    throw new Error('duplicate section name')
  }
  assert.doesNotThrow(() => abg.apply(stub.ctx, {}))

  // The failed seam is isolated: enforcement and the rest of the mount survive.
  assert.equal(stub.sections.length, 0)
  assert.deepEqual(
    [...stub.listeners.keys()].sort(),
    ['agent/pre-step', 'system-prompt/assemble', 'tools/pre-execute'],
  )
  assert.ok(
    stub.logs.some((entry) => entry.message.includes('systemPrompt.section failed')),
    'the failed capability must be attributed in the diagnostics narration',
  )
  assert.ok(
    stub.logs.some((entry) => entry.message.includes('governance mounted')),
    'a partial mount must still record that it mounted, as a partial mount',
  )
})

test('a broken logger cannot break the mount', () => {
  const stub = stubContext()
  stub.ctx.logger = {
    info() {
      throw new Error('logger down')
    },
    warn() {
      throw new Error('logger down')
    },
    error() {
      throw new Error('logger down')
    },
  }
  // Log narration is best effort (§28.3 channel D); the ring and the tools carry
  // the state regardless, so a deployment with no working exporter still mounts.
  assert.doesNotThrow(() => abg.apply(stub.ctx, {}))
  assert.equal(stub.sections.length, 1)
  assert.equal(stub.listeners.size, 3)
})

test('a partial mount reports its degraded capabilities instead of claiming a clean mount', async () => {
  const stub = stubContext()
  stub.ctx.systemPrompt.section = () => {
    throw new Error('duplicate section name')
  }
  abg.apply(stub.ctx, {})
  stub.mountTools()

  const status = stub.tools.find((tool) => tool.name === abg.STATUS_TOOL_NAME)
  const report = await status.execute({}, {})
  // `mounted` says ABG is present; `degraded` says whether it is complete. A
  // health check that reads only `mounted` would miss a dropped enforcement seam.
  assert.equal(report.mount.mounted, true)
  assert.deepEqual(report.mount.degraded, ['systemPrompt.section'])
})

test('an absent seam is recorded as degraded rather than treated as unneeded', () => {
  const stub = stubContext()
  const fullCtx = stub.ctx
  // Remove the injection seam: without it there are no capture surfaces at all.
  delete /** @type {any} */ (fullCtx).inject
  assert.doesNotThrow(() => abg.apply(fullCtx, {}))
  assert.equal(stub.injections.length, 0)
  assert.ok(
    stub.logs.some((entry) => entry.message.includes('capability_missing tools')),
    'the absent seam must be recorded, not silently skipped',
  )
})

test('a full mount degrades nothing and collects its disposer', () => {
  const stub = stubContext()
  assert.doesNotThrow(() => abg.apply(stub.ctx, {}))
  stub.mountTools()
  // The durable handle is disposed through `ctx.effect`, and the disposer is the
  // registration's own contract: a future change that drops it must fail here.
  assert.equal(stub.effects.length, 1)
  assert.match(String(stub.effects[0].label), /release the governance domain handle/)
  const disposer = stub.effects[0].action()
  assert.equal(typeof disposer, 'function')
  assert.doesNotThrow(() => /** @type {() => void} */ (disposer)())
})

/* ── Web GUI routes (§28.8) ──────────────────────────────────────────────── */

/**
 * Drive one route handler and wait for its response. The write routes return
 * before their async body has written anything, so waiting on `end` is required
 * rather than incidental.
 *
 * @param {{ handler: (req: any, res: any) => unknown }} route
 * @param {string} method
 * @param {unknown} [body]
 * @returns {Promise<{ status: number, body: any }>}
 */
async function callRoute(route, method, body) {
  const raw = body === undefined ? '' : JSON.stringify(body)
  /** @type {(value?: unknown) => void} */
  let resolveEnd = () => {}
  const done = new Promise((resolve) => { resolveEnd = resolve })
  let status = 0
  let payload = ''
  const req = {
    method,
    on: (/** @type {string} */ event, /** @type {(arg?: any) => void} */ listener) => {
      if (raw !== '' && event === 'data') listener(Buffer.from(raw, 'utf8'))
      if (event === 'end') listener()
    },
  }
  const res = {
    writeHead: (/** @type {number} */ value) => { status = value },
    end: (/** @type {unknown} */ text) => { payload = String(text ?? ''); resolveEnd() },
  }
  await route.handler(req, res)
  await done
  return { status, body: payload === '' ? null : JSON.parse(payload) }
}

/** @param {any} stub */
const routeOf = (stub, path) => stub.routes.find((/** @type {any} */ r) => r.path === path)

test('the GUI status route serves one JSON contract and never leaves a response open', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  assert.equal(stub.routes.length, 0, 'no route before the web server exists')
  stub.mountWebserver()

  assert.deepEqual(
    stub.routes.map((r) => r.path).sort(),
    [abg.STATUS_ROUTE_PATH, abg.PROMPT_ROUTE_PATH, abg.FEEDBACK_ROUTE_PATH].sort(),
    'one read route and two write routes',
  )
  for (const r of stub.routes) assert.equal(r.kind, 'exact')

  const answer = await callRoute(routeOf(stub, abg.STATUS_ROUTE_PATH), 'GET')
  assert.equal(answer.status, 200)
  assert.equal(answer.body.schema, 1)
  assert.equal(answer.body.mount.mounted, true)
  assert.equal(answer.body.mount.promptOverridden, false)
  assert.match(answer.body.status_line, /^abg:/)
  assert.ok(Array.isArray(answer.body.diagnostics))
  assert.equal(answer.body.prompt.editable, false, 'default mode is `compiled`')
  assert.equal(answer.body.feedback.can_file, false, 'url mode cannot file')

  // A handler that owns the response lifecycle must not throw when it is gone.
  const gone = {
    writeHead: () => { throw new Error('socket closed') },
    end: () => { throw new Error('socket closed') },
  }
  await assert.doesNotReject(() => Promise.resolve(routeOf(stub, abg.STATUS_ROUTE_PATH).handler({ method: 'GET' }, gone)))
})

test('the GUI routes can be switched off', () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { gui: { enabled: false } })
  stub.mountWebserver()
  assert.equal(stub.routes.length, 0)
})

test('the prompt write route is read-only until the deployment opts in', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})   // default prompt.mode is `compiled`
  stub.mountWebserver()
  const route = routeOf(stub, abg.PROMPT_ROUTE_PATH)
  assert.ok(route, 'the route is registered so the refusal is explainable')

  const refused = await callRoute(route, 'POST', {})
  assert.equal(refused.status, 409, 'no prompt.file means no write path')
  assert.match(refused.body.hint, /prompt\.mode/)

  assert.equal((await callRoute(route, 'GET')).status, 405)
})

test('the prompt write route validates through the same kernel and persists on success', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'abg-gui-prompt-'))
  const file = path.join(dir, 'prompt.md')
  try {
    const stub = stubContext()
    abg.apply(stub.ctx, { prompt: { mode: 'replace', file } })
    stub.mountWebserver()
    const route = routeOf(stub, abg.PROMPT_ROUTE_PATH)

    const tooRisky = await callRoute(route, 'POST', { text: 'Report {{objective}} each turn.' })
    assert.equal(tooRisky.status, 422, 'the file and the GUI share one rule')
    assert.match(tooRisky.body.issues[0], /interpolation/)

    const applied = await callRoute(route, 'POST', { text: '# House rules\n\n- Never write outside the workspace.' })
    assert.equal(applied.status, 200)
    assert.equal(applied.body.applied, true)
    assert.match(applied.body.version, /^0\.2\.0\+user:/, 'the effective version names the edited text')
    assert.equal(
      readFileSync(file, 'utf8'),
      '# House rules\n\n- Never write outside the workspace.',
      'persisted before reporting success',
    )

    const view = await callRoute(routeOf(stub, abg.STATUS_ROUTE_PATH), 'GET')
    assert.equal(view.body.mount.promptOverridden, true, 'the live view reflects the edit')
    assert.equal(view.body.prompt.editable, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the feedback write route composes redacted reports through the kernel', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, {})
  stub.mountWebserver()
  const route = routeOf(stub, abg.FEEDBACK_ROUTE_PATH)

  assert.equal((await callRoute(route, 'POST', {})).status, 400, 'a summary is required')

  const report = await callRoute(route, 'POST', { summary: 'Blocked a legitimate edit' })
  assert.equal(report.status, 200)
  assert.match(report.body.issue_url, /^https:\/\/github\.com\/ccneedb\/agent-behavioral-governance\/issues\/new\?/)
  assert.match(report.body.markdown, /### What happened/)
  assert.equal(report.body.filed, false)

  // `file` is honoured only in api mode; in url mode the link is the answer.
  const attempt = await callRoute(route, 'POST', { summary: 'x', file: true })
  assert.match(attempt.body.file_result.reason, /url/)
})
