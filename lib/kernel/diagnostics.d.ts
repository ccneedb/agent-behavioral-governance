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
export declare const STATUS_LINE_MAX_BYTES = 200;
/**
 * The `ieg.*` diagnostic vocabulary of §28.2, in spec order.
 *
 * IEG owns these codes (§17.8, D8). `record` accepts codes outside this set as
 * well — an unknown code is a reporting concern, not a reason to drop the
 * event — and `counts()` reports whatever it actually retained.
 */
export declare const DIAGNOSTIC_CODES: readonly string[];
/** One unvalidated diagnostic input; every field is coerced. */
export interface DiagnosticInput {
    /** `ieg.*` code; coerce-safe. */
    code?: unknown;
    /** module id when attributable. */
    module?: unknown;
    sessionId?: unknown;
    agentId?: unknown;
    /** structured detail; kept only when a non-array object. */
    data?: unknown;
}
/** One retained diagnostic. */
export interface DiagnosticEntry {
    /** monotonic, 1-based, never rewound by `reset`. */
    seq: number;
    /** ISO-8601 timestamp, or the injected clock's string. */
    time: string;
    code: string;
    module?: string;
    sessionId?: string;
    agentId?: string;
    data?: Record<string, unknown>;
}
/** Options for {@link createDiagnostics}. */
export interface DiagnosticOptions {
    /** ring capacity; non-positive/non-numeric falls back to 200. */
    limit?: unknown;
    /** clock returning an ISO-8601 string. */
    now?: unknown;
}
/** The diagnostics ring's public surface. */
export interface Diagnostics {
    record(input?: unknown): DiagnosticEntry;
    recent(count?: unknown): DiagnosticEntry[];
    size(): number;
    counts(): Record<string, number>;
    formatLine(): string;
    lastCode(): string | null;
    reset(): void;
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
export declare function createDiagnostics(options?: DiagnosticOptions): Diagnostics;
