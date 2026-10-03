/**
 * Integration test: the §29 host compatibility adapter.
 *
 * Three layers of evidence:
 *
 * 1. `classify` exercised on synthetic drift for **every** verdict — the §29.4
 *    matrix, independent of the installed host.
 * 2. The adapter mounted against the **real** `@deepseek-ai/dsh-system-prompt`
 *    service: a real assembly is observed, matched against the committed
 *    baseline, and shown to be hash-stable and idempotent across two
 *    observations — including through a real `system-prompt/assemble` waterfall
 *    listener that also calls `next()`.
 * 3. Malformed and adversarial input, which must never throw.
 *
 * This file deliberately does **not** import `lib/index.js`: the adapter is a
 * kernel primitive, and the plugin entry is wired separately. Registering the
 * section directly keeps this test independent of that wiring while still
 * exercising the host's real assembly code.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { dshAvailable, dshVersion, loadCordis, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import { resolveConfig } from '../../lib/kernel/config.js'
import {
  IEG_SECTION_NAME,
  BASELINE_VERSION,
  DEFAULT_BASELINE,
  VERDICTS,
  classify,
  createCompatibilityAdapter,
  stableHash,
} from '../../lib/kernel/compatibility.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

const OTHER_SECTION = 'host:extra'
const BASELINE_HASH = stableHash('alpha\nbeta')

/**
 * A synthetic baseline with the same shape as the committed one.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function syntheticBaseline(overrides = {}) {
  return {
    version: 1,
    sectionNames: ['host:a', IEG_SECTION_NAME, 'host:b'],
    hostPromptHash: BASELINE_HASH,
    capabilities: ['systemPrompt'],
    ...overrides,
  }
}

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function syntheticObservation(overrides = {}) {
  return {
    sectionNames: ['host:a', IEG_SECTION_NAME, 'host:b'],
    hostPromptHash: BASELINE_HASH,
    capabilities: ['systemPrompt'],
    ...overrides,
  }
}

/**
 * @param {Record<string, unknown>} [observed]
 * @param {Record<string, unknown>} [baseline]
 * @returns {{ verdict: string, reasons: string[] }}
 */
function verdictOf(observed = {}, baseline = {}) {
  return classify({ observed: syntheticObservation(observed), baseline: syntheticBaseline(baseline) })
}

/**
 * Boot the real prompt and tool registries and register IEG's section at the
 * configured order, mirroring `composition.test.js`.
 *
 * @returns {Promise<{ ctx: any }>}
 */
async function bootHost() {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const config = resolveConfig(undefined)

  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  ctx.systemPrompt.section({
    name: IEG_SECTION_NAME,
    order: config.sectionOrder,
    interpolate: false,
    text: () => '',
  })
  return { ctx }
}

/* ───────────────────────────── 1. verdict matrix ─────────────────────────── */

test('compatibility: VERDICTS is the frozen §29.4 vocabulary in escalation order', () => {
  assert.ok(Object.isFrozen(VERDICTS))
  assert.deepEqual([...VERDICTS], ['PENDING', 'COMPATIBLE', 'COMPATIBLE_WITH_WARNINGS', 'UNSUPPORTED'])
})

test('compatibility: classify reports PENDING without a usable baseline or observation', () => {
  const inputs = [
    undefined,
    null,
    {},
    42,
    'not-an-input',
    { observed: syntheticObservation() },
    { baseline: syntheticBaseline() },
    { baseline: {}, observed: {} },
    { baseline: { sectionNames: [] }, observed: { sectionNames: [] } },
    { baseline: syntheticBaseline(), observed: { sectionNames: 'not-an-array' } },
  ]

  for (const input of inputs) {
    const result = classify(input)
    assert.equal(result.verdict, 'PENDING', `expected PENDING for ${String(input)}`)
    assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, 'every verdict carries reasons')
    assert.ok(result.reasons.every((reason) => typeof reason === 'string'))
  }
})

test('compatibility: classify returns COMPATIBLE only when every expected fact matches', () => {
  const result = verdictOf()
  assert.equal(result.verdict, 'COMPATIBLE')
  assert.ok(VERDICTS.includes(result.verdict))
  assert.ok(result.reasons.length > 0)
  assert.match(result.reasons.join(' '), /baseline section\(s\) are present/)
})

test('compatibility: classify warns on non-critical drift', () => {
  const extraSection = verdictOf({ sectionNames: ['host:a', IEG_SECTION_NAME, 'host:b', OTHER_SECTION] })
  assert.equal(extraSection.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.match(extraSection.reasons.join(' '), /host:extra/)

  // An optional section *inserted before* IEG shifts its absolute index but not
  // its place among the baseline-required sections, so it is a warning rather
  // than a displacement.
  const insertedBefore = verdictOf({ sectionNames: ['host:a', OTHER_SECTION, IEG_SECTION_NAME, 'host:b'] })
  assert.equal(insertedBefore.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.doesNotMatch(insertedBefore.reasons.join(' '), /displaced/)

  const changedHash = verdictOf({ hostPromptHash: stableHash('something else') })
  assert.equal(changedHash.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.match(changedHash.reasons.join(' '), /host section text changed/)

  const moreCounts = classify({
    observed: syntheticObservation({ contextCount: 2, toolCount: 3 }),
    baseline: syntheticBaseline({ contextCount: 0, toolCount: 0 }),
  })
  assert.equal(moreCounts.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.match(moreCounts.reasons.join(' '), /more runtime contexts/)
  assert.match(moreCounts.reasons.join(' '), /more prompt tools/)

  // Unknown capabilities are reported as unverified, not treated as absent.
  const unknownCapabilities = verdictOf({ capabilities: undefined })
  assert.equal(unknownCapabilities.verdict, 'COMPATIBLE')
  assert.match(unknownCapabilities.reasons.join(' '), /capability inventory was not observed/)

  // Extra capabilities beyond the baseline are not drift.
  const extraCapabilities = verdictOf({ capabilities: ['systemPrompt', 'tools'] })
  assert.equal(extraCapabilities.verdict, 'COMPATIBLE')

  // An *optional* capability is a warning when absent, unlike a required one.
  const optionalCapability = classify({
    observed: syntheticObservation({ capabilities: ['systemPrompt'] }),
    baseline: syntheticBaseline({ optionalCapabilities: ['tools'] }),
  })
  assert.equal(optionalCapability.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.match(optionalCapability.reasons.join(' '), /optional host capability absent: tools/)
})

test('compatibility: classify reports UNSUPPORTED on critical drift', () => {
  const missingSection = verdictOf({ sectionNames: ['host:a', IEG_SECTION_NAME] })
  assert.equal(missingSection.verdict, 'UNSUPPORTED')
  assert.match(missingSection.reasons.join(' '), /required baseline section\(s\) missing/)
  assert.match(missingSection.reasons.join(' '), /host:b/)

  const iegAbsent = verdictOf({ sectionNames: ['host:a', 'host:b'] })
  assert.equal(iegAbsent.verdict, 'UNSUPPORTED')
  assert.match(iegAbsent.reasons.join(' '), /ieg:governance/)

  const displaced = verdictOf({ sectionNames: ['host:a', 'host:b', IEG_SECTION_NAME] })
  assert.equal(displaced.verdict, 'UNSUPPORTED')
  assert.match(displaced.reasons.join(' '), /displaced/)

  const capabilityAbsent = verdictOf({ capabilities: ['tools'] })
  assert.equal(capabilityAbsent.verdict, 'UNSUPPORTED')
  assert.match(capabilityAbsent.reasons.join(' '), /required host capability absent/)

  // UNSUPPORTED outranks a warning raised by the same observation.
  const both = verdictOf({
    sectionNames: ['host:a', OTHER_SECTION, IEG_SECTION_NAME],
    hostPromptHash: stableHash('drifted'),
  })
  assert.equal(both.verdict, 'UNSUPPORTED')
  assert.match(both.reasons.join(' '), /missing/)
  assert.match(both.reasons.join(' '), /host section text changed/)
})

/* ─────────────────────── 2. the real host assembly ───────────────────────── */

test('compatibility: DEFAULT_BASELINE mirrors the committed baseline file', async () => {
  const committed = JSON.parse(
    await readFile(new URL('../../lib/compatibility-baseline.json', import.meta.url), 'utf8'),
  )
  assert.equal(committed.version, BASELINE_VERSION)
  assert.equal(committed.version, DEFAULT_BASELINE.version)
  assert.equal(committed.hostVersion, DEFAULT_BASELINE.hostVersion)
  assert.deepEqual(committed.sectionNames, [...DEFAULT_BASELINE.sectionNames])
  assert.equal(committed.hostPromptHash, DEFAULT_BASELINE.hostPromptHash)
  assert.deepEqual(committed.capabilities, [...DEFAULT_BASELINE.capabilities])
})

test(`integration: a real assembly matches the committed baseline (DSH ${dshVersion()})`, { skip }, async () => {
  const { ctx } = await bootHost()
  const assembly = await ctx.systemPrompt.assemble({})

  // The host's own sections must be intact, and IEG's section must be present.
  const sectionNames = assembly.sections.map((/** @type {any} */ section) => section.name)
  assert.deepEqual(sectionNames, [...DEFAULT_BASELINE.sectionNames])
  assert.ok(sectionNames.includes('harness:identity'), 'the host prompt must survive')

  const hostTexts = assembly.sections
    .filter((/** @type {any} */ section) => section.name !== IEG_SECTION_NAME)
    .map((/** @type {any} */ section) => section.text)
  assert.equal(stableHash(hostTexts.join('\n')), DEFAULT_BASELINE.hostPromptHash)

  const adapter = createCompatibilityAdapter()
  const snapshot = adapter.observe(assembly)
  assert.equal(snapshot.verdict, 'COMPATIBLE')
  assert.equal(adapter.verdict(), 'COMPATIBLE')
  assert.equal(snapshot.iegIndex, DEFAULT_BASELINE.sectionNames.indexOf(IEG_SECTION_NAME))
  assert.equal(snapshot.hostPromptHash, DEFAULT_BASELINE.hostPromptHash)
  assert.equal(snapshot.assemblyCount, 1)
  assert.ok(snapshot.reasons.every((reason) => typeof reason === 'string'))
})

test('integration: two observations of an unchanged shape are debounced and hash-stable', { skip }, async () => {
  const { ctx } = await bootHost()
  let emissions = 0
  const adapter = createCompatibilityAdapter({
    now: () => '2026-01-01T00:00:00.000Z',
    onVerdict: () => {
      emissions += 1
    },
  })

  const firstAssembly = await ctx.systemPrompt.assemble({})
  const secondAssembly = await ctx.systemPrompt.assemble({})

  const first = adapter.observe(firstAssembly)
  const second = adapter.observe(secondAssembly)

  // Stable hash across observations, and no re-classification or re-emission.
  assert.equal(first.hostPromptHash, second.hostPromptHash)
  assert.equal(first.hostPromptHash, DEFAULT_BASELINE.hostPromptHash)
  assert.deepEqual(first, second)
  assert.equal(first.assemblyCount, 1)
  assert.equal(second.assemblyCount, 1)
  assert.equal(emissions, 1)

  // A genuinely different shape is a new material observation.
  const drifted = adapter.observe({
    sections: [...firstAssembly.sections, { name: OTHER_SECTION, text: 'new' }],
  })
  assert.equal(drifted.assemblyCount, 2)
  assert.equal(drifted.verdict, 'COMPATIBLE_WITH_WARNINGS')
  assert.equal(emissions, 2)
})

test('integration: the adapter observes a real system-prompt/assemble waterfall and calls next()', { skip }, async () => {
  const { ctx } = await bootHost()
  /** @type {string[]} */
  const emitted = []
  const adapter = createCompatibilityAdapter({ onVerdict: (result) => emitted.push(result.verdict) })

  const dispose = ctx.on('system-prompt/assemble', (/** @type {any} */ assembly, /** @type {any} */ context, /** @type {any} */ next) => {
    adapter.observe(assembly, context)
    return next()
  })

  const assembly = await ctx.systemPrompt.assemble({})
  dispose()

  assert.equal(adapter.snapshot().assemblyCount, 1)
  assert.equal(adapter.verdict(), 'COMPATIBLE')
  assert.deepEqual(emitted, ['COMPATIBLE'])
  // Calling `next()` kept the waterfall intact: the returned assembly is the
  // host's original, not an adapter-shaped replacement.
  assert.deepEqual(
    assembly.sections.map((/** @type {any} */ section) => section.name),
    [...DEFAULT_BASELINE.sectionNames],
  )
})

test('integration: a supplied capability inventory satisfies the baseline requirement', { skip }, async () => {
  const { ctx } = await bootHost()
  const adapter = createCompatibilityAdapter({ capabilities: ['systemPrompt'] })
  const snapshot = adapter.observe(await ctx.systemPrompt.assemble({}))
  assert.equal(snapshot.verdict, 'COMPATIBLE')
  assert.match(snapshot.reasons.join(' '), /required host capability present: systemPrompt/)
})

/* ───────────────────── 3. malformed input never throws ───────────────────── */

test('compatibility: observe never throws on malformed input and the snapshot stays serialisable', () => {
  const adapter = createCompatibilityAdapter({
    capabilities: () => {
      throw new Error('inventory provider is broken')
    },
    now: () => {
      throw new Error('clock is broken')
    },
  })

  const malformed = [
    undefined,
    null,
    42,
    'assembly',
    [],
    {},
    { sections: null },
    { sections: 'nope', contexts: 'nope', tools: {} },
    { sections: [null, 42, { name: 7, text: {} }, { name: IEG_SECTION_NAME, text: null }] },
    { sections: [{ get name() { throw new Error('boom') } }] },
  ]

  for (const value of malformed) {
    const snapshot = adapter.observe(value)
    assert.ok(VERDICTS.includes(snapshot.verdict), `valid verdict for ${String(value)}`)
    assert.ok(Array.isArray(snapshot.reasons))
    assert.ok(snapshot.reasons.every((reason) => typeof reason === 'string'))
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
      verdict: snapshot.verdict,
      reasons: snapshot.reasons,
      sectionNames: snapshot.sectionNames,
      iegIndex: snapshot.iegIndex,
      hostPromptHash: snapshot.hostPromptHash,
      assemblyCount: snapshot.assemblyCount,
      observedAt: snapshot.observedAt,
    })
  }
  assert.ok(VERDICTS.includes(adapter.verdict()))
})

test('compatibility: classify survives adversarial input, and stableHash is deterministic', () => {
  /** @type {Record<string, unknown>} */
  const throwingBaseline = {}
  Object.defineProperty(throwingBaseline, 'sectionNames', {
    get() {
      throw new Error('baseline getter exploded')
    },
  })
  const throwingObservation = {}
  Object.defineProperty(throwingObservation, 'sectionNames', {
    get() {
      throw new Error('observation getter exploded')
    },
  })

  assert.equal(classify({ observed: throwingObservation, baseline: syntheticBaseline() }).verdict, 'PENDING')
  assert.equal(classify({ observed: syntheticObservation(), baseline: throwingBaseline }).verdict, 'PENDING')
  assert.equal(classify({ observed: { sectionNames: [null, 1] }, baseline: syntheticBaseline() }).verdict, 'UNSUPPORTED')

  for (const value of [undefined, null, 42, '', {}, ['a'], Symbol('hash')]) {
    const hash = stableHash(value)
    assert.match(hash, /^[0-9a-f]{8}$/)
    assert.equal(hash, stableHash(value))
  }
  assert.notEqual(stableHash('alpha'), stableHash('beta'))
  assert.equal(stableHash(undefined), stableHash(''), 'undefined and empty string hash identically')
})

test('compatibility: a malformed adapter configuration degrades to PENDING, never throws', () => {
  for (const options of [
    null,
    'options',
    { baseline: null },
    { capabilities: () => { throw new Error('boom') } },
    { now: () => { throw new Error('boom') } },
    { onVerdict: () => { throw new Error('boom') } },
  ]) {
    const adapter = createCompatibilityAdapter(/** @type {any} */ (options))
    const snapshot = adapter.observe({ sections: [{ name: IEG_SECTION_NAME, text: '' }] })
    assert.ok(VERDICTS.includes(snapshot.verdict))
    assert.ok(VERDICTS.includes(adapter.verdict()))
    assert.ok(Array.isArray(adapter.snapshot().reasons))
  }

  // An explicit `null` baseline means "no baseline", not "use the default".
  const noBaseline = createCompatibilityAdapter({ baseline: null })
  assert.equal(noBaseline.observe({ sections: [{ name: IEG_SECTION_NAME, text: '' }] }).verdict, 'PENDING')
  assert.equal(noBaseline.verdict(), 'PENDING')
})
