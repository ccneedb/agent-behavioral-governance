/**
 * ABG kernel — opt-in diagnostics export (`ARCHITECTURE-SPEC` §28.7).
 *
 * The diagnostic ring lives inside the running host process. A front end — the
 * Web GUI panel, a terminal, a bug report — cannot read it directly, which is
 * why `abg_status` exists. This module adds the machine-readable half: a small
 * JSON mirror the process writes to a path the deployment chooses.
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
export declare const EXPORT_SCHEMA_VERSION = 1;
/** Minimum gap between writes while diagnostics stream in. */
export declare const DEFAULT_EXPORT_MIN_INTERVAL_MS = 500;
/** Input to {@link createDiagnosticsExporter}. */
export interface DiagnosticsExporterInput {
    /** Absolute or relative path; empty disables the mirror. */
    file: string;
    /** Maximum diagnostic entries in the payload. */
    limit?: number;
    /** The live state to mirror. */
    snapshot: () => Record<string, unknown>;
    /** Injected writer. */
    writeFile?: (path: string, text: string) => void;
    onError?: (message: string) => void;
    /** Injectable clock, for tests. */
    now?: () => number;
    minIntervalMs?: number;
}
/** The bounded, throttled diagnostics mirror. */
export interface DiagnosticsExporter {
    file: string;
    limit: number;
    /** Write now unless the throttle blocks it; `force` ignores the throttle. */
    flush(force?: boolean): boolean;
    close(): void;
    lastError(): string;
}
/** Build the opt-in diagnostics mirror. */
export declare function createDiagnosticsExporter(input: DiagnosticsExporterInput): DiagnosticsExporter;
