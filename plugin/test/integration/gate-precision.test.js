/**
 * Gate-precision evaluation — ARCHITECTURE-SPEC §32.4, closing
 * MAINTENANCE-HANDOFF §4 blocker 3 ("false positives unmeasured").
 *
 * A governance layer that blocks legitimate work has negative value, so this
 * suite measures the two error rates that matter rather than asserting a
 * behaviour in isolation:
 *
 * ```text
 * legitimate_calls    the calls the legitimate tasks require
 * false_blocks        calls ABG refused although the task authorized them
 * false_block_rate    false_blocks / legitimate_calls   (target: exactly 0)
 * true_blocks         the declared traps ABG is meant to catch
 * ```
 *
 * ## Environment
 *
 * The environment is simulated but the enforcement is not: a throwaway
 * filesystem workspace, a real Cordis context, the **real**
 * `@deepseek-ai/dsh-system-prompt`, `@deepseek-ai/dsh-tools`, and
 * `dsh-fs-local` services, and ABG mounted through `abg.apply(stub.ctx,
 * config)`. `stub.ctx` records every seam ABG binds while forwarding the
 * enforcement-critical reads (`on`, `inject`, `get`, `effect`, `systemPrompt`)
 * to the real host context. So each `blocked` verdict below is the host tool
 * registry's own `ToolExecutionResult`, not a mock of one.
 *
 * ## Isolation of the gate under test
 *
 * Every case states its own configuration. `preStep.requireBeforeMutation` is
 * `false` everywhere except the one case that measures it, and
 * `workspace.overlapCheck` is `off` except where the overlap gate is the gate
 * under test, so a case isolates the rule it names instead of conflating the
 * orientation requirement, the workspace policy, and the overlap heuristic.
 */

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { dshAvailable, loadCordis, loadDshPackage, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import * as abg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

/* ── the simulated workspace ─────────────────────────────────────────────── */

/**
 * An authoritative document that already carries an `## Authentication`
 * section. The near-duplicate trap below names a new file after that subject
 * while restating the body, which exercises both the body-similarity and the
 * filename-subject signals of the overlap gate.
 */
const WORKSPACE_SPEC = `# Widget Service — Specification

Status: current and authoritative. Last reviewed 2026-10-01.

## API surface (v2)

Every request carries a bearer token in the Authorization header. Tokens are
issued by the accounts service and expire after 24 hours. Widgets live in the
widgets table, one row per widget.

## Authentication

Widget clients authenticate with a bearer token issued by the accounts service.
The token is presented in the Authorization header on every request.
`

/** The same body under a different H1 and filename: a near-duplicate document. */
const NEAR_DUPLICATE = WORKSPACE_SPEC.replace('# Widget Service — Specification', '# Authentication')

/** A genuinely new document: no subject and no body overlap with the spec. */
const UNRELATED_DOCUMENT = `# Deployment runbook

Roll the canary forward in ten percent increments and watch the error budget.
Page the on-call engineer when the burn rate exceeds the threshold.
`

/** The orientation declaration every oriented case records. */
const ORIENTATION = Object.freeze({
  intent: 'keep the widget service coherent',
  objective: 'land the requested change without creating duplicates',
  scope: 'documentation and source under the workspace, nothing outside it',
  terminology: [{ term: 'widget', definition: 'the core entity of the service' }],
  plan: ['inspect the workspace', 'apply the change', 'verify the result'],
})

/** @type {string} */
let workspace = ''

before(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'abg-gate-precision-'))
  writeFileSync(path.join(workspace, 'SPEC.md'), WORKSPACE_SPEC)
})

after(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true })
})

/* ── the simulated environment ───────────────────────────────────────────── */

/**
 * @typedef {object} CallResult
 * @property {boolean} blocked whether the host registry returned an error
 * @property {string} message the model-facing error message, empty when allowed
 */

/**
 * @typedef {object} Environment
 * @property {any} host the real Cordis context
 * @property {{ sections: any[], listeners: string[], logs: string[] }} recorded what ABG bound
 * @property {(name: string, args: Record<string, unknown>) => Promise<CallResult>} call dispatch one call through the real registry
 */

/**
 * Boot the simulated environment and mount ABG through `abg.apply`.
 *
 * @param {unknown} config the ABG row config
 * @param {string} [workspaceDir] the filesystem root the real `dsh-fs-local` serves
 * @returns {Promise<Environment & { dispose: () => Promise<void> }>}
 */
async function boot(config, workspaceDir) {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const fsLocal = await loadDshPackage('dsh-fs-local')

  const host = new Context()
  await host.plugin(systemPromptModule.default, { personaPrefix: '' })
  await host.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await host.plugin(fsLocal.default ?? fsLocal, { cwd: workspaceDir ?? workspace })

  /** @type {any[]} */
  const sections = []
  /** @type {string[]} */
  const listeners = []
  /** @type {string[]} */
  const logs = []
  /** @param {string} level */
  const record = (level) => (/** @type {string} */ message) => {
    logs.push(`${level}: ${message}`)
  }

  // The stub context. Seam *registration* is recorded here; every read that
  // decides an enforcement outcome is forwarded to the real host context, so
  // `tools/pre-execute` and `ctx.tools.guard` are the host's own pipeline.
  const stub = {
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    systemPrompt: {
      section: (/** @type {any} */ section) => {
        sections.push(section)
        return host.systemPrompt.section(section)
      },
      getSectionOrder: (/** @type {string} */ sectionName) => host.systemPrompt.getSectionOrder(sectionName),
    },
    on: (/** @type {string} */ event, /** @type {any} */ handler) => {
      listeners.push(event)
      return host.on(event, handler)
    },
    get: (/** @type {string} */ service) => host.get(service),
    inject: (/** @type {readonly string[]} */ services, /** @type {any} */ callback) =>
      host.inject(services, callback),
    effect: (/** @type {any} */ body, /** @type {string} */ label) => host.effect?.(body, label),
  }

  abg.apply(stub, config)
  // `ctx.inject(['tools'], …)` activates on a microtask; let it settle before
  // registering the stand-in tools and dispatching.
  await new Promise((resolve) => setImmediate(resolve))

  // The tools the matrix dispatches. Their bodies are inert: the matrix measures
  // ABG's gate, not the tools. `parameters` is permissive because argument
  // validation is not what this suite evaluates.
  for (const toolName of ['read', 'glob', 'grep', 'write', 'edit', 'bash', 'ask_user_question']) {
    host.tools.register({
      name: toolName,
      description: toolName,
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          path: { type: 'string' },
          target: { type: 'string' },
          pattern: { type: 'string' },
          command: { type: 'string' },
          content: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          questions: { type: 'array' },
        },
      },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: async () => ({ ok: true }),
    })
  }

  const signal = new AbortController().signal
  // One agent identity per environment, shared by every call, so the state
  // layer (orientation, question ledger) can be keyed per agent.
  const agent = { session: { id: `abg-gate-precision` } }
  let sequence = 0

  return {
    host,
    recorded: { sections, listeners, logs },
    /**
     * @param {string} toolName
     * @param {Record<string, unknown>} args
     * @returns {Promise<CallResult>}
     */
    async call(toolName, args) {
      sequence += 1
      const result = await host.tools.execute({
        callId: `gp-${sequence}-${toolName}`,
        name: toolName,
        arguments: args,
        signal,
        agent,
      })
      return {
        blocked: result.isError === true,
        message: result.isError === true ? String(result.error?.message ?? '') : '',
      }
    },
    async dispose() {
      try {
        await host.dispose?.()
      } catch {
        /* teardown is best-effort; each environment owns its own context */
      }
    },
  }
}

/**
 * Matrix defaults. Each case overrides only the gate it names.
 *
 * @param {{ workspace?: Record<string, unknown>, preStep?: Record<string, unknown>, userAttention?: Record<string, unknown> }} [overrides]
 * @returns {Record<string, unknown>}
 */
function matrixConfig(overrides = {}) {
  return {
    workspace: { policy: 'allow', overlapCheck: 'off', ...(overrides.workspace ?? {}) },
    // The orientation requirement is off by default so a case isolates the gate
    // it names; the orientation case turns it on explicitly.
    preStep: { requireBeforeMutation: false, ...(overrides.preStep ?? {}) },
    userAttention: { enforceBatchCompleteness: true, ...(overrides.userAttention ?? {}) },
  }
}

/**
 * @typedef {{ name: string, arguments: Record<string, unknown> }} MatrixCall
 */

/**
 * A legitimate operation ABG must never block.
 * @typedef {object} LegitimateCase
 * @property {string} id
 * @property {string} gate the gate this case proves cannot fire
 * @property {Record<string, unknown>} [config]
 * @property {MatrixCall[]} calls
 * @property {(call: (name: string, args: Record<string, unknown>) => Promise<CallResult>) => Promise<void>} [setup]
 */

/**
 * A trap ABG must catch.
 * @typedef {object} TrapCase
 * @property {string} id
 * @property {Record<string, unknown>} [config]
 * @property {MatrixCall[]} [setup]
 * @property {MatrixCall} call
 * @property {RegExp} reason
 */

/* ── the legitimate corpus ───────────────────────────────────────────────── */

/**
 * Built lazily because the paths below resolve against the workspace created in
 * `before()`. Returning fresh objects per call also keeps each run independent.
 *
 * @returns {LegitimateCase[]}
 */
function buildLegitimateCases() {
  return [
    {
      id: 'read-only/read',
      gate: 'read-only inspection is never classified as a mutation',
      calls: [{ name: 'read', arguments: { file_path: path.join(workspace, 'SPEC.md') } }],
    },
    {
      id: 'read-only/glob',
      gate: 'path discovery is never classified as a mutation',
      calls: [{ name: 'glob', arguments: { pattern: '**/*.md' } }],
    },
    {
      id: 'read-only/grep',
      gate: 'content search is never classified as a mutation',
      calls: [{ name: 'grep', arguments: { pattern: 'widget', path: workspace } }],
    },
    {
      id: 'authorized/create-artifact',
      gate: 'a genuinely new artifact passes even with the overlap gate armed',
      config: matrixConfig({ workspace: { overlapCheck: 'deny' } }),
      calls: [
        {
          name: 'write',
          arguments: { file_path: path.join(workspace, 'DEPLOY.md'), content: UNRELATED_DOCUMENT },
        },
      ],
    },
    {
      id: 'authorized/edit-in-place',
      gate: 'an in-place edit of an inspected file is not obstructed',
      config: matrixConfig({ workspace: { overlapCheck: 'deny' } }),
      calls: [
        {
          name: 'edit',
          arguments: {
            file_path: path.join(workspace, 'SPEC.md'),
            old_string: 'Last reviewed 2026-10-01.',
            new_string: 'Last reviewed 2026-10-02.',
          },
        },
      ],
    },
    {
      id: 'authorized/delete-stale-content',
      gate: 'a shell command that removes stale content is authorized under an allow policy',
      calls: [{ name: 'bash', arguments: { command: 'rm stale-notes.md' } }],
    },
    {
      id: 'authorized/multi-file-refactor',
      gate: 'a refactor spanning several files is admitted as one authorized task',
      calls: [
        { name: 'edit', arguments: { file_path: path.join(workspace, 'a.ts'), old_string: 'x', new_string: 'y' } },
        { name: 'edit', arguments: { file_path: path.join(workspace, 'b.ts'), old_string: 'x', new_string: 'y' } },
        {
          name: 'write',
          arguments: { file_path: path.join(workspace, 'c.ts'), content: 'export const c = 1\n' },
        },
      ],
    },
    {
      id: 'shell/ls',
      gate: 'a read-only shell command is not classified as a mutation',
      calls: [{ name: 'bash', arguments: { command: 'ls -la' } }],
    },
    {
      id: 'shell/grep',
      gate: 'grep in a shell is not misread as a writing command',
      calls: [{ name: 'bash', arguments: { command: 'grep -rn "widget" src' } }],
    },
    {
      id: 'shell/node-test',
      gate: 'node --test is not misread as a writing command',
      calls: [{ name: 'bash', arguments: { command: 'node --test test/unit/config.test.js' } }],
    },
    {
      id: 'shell/rg-arrow',
      gate: "a quoted arrow in a search pattern is not misread as a redirection (`rg '=>' src`)",
      calls: [{ name: 'bash', arguments: { command: "rg '=>' src" } }],
    },
    {
      id: 'shell/commit-message',
      gate: "a quoted write word in a commit message is not misread as a shell write (`git commit -m 'rm stale files'`)",
      calls: [{ name: 'bash', arguments: { command: "git commit -m 'rm stale files'" } }],
    },
    {
      id: 'user-attention/complete-batch',
      gate: 'a batch that carries every registered blocker is admitted',
      calls: [
        {
          name: 'record_question',
          arguments: { id: 'q-db', question: 'Which database?', kind: 'deterministic-blocker' },
        },
        {
          name: 'record_question',
          arguments: { id: 'q-region', question: 'Which region?', kind: 'deterministic-blocker' },
        },
        { name: 'ask_user_question', arguments: { questions: [{ id: 'q-db' }, { id: 'q-region' }] } },
      ],
    },
    {
      id: 'orientation/record',
      gate: 'the orientation declaration itself is never gated',
      calls: [{ name: 'record_orientation', arguments: { ...ORIENTATION } }],
    },
    {
      id: 'user-attention/record-question',
      gate: 'registering a question is never gated',
      calls: [
        {
          name: 'record_question',
          arguments: { id: 'q-standalone', question: 'Which font?', kind: 'non-blocking-uncertainty' },
        },
      ],
    },
    {
      id: 'orientation/mutation-after-declaration',
      gate: 'the orientation requirement is satisfied by its own tool, not by refusing work',
      config: matrixConfig({
        workspace: { policy: 'allow', overlapCheck: 'off' },
        preStep: { requireBeforeMutation: true },
      }),
      calls: [
        { name: 'record_orientation', arguments: { ...ORIENTATION } },
        {
          name: 'write',
          arguments: { file_path: path.join(workspace, 'oriented.md'), content: UNRELATED_DOCUMENT },
        },
      ],
    },
  ]
}

/* ── the trap corpus ─────────────────────────────────────────────────────── */

/**
 * @returns {TrapCase[]}
 */
function buildTraps() {
  return [
    {
      id: 'trap/overlap-near-duplicate',
      config: matrixConfig({ workspace: { overlapCheck: 'deny' } }),
      call: {
        name: 'write',
        arguments: { file_path: path.join(workspace, 'AUTHENTICATION.md'), content: NEAR_DUPLICATE },
      },
      reason: /substantially duplicates existing documentation/,
    },
    {
      id: 'trap/protected-path',
      config: matrixConfig({ workspace: { policy: 'allow', protectedPaths: [path.join(workspace, 'secrets')] } }),
      call: {
        name: 'write',
        arguments: { file_path: path.join(workspace, 'secrets', 'key.pem'), content: 'private key' },
      },
      reason: /protected path/,
    },
    {
      id: 'trap/unauthorized-mutation-under-deny',
      config: matrixConfig({ workspace: { policy: 'deny' } }),
      call: {
        name: 'write',
        arguments: { file_path: path.join(workspace, 'unauthorized.ts'), content: 'export const x = 1\n' },
      },
      reason: /not authorized/,
    },
    {
      id: 'trap/incomplete-question-batch',
      config: matrixConfig(),
      setup: [
        {
          name: 'record_question',
          arguments: { id: 'q-one', question: 'Which database?', kind: 'deterministic-blocker' },
        },
        {
          name: 'record_question',
          arguments: { id: 'q-two', question: 'Which region?', kind: 'deterministic-blocker' },
        },
      ],
      call: { name: 'ask_user_question', arguments: { questions: [{ id: 'q-one' }] } },
      reason: /omits 1 registered question/,
    },
  ]
}

/* ── execution and measurement ───────────────────────────────────────────── */

/**
 * @typedef {object} CaseOutcome
 * @property {string} id
 * @property {CallResult[]} results
 */

/** @type {Promise<{ legitimate: CaseOutcome[], traps: { trap: TrapCase, setup: CallResult[], outcome: CallResult }[] }> | undefined} */
let matrix

/** Run the whole matrix once and memoize it, so the assertions below share one measurement. */
function runMatrix() {
  matrix ??= (async () => {
    const legitimateCases = buildLegitimateCases()
    const trapCases = buildTraps()

    /** @type {CaseOutcome[]} */
    const legitimate = []
    for (const matrixCase of legitimateCases) {
      const env = await boot(matrixCase.config ?? matrixConfig())
      try {
        /** @type {CallResult[]} */
        const results = []
        for (const pending of matrixCase.calls) results.push(await env.call(pending.name, pending.arguments))
        legitimate.push({ id: matrixCase.id, results })
      } finally {
        await env.dispose()
      }
    }

    const traps = []
    for (const trap of trapCases) {
      const env = await boot(trap.config ?? matrixConfig())
      try {
        /** @type {CallResult[]} */
        const setup = []
        for (const pending of trap.setup ?? []) setup.push(await env.call(pending.name, pending.arguments))
        const outcome = await env.call(trap.call.name, trap.call.arguments)
        traps.push({ trap, setup, outcome })
      } finally {
        await env.dispose()
      }
    }

    return { legitimate, traps }
  })()
  return matrix
}

/**
 * Print the measurement so a reader sees the numbers, not only the assertions.
 *
 * @param {CaseOutcome[]} legitimate
 * @param {{ trap: TrapCase, setup: CallResult[], outcome: CallResult }[]} traps
 * @returns {{ legitimateCalls: number, falseBlocks: number, falseBlockRate: number, trueBlocks: number }}
 */
function report(legitimate, traps) {
  let legitimateCalls = 0
  let falseBlocks = 0
  console.log('ABG gate-precision matrix (ARCHITECTURE-SPEC §32.4)')
  for (const matrixCase of legitimate) {
    const blocked = matrixCase.results.filter((result) => result.blocked)
    legitimateCalls += matrixCase.results.length
    falseBlocks += blocked.length
    const status = blocked.length === 0 ? 'allow' : `BLOCKED(${blocked.length})`
    console.log(`  legitimate  ${status.padEnd(12)} calls=${matrixCase.results.length}  ${matrixCase.id}`)
    for (const result of blocked) console.log(`      ! ${result.message}`)
  }

  const trueBlocks = traps.filter((entry) => entry.outcome.blocked).length
  for (const entry of traps) {
    console.log(`  trap        ${entry.outcome.blocked ? 'denied' : 'ALLOWED'}       ${entry.trap.id}`)
  }

  const falseBlockRate = legitimateCalls === 0 ? 0 : falseBlocks / legitimateCalls
  console.log(
    `  measured    legitimate_calls=${legitimateCalls} false_blocks=${falseBlocks} ` +
      `false_block_rate=${falseBlockRate}`,
  )
  console.log(`  measured    traps=${traps.length} true_blocks=${trueBlocks}`)

  return { legitimateCalls, falseBlocks, falseBlockRate, trueBlocks }
}

/* ── tests ───────────────────────────────────────────────────────────────── */

test('gate-precision: ABG mounts on the simulated environment through the real tool registry', { skip }, async () => {
  const env = await boot(matrixConfig())
  try {
    assert.equal(env.recorded.sections.length, 1, 'exactly one additive prompt section')
    assert.equal(env.recorded.sections[0].name, abg.SECTION_NAME)
    assert.ok(
      env.recorded.listeners.includes('tools/pre-execute'),
      'the mutation gate binds to the host pipeline',
    )
    assert.ok(env.host.get('fs'), 'the real local filesystem service is mounted')
    assert.ok(env.host.tools.get('record_orientation'), 'ABG registers its orientation tool')
    assert.ok(env.host.tools.get('record_question'), 'ABG registers its question tool')
  } finally {
    await env.dispose()
  }
})

test('gate-precision: the legitimate corpus is not blocked (false_block_rate = 0)', { skip }, async () => {
  const { legitimate, traps } = await runMatrix()
  const measured = report(legitimate, traps)

  assert.ok(
    measured.legitimateCalls >= 12,
    `§32.4 requires at least 12 legitimate calls; measured ${measured.legitimateCalls}`,
  )

  const blocked = legitimate.flatMap((matrixCase) =>
    matrixCase.results
      .filter((result) => result.blocked)
      .map((result) => `${matrixCase.id}: ${result.message}`),
  )
  assert.deepEqual(blocked, [], `ABG blocked authorized work:\n  ${blocked.join('\n  ')}`)
  assert.equal(measured.falseBlockRate, 0, `false_block_rate must be 0, measured ${measured.falseBlockRate}`)
})

test('gate-precision: every declared trap is blocked for its declared precondition', { skip }, async () => {
  const { legitimate, traps } = await runMatrix()

  // Setup calls belong to a trap case, not to the legitimate corpus, but a
  // legitimate registration must still never be blocked.
  const blockedSetup = traps.flatMap((entry) =>
    entry.setup
      .filter((result) => result.blocked)
      .map((result) => `${entry.trap.id} setup: ${result.message}`),
  )
  assert.deepEqual(blockedSetup, [], `ABG blocked a trap's legitimate setup call:\n  ${blockedSetup.join('\n  ')}`)

  const missed = traps
    .filter((entry) => !(entry.outcome.blocked && entry.trap.reason.test(entry.outcome.message)))
    .map((entry) => `${entry.trap.id}: ${entry.outcome.blocked ? entry.outcome.message : 'was allowed'}`)
  assert.deepEqual(missed, [], `ABG failed to block a declared trap:\n  ${missed.join('\n  ')}`)

  const trueBlocks = traps.filter((entry) => entry.outcome.blocked).length
  assert.equal(trueBlocks, buildTraps().length, 'every trap in the matrix must be caught')
  assert.equal(legitimate.length, buildLegitimateCases().length)
})
