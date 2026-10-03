/**
 * User-editable prompt (`ARCHITECTURE-SPEC` §27.1).
 *
 * The value of this feature depends on it failing *loudly*: a user edit that
 * breaks a hard requirement must fall back to the audited default and say so,
 * and any applied edit must be attributable through `PROMPT_VERSION`. Those two
 * properties, plus the soft-invariant disclosure, are what these tests pin.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  UNCHECKED_INVARIANTS,
  composePromptOverride,
  shortHash,
} from '../../lib/kernel/prompt-override.js'
import { buildGovernance, PROMPT_VERSION } from '../../lib/index.js'
import { resolveConfig, IegConfigError } from '../../lib/kernel/config.js'
import { DEFAULT_MAX_PROMPT_BYTES } from '../../lib/kernel/prompt-compiler.js'

const BASE = '## Information Environment Governance (IEG)\n\n- Prefer a safe refusal.\n'

test('compiled mode changes nothing and claims no override', () => {
  const result = composePromptOverride({ mode: 'compiled', basePrompt: BASE })
  assert.equal(result.text, BASE)
  assert.equal(result.applied, false)
  assert.equal(result.versionSuffix, '')
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.unchecked, [])
})

test('append mode adds guidance and reports the soft invariants as unchecked', () => {
  const result = composePromptOverride({
    mode: 'append',
    append: 'Cite the file you changed in the final summary.',
    basePrompt: BASE,
  })
  assert.equal(result.applied, true)
  assert.ok(result.text.startsWith(BASE))
  assert.match(result.text, /Cite the file you changed/)
  assert.match(result.versionSuffix, /^\+user:/)
  assert.deepEqual(result.unchecked, [...UNCHECKED_INVARIANTS])
  assert.deepEqual(result.issues, [])
})

test('an empty append is reported, not silently ignored', () => {
  const result = composePromptOverride({ mode: 'append', append: '   ', basePrompt: BASE })
  assert.equal(result.applied, false)
  assert.equal(result.text, BASE)
  assert.match(result.issues[0], /prompt\.append is empty/)
})

test('replace mode uses the supplied text verbatim', () => {
  const override = '# House rules\n\n- Never write outside the workspace.\n'
  const result = composePromptOverride({ mode: 'replace', overrideText: override, basePrompt: BASE })
  assert.equal(result.applied, true)
  assert.equal(result.text, override.trim())
  assert.match(result.versionSuffix, /^\+user:/)
})

test('replace mode without usable text falls back to the compiled default', () => {
  const result = composePromptOverride({ mode: 'replace', overrideText: '  ', basePrompt: BASE })
  assert.equal(result.applied, false)
  assert.equal(result.text, BASE)
  assert.match(result.issues[0], /override text is unavailable/)
})

test('interpolation syntax is a hard refusal, never a silent hazard', () => {
  const result = composePromptOverride({
    mode: 'append',
    append: 'Report the value of {{objective}} each turn.',
    basePrompt: BASE,
  })
  assert.equal(result.applied, false)
  assert.equal(result.text, BASE)
  assert.match(result.issues[0], /interpolation syntax/)
})

test('the byte ceiling is enforced unless explicitly waived', () => {
  const huge = `- ${'x'.repeat(DEFAULT_MAX_PROMPT_BYTES)}`
  const refused = composePromptOverride({ mode: 'replace', overrideText: huge, basePrompt: BASE })
  assert.equal(refused.applied, false)
  assert.match(refused.issues[0], /over the \d+-byte ceiling/)

  const allowed = composePromptOverride({
    mode: 'replace',
    overrideText: huge,
    basePrompt: BASE,
    allowOverBudget: true,
  })
  assert.equal(allowed.applied, true)
  assert.match(allowed.issues[0], /exceeds the \d+-byte ceiling by explicit configuration/)
})

test('the attribution hash is stable and text-specific', () => {
  assert.equal(shortHash('abc'), shortHash('abc'))
  assert.notEqual(shortHash('abc'), shortHash('abd'))
  assert.match(shortHash('abc'), /^[0-9a-z]{7}$/)
})

test('buildGovernance applies the configured override and versions it', () => {
  const plain = buildGovernance(undefined)
  assert.equal(plain.promptOverridden, false)
  assert.equal(plain.promptVersion, PROMPT_VERSION)
  assert.ok(plain.compiledBytes > 0)

  const appended = buildGovernance({
    prompt: { mode: 'append', append: 'Always name the file you changed.' },
  })
  assert.equal(appended.promptOverridden, true)
  assert.match(appended.prompt, /Always name the file you changed\./)
  assert.match(appended.promptVersion, new RegExp(`^${PROMPT_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\+user:`))
  assert.equal(appended.compiledBytes < appended.stats.bytes, true)
  assert.deepEqual(appended.promptUnchecked, [...UNCHECKED_INVARIANTS])

  const replaced = buildGovernance({ prompt: { mode: 'replace', file: '/ignored' } }, { overrideText: '# Mine\n' })
  assert.equal(replaced.prompt, '# Mine')
  assert.equal(replaced.promptOverridden, true)
})

test('resolveConfig validates the prompt and diagnostics-export blocks', () => {
  const defaults = resolveConfig(undefined)
  assert.deepEqual(
    { ...defaults.prompt },
    { mode: 'compiled', append: '', file: '', allowOverBudget: false },
  )
  assert.deepEqual({ ...defaults.diagnosticsExport }, { file: '', limit: 50 })

  assert.equal(resolveConfig({ prompt: { mode: 'append', append: 'x' } }).prompt.append, 'x')
  assert.throws(() => resolveConfig({ prompt: { mode: 'rewrite' } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { mode: 'replace' } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { append: 1 } }), IegConfigError)
  assert.throws(() => resolveConfig({ prompt: { nope: 1 } }), IegConfigError)
  assert.equal(resolveConfig({ diagnosticsExport: { file: '/tmp/a.json', limit: 10 } }).diagnosticsExport.limit, 10)
  assert.throws(() => resolveConfig({ diagnosticsExport: { limit: 0 } }), IegConfigError)
  assert.throws(() => resolveConfig({ diagnosticsExport: { limit: 500 } }), IegConfigError)
  assert.throws(() => resolveConfig({ diagnosticsExport: { limit: 1.5 } }), IegConfigError)
  assert.throws(() => resolveConfig({ diagnosticsExport: { nope: 1 } }), IegConfigError)
})
