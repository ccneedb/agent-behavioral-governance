/**
 * ABG kernel — prompt compiler (`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §5.2).
 *
 * Aggregates the kernel's stable principles with the enabled modules' principles
 * and prompt fragments into **one** additive section, removing duplicated
 * statements and enforcing the §11 prompt budget.
 *
 * Two host facts shape this module:
 *
 * 1. `renderPrompt` interpolates strict `{{variable}}` syntax and **throws** on
 *    an unknown or undefined reference. ABG therefore registers its section with
 *    `interpolate: false`, and the compiler additionally refuses to emit text
 *    containing interpolation syntax so the two defences agree.
 * 2. ABG must never set `complete: true`: one effective complete section
 *    replaces the entire assembled prompt, and two make assembly fail.
 */

/**
 * Recorded size of the compiled four-module governance section, in UTF-8 bytes,
 * measured at `PROMPT_VERSION` `0.2.0`. The ceiling is derived from this
 * recorded footprint rather than from the current compilation: a budget that is
 * recomputed from the text it is meant to bound can never detect growth.
 */
export const RECORDED_PROMPT_BYTES = 3459

/** Floor for the ceiling, so a shrunken prompt cannot drive the budget to zero (§34.1 B6). */
export const PROMPT_BYTE_FLOOR = 1400

/** Hard cap on the ceiling, independent of the recorded size (§34.1 B6). */
export const PROMPT_BYTE_HARD_CAP = 4096

/**
 * Default ceiling for the compiled governance section, in UTF-8 bytes
 * (`ARCHITECTURE-SPEC` §11, §34.1 B6): the recorded size plus 10 %, floored at
 * {@link PROMPT_BYTE_FLOOR} and capped at {@link PROMPT_BYTE_HARD_CAP}.
 *
 * Raising this ceiling is a policy change and must carry a documented reason
 * (PRODUCT-SPEC PR-07/PR-08), recorded in `CHANGELOG.md` alongside the prompt
 * revision it bounds.
 */
export const DEFAULT_MAX_PROMPT_BYTES = Math.min(
  PROMPT_BYTE_HARD_CAP,
  Math.max(PROMPT_BYTE_FLOOR, Math.ceil(RECORDED_PROMPT_BYTES * 1.1)),
)

/**
 * Count UTF-8 bytes without depending on `Buffer` or `TextEncoder`, so the
 * package stays import-free and typecheckable in isolation.
 *
 * @param {string} text
 * @returns {number}
 */
export function utf8Bytes(text) {
  let bytes = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
  }
  return bytes
}

/**
 * Whether text contains prompt-variable interpolation syntax.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsInterpolationSyntax(text) {
  return text.includes('{{') || text.includes('}}')
}

/**
 * Normalise a statement for duplicate detection: collapse whitespace, strip
 * trailing punctuation, and case-fold.
 *
 * @param {string} statement
 * @returns {string}
 */
function normalise(statement) {
  return statement
    .replace(/\s+/g, ' ')
    .trim()
    // Strip trailing sentence punctuation so that "Do X." and "Do X!" collapse.
    .replace(/[\s.;:,!?]+$/g, '')
    .toLowerCase()
}

/**
 * Compile the single additive ABG governance section.
 *
 * @param {object} input
 * @param {readonly string[]} input.kernelPrinciples - stable kernel invariants.
 * @param {readonly GovernanceModule[]} input.modules - enabled modules, already in dependency order.
 * @param {number} [input.maxBytes] - budget for the compiled section.
 * @returns {string} the section text, or `''` when nothing is enabled.
 * @throws {Error} when the compiled text exceeds the budget or contains interpolation syntax.
 */
export function compilePrompt(input) {
  const { kernelPrinciples, modules } = input
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_PROMPT_BYTES

  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {string[]} */
  const lines = []

  /**
   * Append one statement unless an equivalent one was already emitted.
   *
   * @param {string} statement
   * @returns {void}
   */
  const push = (statement) => {
    const key = normalise(statement)
    if (key === '' || seen.has(key)) return
    seen.add(key)
    lines.push(`- ${statement}`)
  }

  for (const principle of kernelPrinciples) push(principle)

  /**
   * Split a fragment into sentences and drop any that restate a statement that
   * has already been emitted. §5.2 requires duplicated statements to be removed;
   * a fragment that only paraphrases its own module's principles is pure prompt
   * cost with no added guidance.
   *
   * @param {string} fragment
   * @returns {string}
   */
  const dedupeFragment = (fragment) => {
    if (fragment === '') return ''
    /** @type {string[]} */
    const kept = []
    for (const sentence of fragment.split(/(?<=[.!?])\s+/)) {
      const trimmed = sentence.trim()
      const key = normalise(trimmed)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      kept.push(trimmed)
    }
    return kept.join(' ')
  }

  /** @type {string[]} */
  const moduleSections = []
  for (const module of modules) {
    const before = lines.length
    for (const principle of module.principles) push(principle)
    const moduleLines = lines.splice(before)
    const fragment = dedupeFragment((module.prompt ?? '').trim())

    if (moduleLines.length === 0 && fragment === '') continue
    moduleSections.push(
      [`### ${module.id}`, ...moduleLines, ...(fragment === '' ? [] : ['', fragment])].join('\n'),
    )
  }

  if (lines.length === 0 && moduleSections.length === 0) return ''

  const header = [
    '## Agent Behavioral Governance (ABG)',
    '',
    'Project-work governance for this session. This section is additive: it',
    'supplements the host instructions above and never replaces them. Where this',
    'section and a host instruction describe the same capability, the host',
    'instruction governs.',
    '',
    '### Operating invariants',
  ].join('\n')

  // Bullets stay single-spaced inside a block; blocks are separated by a blank
  // line so each module heading starts a clean Markdown block.
  const invariants = [header, ...lines].join('\n')
  const text = [invariants, ...moduleSections].join('\n\n').trim()

  if (containsInterpolationSyntax(text)) {
    throw new Error('abg prompt compiler: compiled section contains {{ }} interpolation syntax; governance text must be literal')
  }

  const bytes = utf8Bytes(text)
  if (bytes > maxBytes) {
    throw new Error(`abg prompt compiler: compiled section is ${bytes} bytes, over the ${maxBytes}-byte budget`)
  }

  return text
}

/**
 * Report the compiled prompt's size, for `prompt_assembly` diagnostics (§12).
 *
 * @param {string} text
 * @returns {{ bytes: number, characters: number, lines: number }}
 */
export function promptStats(text) {
  return {
    bytes: utf8Bytes(text),
    characters: text.length,
    lines: text.length === 0 ? 0 : text.split('\n').length,
  }
}
