/**
 * ABG kernel — user-editable prompt overlay (`ARCHITECTURE-SPEC` §27.1).
 *
 * The compiled governance section is *generated* and *audited*: the conformance
 * suite enforces no duplicated statements, no implementation leakage, no
 * restating of rules the plugin already enforces deterministically, and a byte
 * budget. Letting a user replace that text trades those guarantees for
 * flexibility, which is a legitimate choice — but it must be a **loud** one.
 *
 * This module therefore does three things and nothing else:
 *
 * 1. composes the candidate text for the three modes (`compiled`, `append`,
 *    `replace`);
 * 2. refuses any candidate that breaks a *hard* requirement (interpolation
 *    syntax, or the byte ceiling unless explicitly allowed) and falls back to the
 *    audited default, reporting why;
 * 3. derives an attribution suffix so `PROMPT_VERSION` still names exactly one
 *    text (`0.2.0+user:<hash>`), which is what makes a behavioural claim
 *    traceable after a user edit.
 *
 * The soft invariants the conformance suite normally enforces cannot be checked
 * on arbitrary user text; that is reported as `unchecked` so no caller can
 * present a user-edited prompt as an audited one.
 *
 * Migrated from `prompt-override.js` (2026-10-02). This is the source of truth;
 * `lib/generated/kernel/prompt-override.js` is the `tsc` build artifact that DSH
 * actually loads (see `TYPESCRIPT-MIGRATION.md`).
 */
/** Invariants the conformance suite enforces on the compiled default but cannot enforce on user text. */
export declare const UNCHECKED_INVARIANTS: readonly string[];
/** Attribution hash, FNV-1a base36. Never a security primitive. */
export declare function shortHash(text: string): string;
/** Input to {@link composePromptOverride}. */
export interface ComposePromptOverrideInput {
    mode: 'compiled' | 'append' | 'replace';
    /** Extra guidance for `append` mode. */
    append?: string;
    /** File contents for `replace` mode. */
    overrideText?: string;
    /** The audited compiled section. */
    basePrompt: string;
    allowOverBudget?: boolean;
    maxBytes?: number;
}
/** Result of {@link composePromptOverride}: the effective text and why it is that text. */
export interface PromptOverrideResult {
    text: string;
    applied: boolean;
    versionSuffix: string;
    issues: string[];
    unchecked: string[];
}
/** Compose the governance section for the configured prompt mode. */
export declare function composePromptOverride(input: ComposePromptOverrideInput): PromptOverrideResult;
