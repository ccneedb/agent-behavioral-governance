/**
 * ABG kernel — opt-in diagnostics export (`ARCHITECTURE-SPEC` §28.7).
 *
 * The diagnostic ring lives inside the running host process. A front end — the
 * `abg` terminal interface, a script, a bug report — cannot read it directly,
 * which is why `abg_status` exists. This module adds the machine-readable half: a
 * small JSON mirror the process writes to a path the deployment chooses, and
 * `abg status` is its reader.
 *
 * Design constraints, in order:
 *
 * 1. **Off by default.** An empty `file` means no file I/O at all; the plugin's
 *    zero-side-effect property holds unless a deployment asks for the mirror.
 * 2. **Fail open, and never recurse.** A write failure is reported once and
 *    throttled; the ring, the status line, and the tools are unaffected. Because
 *    the failure reporter itself records a diagnostic, re-entrancy is blocked
 *    explicitly.
 * 3. **Bounded.** The payload carries at most `limit` entries, newest first.
 * 4. **Testable without a filesystem.** The actual write is injected, so the
 *    throttling, bounding, and failure paths are unit-testable.
 *
 * Migrated from `export.js` (2026-10-02). This is the source of truth;
 * `lib/generated/kernel/export.js` is the `tsc` build artifact that DSH actually
 * loads (see `TYPESCRIPT-MIGRATION.md`).
 */

/** Bumped when the mirror's shape changes, so a reader can refuse a stale file. */
export const EXPORT_SCHEMA_VERSION = 1

/** Minimum gap between writes while diagnostics stream in. */
export const DEFAULT_EXPORT_MIN_INTERVAL_MS = 500

/** Input to {@link createDiagnosticsExporter}. */
export interface DiagnosticsExporterInput {
  /** Absolute or relative path; empty disables the mirror. */
  file: string
  /** Maximum diagnostic entries in the payload. */
  limit?: number
  /** The live state to mirror. */
  snapshot: () => Record<string, unknown>
  /** Injected writer. */
  writeFile?: (path: string, text: string) => void
  onError?: (message: string) => void
  /** Injectable clock, for tests. */
  now?: () => number
  minIntervalMs?: number
}

/** The bounded, throttled diagnostics mirror. */
export interface DiagnosticsExporter {
  file: string
  limit: number
  /** Write now unless the throttle blocks it; `force` ignores the throttle. */
  flush(force?: boolean): boolean
  close(): void
  lastError(): string
}

/** Build the opt-in diagnostics mirror. */
export function createDiagnosticsExporter(input: DiagnosticsExporterInput): DiagnosticsExporter {
  const file = typeof input.file === 'string' ? input.file : ''
  const limit = typeof input.limit === 'number' ? input.limit : 50
  const now = input.now ?? (() => Date.now())
  const minIntervalMs = typeof input.minIntervalMs === 'number' ? input.minIntervalMs : DEFAULT_EXPORT_MIN_INTERVAL_MS
  const writeFile = input.writeFile

  let lastWrite = Number.NEGATIVE_INFINITY
  let lastError = ''
  let lastReportedError = ''
  let lastReportedAt = Number.NEGATIVE_INFINITY
  let writing = false
  let closed = false

  /**
   * @param force - ignore the throttle (mount, teardown, explicit ask).
   * @returns whether a write happened.
   */
  const flush = (force = false): boolean => {
    if (closed || file === '' || typeof writeFile !== 'function') return false
    // Re-entrancy guard: a failed write may report through the same diagnostic
    // path that triggers the next flush.
    if (writing) return false
    if (force !== true && now() - lastWrite < minIntervalMs) return false

    writing = true
    try {
      const payload = {
        schema: EXPORT_SCHEMA_VERSION,
        generatedAt: new Date(now()).toISOString(),
        ...input.snapshot(),
      }
      writeFile(file, `${JSON.stringify(payload, null, 2)}\n`)
      lastWrite = now()
      lastError = ''
      lastReportedError = ''
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = message
      // Retry no sooner than the interval, so a broken path cannot become a
      // write loop now that the report itself records a diagnostic.
      lastWrite = now()
      // The same failure is reported once per window, forced flushes included:
      // an unwritable path is one problem, not one problem per record.
      if (message !== lastReportedError || now() - lastReportedAt >= minIntervalMs) {
        lastReportedError = message
        lastReportedAt = now()
        input.onError?.(message)
      }
      return false
    } finally {
      writing = false
    }
  }

  return {
    file,
    limit,
    flush,
    close: () => {
      closed = true
    },
    lastError: () => lastError,
  }
}
