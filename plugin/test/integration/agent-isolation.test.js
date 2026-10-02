/**
 * Per-agent isolation (ARCHITECTURE-SPEC Part B §25, Gate H).
 *
 * The `0.1.0` prototype held one orientation and one question ledger per
 * composition, so two concurrent agents shared both. These tests mount ABG once
 * and drive two distinct live-agent objects through the same listeners, which is
 * exactly the arrangement that used to leak state between agents.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as abg from '../../lib/index.js'

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

  /** @param {string} level */
  const record = (level) => (/** @type {string} */ message) => {
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
    /** Simulate the tool registry becoming available. */
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

/** Two live agents with distinct ids and sessions, as DSH would hand them over. */
const agentA = { id: 'agent-a', session: { id: 'session-a' } }
const agentB = { id: 'agent-b', session: { id: 'session-b' } }

test('isolation: the orientation requirement is satisfied per agent, not per composition', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { workspace: { policy: 'allow' }, preStep: { requireBeforeMutation: true } })
  stub.mountTools()

  const handler = stub.listeners.get('tools/pre-execute')[0]
  const orientationTool = stub.tools.find((tool) => tool.name === 'record_orientation')
  assert.ok(orientationTool, 'the orientation tool must be registered')
  const next = async () => ({ kind: 'allow' })

  // Neither agent has oriented yet.
  const beforeA = await handler({ name: 'write', arguments: { file_path: '/repo/a.md' }, agent: agentA }, next)
  const beforeB = await handler({ name: 'write', arguments: { file_path: '/repo/b.md' }, agent: agentB }, next)
  assert.equal(beforeA.kind, 'deny')
  assert.equal(beforeB.kind, 'deny')

  // Agent A orients: only A is admitted, and the call carries A's own subject.
  await orientationTool.execute({ intent: 'i-a', objective: 'o-a', scope: 's-a' }, { agent: agentA })
  const afterA = await handler({ name: 'write', arguments: { file_path: '/repo/a.md' }, agent: agentA }, next)
  assert.equal(afterA.kind, 'allow', "agent A's own orientation must admit A")

  const blockedB = await handler({ name: 'write', arguments: { file_path: '/repo/b.md' }, agent: agentB }, next)
  assert.equal(blockedB.kind, 'deny', "agent B must not inherit agent A's orientation")
  assert.match(blockedB.reason, /record the project orientation/)

  // A seam without an agent must not inherit either agent's orientation.
  const unscoped = await handler({ name: 'write', arguments: { file_path: '/repo/c.md' } }, next)
  assert.equal(unscoped.kind, 'deny')

  // B orients independently; both are then admitted.
  await orientationTool.execute({ intent: 'i-b', objective: 'o-b', scope: 's-b' }, { agent: agentB })
  assert.equal((await handler({ name: 'write', arguments: { file_path: '/repo/b.md' }, agent: agentB }, next)).kind, 'allow')
  assert.equal((await handler({ name: 'write', arguments: { file_path: '/repo/a.md' }, agent: agentA }, next)).kind, 'allow')
})

test('isolation: question ledgers do not cross agents', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { userAttention: { enforceBatchCompleteness: true } })
  stub.mountTools()

  const handler = stub.listeners.get('tools/pre-execute')[0]
  const questionTool = stub.tools.find((tool) => tool.name === 'record_question')
  assert.ok(questionTool, 'the question tool must be registered')
  const next = async () => ({ kind: 'allow' })

  await questionTool.execute(
    { id: 'q-a1', question: 'Which database?', kind: 'deterministic-blocker' },
    { agent: agentA },
  )

  // A's incomplete batch is refused; B's identical batch is untouched by A's ledger.
  const aDecision = await handler(
    { name: 'ask_user_question', arguments: { questions: [{ id: 'z' }] }, agent: agentA },
    next,
  )
  assert.equal(aDecision.kind, 'deny')
  assert.match(aDecision.reason, /q-a1/)

  const bDecision = await handler(
    { name: 'ask_user_question', arguments: { questions: [{ id: 'z' }] }, agent: agentB },
    next,
  )
  assert.equal(bDecision.kind, 'allow', "agent B must not owe agent A's registered question")
})

test('isolation: the pre-step gate evaluates each step against its own agent', async () => {
  const stub = stubContext()
  abg.apply(stub.ctx, { preStep: { orientationGate: 'reject' } })
  stub.mountTools()

  const preStep = stub.listeners.get('agent/pre-step')[0]
  const orientationTool = stub.tools.find((tool) => tool.name === 'record_orientation')
  const next = async () => ({ kind: 'enter', messages: [] })

  assert.deepEqual(await preStep({ agent: agentA, messages: [], turn: 1, step: 1 }, next), { kind: 'reject' })

  await orientationTool.execute(
    {
      intent: 'i-a',
      objective: 'o-a',
      scope: 's-a',
      terminology: [{ term: 'project', definition: 'the subject of this task' }],
    },
    { agent: agentA },
  )

  assert.deepEqual(await preStep({ agent: agentA, messages: [], turn: 1, step: 1 }, next), {
    kind: 'enter',
    messages: [],
  })
  assert.deepEqual(await preStep({ agent: agentB, messages: [], turn: 1, step: 1 }, next), { kind: 'reject' })
})
