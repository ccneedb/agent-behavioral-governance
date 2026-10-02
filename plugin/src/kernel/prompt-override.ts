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

import { containsInterpolationSyntax, utf8Bytes, DEFAULT_MAX_PROMPT_BYTES } from './prompt-compiler.js'

/** Invariants the conformance suite enforces on the compiled default but cannot enforce on user text. */
export const UNCHECKED_INVARIANTS: readonly string[] = Object.freeze([
  'no duplicated statements between modules (§5.2)',
  'no authority claim over the user or the host',
  'no implementation detail leaking into model-facing text',
  'no restatement of a rule the plugin enforces deterministically',
])

/** Attribution hash, FNV-1a base36. Never a security primitive. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

/** Input to {@link composePromptOverride}. */
export interface ComposePromptOverrideInput {
  mode: 'compiled' | 'append' | 'replace'
  /** Extra guidance for `append` mode. */
  append?: string
  /** File contents for `replace` mode. */
  overrideText?: string
  /** The audited compiled section. */
  basePrompt: string
  allowOverBudget?: boolean
  maxBytes?: number
}

/** Result of {@link composePromptOverride}: the effective text and why it is that text. */
export interface PromptOverrideResult {
  text: string
  applied: boolean
  versionSuffix: string
  issues: string[]
  unchecked: string[]
}

/** Compose the governance section for the configured prompt mode. */
export function composePromptOverride(input: ComposePromptOverrideInput): PromptOverrideResult {
  const base = input.basePrompt
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_PROMPT_BYTES
  const issues: string[] = []

  if (input.mode === 'compiled') {
    return { text: base, applied: false, versionSuffix: '', issues, unchecked: [] }
  }

  let candidate: string
  if (input.mode === 'append') {
    const extra = (input.append ?? '').trim()
    if (extra === '') {
      issues.push('prompt.append is empty; the compiled default is in use')
      return { text: base, applied: false, versionSuffix: '', issues, unchecked: [] }
    }
    candidate = `${base}\n\n${extra}`
  } else {
    const override = (input.overrideText ?? '').trim()
    if (override === '') {
      issues.push('prompt.mode is "replace" but the override text is unavailable; the compiled default is in use')
      return { text: base, applied: false, versionSuffix: '', issues, unchecked: [] }
    }
    candidate = override
  }

  // Hard requirement 1: the section is registered with `interpolate: false`, and
  // `{{ }}` in governance text is a latent host-assembly hazard either way.
  if (containsInterpolationSyntax(candidate)) {
    issues.push('the override contains `{{ }}` interpolation syntax and was rejected; the compiled default is in use')
    return { text: base, applied: false, versionSuffix: '', issues, unchecked: [] }
  }

  // Hard requirement 2: the §11 byte ceiling, unless the deployment explicitly
  // opts out. Prompt cost is a real budget, not a style preference.
  const bytes = utf8Bytes(candidate)
  if (bytes > maxBytes && input.allowOverBudget !== true) {
    issues.push(
      `the override is ${bytes} bytes, over the ${maxBytes}-byte ceiling, and was rejected; ` +
        'set prompt.allowOverBudget to accept it deliberately',
    )
    return { text: base, applied: false, versionSuffix: '', issues, unchecked: [] }
  }
  if (bytes > maxBytes) {
    issues.push(`the override is ${bytes} bytes and exceeds the ${maxBytes}-byte ceiling by explicit configuration`)
  }

  return {
    text: candidate,
    applied: true,
    versionSuffix: `+user:${shortHash(candidate)}`,
    issues,
    unchecked: [...UNCHECKED_INVARIANTS],
  }
}
