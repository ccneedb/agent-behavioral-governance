import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig, AbgConfigError, DEFAULT_MUTATING_TOOLS } from '../../lib/kernel/config.js'

test('resolveConfig applies documented defaults', () => {
  const config = resolveConfig(undefined)
  assert.equal(config.enabled, true)
  assert.equal(config.sectionOrder, 8500)
  assert.equal(config.workspace.policy, 'ask')
  assert.deepEqual(config.workspace.mutatingTools, DEFAULT_MUTATING_TOOLS)
  assert.deepEqual(config.workspace.protectedPaths, [])
  assert.equal(config.workspace.classifyShellCommands, true)
  assert.equal(config.preStep.orientationGate, 'off')
  // Non-intrusive default, per the user decision in ARCHITECTURE-SPEC §34.2 Q1.
  assert.equal(config.preStep.requireBeforeMutation, false)
  assert.equal(config.diagnostics, true)
})

test('resolveConfig returns a frozen, detached value', () => {
  const raw = { workspace: { policy: 'deny' }, modules: { 'user-attention': { enabled: false } } }
  const config = resolveConfig(raw)
  assert.ok(Object.isFrozen(config))
  assert.ok(Object.isFrozen(config.workspace))
  // Mutating the source must not affect the resolved config.
  raw.workspace.policy = 'allow'
  assert.equal(config.workspace.policy, 'deny')
  assert.equal(config.modules['user-attention'].enabled, false)
})

test('resolveConfig rejects unknown keys at every level', () => {
  assert.throws(() => resolveConfig({ nope: 1 }), AbgConfigError)
  assert.throws(() => resolveConfig({ workspace: { nope: 1 } }), AbgConfigError)
  assert.throws(() => resolveConfig({ preStep: { nope: 1 } }), AbgConfigError)
  assert.throws(() => resolveConfig({ modules: { 'project-governance': { nope: 1 } } }), AbgConfigError)
})

test('resolveConfig rejects malformed values', () => {
  assert.throws(() => resolveConfig({ enabled: 'yes' }), AbgConfigError)
  assert.throws(() => resolveConfig({ diagnostics: 1 }), AbgConfigError)
  assert.throws(() => resolveConfig({ workspace: { policy: 'maybe' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ preStep: { orientationGate: 'block' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ workspace: { mutatingTools: 'write' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ workspace: { mutatingTools: [''] } }), AbgConfigError)
  assert.throws(() => resolveConfig([]), AbgConfigError)
})

test('resolveConfig rejects a non-finite section order', () => {
  // Verified host fact: SystemPrompt.section() throws on a non-finite order, so
  // configuration validation must catch it first.
  assert.throws(() => resolveConfig({ sectionOrder: Number.NaN }), AbgConfigError)
  assert.throws(() => resolveConfig({ sectionOrder: Number.POSITIVE_INFINITY }), AbgConfigError)
  assert.throws(() => resolveConfig({ sectionOrder: '8500' }), AbgConfigError)
})
