/**
 * ABG kernel — host compatibility adapter (ARCHITECTURE-SPEC §29, PR-07).
 *
 * A DSH peer range is declared and enforced at install and profile startup, but
 * nothing observes whether the **running** host's prompt surface still matches
 * what ABG was verified against (§29.1). This module closes that gap without
 * depending on a version string — the installed `0.2.0-rc.2` exposes no
 * plugin-facing version service (§29.2) — by observing the seam facts that would
 * actually change a decision:
 *
 * ```text
 * ordered section names            assembly.sections.map(s => s.name)
 * ABG section presence + position  index of 'abg:governance'
 * host section text hash           stableHash of the non-ABG section texts
 * contexts / tools counts          assembly.contexts.length, assembly.tools.length
 * capability inventory             supplied by the composition (ctx.get)
 * ```
 *
 * **`AssembledSection` carries `name`, `text`, and `interpolate` — not `order`.**
 * The ordered name array *is* the resolved placement, which is exactly the drift
 * signal that matters (§29.3).
 *
 * **Fail-open.** A listener on the `system-prompt/assemble` expert waterfall must
 * call `next()`; the adapter observes only and never blocks or denies. Nothing
 * here ever throws into the assembly path — a compatibility probe must never be
 * able to break prompt assembly — so both `observe` and `classify` accept any
 * malformed input and degrade to `PENDING`.
 *
 * Zero runtime dependencies: only language built-ins (`Math`, `JSON`, `Set`,
 * `WeakMap`).
 */

/** Version of the baseline *format* (not of the host). Bump with a reviewed change. */
export const BASELINE_VERSION = 1

/** @typedef {'PENDING' | 'COMPATIBLE' | 'COMPATIBLE_WITH_WARNINGS' | 'UNSUPPORTED'} VerdictName */

/** Every verdict `classify` can return, in escalation order. */
export const VERDICTS = Object.freeze(
  /** @type {VerdictName[]} */ (['PENDING', 'COMPATIBLE', 'COMPATIBLE_WITH_WARNINGS', 'UNSUPPORTED']),
)

/**
 * ABG's single prompt section. Kept here — rather than imported from the plugin
 * entry — so the kernel stays dependency-free and the compatibility rules can
 * name the section without a cycle.
 */
export const ABG_SECTION_NAME = 'abg:governance'

/**
 * @typedef {object} CompatibilityObservation
 * @property {string[]} [sectionNames] the ordered resolved section names
 * @property {string | null} [hostPromptHash] hash of the non-ABG section texts
 * @property {number} [sectionCount]
 * @property {number} [contextCount]
 * @property {number} [toolCount]
 * @property {string[]} [capabilities] host services the composition can see
 */

/**
 * @typedef {object} CompatibilityBaseline
 * @property {number} [version] baseline format version
 * @property {string} [hostVersion] the DSH release the baseline was captured against
 * @property {string[]} [sectionNames] the expected ordered section names
 * @property {string | null} [hostPromptHash] the expected hash of the non-ABG section texts
 * @property {string[]} [capabilities] capabilities ABG requires of the host
 * @property {string[]} [optionalCapabilities] capabilities whose absence only warns
 * @property {number} [contextCount] optional expected context count (stricter baselines)
 * @property {number} [toolCount] optional expected tool count (stricter baselines)
 */

/**
 * @typedef {object} CompatibilityVerdict
 * @property {VerdictName} verdict
 * @property {string[]} reasons
 */

/**
 * @typedef {object} CompatibilitySnapshot
 * @property {VerdictName} verdict
 * @property {string[]} reasons
 * @property {string[]} sectionNames
 * @property {number} abgIndex index of `abg:governance`, or -1 when absent
 * @property {string | null} hostPromptHash
 * @property {number} assemblyCount material observations recorded so far
 * @property {string | null} observedAt ISO timestamp (or the injected clock value)
 */

/**
 * @typedef {object} NormalizedObservation
 * @property {string[]} sectionNames
 * @property {number} abgIndex
 * @property {string | null} hostPromptHash
 * @property {number} contextCount
 * @property {number} toolCount
 */

/* ───────────────────────────────── hashing ────────────────────────────────── */

/**
 * Best-effort string conversion that never throws. `String(value)` can throw when
 * a value's own `toString` throws, and hash input arrives from untrusted shapes.
 *
 * @param {unknown} value
 * @returns {string}
 */
function safeToString(value) {
  if (value === undefined || value === null) return ''
  try {
    return String(value)
  } catch {
    return `[unstringifiable ${typeof value}]`
  }
}

/**
 * Deterministic FNV-1a 32-bit hash rendered as 8 lowercase hex digits.
 *
 * Chosen because it is short enough to read in a diagnostic and needs no
 * dependency. It is a **drift signal**, not a security primitive: the baseline
 * test only needs "same text → same hash, different text → different hash with
 * overwhelming probability" for prompt-sized inputs.
 *
 * @param {unknown} text
 * @returns {string} 8 lowercase hex digits, e.g. `ceb63ee5`
 */
export function stableHash(text) {
  let input = ''
  try {
    input = typeof text === 'string' ? text : safeToString(text)
  } catch {
    input = ''
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/* ──────────────────────────── defensive accessors ─────────────────────────── */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null
}

/**
 * Property read that tolerates primitives, null, and throwing getters.
 *
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function safeGet(value, key) {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return /** @type {Record<string, unknown>} */ (value)[key]
  } catch {
    return undefined
  }
}

/**
 * Read a list of names, dropping non-string entries. Returns `null` when the
 * value is not an array at all — which callers treat as "not observed".
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
function stringList(value) {
  if (!Array.isArray(value)) return null
  /** @type {string[]} */
  const result = []
  for (const entry of value) {
    if (typeof entry === 'string') result.push(entry)
  }
  return result
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function safeCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeHash(value) {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string') return error.message
  return safeToString(error)
}

/* ─────────────────────────── baseline and verdict ─────────────────────────── */

/**
 * The committed baseline, mirroring `lib/compatibility-baseline.json` exactly.
 *
 * Captured by `scripts/capture-baseline.mjs` against the installed
 * `@deepseek-ai/dsh` `0.2.0-rc.2` with a minimal real composition (the prompt
 * registry, the tool registry, and ABG's own section). Section *texts* are not
 * recorded: only the ordered names and the hash of the non-ABG texts, so ABG's
 * own prompt wording can evolve without a baseline update.
 *
 * `hostPromptHash` is `stableHash` of `harness:identity`'s text plus the two
 * empty persona sections, joined with `\n` in resolved order.
 *
 * `capabilities` names the host service ABG actually requires (`systemPrompt`,
 * its `inject` dependency — §29.4's "capability set for the declared host
 * version"). Tools, filesystem, storage, and questioning are optional seams and
 * are deliberately not required here.
 */
export const DEFAULT_BASELINE = Object.freeze({
  version: BASELINE_VERSION,
  hostVersion: '0.2.0-rc.2',
  sectionNames: Object.freeze([
    'harness:identity',
    'deployment:persona-prefix',
    ABG_SECTION_NAME,
    'deployment:persona-suffix',
  ]),
  hostPromptHash: 'ceb63ee5',
  capabilities: Object.freeze(['systemPrompt']),
})

/**
 * Compare one observation with one baseline and produce a §29.4 verdict.
 *
 * ```text
 * COMPATIBLE                 every expected fact matches
 * COMPATIBLE_WITH_WARNINGS   non-critical drift: new optional sections/contexts/
 *                            tools, or a changed host prompt hash
 * UNSUPPORTED                a required section is missing, the ABG section is
 *                            absent or displaced, or a required capability is absent
 * PENDING                    no baseline or no usable observation yet
 * ```
 *
 * Displacement is measured against the **baseline-required** sections only: a new
 * optional section inserted before `abg:governance` is a warning, while ABG moving
 * relative to its baseline neighbours is unsupported. That keeps the two §29.4
 * rules from contradicting each other.
 *
 * Never throws. A malformed baseline or observation yields `PENDING`, and any
 * unexpected failure degrades to `PENDING` with the failure named in `reasons`.
 *
 * @param {unknown} input `{ observed?: CompatibilityObservation, baseline?: CompatibilityBaseline }`
 * @returns {CompatibilityVerdict}
 */
export function classify(input) {
  try {
    const source = isRecord(input) ? input : {}
    const rawBaseline = safeGet(source, 'baseline')
    const rawObserved = safeGet(source, 'observed')
    const baseline = isRecord(rawBaseline) ? rawBaseline : null
    const observed = isRecord(rawObserved) ? rawObserved : null

    const baselineNames = stringList(baseline === null ? undefined : safeGet(baseline, 'sectionNames'))
    if (baselineNames === null) {
      return {
        verdict: 'PENDING',
        reasons: ['no compatibility baseline with a section inventory is available'],
      }
    }
    if (baselineNames.length === 0) {
      return { verdict: 'PENDING', reasons: ['the compatibility baseline declares no prompt sections'] }
    }

    const observedNames = stringList(observed === null ? undefined : safeGet(observed, 'sectionNames'))
    if (observedNames === null) {
      return { verdict: 'PENDING', reasons: ['no prompt assembly has been observed yet'] }
    }

    /** @type {string[]} */
    const unsupported = []
    /** @type {string[]} */
    const warnings = []
    /** @type {string[]} */
    const notes = []

    const baselineSet = new Set(baselineNames)
    const observedSet = new Set(observedNames)

    const missing = baselineNames.filter((name) => !observedSet.has(name))
    if (missing.length > 0) {
      unsupported.push(`required baseline section(s) missing from the assembled prompt: ${missing.join(', ')}`)
    }

    const abgIndex = observedNames.indexOf(ABG_SECTION_NAME)
    const abgPresent = abgIndex !== -1
    if (!abgPresent) {
      unsupported.push(`the ABG section "${ABG_SECTION_NAME}" is absent from the assembled prompt`)
    }

    if (abgPresent && missing.length === 0) {
      const baselineAbgIndex = baselineNames.indexOf(ABG_SECTION_NAME)
      if (baselineAbgIndex !== -1) {
        let observedRank = 0
        for (let index = 0; index < abgIndex; index += 1) {
          if (baselineSet.has(observedNames[index])) observedRank += 1
        }
        if (baselineAbgIndex !== observedRank) {
          unsupported.push(
            `the ABG section "${ABG_SECTION_NAME}" is displaced: the baseline places it after ` +
              `${baselineAbgIndex} baseline section(s), the assembly places it after ${observedRank}`,
          )
        }
      }
    }

    const requiredCapabilities = stringList(safeGet(baseline, 'capabilities')) ?? []
    const observedCapabilities = observed === null ? null : stringList(safeGet(observed, 'capabilities'))
    if (requiredCapabilities.length > 0) {
      if (observedCapabilities === null) {
        notes.push(
          `capability inventory was not observed, so required capabilities ` +
            `(${requiredCapabilities.join(', ')}) could not be verified`,
        )
      } else {
        const missingCapabilities = requiredCapabilities.filter((name) => !observedCapabilities.includes(name))
        if (missingCapabilities.length > 0) {
          unsupported.push(`required host capability absent: ${missingCapabilities.join(', ')}`)
        }
      }
    }

    const extraSections = observedNames.filter((name) => !baselineSet.has(name))
    if (extraSections.length > 0) {
      warnings.push(
        `unexpected additional prompt section(s) not present in the baseline: ${extraSections.join(', ')}`,
      )
    }

    // §29.4 distinguishes a required capability (absent → unsupported) from an
    // optional one (absent → warning). The committed baseline requires only what
    // ABG's `inject` depends on, so optional capabilities exist for deployments
    // that want a stricter inventory without failing the mount.
    const optionalCapabilities = stringList(safeGet(baseline, 'optionalCapabilities')) ?? []
    if (optionalCapabilities.length > 0 && observedCapabilities !== null) {
      const absentOptional = optionalCapabilities.filter((name) => !observedCapabilities.includes(name))
      if (absentOptional.length > 0) {
        warnings.push(`optional host capability absent: ${absentOptional.join(', ')}`)
      }
    }

    const baselineContexts = baseline === null ? null : safeCount(safeGet(baseline, 'contextCount'))
    const observedContexts = observed === null ? null : safeCount(safeGet(observed, 'contextCount'))
    if (baselineContexts !== null && observedContexts !== null && observedContexts > baselineContexts) {
      warnings.push(`more runtime contexts than the baseline (${observedContexts} > ${baselineContexts})`)
    }

    const baselineTools = baseline === null ? null : safeCount(safeGet(baseline, 'toolCount'))
    const observedTools = observed === null ? null : safeCount(safeGet(observed, 'toolCount'))
    if (baselineTools !== null && observedTools !== null && observedTools > baselineTools) {
      warnings.push(`more prompt tools than the baseline (${observedTools} > ${baselineTools})`)
    }

    const baselineHash = baseline === null ? null : safeHash(safeGet(baseline, 'hostPromptHash'))
    const observedHash = observed === null ? null : safeHash(safeGet(observed, 'hostPromptHash'))
    if (baselineHash !== null) {
      if (observedHash === null) {
        notes.push('the host section text hash was not observed, so the baseline hash could not be checked')
      } else if (observedHash !== baselineHash) {
        warnings.push(`host section text changed: baseline hash ${baselineHash}, observed hash ${observedHash}`)
      }
    }

    if (unsupported.length > 0) {
      return { verdict: 'UNSUPPORTED', reasons: [...unsupported, ...warnings, ...notes] }
    }
    if (warnings.length > 0) {
      return { verdict: 'COMPATIBLE_WITH_WARNINGS', reasons: [...warnings, ...notes] }
    }

    /** @type {string[]} */
    const confirmations = [`all ${baselineNames.length} baseline section(s) are present in the expected order`]
    if (baselineHash !== null && observedHash === baselineHash) {
      confirmations.push(`host section hash matches the baseline (${baselineHash})`)
    }
    if (requiredCapabilities.length > 0 && observedCapabilities !== null) {
      confirmations.push(
        `required host capabilit${requiredCapabilities.length === 1 ? 'y' : 'ies'} present: ` +
          requiredCapabilities.join(', '),
      )
    }
    return { verdict: 'COMPATIBLE', reasons: [...confirmations, ...notes] }
  } catch (error) {
    return {
      verdict: 'PENDING',
      reasons: [`compatibility classification failed: ${errorMessage(error)}`],
    }
  }
}

/* ─────────────────────────────── the adapter ─────────────────────────────── */

/**
 * @param {unknown} assembly
 * @returns {NormalizedObservation}
 */
function normalizeAssembly(assembly) {
  const record = isRecord(assembly) ? assembly : null
  const sections = record === null ? undefined : safeGet(record, 'sections')
  /** @type {string[]} */
  const sectionNames = []
  /** @type {string[]} */
  const hostTexts = []
  let abgIndex = -1

  if (Array.isArray(sections)) {
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index]
      const name = safeGet(section, 'name')
      const sectionName = typeof name === 'string' ? name : ''
      sectionNames.push(sectionName)
      if (sectionName === ABG_SECTION_NAME && abgIndex === -1) abgIndex = index
      if (sectionName !== ABG_SECTION_NAME) {
        const text = safeGet(section, 'text')
        hostTexts.push(typeof text === 'string' ? text : '')
      }
    }
  }

  const contexts = record === null ? undefined : safeGet(record, 'contexts')
  const tools = record === null ? undefined : safeGet(record, 'tools')

  return {
    sectionNames,
    abgIndex,
    // `null` means "could not be observed", which is distinct from "hash of an
    // empty host prompt"; only the former skips the hash comparison.
    hostPromptHash: Array.isArray(sections) ? stableHash(hostTexts.join('\n')) : null,
    contextCount: Array.isArray(contexts) ? contexts.length : 0,
    toolCount: Array.isArray(tools) ? tools.length : 0,
  }
}

/**
 * The observation shape that decides whether a re-classification is warranted.
 * Two assemblies with the same signature are debounced.
 *
 * @param {NormalizedObservation} observation
 * @param {string[] | undefined} capabilities
 * @returns {string}
 */
function shapeSignature(observation, capabilities) {
  return (
    JSON.stringify([
      observation.sectionNames,
      observation.abgIndex,
      observation.hostPromptHash,
      observation.contextCount,
      observation.toolCount,
      capabilities === undefined ? null : capabilities,
    ]) ?? ''
  )
}

/**
 * The debounce key for one assembly: its scope, then its agent, then the whole
 * adapter. `ScopeKey` is an opaque identity-compared object (§17.7), so the
 * adapter files shapes in a `WeakMap` rather than inventing a string key.
 *
 * @param {unknown} context
 * @returns {object | null}
 */
function scopeKeyOf(context) {
  if (!isRecord(context)) return null
  const scope = safeGet(context, 'scope')
  if (typeof scope === 'object' && scope !== null) return scope
  const agent = safeGet(context, 'agent')
  if (typeof agent === 'object' && agent !== null) return agent
  return null
}

/**
 * @param {() => unknown} now
 * @returns {string}
 */
function timestamp(now) {
  try {
    const value = now()
    if (typeof value === 'string' && value !== '') return value
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  } catch {
    /* fall through to the wall clock */
  }
  try {
    return new Date().toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

/**
 * Create the §29 compatibility adapter.
 *
 * Wire it as an observing waterfall listener that **always calls `next()`**:
 *
 * ```js
 * const compatibility = createCompatibilityAdapter({
 *   capabilities: () => ['systemPrompt', 'tools'].filter((name) => ctx.get?.(name) !== undefined),
 * })
 * ctx.on('system-prompt/assemble', (assembly, context, next) => {
 *   compatibility.observe(assembly, context) // never throws, never blocks
 *   return next()
 * })
 * ```
 *
 * Options:
 * - `baseline` — the baseline to judge against (default {@link DEFAULT_BASELINE};
 *   pass `null` to report `PENDING`).
 * - `capabilities` — a capability inventory, or a provider returning one. When
 *   omitted the inventory is unknown, so required capabilities are reported as
 *   unverified rather than absent.
 * - `now` — injectable clock (`() => Date | number | string`) for tests.
 * - `onVerdict` — called once per **material** observation (first assembly per
 *   scope, then each shape change), never for a debounced repeat.
 *
 * @param {{ baseline?: unknown, capabilities?: readonly string[] | (() => readonly string[] | undefined), now?: () => unknown, onVerdict?: (result: CompatibilityVerdict, snapshot: CompatibilitySnapshot) => void }} [options]
 * @returns {{ observe: (assembly: unknown, context?: unknown) => CompatibilitySnapshot, snapshot: () => CompatibilitySnapshot, verdict: () => VerdictName }}
 */
export function createCompatibilityAdapter(options = {}) {
  const rawOptions = isRecord(options) ? options : {}

  const baseline =
    Object.prototype.hasOwnProperty.call(rawOptions, 'baseline') ? rawOptions.baseline : DEFAULT_BASELINE
  const capabilitySource = safeGet(rawOptions, 'capabilities')
  const nowOption = safeGet(rawOptions, 'now')
  const now = typeof nowOption === 'function' ? /** @type {() => unknown} */ (nowOption) : () => Date.now()
  const onVerdictOption = safeGet(rawOptions, 'onVerdict')
  const onVerdict =
    typeof onVerdictOption === 'function'
      ? /** @type {(result: CompatibilityVerdict, snapshot: CompatibilitySnapshot) => void} */ (onVerdictOption)
      : null

  /** Shapes already classified, per scope, so a repeated assembly is a no-op. */
  const shapeByScope = new WeakMap()
  /** @type {string | null} */
  let globalShape = null

  /** @type {CompatibilitySnapshot} */
  let state = {
    verdict: 'PENDING',
    reasons: ['no prompt assembly has been observed yet'],
    sectionNames: [],
    abgIndex: -1,
    hostPromptHash: null,
    assemblyCount: 0,
    observedAt: null,
  }

  /**
   * @returns {string[] | undefined}
   */
  function resolveCapabilities() {
    try {
      const value = typeof capabilitySource === 'function' ? capabilitySource() : capabilitySource
      if (!Array.isArray(value)) return undefined
      /** @type {string[]} */
      const result = []
      for (const entry of value) {
        if (typeof entry === 'string') result.push(entry)
      }
      return result
    } catch {
      return undefined
    }
  }

  /** @returns {CompatibilitySnapshot} */
  function snapshot() {
    return {
      verdict: state.verdict,
      reasons: state.reasons.slice(),
      sectionNames: state.sectionNames.slice(),
      abgIndex: state.abgIndex,
      hostPromptHash: state.hostPromptHash,
      assemblyCount: state.assemblyCount,
      observedAt: state.observedAt,
    }
  }

  /**
   * Observe one real assembly. Idempotent for an unchanged shape, and never
   * throws: malformed input degrades to an observation with no readable sections.
   *
   * @param {unknown} assembly
   * @param {unknown} [context]
   * @returns {CompatibilitySnapshot}
   */
  function observe(assembly, context) {
    try {
      const normalized = normalizeAssembly(assembly)
      const capabilities = resolveCapabilities()
      const shape = shapeSignature(normalized, capabilities)
      const scopeObject = scopeKeyOf(context)
      const previous = scopeObject === null ? globalShape : shapeByScope.get(scopeObject)
      if (previous === shape) return snapshot()

      if (scopeObject === null) globalShape = shape
      else shapeByScope.set(scopeObject, shape)

      /** @type {CompatibilityObservation} */
      const observed = {
        sectionNames: normalized.sectionNames,
        hostPromptHash: normalized.hostPromptHash,
        sectionCount: normalized.sectionNames.length,
        contextCount: normalized.contextCount,
        toolCount: normalized.toolCount,
      }
      if (capabilities !== undefined) observed.capabilities = capabilities

      const result = classify({ observed, baseline })
      state = {
        verdict: result.verdict,
        reasons: result.reasons,
        sectionNames: normalized.sectionNames.slice(),
        abgIndex: normalized.abgIndex,
        hostPromptHash: normalized.hostPromptHash,
        assemblyCount: state.assemblyCount + 1,
        observedAt: timestamp(now),
      }

      if (onVerdict !== null) {
        try {
          onVerdict(result, snapshot())
        } catch {
          /* a consumer callback must never break prompt assembly */
        }
      }
    } catch {
      /* observing is best-effort: it must never throw into the waterfall */
    }
    return snapshot()
  }

  return {
    observe,
    snapshot,
    verdict: () => state.verdict,
  }
}
