import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAgentState, createGovernanceState, agentIdOf } from '../../lib/kernel/state.js'

test('state: one agent always resolves to the same orientation state, distinct from another', () => {
  const governance = createGovernanceState()
  const first = { id: 'agent-a' }
  const second = { id: 'agent-b' }

  assert.equal(governance.forAgent(first), governance.forAgent(first))
  assert.notEqual(governance.forAgent(first), governance.forAgent(second))
  assert.notEqual(governance.forAgent(first).orientation, governance.forAgent(second).orientation)
})

test('state: a seam without an agent shares one unscoped bucket', () => {
  const governance = createGovernanceState()
  assert.equal(governance.forAgent(undefined), governance.unscoped)
  assert.equal(governance.forAgent(null), governance.unscoped)
  assert.equal(governance.forAgent(undefined), governance.forAgent(null))
})

test('state: primitive subjects never become WeakMap keys', () => {
  const governance = createGovernanceState()
  for (const subject of [42, 'agent', true, Symbol('s')]) {
    assert.equal(governance.forAgent(subject), governance.unscoped)
  }
})

test('state: orientation recorded for one agent is invisible to another', () => {
  const governance = createGovernanceState()
  const first = { id: 'agent-a' }
  const second = { id: 'agent-b' }

  governance.forAgent(first).orientation.record({ intent: 'i', objective: 'o', scope: 's' })

  assert.equal(governance.forAgent(first).orientation.isRecorded(), true)
  assert.equal(governance.forAgent(second).orientation.isRecorded(), false)
  assert.equal(governance.unscoped.orientation.isRecorded(), false)
})

test('state: createAgentState builds the orientation store', () => {
  const state = createAgentState()
  assert.equal(typeof state.orientation.record, 'function')
  assert.equal(typeof state.orientation.isRecorded, 'function')
  assert.equal(state.orientation.isRecorded(), false)
})

test('state: agentIdOf tolerates subjects without a usable id', () => {
  assert.equal(agentIdOf({ id: 'agent-a' }), 'agent-a')
  assert.equal(agentIdOf({}), '')
  assert.equal(agentIdOf({ id: 7 }), '')
  assert.equal(agentIdOf(undefined), '')
  assert.equal(agentIdOf(null), '')
  assert.equal(agentIdOf('not-an-agent'), '')
})
