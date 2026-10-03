/**
 * Wiring test: mount IEG on a stub Cordis context and assert it binds to the
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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import * as ieg from '../../lib/index.js'

/**
 * A minimal stand-in for the Cordis context that records what IEG registers.
 *
 * @returns {{
 *   ctx: IegContext,
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
    /** Record orientation through the tool IEG registered, as an agent would. */
    recordOrientation: async () => {
      const tool = tools.find((candidate) => candidate.name === 'record_orientation')
      if (tool === undefined) throw new Error('IEG did not register the orientation tool')
      return tool.execute({ intent: 'i', objective: 'o', scope: 's', terminology: [{ term: 't', definition: 'd' }], plan: ['step'] })
    },
  }
}

test('IEG registers exactly one additive prompt section', () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, {})

  assert.equal(stub.sections.length, 1, 'exactly one section: the composition pattern depends on it')
  const section = stub.sections[0]
  assert.equal(section.name, ieg.SECTION_NAME)
  assert.equal(section.order, 8500)
  assert.equal(section.interpolate, false, 'governance text is literal')
  assert.equal(section.complete, undefined, 'complete would replace the host prompt')
  assert.equal(typeof section.text, 'function')
  assert.match(section.text({}), /Information Environment Governance \(IEG\)/)
})

test('IEG binds to the verified event names only', () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, {})
  assert.deepEqual(
    [...stub.listeners.keys()].sort(),
    ['agent/pre-step', 'system-prompt/assemble', 'tools/pre-execute'],
  )
  for (const handlers of stub.listeners.values()) assert.equal(handlers.length, 1)
})

test('IEG requests the tool registry through ctx.inject, not eagerly', () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, { workspace: { protectedPaths: ['/repo/secrets'] } })

  assert.deepEqual(
    stub.injections.map((injection) => injection.services.join(',')).sort(),
    ['tools'],
    'every optional service is requested through ctx.inject, never read eagerly',
  )
  assert.equal(stub.guards.length, 0, 'no guard before the registry exists')
  assert.equal(stub.tools.length, 0, 'no tool before the registry exists')

  stub.mountTools()
  assert.equal(stub.guards.length, 1, 'the guard attaches once the registry is available')
  assert.match(String(stub.guards[0]({ name: 'write', arguments: { file_path: '/repo/secrets/k' } })), /protected path/)
  assert.deepEqual(
    stub.tools.map((tool) => tool.name).sort(),
    ['ieg_status', 'record_orientation'],
    'IEG registers exactly its own two tools: the orientation capture tool and the read-only status surface',
  )
})

test('the orientation requirement refuses the first mutation until orientation is recorded', async () => {
  const stub = stubContext()
  // The requirement is opt-in (ARCHITECTURE-SPEC §34.2 Q1), so this case states
  // it rather than inheriting it from the default.
  ieg.apply(stub.ctx, { workspace: { policy: 'allow' }, preStep: { requireBeforeMutation: true } })
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
  ieg.apply(stub.ctx, { workspace: { policy: 'allow' } })
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
  ieg.apply(stub.ctx, { workspace: { policy: 'ask', protectedPaths: ['/repo/secrets'] } })
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
  ieg.apply(stub.ctx, {})
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
  ieg.apply(off.ctx, {})
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
  ieg.apply(strict.ctx, { preStep: { orientationGate: 'reject' } })
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
  ieg.apply(stub.ctx, {})
  const handler = stub.listeners.get('agent/pre-step')[0]
  // payload + next
  assert.equal(handler.length, 2)
  assert.equal(stub.listeners.get('tools/pre-execute')[0].length, 2)
})

test('the mutation gate lets inspection through and gates mutation', async () => {
  const stub = stubContext()
  // The orientation requirement is disabled here so this test isolates the
  // workspace policy; it has its own test above.
  ieg.apply(stub.ctx, { workspace: { policy: 'deny' }, preStep: { requireBeforeMutation: false } })
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
  ieg.apply(stub.ctx, { workspace: { policy: 'ask' }, preStep: { requireBeforeMutation: false } })
  const decision = await stub.listeners.get('tools/pre-execute')[0](
    { name: 'write', arguments: { file_path: '/a' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'ask')
  assert.ok(stub.logs.some((entry) => entry.message.includes('workspace_mutation_gated')))
})

test('the mount diagnostic is emitted with the modules and section placement', () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, {})
  const mount = stub.logs.find((entry) => entry.message.startsWith('ieg: governance mounted'))
  assert.ok(mount, 'the mount diagnostic is the load-verification signal')
  assert.match(mount.message, /modules=project-governance,information-integrity,workspace-governance/)
  assert.match(mount.message, /section=ieg:governance@8500/)
  assert.match(mount.message, /workspace=ask/)
})

test('a disabled plugin registers nothing and says so', () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, { enabled: false })
  assert.equal(stub.sections.length, 0)
  assert.equal(stub.listeners.size, 0)
  assert.ok(stub.logs.some((entry) => entry.message.includes('disabled by configuration')))
})

test('diagnostics can be silenced without changing enforcement', async () => {
  const stub = stubContext()
  ieg.apply(stub.ctx, { diagnostics: false, workspace: { policy: 'deny' } })
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
  // carries on, so IEG must degrade to a diagnostic it can be seen through.
  assert.doesNotThrow(() => ieg.apply(stub.ctx, { nope: 1 }))

  // Fail-safe: no prompt section and no enforcement from an unvalidated config.
  assert.equal(stub.sections.length, 0, 'no section without a validated configuration')
  assert.equal(stub.listeners.size, 0, 'no enforcement from an unvalidated configuration')

  // Observable: the fault reaches the transcript through the read-only tool.
  stub.mountTools()
  const status = stub.tools.find((tool) => tool.name === ieg.STATUS_TOOL_NAME)
  assert.ok(status, 'the read-only status tool must be registered so the fault is visible')
  const report = await status.execute({}, {})
  assert.equal(report.mount.mounted, false)
  assert.match(report.mount.configError, /unknown key/)
  assert.equal(report.diagnostics[0].code, 'ieg.config_invalid')
  assert.ok(stub.logs.some((entry) => entry.message.includes('config_invalid')))
})

test('a failing capability degrades to a diagnostic and the rest of the plugin still binds', () => {
  const stub = stubContext()
  stub.ctx.systemPrompt.section = () => {
    throw new Error('duplicate section name')
  }
  assert.doesNotThrow(() => ieg.apply(stub.ctx, {}))

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
  assert.doesNotThrow(() => ieg.apply(stub.ctx, {}))
  assert.equal(stub.sections.length, 1)
  assert.equal(stub.listeners.size, 3)
})

test('a partial mount reports its degraded capabilities instead of claiming a clean mount', async () => {
  const stub = stubContext()
  stub.ctx.systemPrompt.section = () => {
    throw new Error('duplicate section name')
  }
  ieg.apply(stub.ctx, {})
  stub.mountTools()

  const status = stub.tools.find((tool) => tool.name === ieg.STATUS_TOOL_NAME)
  const report = await status.execute({}, {})
  // `mounted` says IEG is present; `degraded` says whether it is complete. A
  // health check that reads only `mounted` would miss a dropped enforcement seam.
  assert.equal(report.mount.mounted, true)
  assert.deepEqual(report.mount.degraded, ['systemPrompt.section'])
})

test('an absent seam is recorded as degraded rather than treated as unneeded', () => {
  const stub = stubContext()
  const fullCtx = stub.ctx
  // Remove the injection seam: without it there are no capture surfaces at all.
  delete /** @type {any} */ (fullCtx).inject
  assert.doesNotThrow(() => ieg.apply(fullCtx, {}))
  assert.equal(stub.injections.length, 0)
  assert.ok(
    stub.logs.some((entry) => entry.message.includes('capability_missing tools')),
    'the absent seam must be recorded, not silently skipped',
  )
})

test('a full mount degrades nothing and collects its disposer', () => {
  const stub = stubContext()
  assert.doesNotThrow(() => ieg.apply(stub.ctx, {}))
  stub.mountTools()
  // The durable handle is disposed through `ctx.effect`, and the disposer is the
  // registration's own contract: a future change that drops it must fail here.
  assert.equal(stub.effects.length, 1)
  assert.match(String(stub.effects[0].label), /release the governance domain handle/)
  const disposer = stub.effects[0].action()
  assert.equal(typeof disposer, 'function')
  assert.doesNotThrow(() => /** @type {() => void} */ (disposer)())
})

/* ── control plane: start | pause | restart | exit (0.6.0) ───────────────── */

/**
 * Run one case with the control plane pointed at a throwaway state file, then
 * remove it. The plugin resolves `$IEG_STATE_FILE` per `apply()`, so setting it
 * here is exactly how a real profile is pointed at its control record.
 *
 * @param {(control: {
 *   dir: string, stateFile: string, promptFile: string,
 *   writeState: (value: unknown) => void, writePrompt: (text: string) => void,
 * }) => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function withControl(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ieg-control-'))
  const stateFile = path.join(dir, 'state.json')
  const promptFile = path.join(dir, 'prompt.md')
  const previous = process.env.IEG_STATE_FILE
  process.env.IEG_STATE_FILE = stateFile
  try {
    await fn({
      dir,
      stateFile,
      promptFile,
      writeState: (value) =>
        writeFileSync(stateFile, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`),
      writePrompt: (text) => writeFileSync(promptFile, text),
    })
  } finally {
    if (previous === undefined) delete process.env.IEG_STATE_FILE
    else process.env.IEG_STATE_FILE = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

const controlRecord = (/** @type {'running'|'paused'|'stopped'} */ status, /** @type {number} */ generation = 0) => ({
  schema: 1,
  status,
  generation,
  updatedAt: '2026-10-03T00:00:00.000Z',
})

test('control: an absent state file means running, exactly as before 0.6.0', async () => {
  await withControl(async () => {
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    assert.equal(stub.sections.length, 1)
    assert.match(stub.sections[0].text({}), /Information Environment Governance \(IEG\)/)
  })
})

test('control: pause suppresses the section, passes hooks through, and is recorded once', async () => {
  await withControl(async (control) => {
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    const section = stub.sections[0]

    control.writeState(controlRecord('paused'))
    assert.equal(section.text({}), '', 'a paused profile emits no governance section')
    assert.match(section.text({}), /^$/, 'a second assembly is still suppressed')

    const preStep = await stub.listeners.get('agent/pre-step')[0](
      { agent: {}, messages: [], turn: 1, step: 1 },
      async () => ({ kind: 'enter', messages: [] }),
    )
    assert.equal(preStep.kind, 'enter', 'a paused profile lets the step through')

    const decision = await stub.listeners.get('tools/pre-execute')[0](
      { name: 'write', arguments: { file_path: '/a' } },
      async () => ({ kind: 'allow' }),
    )
    assert.equal(decision.kind, 'allow', 'a paused profile does not gate a mutation')

    const paused = stub.logs.filter((entry) => entry.message.includes('control_paused'))
    assert.equal(paused.length, 1, 'the transition is recorded once, not once per step')
  })
})

test('control: start after pause resumes and re-emits the section', async () => {
  await withControl(async (control) => {
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    const section = stub.sections[0]

    control.writeState(controlRecord('paused'))
    assert.equal(section.text({}), '')
    control.writeState(controlRecord('running'))
    assert.match(section.text({}), /Information Environment Governance \(IEG\)/)
    assert.ok(stub.logs.some((entry) => entry.message.includes('control_resumed')))
  })
})

test('control: exit mounts nothing active, as `enabled: false` does', async () => {
  await withControl(async (control) => {
    control.writeState(controlRecord('stopped'))
    const stub = stubContext()
    assert.doesNotThrow(() => ieg.apply(stub.ctx, {}))
    assert.equal(stub.sections.length, 0, 'no section while stopped')
    assert.equal(stub.listeners.size, 0, 'no enforcement while stopped')
    assert.ok(stub.logs.some((entry) => entry.message.includes('control_stopped')))
    assert.ok(stub.logs.some((entry) => entry.message.includes('stopped by control state')))
  })
})

test('control: a corrupt state file degrades to running and is recorded, never thrown', async () => {
  await withControl(async (control) => {
    control.writeState('{ this is not json')
    const stub = stubContext()
    assert.doesNotThrow(() => ieg.apply(stub.ctx, {}))
    assert.equal(stub.sections.length, 1, 'a corrupt record must not switch governance off')
    assert.match(stub.sections[0].text({}), /Information Environment Governance \(IEG\)/)
    assert.ok(stub.logs.some((entry) => entry.message.includes('control_state_unreadable')))
  })
})

test('control: restart bumps generation, which invalidates the cached prompt', async () => {
  await withControl(async (control) => {
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    const section = stub.sections[0]
    assert.match(section.text({}), /Information Environment Governance \(IEG\)/)

    // A prompt.md that appears after mount is NOT picked up until a restart:
    // the contract is that `restart` reloads configuration and prompt.md.
    control.writePrompt('# House rules\n\n- Never write outside the workspace.\n')
    assert.match(section.text({}), /Information Environment Governance \(IEG\)/)

    control.writeState(controlRecord('running', 1))
    // `composePromptOverride` trims, so the effective text carries no trailing newline.
    assert.equal(section.text({}), '# House rules\n\n- Never write outside the workspace.')
    assert.ok(stub.logs.some((entry) => entry.message.includes('control_generation_changed')))
  })
})

test('control: a valid prompt.md applies at mount and is attributed to its text', async () => {
  await withControl(async (control) => {
    control.writePrompt('# House rules\n\n- Never write outside the workspace.\n')
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    stub.mountTools()
    assert.equal(stub.sections[0].text({}), '# House rules\n\n- Never write outside the workspace.')

    const status = stub.tools.find((tool) => tool.name === ieg.STATUS_TOOL_NAME)
    const report = await status.execute({}, {})
    assert.equal(report.mount.promptOverridden, true)
    // Derived from the constant, not hardcoded: a prompt revision must never
    // require a test edit, only a `PROMPT_VERSION` change.
    const escapedVersion = ieg.PROMPT_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(report.mount.promptVersion, new RegExp(`^${escapedVersion}\\+user:`))
    assert.equal(report.control.status, 'running')
    assert.equal(report.control.promptSource, 'control')

    // A tool's canonical value only reaches the model through `render`. This
    // tool once declared `render: () => []`, so every call succeeded and showed
    // the caller nothing (observed live, 2026-10-03).
    const rendered = status.output.render({}, report)
    assert.ok(Array.isArray(rendered) && rendered.length > 0, 'ieg_status must render model-visible content')
    assert.ok(
      rendered.some((block) => block.type === 'text' && typeof block.text === 'string' && block.text.includes('mounted')),
      'ieg_status must render its mount record',
    )
  })
})

test('control: a refused prompt.md falls back to the compiled default with its reasons', async () => {
  await withControl(async (control) => {
    control.writePrompt('Report {{objective}} each turn.')
    const stub = stubContext()
    ieg.apply(stub.ctx, {})
    assert.match(stub.sections[0].text({}), /Information Environment Governance \(IEG\)/)
    const rejection = stub.logs.find((entry) => entry.message.includes('prompt_override_rejected'))
    assert.ok(rejection, 'a refusal is a governance event, not a silent no-op')
    assert.match(rejection.message, /interpolation/)
  })
})

