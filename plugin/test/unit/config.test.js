import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveConfig, AbgConfigError, DEFAULT_MUTATING_TOOLS } from '../../lib/kernel/config.js'
import { buildGovernance } from '../../lib/index.js'

/** The shipped composition row, read by the regression test at the bottom. */
const PATCH_PATH = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))

/**
 * The DSH CLI's own `node_modules`, which carries the real `yaml` parser the host
 * uses. Overridable for other installations, like `test-support/dsh.js`.
 */
const DSH_PACKAGES =
  process.env.ABG_DSH_PACKAGES ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
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

// ─────────────────────────────────────────────────────────────────────────────
// Regression: path-valued fields accept the empty string.
//
// `cordis.patch.yml` ships `prompt: { file: "" }` and
// `diagnosticsExport: { file: "" }`, where `''` is the documented value for
// "none configured". Validating them with the non-empty-string rule made the
// plugin reject its own shipped configuration, and because `apply()` must not
// throw (§26.2) a default install mounted the inert fault surface: no prompt
// section, no hooks, no tools, no GUI route, and no host warning. These tests
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
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace', file: '' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace', file: '   ' } }), AbgConfigError)
})

test('a whitespace-only path is refused for both path-valued fields', () => {
  // Whitespace is always a typo, never an intentional "none".
  assert.throws(() => resolveConfig({ prompt: { file: '   ' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ prompt: { file: '\t' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ diagnosticsExport: { file: ' \n ' } }), AbgConfigError)
})

test('a non-string path is refused for both path-valued fields', () => {
  for (const value of [42, null, false, [], {}]) {
    assert.throws(() => resolveConfig({ prompt: { file: value } }), AbgConfigError)
    assert.throws(() => resolveConfig({ diagnosticsExport: { file: value } }), AbgConfigError)
  }
})

test('the shipped cordis.patch.yml is accepted by resolveConfig and buildGovernance', (t) => {
  const YAML = loadYaml()
  if (YAML === undefined) return t.skip('the DSH-installed `yaml` parser is not available')

  const document = YAML.parse(readFileSync(PATCH_PATH, 'utf8'))
  assert.ok(Array.isArray(document), 'the patch is a list of layers')
  const rows = document.flatMap((layer) => (Array.isArray(layer?.insert) ? layer.insert : []))
  const abg = rows.find((row) => row?.id === 'abg')
  assert.ok(abg, 'the patch must insert the abg row')
  assert.equal(abg.name, 'dsh-agent-behavioral-governance')

  const resolved = resolveConfig(abg.config)
  assert.equal(resolved.prompt.file, '', 'the shipped prompt.file is the default "none"')
  assert.equal(resolved.diagnosticsExport.file, '', 'the shipped diagnosticsExport.file means "off"')
  // `buildGovernance` is what threw on the shipped configuration; `apply()` then
  // swallowed it into the fault surface.
  assert.doesNotThrow(() => buildGovernance(abg.config))
})

