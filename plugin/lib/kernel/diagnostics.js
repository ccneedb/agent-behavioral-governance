/**
 * ABG kernel — diagnostics record and bounded ring.
 *
 * ARCHITECTURE-SPEC `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §28.1 / blocker 1:
 * `ctx.logger` is buffered but not displayed, because no shipped profile mounts
 * a Cordis exporter. An operator reading only the transcript could not tell
 * what ABG decided. This module is the substrate for the three visible
 * channels: the §28.3 status line (channel A), the `abg_status` tool
 * (channel B), and the durable ring (channel C).
 *
 * Design constraints, mirroring §28.2–§28.3:
 *
 * - **Bounded.** A fixed ring, default 200 entries, so a long session cannot
 *   grow diagnostics without limit.
 * - **Totally tolerant.** `record` accepts anything and never throws. A
 *   governance layer that can crash the request it observes is worse than one
 *   that cannot report. Malformed input is coerced to a safe entry.
 * - **Bounded line.** `formatLine` is capped at {@link STATUS_LINE_MAX_BYTES}
 *   UTF-8 bytes, counted in bytes rather than code units, and cannot contain a
 *   newline or any control character.
 * - **Stable.** `formatLine` is a pure function of the retained ring: with no
 *   intervening `record`/`reset` it returns an identical string, so the status
 *   line changes only when material state changes.
 * - **Dependency-free.** No imports, including Node builtins; the plugin stays
 *   import-free so it mounts in any composition. UTF-8 lengths are computed by
 *   hand rather than through `TextEncoder`, which is not in the ES2022 lib.
 */

/** Hard ceiling on the §28.3 channel-A status line, in UTF-8 bytes. */
export const STATUS_LINE_MAX_BYTES = 200

/**
 * The `abg.*` diagnostic vocabulary of §28.2, in spec order.
 *
 * ABG owns these codes (§17.8, D8). `record` accepts codes outside this set as
 * well — an unknown code is a reporting concern, not a reason to drop the
 * event — and `counts()` reports whatever it actually retained.
 */
export const DIAGNOSTIC_CODES = Object.freeze([
  'abg.mount',
  'abg.config_invalid',
  'abg.capability_missing',
  'abg.module_enabled',
  'abg.module_conflict',
  'abg.host_compatibility',
  'abg.prompt_assembly',
  'abg.prompt_override_applied',
  'abg.prompt_override_rejected',
  'abg.prompt_override_missing',
  'abg.diagnostics_export_failed',
  'abg.orientation_recorded',
  'abg.orientation_restored',
  'abg.orientation_required',
  'abg.question_registered',
  'abg.question_batch_created',
  'abg.question_deferred',
  'abg.question_submitted',
  'abg.question_batch_blocked',
  'abg.question_redundant',
  'abg.workspace_mutation_allowed',
  'abg.workspace_mutation_blocked',
  'abg.document_overlap_flagged',
  'abg.information_invalidated',
  'abg.information_reintroduced',
  'abg.error',
])

/** Ring size when the caller supplies no usable `limit`. */
const DEFAULT_LIMIT = 200

/** `recent()` default window, per the frozen interface. */
const DEFAULT_RECENT = 20

/** Substituted for a missing or non-string `code`. */
const FALLBACK_CODE = 'abg.error'

/**
 * Codes whose retained presence counts toward `warnings=` in the status line.
 * This is presentation only: it never suppresses or reclassifies an entry.
 */
const WARNING_CODES = new Set([
  'abg.config_invalid',
  'abg.capability_missing',
  'abg.module_conflict',
  'abg.host_compatibility',
  'abg.orientation_required',
  'abg.question_batch_blocked',
  'abg.question_redundant',
  'abg.workspace_mutation_blocked',
  'abg.document_overlap_flagged',
  'abg.information_invalidated',
  'abg.information_reintroduced',
  'abg.error',
])

/**
 * @typedef {object} DiagnosticInput
 * @property {unknown} [code] `abg.*` code; coerce-safe.
 * @property {unknown} [module] module id when attributable.
 * @property {unknown} [sessionId]
 * @property {unknown} [agentId]
 * @property {unknown} [data] structured detail; kept only when a non-array object.
 */

/**
 * @typedef {object} DiagnosticEntry
 * @property {number} seq monotonic, 1-based, never rewound by `reset`.
 * @property {string} time ISO-8601 timestamp, or the injected clock's string.
 * @property {string} code
 * @property {string} [module]
 * @property {string} [sessionId]
 * @property {string} [agentId]
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {object} DiagnosticOptions
 * @property {unknown} [limit] ring capacity; non-positive/non-numeric falls back to 200.
 * @property {unknown} [now] clock returning an ISO-8601 string.
 */

/**
 * @typedef {object} Diagnostics
 * @property {(input?: unknown) => DiagnosticEntry} record
 * @property {(count?: unknown) => DiagnosticEntry[]} recent
 * @property {() => number} size
 * @property {() => Record<string, number>} counts
 * @property {() => string} formatLine
 * @property {() => string | null} lastCode
 * @property {() => void} reset
 */

/**
 * Narrow an unknown value to a non-array object record.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Coerce an optional string field, tolerating finite numbers.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function optionalString(value) {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Coerce a code to a non-empty string, falling back to `abg.error`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normaliseCode(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return FALLBACK_CODE
}

/**
 * Keep structured detail only when it is a non-array object; anything else is
 * dropped rather than stringified, because `data` is never rendered.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown> | undefined}
 */
function plainData(value) {
  return isRecord(value) ? value : undefined
}

/**
 * A non-negative integer, or `fallback` for anything else. Never throws.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function nonNegativeInteger(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/**
 * A positive integer (ring capacity), or `fallback` for anything else.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInteger(value, fallback) {
  const sized = nonNegativeInteger(value, fallback)
  return sized >= 1 ? sized : fallback
}

/**
 * UTF-8 width of one code point.
 *
 * @param {number} codePoint
 * @returns {number}
 */
function utf8Width(codePoint) {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

/**
 * UTF-8 byte length, counted in bytes rather than code units so the
 * {@link STATUS_LINE_MAX_BYTES} cap cannot be exceeded by multi-byte text.
 *
 * @param {string} text
 * @returns {number}
 */
function utf8Length(text) {
  let bytes = 0
  for (const character of text) bytes += utf8Width(character.codePointAt(0) ?? 0)
  return bytes
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point.
 *
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(text, maxBytes) {
  if (utf8Length(text) <= maxBytes) return text
  let bytes = 0
  let truncated = ''
  for (const character of text) {
    const width = utf8Width(character.codePointAt(0) ?? 0)
    if (bytes + width > maxBytes) break
    bytes += width
    truncated += character
  }
  return truncated
}

/**
 * Collapse anything that could break the one-line contract.
 *
 * @param {string} text
 * @returns {string}
 */
function singleLine(text) {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()
}

/**
 * Create one diagnostics ring. The returned object is the whole public surface:
 * `record`, `recent`, `size`, `counts`, `formatLine`, `lastCode`, `reset`.
 *
 * `record` never throws. `recent`, `counts`, and `formatLine` likewise never
 * throw for any argument, because they are called from the status line and the
 * `abg_status` tool, where an exception would surface as a governance failure
 * rather than a diagnostics gap.
 *
 * @param {DiagnosticOptions | undefined} [options]
 * @returns {Diagnostics}
 */
export function createDiagnostics(options) {
  const config = isRecord(options) ? options : {}
  const limit = positiveInteger(config.limit, DEFAULT_LIMIT)
  /** @type {(() => unknown) | undefined} */
  const clock = typeof config.now === 'function' ? /** @type {() => unknown} */ (config.now) : undefined

  /** @type {DiagnosticEntry[]} */
  const ring = []
  /** Index of the oldest entry once the ring is full; ignored before then. */
  let head = 0
  let nextSeq = 1

  /**
   * Ring contents, oldest to newest.
   *
   * @returns {DiagnosticEntry[]}
   */
  function ordered() {
    if (ring.length < limit) return ring.slice()
    return [...ring.slice(head), ...ring.slice(0, head)]
  }

  /**
   * Resolve a timestamp, preferring the injected clock.
   *
   * @returns {string}
   */
  function timestamp() {
    if (clock !== undefined) {
      try {
        const value = clock()
        if (typeof value === 'string' && value.length > 0) return value
      } catch {
        // A broken clock must not lose the diagnostic: fall through to real time.
      }
    }
    try {
      return new Date().toISOString()
    } catch {
      return ''
    }
  }

  /**
   * Append one entry, evicting the oldest when the ring is full.
   *
   * @param {DiagnosticEntry} entry
   * @returns {void}
   */
  function store(entry) {
    if (ring.length < limit) {
      ring.push(entry)
      return
    }
    ring[head] = entry
    head = (head + 1) % limit
  }

  /**
   * Record one diagnostic. Returns the stored plain object.
   *
   * @param {unknown} [input]
   * @returns {DiagnosticEntry}
   */
  function record(input) {
    const source = isRecord(input) ? input : {}
    /** @type {DiagnosticEntry} */
    const entry = {
      seq: nextSeq,
      time: timestamp(),
      code: normaliseCode(source.code),
    }
    nextSeq += 1

    const moduleId = optionalString(source.module)
    if (moduleId !== undefined) entry.module = moduleId
    const sessionId = optionalString(source.sessionId)
    if (sessionId !== undefined) entry.sessionId = sessionId
    const agentId = optionalString(source.agentId)
    if (agentId !== undefined) entry.agentId = agentId
    const data = plainData(source.data)
    if (data !== undefined) entry.data = data

    store(entry)
    return entry
  }

  /**
   * Up to `count` retained entries, oldest to newest. `count` defaults to 20.
   *
   * @param {unknown} [count]
   * @returns {DiagnosticEntry[]}
   */
  function recent(count = DEFAULT_RECENT) {
    const wanted = nonNegativeInteger(count, DEFAULT_RECENT)
    const entries = ordered()
    return entries.slice(Math.max(0, entries.length - wanted))
  }

  /**
   * The number of retained entries, at most `limit`.
   *
   * @returns {number}
   */
  function size() {
    return ring.length
  }

  /**
   * Code frequency over the retained ring, as a fresh plain object.
   *
   * @returns {Record<string, number>}
   */
  function counts() {
    /** @type {Record<string, number>} */
    const totals = {}
    for (const entry of ordered()) {
      const next = (Object.hasOwn(totals, entry.code) ? totals[entry.code] : 0) + 1
      // `defineProperty` rather than `totals[code] = …`: an unknown code such as
      // `__proto__` must become an own data property, not touch the prototype.
      Object.defineProperty(totals, entry.code, { value: next, enumerable: true, writable: true, configurable: true })
    }
    return totals
  }

  /**
   * The most recent retained code, or `null` when the ring is empty.
   *
   * @returns {string | null}
   */
  function lastCode() {
    const entries = ordered()
    const last = /** @type {DiagnosticEntry | undefined} */ (entries[entries.length - 1])
    return last === undefined ? null : last.code
  }

  /**
   * Count retained warning-class entries for the status line.
   *
   * @returns {number}
   */
  function warningCount() {
    let total = 0
    for (const entry of ordered()) if (WARNING_CODES.has(entry.code)) total += 1
    return total
  }

  /**
   * One single-line, byte-capped summary of material state. Pure: repeated
   * calls with no intervening `record`/`reset` are identical.
   *
   * @returns {string}
   */
  function formatLine() {
    const line = `abg: diagnostics=${size()} last=${lastCode() ?? 'none'} warnings=${warningCount()}`
    return truncateUtf8(singleLine(line), STATUS_LINE_MAX_BYTES)
  }

  /**
   * Empty the ring and clear counts. `seq` keeps increasing, so sequence
   * numbers stay monotonic for the lifetime of the instance.
   *
   * @returns {void}
   */
  function reset() {
    ring.length = 0
    head = 0
  }

  return { record, recent, size, counts, formatLine, lastCode, reset }
}
