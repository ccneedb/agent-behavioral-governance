import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createProjectState,
  applyProjectEvent,
  orientationStatus,
  evaluateOrientationGate,
  REQUIRED_ORIENTATION_FIELDS,
} from '../../lib/modules/project-governance.js'

function orientedState() {
  let state = createProjectState()
  state = applyProjectEvent(state, { type: 'set-intent', value: 'govern agent behaviour' })
  state = applyProjectEvent(state, { type: 'set-objective', value: 'reduce recurring failures' })
  state = applyProjectEvent(state, { type: 'set-scope', value: 'project work' })
  state = applyProjectEvent(state, { type: 'define-term', term: 'IEG', definition: 'information environment governance' })
  return state
}

test('a fresh project state is unoriented', () => {
  const state = createProjectState()
  const status = orientationStatus(state)
  assert.equal(status.oriented, false)
  assert.deepEqual(status.missing, [...REQUIRED_ORIENTATION_FIELDS, 'terminology'])
})

test('applying an event does not mutate the input state', () => {
  const before = createProjectState()
  const after = applyProjectEvent(before, { type: 'set-intent', value: 'x' })
  assert.equal(before.intent, '')
  assert.equal(after.intent, 'x')
  assert.notEqual(before, after)
})

test('terminology is copied, not aliased, across events', () => {
  const state = applyProjectEvent(createProjectState(), { type: 'define-term', term: 'A', definition: 'one' })
  const next = applyProjectEvent(state, { type: 'define-term', term: 'B', definition: 'two' })
  assert.deepEqual(Object.keys(state.terminology), ['A'])
  assert.deepEqual(Object.keys(next.terminology).sort(), ['A', 'B'])
})

test('the full orientation is recognised as oriented', () => {
  const status = orientationStatus(orientedState())
  assert.equal(status.oriented, true)
  assert.deepEqual(status.missing, [])
})

test('unknowns can be raised and resolved', () => {
  let state = applyProjectEvent(createProjectState(), { type: 'add-unknown', value: 'which DSH version?' })
  state = applyProjectEvent(state, { type: 'add-assumption', value: 'assume rc.2' })
  state = applyProjectEvent(state, { type: 'add-constraint', value: 'no new deps' })
  assert.deepEqual(state.unknowns, ['which DSH version?'])
  assert.deepEqual(state.assumptions, ['assume rc.2'])
  assert.deepEqual(state.constraints, ['no new deps'])

  const resolved = applyProjectEvent(state, { type: 'resolve-unknown', value: 'which DSH version?' })
  assert.deepEqual(resolved.unknowns, [])
})

test('an unrecognised event is a no-op that returns the same state', () => {
  const state = createProjectState()
  assert.equal(applyProjectEvent(state, { type: /** @type {any} */ ('bogus') }), state)
})

test('the orientation gate never blocks unless configured to reject', () => {
  const unoriented = createProjectState()

  const off = evaluateOrientationGate(unoriented, 'off')
  assert.equal(off.decision, null)
  assert.ok(off.missing.length > 0)

  const warn = evaluateOrientationGate(unoriented, 'warn')
  assert.equal(warn.decision, null)

  const reject = evaluateOrientationGate(unoriented, 'reject')
  assert.deepEqual(reject.decision, { kind: 'reject' })
})

test('the rejection gate admits an oriented project', () => {
  const result = evaluateOrientationGate(orientedState(), 'reject')
  assert.equal(result.decision, null)
  assert.deepEqual(result.missing, [])
})
