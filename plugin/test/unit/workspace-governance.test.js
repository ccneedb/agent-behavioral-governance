import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyMutation,
  decideMutation,
  extractTargets,
  isProtectedPath,
  guardBackstop,
} from '../../lib/modules/workspace-governance.js'

const POLICY = { mutatingTools: ['write', 'edit', 'bash'], protectedPaths: [] }

test('a tool outside the mutating set is read-only', () => {
  const classification = classifyMutation('read', { file_path: '/tmp/x' }, POLICY)
  assert.equal(classification.kind, 'read-only')
  assert.deepEqual(decideMutation(classification, { policy: 'deny', protectedPaths: [] }), { kind: 'allow' })
})

test('a mutating tool is classified with its targets', () => {
  const classification = classifyMutation('write', { file_path: '/w/a.txt' }, POLICY)
  assert.equal(classification.kind, 'persistent-mutation')
  assert.deepEqual(classification.targets, ['/w/a.txt'])
})

test('targets are extracted from every known argument key', () => {
  assert.deepEqual(extractTargets('write', { file_path: '/a', path: '/b' }), ['/a', '/b'])
  assert.deepEqual(extractTargets('edit', { target: '/c' }), ['/c'])
  assert.deepEqual(extractTargets('read', { nope: 1 }), [])
})

test('a shell command becomes an opaque shell target', () => {
  const targets = extractTargets('bash', { command: 'rm -rf build' })
  assert.deepEqual(targets, ['<shell> rm -rf build'])
})

test('protected paths match the path itself and anything beneath it', () => {
  const protectedPaths = ['/repo/secrets', '/repo/.env']
  assert.equal(isProtectedPath('/repo/secrets', protectedPaths), true)
  assert.equal(isProtectedPath('/repo/secrets/key.pem', protectedPaths), true)
  assert.equal(isProtectedPath('/repo/.env', protectedPaths), true)
  // A sibling with a shared prefix must not match.
  assert.equal(isProtectedPath('/repo/secrets-public/key.pem', protectedPaths), false)
  assert.equal(isProtectedPath('/repo/src/index.ts', protectedPaths), false)
})

test('the ask policy delegates the decision to the host approval service', () => {
  const classification = classifyMutation('write', { file_path: '/w/a' }, POLICY)
  const decision = decideMutation(classification, { policy: 'ask', protectedPaths: [] })
  assert.equal(decision.kind, 'ask')
  assert.match(/** @type {any} */ (decision).reason, /confirm persistent workspace mutation/)
})

test('the deny policy refuses outright', () => {
  const classification = classifyMutation('write', { file_path: '/w/a' }, POLICY)
  const decision = decideMutation(classification, { policy: 'deny', protectedPaths: [] })
  assert.equal(decision.kind, 'deny')
})

test('the allow policy admits the mutation', () => {
  const classification = classifyMutation('write', { file_path: '/w/a' }, POLICY)
  assert.deepEqual(decideMutation(classification, { policy: 'allow', protectedPaths: [] }), { kind: 'allow' })
})

test('a protected path is refused even under the allow policy', () => {
  const policy = { mutatingTools: ['write'], protectedPaths: ['/repo/secrets'] }
  const classification = classifyMutation('write', { file_path: '/repo/secrets/key.pem' }, policy)
  assert.equal(classification.protected, true)
  const decision = decideMutation(classification, policy)
  assert.equal(decision.kind, 'deny')
  assert.match(/** @type {any} */ (decision).reason, /protected path/)
})

test('the monotonic guard backstop denies protected mutations only', () => {
  const policy = { mutatingTools: ['write'], protectedPaths: ['/repo/secrets'] }

  assert.match(
    String(guardBackstop({ name: 'write', arguments: { file_path: '/repo/secrets/x' } }, policy)),
    /protected path/,
  )
  assert.equal(guardBackstop({ name: 'write', arguments: { file_path: '/repo/src/x' } }, policy), undefined)
  // `read` is not in the mutating set, so it is never a mutation to guard.
  assert.equal(guardBackstop({ name: 'read', arguments: { file_path: '/repo/secrets/x' } }, policy), undefined)
  // With no protected paths configured the guard is inert.
  assert.equal(
    guardBackstop({ name: 'write', arguments: { file_path: '/repo/secrets/x' } }, { mutatingTools: ['write'], protectedPaths: [] }),
    undefined,
  )
})
