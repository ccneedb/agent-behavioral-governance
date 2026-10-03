/**
 * Unit: the 0.6.0 prompt store (`src/kernel/prompt-store.ts`).
 *
 * The documented precedence and the "refusal keeps the previous text" rule are
 * asserted here; the refusal mechanics themselves belong to the already-tested
 * `composePromptOverride`, which this module delegates to.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  PROMPT_FILE_NAME,
  attributedPromptVersion,
  deletePromptFile,
  readPromptFile,
  resolveEffectivePrompt,
  validatePromptText,
  writePromptFile,
} from '../../lib/kernel/prompt-store.js'

const BASE = 'compiled default text'
const HOUSE = '# House rules\n\n- Never write outside the workspace.'

test('prompt-store: the file name is prompt.md', () => {
  assert.equal(PROMPT_FILE_NAME, 'prompt.md')
})

test('prompt-store: an absent control plane leaves the config layer in charge', () => {
  assert.deepEqual(
    pick(resolveEffectivePrompt({ basePrompt: BASE, mode: 'compiled' })),
    { text: BASE, source: 'compiled', applied: false, versionSuffix: '' },
  )
  assert.deepEqual(
    pick(resolveEffectivePrompt({ basePrompt: BASE, mode: 'append', append: 'extra' })),
    { text: `${BASE}\n\nextra`, source: 'config-append', applied: true },
  )
  assert.deepEqual(
    pick(resolveEffectivePrompt({ basePrompt: BASE, mode: 'replace', configText: HOUSE })),
    { text: HOUSE, source: 'config-file', applied: true },
  )
})

test('prompt-store: prompt.md outranks every configuration layer', () => {
  const result = resolveEffectivePrompt({
    basePrompt: BASE,
    mode: 'replace',
    configText: 'config file text',
    controlText: HOUSE,
    controlPath: '/state/ieg/prompt.md',
  })
  assert.equal(result.text, HOUSE)
  assert.equal(result.source, 'control')
  assert.match(result.versionSuffix, /^\+user:/)
  assert.equal(result.controlPath, '/state/ieg/prompt.md')
})

test('prompt-store: a refused prompt.md falls back to the next layer and keeps its reasons', () => {
  const refused = resolveEffectivePrompt({
    basePrompt: BASE,
    mode: 'append',
    append: 'extra',
    controlText: 'Report {{objective}} each turn.',
  })
  assert.equal(refused.text, `${BASE}\n\nextra`, 'the config layer is used instead')
  assert.equal(refused.source, 'config-append')
  assert.equal(refused.controlRefused, true)
  assert.ok(refused.issues.some((issue) => issue.startsWith('prompt.md:') && /interpolation/.test(issue)))

  // With no config layer either, the compiled default is the safe floor.
  const bare = resolveEffectivePrompt({ basePrompt: BASE, mode: 'compiled', controlText: 'a {{ b }} c' })
  assert.equal(bare.text, BASE)
  assert.equal(bare.source, 'compiled')
})

test('prompt-store: an empty prompt.md is treated as absent', () => {
  const result = resolveEffectivePrompt({ basePrompt: BASE, mode: 'compiled', controlText: '   \n' })
  assert.equal(result.source, 'compiled')
  assert.equal(result.controlRefused, false)
})

test('prompt-store: read, write and delete round-trip atomically', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ieg-prompt-unit-'))
  try {
    const file = path.join(dir, 'ieg', 'prompt.md')
    assert.equal(readPromptFile(file).present, false)
    writePromptFile(file, HOUSE)
    assert.equal(readPromptFile(file).text, HOUSE)
    assert.equal(deletePromptFile(file), true)
    assert.equal(deletePromptFile(file), false)
    assert.equal(readPromptFile(file).present, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prompt-store: validation delegates to the override kernel and attributes the text', () => {
  const accepted = validatePromptText({ basePrompt: BASE, text: HOUSE })
  assert.equal(accepted.applied, true)
  assert.equal(accepted.bytes, Buffer.byteLength(HOUSE, 'utf8'))
  assert.match(attributedPromptVersion('0.2.0', accepted.versionSuffix), /^0\.2\.0\+user:[0-9a-z]+$/)

  const refused = validatePromptText({ basePrompt: BASE, text: 'a {{ b }} c' })
  assert.equal(refused.applied, false)
  assert.match(refused.issues[0], /interpolation/)
})

/** The subset of interest, so each assertion states exactly what it checks. */
function pick(result) {
  const { text, source, applied, versionSuffix } = result
  if (versionSuffix === '') return { text, source, applied, versionSuffix }
  return { text, source, applied }
}
