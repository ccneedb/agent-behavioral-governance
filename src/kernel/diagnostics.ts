/**
 * IEG kernel — diagnostics record and bounded ring.
 *
 * ARCHITECTURE-SPEC `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §28.1 / blocker 1:
 * `ctx.logger` is buffered but not displayed, because no shipped profile mounts
 * a Cordis exporter. An operator reading only the transcript could not tell
 * what IEG decided. This module is the substrate for the three visible
 * channels: the §28.3 status line (channel A), the `ieg_status` tool
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
 * The `ieg.*` diagnostic vocabulary of §28.2, in spec order.
 *
 * IEG owns these codes (§17.8, D8). `record` accepts codes outside this set as
 * well — an unknown code is a reporting concern, not a reason to drop the
 * event — and `counts()` reports whatever it actually retained.
 */
export const DIAGNOSTIC_CODES: readonly string[] = Object.freeze([
  'ieg.mount',
  'ieg.config_invalid',
  'ieg.capability_missing',
  'ieg.module_enabled',
  'ieg.module_conflict',
  'ieg.host_compatibility',
  'ieg.prompt_assembly',
  'ieg.prompt_override_applied',
  'ieg.prompt_override_rejected',
  'ieg.prompt_override_missing',
  'ieg.control_paused',
  'ieg.control_resumed',
  'ieg.control_stopped',
  'ieg.control_generation_changed',
  'ieg.control_state_unreadable',
  'ieg.diagnostics_export_failed',
  'ieg.orientation_recorded',
  'ieg.orientation_restored',
  'ieg.orientation_required',
  'ieg.workspace_mutation_allowed',
  'ieg.workspace_mutation_blocked',
  'ieg.document_overlap_flagged',
  'ieg.information_invalidated',
  'ieg.information_reintroduced',
  'ieg.error',
])

/** Ring size when the caller supplies no usable `limit`. */
const DEFAULT_LIMIT = 200

/** `recent()` default window, per the frozen interface. */
const DEFAULT_RECENT = 20

/** Substituted for a missing or non-string `code`. */
const FALLBACK_CODE = 'ieg.error'

/**
 * Codes whose retained presence counts toward `warnings=` in the status line.
 * This is presentation only: it never suppresses or reclassifies an entry.
 */
const WARNING_CODES = new Set([
  'ieg.config_invalid',
  'ieg.capability_missing',
  'ieg.module_conflict',
  'ieg.host_compatibility',
  'ieg.orientation_required',
  'ieg.workspace_mutation_blocked',
  'ieg.document_overlap_flagged',
  'ieg.information_invalidated',
  'ieg.information_reintroduced',
  'ieg.error',
])

/** One unvalidated diagnostic input; every field is coerced. */
export interface DiagnosticInput {
  /** `ieg.*` code; coerce-safe. */
  code?: unknown
  /** module id when attributable. */
  module?: unknown
  sessionId?: unknown
  agentId?: unknown
  /** structured detail; kept only when a non-array object. */
  data?: unknown
}

/** One retained diagnostic. */
export interface DiagnosticEntry {
  /** monotonic, 1-based, never rewound by `reset`. */
  seq: number
  /** ISO-8601 timestamp, or the injected clock's string. */
  time: string
  code: string
  module?: string
  sessionId?: string
  agentId?: string
  data?: Record<string, unknown>
}

/** Options for {@link createDiagnostics}. */
export interface DiagnosticOptions {
  /** ring capacity; non-positive/non-numeric falls back to 200. */
  limit?: unknown
  /** clock returning an ISO-8601 string. */
  now?: unknown
}

/** The diagnostics ring's public surface. */
export interface Diagnostics {
  record(input?: unknown): DiagnosticEntry
  recent(count?: unknown): DiagnosticEntry[]
  size(): number
  counts(): Record<string, number>
  formatLine(): string
  lastCode(): string | null
  reset(): void
}

/**
 * Narrow an unknown value to a non-array object record.
 *
 * @param value
 * @returns whether the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Coerce an optional string field, tolerating finite numbers.
 *
 * @param value
 * @returns the coerced string, or `undefined` when there is none.
 */
function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Coerce a code to a non-empty string, falling back to `ieg.error`.
 *
 * @param value
 * @returns the normalised code.
 */
function normaliseCode(value: unknown): string {
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
 * @param value
 * @returns the retained detail record, or `undefined`.
 */
function plainData(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

/**
 * A non-negative integer, or `fallback` for anything else. Never throws.
 *
 * @param value
 * @param fallback
 * @returns the integer, or the fallback.
 */
function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

/**
 * A positive integer (ring capacity), or `fallback` for anything else.
 *
 * @param value
 * @param fallback
 * @returns the integer, or the fallback.
 */
function positiveInteger(value: unknown, fallback: number): number {
  const sized = nonNegativeInteger(value, fallback)
  return sized >= 1 ? sized : fallback
}

/**
 * UTF-8 width of one code point.
 *
 * @param codePoint
 * @returns the width in bytes.
 */
function utf8Width(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

/**
 * UTF-8 byte length, counted in bytes rather than code units so the
 * {@link STATUS_LINE_MAX_BYTES} cap cannot be exceeded by multi-byte text.
 *
 * @param text
 * @returns the length in bytes.
 */
function utf8Length(text: string): number {
  let bytes = 0
  for (const character of text) bytes += utf8Width(character.codePointAt(0) ?? 0)
  return bytes
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point.
 *
 * @param text
 * @param maxBytes
 * @returns the truncated text.
 */
function truncateUtf8(text: string, maxBytes: number): string {
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
 * @param text
 * @returns the single-line text.
 */
function singleLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim()
}

/**
 * Create one diagnostics ring. The returned object is the whole public surface:
 * `record`, `recent`, `size`, `counts`, `formatLine`, `lastCode`, `reset`.
 *
 * `record` never throws. `recent`, `counts`, and `formatLine` likewise never
 * throw for any argument, because they are called from the status line and the
 * `ieg_status` tool, where an exception would surface as a governance failure
 * rather than a diagnostics gap.
 *
 * @param options
 * @returns the diagnostics ring.
 */
export function createDiagnostics(options?: DiagnosticOptions): Diagnostics {
  const config: Record<string, unknown> = isRecord(options) ? options : {}
  const limit = positiveInteger(config.limit, DEFAULT_LIMIT)
  const clock = typeof config.now === 'function' ? (config.now as () => unknown) : undefined

  const ring: DiagnosticEntry[] = []
  /** Index of the oldest entry once the ring is full; ignored before then. */
  let head = 0
  let nextSeq = 1

  /**
   * Ring contents, oldest to newest.
   *
   * @returns the ring contents in order.
   */
  function ordered(): DiagnosticEntry[] {
    if (ring.length < limit) return ring.slice()
    return [...ring.slice(head), ...ring.slice(0, head)]
  }

  /**
   * Resolve a timestamp, preferring the injected clock.
   *
   * @returns the timestamp string.
   */
  function timestamp(): string {
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
   * @param entry
   */
  function store(entry: DiagnosticEntry): void {
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
   * @param input
   * @returns the stored entry.
   */
  function record(input?: unknown): DiagnosticEntry {
    const source: Record<string, unknown> = isRecord(input) ? input : {}
    const entry: DiagnosticEntry = {
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
   * @param count
   * @returns the retained entries.
   */
  function recent(count: unknown = DEFAULT_RECENT): DiagnosticEntry[] {
    const wanted = nonNegativeInteger(count, DEFAULT_RECENT)
    const entries = ordered()
    return entries.slice(Math.max(0, entries.length - wanted))
  }

  /**
   * The number of retained entries, at most `limit`.
   *
   * @returns the retained entry count.
   */
  function size(): number {
    return ring.length
  }

  /**
   * Code frequency over the retained ring, as a fresh plain object.
   *
   * @returns the per-code totals.
   */
  function counts(): Record<string, number> {
    const totals: Record<string, number> = {}
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
   * @returns the last code, or `null`.
   */
  function lastCode(): string | null {
    const entries = ordered()
    const last = entries[entries.length - 1] as DiagnosticEntry | undefined
    return last === undefined ? null : last.code
  }

  /**
   * Count retained warning-class entries for the status line.
   *
   * @returns the warning-class entry count.
   */
  function warningCount(): number {
    let total = 0
    for (const entry of ordered()) if (WARNING_CODES.has(entry.code)) total += 1
    return total
  }

  /**
   * One single-line, byte-capped summary of material state. Pure: repeated
   * calls with no intervening `record`/`reset` are identical.
   *
   * @returns the status line.
   */
  function formatLine(): string {
    const line = `ieg: diagnostics=${size()} last=${lastCode() ?? 'none'} warnings=${warningCount()}`
    return truncateUtf8(singleLine(line), STATUS_LINE_MAX_BYTES)
  }

  /**
   * Empty the ring and clear counts. `seq` keeps increasing, so sequence
   * numbers stay monotonic for the lifetime of the instance.
   */
  function reset(): void {
    ring.length = 0
    head = 0
  }

  return { record, recent, size, counts, formatLine, lastCode, reset }
}
