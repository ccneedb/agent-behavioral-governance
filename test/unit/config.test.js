import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveConfig, IegConfigError, DEFAULT_MUTATING_TOOLS } from '../../lib/kernel/config.js'
import { buildGovernance } from '../../lib/index.js'

/** The shipped composition row, read by the regression test at the bottom. */
const PATCH_PATH = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))

/**
 * The DSH CLI's own `node_modules`, which carries the real `yaml` parser the host
 * uses. Overridable for other installations, like `test-support/dsh.js`.
 */
const DSH_PACKAGES =
  process.env.IEG_DSH_PACKAGES ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const DSH_NODE_MODULES = path.resolve(DSH_PACKAGES, '..')

/**
 * Load the DSH-installed `yaml` parser without adding a dependency. Returns
 * `undefined` when no DSH installation is present; the test then skips rather
 * than failing, so the unit suite stays portable.
 *
 * @returns {any | undefined}
 */
function loadYaml() {
  try {
    return createRequire(path.join(DSH_NODE_MODULES, 'noop.js'))('yaml')
  } catch {
    return undefined
  }
}

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
  const raw = { workspace: { policy: 'deny' }, modules: { 'workspace-governance': { enabled: false } } }
  const config = resolveConfig(raw)
  assert.ok(Object.isFrozen(config))
  assert.ok(Object.isFrozen(config.workspace))
  // Mutating the source must not affect the resolved config.
  raw.workspace.policy = 'allow'
  assert.equal(config.workspace.policy, 'deny')
  assert.equal(config.modules['workspace-governance'].enabled, false)
})

test('resolveConfig rejects unknown keys at every level', () => {
  assert.throws(() => resolveConfig({ nope: 1 }), IegConfigError)
  assert.throws(() => resolveConfig({ workspace: { nope: 1 } }), IegConfigError)
  assert.throws(() => resolveConfig({ preStep: { nope: 1 } }), IegConfigError)
  assert.throws(() => resolveConfig({ modules: { 'project-governance': { nope: 1 } } }), IegConfigError)
})

test('resolveConfig rejects the withdrawn userAttention key as an unknown top-level key', () => {
  // `user-attention` and its `userAttention` config key were removed in 0.7.0, so
  // a composition that still carries the key must fail at load rather than being
  // silently ignored (the strict-validation contract this suite pins).
  assert.throws(() => resolveConfig({ userAttention: { enforceBatchCompleteness: true } }), IegConfigError)
})

test('resolveConfig rejects malformed values', () => {
  assert.throws(() => resolveConfig({ enabled: 'yes' }), IegConfigError)
  assert.throws(() => resolveConfig({ diagnostics: 1 }), IegConfigError)
  assert.throws(() => resolveConfig({ workspace: { policy: 'maybe' } }), IegConfigError)
  assert.throws(() => resolveConfig({ preStep: { orientationGate: 'block' } }), IegConfigError)
  assert.throws(() => resolveConfig({ workspace: { mutatingTools: 'write' } }), IegConfigError)
  assert.throws(() => resolveConfig({ workspace: { mutatingTools: [''] } }), IegConfigError)
  assert.throws(() => resolveConfig([]), IegConfigError)
})

test('resolveConfig rejects a non-finite section order', () => {
  // Verified host fact: SystemPrompt.section() throws on a non-finite order, so
  // configuration validation must catch it first.
  assert.throws(() => resolveConfig({ sectionOrder: Number.NaN }), IegConfigError)
  assert.throws(() => resolveConfig({ sectionOrder: Number.POSITIVE_INFINITY }), IegConfigError)
  assert.throws(() => resolveConfig({ sectionOrder: '8500' }), IegConfigError)
})

// ─────────────────────────────────────────────────────────────────────────────
// Regression: path-valued fields accept the empty string.
//
// `cordis.patch.yml` ships `prompt: { file: "" }` and
// `diagnosticsExport: { file: "" }`, where `''` is the documented value for
// "none configured". Validating them with the non-empty-string rule made the
// plugin reject its own shipped configuration, and because `apply()` must not
// throw (§26.2) a default install mounted the inert fault surface: no prompt
// section, no hooks, no tools, and no host warning. These tests
// pin the accepting half; the patch-file test below pins the file that broke.
// ─────────────────────────────────────────────────────────────────────────────

test('an empty path is accepted wherever "none configured" is a documented value', () => {
  assert.equal(resolveConfig(undefined).prompt.file, '')
  assert.equal(resolveConfig(undefined).diagnosticsExport.file, '')
  // Every mode except `replace`, which requires a path.
  assert.equal(resolveConfig({ prompt: { file: '' } }).prompt.file, '')
  assert.equal(resolveConfig({ prompt: { mode: 'compiled', file: '' } }).prompt.file, '')
  assert.equal(resolveConfig({ prompt: { mode: 'append', file: '' } }).prompt.file, '')
  assert.equal(resolveConfig({ diagnosticsExport: { file: '' } }).diagnosticsExport.file, '')
})

test('a real path still round-trips for both path-valued fields', () => {
  assert.equal(resolveConfig({ prompt: { mode: 'replace', file: '/tmp/p.md' } }).prompt.file, '/tmp/p.md')
  assert.equal(
    resolveConfig({ diagnosticsExport: { file: '/tmp/status.json' } }).diagnosticsExport.file,
    '/tmp/status.json',
  )
})

test('prompt.file is still required when prompt.mode is "replace"', () => {
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace' } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace', file: '' } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace', file: '   ' } }), IegConfigError)
})

test('a whitespace-only path is refused for both path-valued fields', () => {
  // Whitespace is always a typo, never an intentional "none".
  assert.throws(() => resolveConfig({ prompt: { file: '   ' } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { file: '\t' } }), IegConfigError)
  assert.throws(() => resolveConfig({ diagnosticsExport: { file: ' \n ' } }), IegConfigError)
})

test('a non-string path is refused for both path-valued fields', () => {
  for (const value of [42, null, false, [], {}]) {
    assert.throws(() => resolveConfig({ prompt: { file: value } }), IegConfigError)
    assert.throws(() => resolveConfig({ diagnosticsExport: { file: value } }), IegConfigError)
  }
})

test('the shipped cordis.patch.yml is accepted by resolveConfig and buildGovernance', (t) => {
  const YAML = loadYaml()
  if (YAML === undefined) return t.skip('the DSH-installed `yaml` parser is not available')

  const document = YAML.parse(readFileSync(PATCH_PATH, 'utf8'))
  assert.ok(Array.isArray(document), 'the patch is a list of layers')
  const rows = document.flatMap((layer) => (Array.isArray(layer?.insert) ? layer.insert : []))
  const ieg = rows.find((row) => row?.id === 'ieg')
  assert.ok(ieg, 'the patch must insert the ieg row')
  assert.equal(ieg.name, 'dsh-information-environment-governance')

  const resolved = resolveConfig(ieg.config)
  assert.equal(resolved.prompt.file, '', 'the shipped prompt.file is the default "none"')
  assert.equal(resolved.diagnosticsExport.file, '', 'the shipped diagnosticsExport.file means "off"')
  // `buildGovernance` is what threw on the shipped configuration; `apply()` then
  // swallowed it into the fault surface.
  assert.doesNotThrow(() => buildGovernance(ieg.config))
})

