/**
 * Prompt-content conformance.
 *
 * The behavioural suite proves the plugin *works*; this suite proves the text it
 * injects actually satisfies the design requirements. It encodes
 * `IMPLEMENTATION-VALIDATION-HANDOFF.md` §10 ("Prompt Content Rules"),
 * PRODUCT-SPEC §2/§11 (failure classes and success criteria), ARCHITECTURE-SPEC
 * §5.2 (no duplicated statements) and §11 (prompt budget).
 *
 * It exists because a prompt can pass every structural test while still failing
 * the requirements it was written to satisfy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildGovernance, MODULES, KERNEL_PRINCIPLES, FAILURE_CLASSES } from '../../lib/index.js'
import {
  DEFAULT_MAX_PROMPT_BYTES,
  PROMPT_BYTE_FLOOR,
  RECORDED_PROMPT_BYTES,
} from '../../lib/kernel/prompt-compiler.js'

const { prompt: PROMPT, enabled } = buildGovernance(undefined)

/** The prompt with prose wrapping collapsed, for phrase-level assertions. */
const FLAT = PROMPT.replace(/\s+/g, ' ')

/** The statements the model actually reads, excluding headings and prose. */
const statements = PROMPT.split('\n')
  .filter((line) => line.startsWith('- '))
  .map((line) => line.slice(2))

/**
 * @param {string} statement
 * @returns {string}
 */
function normalise(statement) {
  return statement
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.;:,!?]+$/g, '')
    .toLowerCase()
}

test('conformance: every PRODUCT-SPEC §2 failure class is covered by an enabled module', () => {
  const claimed = new Set(enabled.flatMap((module) => module.addresses ?? []))

  for (const failureClass of FAILURE_CLASSES) {
    assert.ok(claimed.has(failureClass), `failure class ${failureClass} is not addressed by any enabled module`)
  }
  // And nothing claims a class that does not exist.
  for (const claim of claimed) {
    assert.ok(FAILURE_CLASSES.includes(claim), `module claims unknown failure class "${claim}"`)
  }
  assert.ok(claimed.size >= 3)
})

test('conformance: each failure class maps to exactly one responsibility, and every module claims one', () => {
  for (const module of enabled) {
    assert.ok(
      (module.addresses ?? []).length > 0,
      `module "${module.id}" declares no failure class, so its purpose is untraceable to the spec`,
    )
  }
  // The three classes are distinct concerns; no class should be double-claimed,
  // which would mean two modules own the same requirement.
  const counts = {}
  for (const module of enabled) {
    for (const claim of module.addresses ?? []) counts[claim] = (counts[claim] ?? 0) + 1
  }
  for (const [failureClass, count] of Object.entries(counts)) {
    assert.equal(count, 1, `failure class ${failureClass} is claimed by ${count} modules`)
  }
})

test('conformance: §5.2 no statement is duplicated anywhere in the section', () => {
  const seen = new Map()
  for (const statement of statements) {
    const key = normalise(statement)
    assert.equal(seen.has(key), false, `duplicated statement: "${statement}" also appears as "${seen.get(key)}"`)
    seen.set(key, statement)
  }
})

test('conformance: every module prompt fragment survives compilation', () => {
  // A fragment that only restated its own principles would be removed by the
  // §5.2 dedupe pass. If a fragment is empty after compilation it adds nothing
  // and should be deleted rather than shipped as prompt cost.
  for (const module of enabled) {
    if (module.prompt === undefined) continue
    assert.ok(
      PROMPT.includes(module.prompt),
      `module "${module.id}" declares a prompt fragment that adds no new guidance and was deduplicated away`,
    )
  }
})

test('conformance: handoff §10 DO — every module states at least one trigger condition', () => {
  const trigger = /\b(when|before|after|once|if|never|do not|avoid)\b/i
  for (const module of enabled) {
    const own = [
      ...module.principles,
      ...(module.prompt === undefined ? [] : [module.prompt]),
    ]
    assert.ok(
      own.some((statement) => trigger.test(statement)),
      `module "${module.id}" states no trigger condition, so the model has no cue for when it applies`,
    )
  }
})

test('conformance: handoff §10 DO NOT — the section never claims authority over the user or the host', () => {
  assert.match(PROMPT, /never outranks a direct user instruction/)
  assert.match(FLAT, /the host instruction governs/)

  const forbidden = [
    /higher priority than/i,
    /takes precedence over/i,
    /overrides? the user/i,
    /you must always follow this section/i,
    /this section is authoritative/i,
  ]
  for (const pattern of forbidden) {
    assert.doesNotMatch(PROMPT, pattern, `authority claim: ${pattern}`)
  }
})

test('conformance: handoff §10 DO NOT — no implementation detail leaks into the prompt', () => {
  // Statements addressed to the plugin author rather than to the agent. P7
  // ("prefer deterministic enforcement over repeated prompting") is the one that
  // was removed for exactly this reason.
  const forbidden = [
    'deterministic enforcement over repeated prompting',
    'the plugin',
    'cordis',
    'ctx.',
    'tools/pre-execute',
    'sessionProjection',
    'storageDomain',
  ]
  for (const phrase of forbidden) {
    assert.equal(
      PROMPT.toLowerCase().includes(phrase.toLowerCase()),
      false,
      `implementation detail "${phrase}" leaked into the model-facing prompt`,
    )
  }
})

test('conformance: handoff §10 DO NOT — no instruction restates a deterministically enforced rule', () => {
  // `tools/pre-execute` and `ctx.tools.guard` already gate persistent mutation.
  // Telling the model to perform that check duplicates enforcement, and the
  // earlier wording additionally implied an authorization channel ("existing
  // project convention") that the gate does not honour.
  const enforcedRuleRestatements = [/confirm that the change is authorized/i, /check whether .* is authorized/i]
  for (const pattern of enforcedRuleRestatements) {
    assert.doesNotMatch(PROMPT, pattern, `prompt restates an enforced rule: ${pattern}`)
  }
  // The replacement states the host's real grant semantics instead.
  assert.match(PROMPT, /each approval covers only that one change/)
})

test('conformance: handoff §10 DO NOT — no host plan-mode or tool-manual duplication', () => {
  assert.doesNotMatch(PROMPT, /plan mode|exit_plan_mode/i)
  for (const toolName of ['ask_user_question', 'str_replace_editor', 'todo_write', 'run_code', 'list_agents', 'send_message']) {
    assert.equal(PROMPT.includes(toolName), false, `prompt restates host tool "${toolName}"`)
  }
})

test('conformance: §2.3 information integrity is stated as a status obligation, not a note-taking habit', () => {
  assert.match(PROMPT, /Delete information you have established is wrong/)
  assert.match(PROMPT, /Never leave it in place annotated as wrong/)
  assert.match(PROMPT, /Never present invalid/)
  assert.match(PROMPT, /requires new evidence or explicit user confirmation/)
})

test('conformance: §11 the section is one logical contribution with a stable shape', () => {
  const level2 = PROMPT.split('\n').filter((line) => line.startsWith('## '))
  assert.equal(level2.length, 1, 'IEG must contribute exactly one logical section')
  assert.equal(level2[0], '## Information Environment Governance (IEG)')
  // Host prompt-variable syntax must never appear: governance text is literal.
  assert.equal(PROMPT.includes('{{'), false)
  assert.equal(PROMPT.includes('}}'), false)
})

test('conformance: architecture §11/§34.1 B6 prompt budget — recorded footprint, floored and capped', () => {
  const bytes = Buffer.byteLength(PROMPT, 'utf8')
  // §34.1 B6: the ceiling is the recorded size plus 10 %, floored at 1,400 bytes
  // and hard-capped at 4,096. The ceiling and the floor come from the compiler,
  // so this suite and the compiler cannot disagree about the budget. Raising the
  // recorded footprint is a policy change and must carry a documented reason
  // (PR-08), recorded in CHANGELOG.md with the prompt revision it bounds.
  assert.ok(
    bytes <= DEFAULT_MAX_PROMPT_BYTES,
    `section is ${bytes} bytes, over the recorded ${DEFAULT_MAX_PROMPT_BYTES}-byte ceiling`,
  )
  assert.ok(bytes >= PROMPT_BYTE_FLOOR, `section is only ${bytes} bytes; it likely lost required guidance`)
  assert.ok(
    Math.abs(bytes - RECORDED_PROMPT_BYTES) <= Math.ceil(RECORDED_PROMPT_BYTES * 0.1),
    `recorded footprint ${RECORDED_PROMPT_BYTES} bytes no longer describes the ${bytes}-byte section`,
  )
})

test('conformance: OBJ-1 — unprompted orientation and an ordered task flow are required', () => {
  assert.match(PROMPT, /Before your first change, state the project intent and scope/)
  assert.match(PROMPT, /terms you will use for its central concepts/)
  assert.match(PROMPT, /State the ordered task flow before you begin it/)
  // And it must not tell the agent to stall instead of aligning.
  assert.match(PROMPT, /proceed with the narrowest reversible work rather than stalling/)
})

test('conformance: OBJ-2 — overlap check before creating, and removal of outdated content', () => {
  assert.match(PROMPT, /Before creating a new artifact, look for an existing one that already serves the same purpose/)
  assert.match(PROMPT, /extend it instead of adding a near-duplicate/)
  // Deletion is the required disposition for wrong information, and for
  // outdated information except in a software project, where history matters.
  assert.match(PROMPT, /Delete information you have established is wrong/)
  assert.match(PROMPT, /Never leave it in place annotated as wrong/)
  assert.match(PROMPT, /Delete outdated and superseded content as well, except in a software development project/)
  assert.match(PROMPT, /mark it explicitly as outdated instead of removing it/)
  // And the removal must land at the source of the claim.
  assert.match(PROMPT, /remove it at the source/)
})

test('conformance: kernel and module principles are all present in the section', () => {
  for (const principle of KERNEL_PRINCIPLES) {
    assert.ok(PROMPT.includes(principle), `kernel principle missing: "${principle}"`)
  }
  for (const module of enabled) {
    for (const principle of module.principles) {
      assert.ok(PROMPT.includes(principle), `${module.id} principle missing: "${principle}"`)
    }
  }
})

test('conformance: IEG deliberately does not ship the implementation-facing P7 rule', () => {
  // Regression guard for the audit finding: P7 governs how the plugin is built,
  // not how the agent behaves, so it must not be model-facing.
  assert.equal(
    KERNEL_PRINCIPLES.some((principle) => /weakest mechanism/i.test(principle)),
    false,
  )
  assert.equal(MODULES.length, 3)
})
