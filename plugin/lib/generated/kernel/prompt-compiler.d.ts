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
 *
 * Migrated from `prompt-compiler.js` (2026-10-02). This is the source of truth;
 * `lib/generated/kernel/prompt-compiler.js` is the `tsc` build artifact that
 * DSH actually loads (see `TYPESCRIPT-MIGRATION.md`).
 */
/**
 * Recorded size of the compiled four-module governance section, in UTF-8 bytes,
 * measured at `PROMPT_VERSION` `0.2.0`. The ceiling is derived from this
 * recorded footprint rather than from the current compilation: a budget that is
 * recomputed from the text it is meant to bound can never detect growth.
 */
export declare const RECORDED_PROMPT_BYTES = 3459;
/** Floor for the ceiling, so a shrunken prompt cannot drive the budget to zero (§34.1 B6). */
export declare const PROMPT_BYTE_FLOOR = 1400;
/** Hard cap on the ceiling, independent of the recorded size (§34.1 B6). */
export declare const PROMPT_BYTE_HARD_CAP = 4096;
/**
 * Default ceiling for the compiled governance section, in UTF-8 bytes
 * (`ARCHITECTURE-SPEC` §11, §34.1 B6): the recorded size plus 10 %, floored at
 * {@link PROMPT_BYTE_FLOOR} and capped at {@link PROMPT_BYTE_HARD_CAP}.
 *
 * Raising this ceiling is a policy change and must carry a documented reason
 * (PRODUCT-SPEC PR-07/PR-08), recorded in `CHANGELOG.md` alongside the prompt
 * revision it bounds.
 */
export declare const DEFAULT_MAX_PROMPT_BYTES: number;
/**
 * Count UTF-8 bytes without depending on `Buffer` or `TextEncoder`, so the
 * package stays import-free and typecheckable in isolation.
 */
export declare function utf8Bytes(text: string): number;
/** Whether text contains prompt-variable interpolation syntax. */
export declare function containsInterpolationSyntax(text: string): boolean;
/** Input to {@link compilePrompt}. */
export interface CompilePromptInput {
    /** Stable kernel invariants. */
    kernelPrinciples: readonly string[];
    /** Enabled modules, already in dependency order. */
    modules: readonly GovernanceModule[];
    /** Budget for the compiled section. */
    maxBytes?: number;
}
/**
 * Compile the single additive ABG governance section.
 *
 * @returns the section text, or `''` when nothing is enabled.
 * @throws when the compiled text exceeds the budget or contains interpolation syntax.
 */
export declare function compilePrompt(input: CompilePromptInput): string;
/** Size report for the compiled prompt (`prompt_assembly` diagnostics, §12). */
export interface PromptStats {
    bytes: number;
    characters: number;
    lines: number;
}
/** Report the compiled prompt's size, for `prompt_assembly` diagnostics (§12). */
export declare function promptStats(text: string): PromptStats;
