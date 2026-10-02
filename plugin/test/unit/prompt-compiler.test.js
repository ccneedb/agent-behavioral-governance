import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  compilePrompt,
  promptStats,
  utf8Bytes,
  containsInterpolationSyntax,
  DEFAULT_MAX_PROMPT_BYTES,
  PROMPT_BYTE_FLOOR,
  PROMPT_BYTE_HARD_CAP,
  RECORDED_PROMPT_BYTES,
} from '../../lib/kernel/prompt-compiler.js'
import { MODULES, KERNEL_PRINCIPLES, buildGovernance } from '../../lib/index.js'

/** @param {Partial<GovernanceModule> & { id: string }} overrides */
function moduleFixture(overrides) {
  return {
    version: '1',
    problem: 'p',
    objective: 'o',
    principles: [],
    risk: 'low',
    enabledByDefault: true,
    ...overrides,
  }
}

test('utf8Bytes counts multi-byte characters correctly', () => {
  assert.equal(utf8Bytes('abc'), 3)
  assert.equal(utf8Bytes('é'), 2)
  assert.equal(utf8Bytes('→'), 3)
  assert.equal(utf8Bytes('漢'), 3)
})

test('containsInterpolationSyntax detects host prompt-variable syntax', () => {
  assert.equal(containsInterpolationSyntax('plain text'), false)
  assert.equal(containsInterpolationSyntax('a {{var}} b'), true)
  assert.equal(containsInterpolationSyntax('a }} b'), true)
})

test('an empty module set compiles to nothing', () => {
  assert.equal(compilePrompt({ kernelPrinciples: [], modules: [] }), '')
})

test('the compiled section has one header and one bullet per unique principle', () => {
  const text = compilePrompt({
    kernelPrinciples: ['Alpha rule.', 'Beta rule.'],
    modules: [moduleFixture({ id: 'm1', principles: ['Gamma rule.'] })],
  })
  assert.match(text, /^## Agent Behavioral Governance \(ABG\)/)
  assert.match(text, /### Operating invariants/)
  assert.match(text, /### m1/)
  assert.equal(text.match(/^- Alpha rule\.$/gm)?.length, 1)
  assert.equal(text.match(/^- Gamma rule\.$/gm)?.length, 1)
})

test('duplicate statements across kernel and modules are emitted once', () => {
  const text = compilePrompt({
    kernelPrinciples: ['Prefer a safe refusal.'],
    modules: [
      moduleFixture({ id: 'm1', principles: ['prefer a safe refusal'] }),
      moduleFixture({ id: 'm2', principles: ['Prefer a safe refusal!'] }),
    ],
  })
  // Normalisation strips trailing punctuation and case, so all three collapse.
  assert.equal(text.toLowerCase().match(/prefer a safe refusal/g)?.length, 1)
  // A module whose principles were all duplicates contributes no section.
  assert.doesNotMatch(text, /### m1/)
  assert.doesNotMatch(text, /### m2/)
})

test('a module prompt fragment is appended under its heading', () => {
  const text = compilePrompt({
    kernelPrinciples: [],
    modules: [moduleFixture({ id: 'm1', principles: ['Rule one.'], prompt: 'Extra guidance.' })],
  })
  assert.match(text, /### m1\n- Rule one\.\n\nExtra guidance\./)
})

test('the compiler enforces the prompt budget', () => {
  const big = 'x'.repeat(500)
  assert.throws(
    () => compilePrompt({ kernelPrinciples: [big], modules: [], maxBytes: 100 }),
    /over the 100-byte budget/,
  )
  // The same content fits when the budget allows it.
  assert.doesNotThrow(() => compilePrompt({ kernelPrinciples: [big], modules: [], maxBytes: 5000 }))
})

test('the compiler refuses to emit interpolation syntax', () => {
  // The section is also registered with `interpolate: false`; this is the second,
  // independent defence, because renderPrompt throws on unknown references.
  assert.throws(
    () => compilePrompt({ kernelPrinciples: ['Use {{project_name}} here.'], modules: [] }),
    /interpolation syntax/,
  )
})

test('promptStats reports bytes, characters, and lines', () => {
  const stats = promptStats('ab\ncd')
  assert.equal(stats.characters, 5)
  assert.equal(stats.bytes, 5)
  assert.equal(stats.lines, 2)
  assert.deepEqual(promptStats(''), { bytes: 0, characters: 0, lines: 0 })
})

test('the shipped governance section compiles and stays inside the default budget', () => {
  const { prompt, stats, enabled } = buildGovernance(undefined)
  assert.equal(enabled.length, 4)
  assert.ok(stats.bytes > 0)
  assert.ok(stats.bytes <= DEFAULT_MAX_PROMPT_BYTES, `section is ${stats.bytes} bytes`)
  // The recorded footprint must still describe the text it bounds: a prompt
  // change within the +10 % tolerance may leave it alone, but a larger revision
  // must re-record it and attribute the change (PR-07/PR-08).
  assert.ok(
    Math.abs(stats.bytes - RECORDED_PROMPT_BYTES) <= Math.ceil(RECORDED_PROMPT_BYTES * 0.1),
    `recorded footprint ${RECORDED_PROMPT_BYTES} bytes no longer describes the ${stats.bytes}-byte section`,
  )
  assert.equal(containsInterpolationSyntax(prompt), false)
  for (const module of MODULES) {
    assert.match(prompt, new RegExp(`### ${module.id}`), `${module.id} heading missing`)
  }
  for (const principle of KERNEL_PRINCIPLES) {
    assert.ok(prompt.toLowerCase().includes(principle.toLowerCase().slice(0, 40)))
  }
})

test('the default budget is the §34.1 B6 ceiling: recorded + 10 %, floored and capped', () => {
  assert.equal(
    DEFAULT_MAX_PROMPT_BYTES,
    Math.min(PROMPT_BYTE_HARD_CAP, Math.max(PROMPT_BYTE_FLOOR, Math.ceil(RECORDED_PROMPT_BYTES * 1.1))),
  )
  assert.ok(DEFAULT_MAX_PROMPT_BYTES <= PROMPT_BYTE_HARD_CAP)
  assert.ok(DEFAULT_MAX_PROMPT_BYTES >= PROMPT_BYTE_FLOOR)
})

test('a disabled module drops out of the compiled section', () => {
  const { prompt } = buildGovernance({ modules: { 'user-attention': { enabled: false } } })
  assert.doesNotMatch(prompt, /### user-attention/)
  assert.match(prompt, /### project-governance/)
})

test('disabling the whole plugin compiles no section', () => {
  const { prompt, stats } = buildGovernance({ enabled: false })
  assert.equal(prompt, '')
  assert.equal(stats.bytes, 0)
})

test('§5.2 a fragment sentence restating a principle is removed', () => {
  const text = compilePrompt({
    kernelPrinciples: [],
    modules: [
      moduleFixture({
        id: 'm1',
        principles: ['Never claim authorization the user has not given.'],
        prompt: 'Never claim authorization the user has not given. Prefer a safe refusal to mutate.',
      }),
    ],
  })
  // The first fragment sentence duplicates the principle and must appear once.
  assert.equal(text.match(/never claim authorization the user has not given/gi)?.length, 1)
  // The sentence that adds new guidance survives.
  assert.match(text, /Prefer a safe refusal to mutate\./)
})

test('§5.2 a fragment that only restates principles is dropped entirely', () => {
  const text = compilePrompt({
    kernelPrinciples: [],
    modules: [
      moduleFixture({
        id: 'm1',
        principles: ['Distinguish inspection from mutation.'],
        prompt: 'Distinguish inspection from mutation.',
      }),
    ],
  })
  // Nothing in the fragment adds guidance, so no prose block is emitted.
  assert.equal(text.includes('Distinguish inspection from mutation.'), true)
  assert.equal(text.split('Distinguish inspection from mutation.').length - 1, 1)
  assert.doesNotMatch(text, /### m1\n- Distinguish inspection from mutation\.\n\n/)
})

test('§5.2 fragments are deduplicated across modules too', () => {
  const text = compilePrompt({
    kernelPrinciples: [],
    modules: [
      moduleFixture({ id: 'm1', principles: [], prompt: 'Record assumptions explicitly.' }),
      moduleFixture({ id: 'm2', principles: [], prompt: 'Record assumptions explicitly.' }),
    ],
  })
  assert.equal(text.match(/Record assumptions explicitly/gi)?.length, 1)
})

test('module sections are separated by a blank line so headings start clean blocks', () => {
  const text = compilePrompt({
    kernelPrinciples: ['A rule.'],
    modules: [
      moduleFixture({ id: 'm1', principles: ['One.'], prompt: 'Extra one.' }),
      moduleFixture({ id: 'm2', principles: ['Two.'] }),
    ],
  })
  assert.match(text, /Extra one\.\n\n### m2/)
  // Bullets within the invariants block stay single-spaced.
  assert.doesNotMatch(text, /- A rule\.\n\n- /)
})
