/**
 * ABG kernel — the prompt store (`ARCHITECTURE-SPEC` §27.1, 0.6.0).
 *
 * Prompt text is **not** stored inside the control-state JSON. It lives in a
 * sibling file, `prompt.md`, so the JSON stays a small stable control record and
 * the text stays something a human edits as text. This module owns that file and
 * the precedence that decides which text the plugin actually emits.
 *
 * Validation is deliberately **not** re-implemented here: every candidate goes
 * through `composePromptOverride`, the existing, tested override kernel. That is
 * what makes the CLI, a config-supplied file, and the compiled default obey the
 * same two hard rules — no `{{ }}` interpolation syntax, and the byte ceiling
 * unless explicitly allowed — and it is what gives an accepted override the
 * attribution `PROMPT_VERSION+user:<hash>`.
 *
 * Precedence, as documented in the README:
 *
 * ```text
 * control-plane prompt.md                                  (highest)
 *   > config prompt.file   (only when prompt.mode: replace)
 *   > config prompt.append (only when prompt.mode: append)
 *   > the compiled default                                 (lowest)
 * ```
 *
 * `prompt.mode: compiled` therefore yields the compiled default whenever no
 * control-plane `prompt.md` exists; `abg prompt reset` is how an operator returns
 * to it. A `prompt.md` that exists but is refused never becomes effective: the
 * next lower source is used and the refusal reasons are reported.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { utf8Bytes } from './prompt-compiler.js'
import { composePromptOverride, type PromptOverrideResult } from './prompt-override.js'

/** The prompt file's fixed name; always the sibling of the control-state file. */
export const PROMPT_FILE_NAME = 'prompt.md'

/** Where the effective text came from. */
export type AbgPromptSource = 'control' | 'config-file' | 'config-append' | 'compiled'

/** Input to {@link resolveEffectivePrompt}. */
export interface EffectivePromptInput {
  /** The audited compiled section, which every candidate is validated against. */
  basePrompt: string
  /** The config layer's mode. */
  mode: 'compiled' | 'append' | 'replace'
  /** Config `prompt.append`, used when `mode` is `append`. */
  append?: string
  /** Contents of config `prompt.file`, used when `mode` is `replace`. */
  configText?: string
  /** Contents of the control-plane `prompt.md`, when one exists. */
  controlText?: string
  /** Path of the control-plane `prompt.md`, for reporting only. */
  controlPath?: string
  /** Accept text over the byte ceiling, deliberately and visibly. */
  allowOverBudget?: boolean
}

/** The text the plugin will emit, and exactly why. */
export interface EffectivePrompt {
  text: string
  /** Whether a user-authored override is in force. */
  applied: boolean
  source: AbgPromptSource
  /** `+user:<hash>` when an override applied; `''` otherwise. */
  versionSuffix: string
  /** Hard-rule refusals and informational notes, in the order they were found. */
  issues: string[]
  /** Soft invariants that no longer apply once the text is user-authored. */
  unchecked: string[]
  bytes: number
  controlPath: string
  /** Whether a control-plane `prompt.md` existed but was refused. */
  controlRefused: boolean
}

/** Adapt a composition result to the store's return shape. */
function outcome(
  composed: PromptOverrideResult,
  source: AbgPromptSource,
  input: EffectivePromptInput,
  extraIssues: string[],
  controlRefused: boolean,
): EffectivePrompt {
  return {
    text: composed.text,
    applied: composed.applied,
    source,
    versionSuffix: composed.versionSuffix,
    issues: [...extraIssues, ...composed.issues],
    unchecked: composed.unchecked,
    bytes: utf8Bytes(composed.text),
    controlPath: input.controlPath ?? '',
    controlRefused,
  }
}

/** Resolve the effective governance prompt for one profile. Pure; no I/O. */
export function resolveEffectivePrompt(input: EffectivePromptInput): EffectivePrompt {
  const base = input.basePrompt
  let controlIssues: string[] = []
  let controlRefused = false

  // 1. Control plane. A non-empty prompt.md is the operator's current choice and
  //    outranks every configuration layer.
  if (typeof input.controlText === 'string' && input.controlText.trim() !== '') {
    const composed = composePromptOverride({
      mode: 'replace',
      overrideText: input.controlText,
      basePrompt: base,
      allowOverBudget: input.allowOverBudget,
    })
    if (composed.applied) return outcome(composed, 'control', input, [], false)
    controlRefused = true
    controlIssues = composed.issues.map((issue) => `${PROMPT_FILE_NAME}: ${issue}`)
  }

  // 2. Configuration layer.
  const composed = composePromptOverride({
    mode: input.mode,
    append: input.append,
    overrideText: input.configText,
    basePrompt: base,
    allowOverBudget: input.allowOverBudget,
  })
  const source: AbgPromptSource = composed.applied
    ? input.mode === 'replace'
      ? 'config-file'
      : 'config-append'
    : 'compiled'
  return outcome(composed, source, input, controlIssues, controlRefused)
}

/** Result of reading the control-plane prompt file. */
export interface PromptFileRead {
  text?: string
  present: boolean
  issue?: string
}

/** Read `prompt.md`, tolerating absence and read errors. Never throws. */
export function readPromptFile(file: string): PromptFileRead {
  try {
    return { text: readFileSync(file, 'utf8'), present: true }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'ENOENT') return { present: false }
    const message = error instanceof Error ? error.message : String(error)
    return { present: false, issue: `prompt.md could not be read (${message})` }
  }
}

/** Write `prompt.md` atomically: sibling temporary file, then rename. */
export function writePromptFile(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, file)
}

/** Delete `prompt.md`. Returns whether a file was actually removed. */
export function deletePromptFile(file: string): boolean {
  try {
    unlinkSync(file)
    return true
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'ENOENT') return false
    throw error
  }
}

/** Validate candidate replacement text through the existing override kernel. */
export function validatePromptText(input: {
  basePrompt: string
  text: string
  allowOverBudget?: boolean
}): PromptOverrideResult & { bytes: number } {
  const composed = composePromptOverride({
    mode: 'replace',
    overrideText: input.text,
    basePrompt: input.basePrompt,
    allowOverBudget: input.allowOverBudget,
  })
  return { ...composed, bytes: utf8Bytes(composed.text) }
}

/** `PROMPT_VERSION` with an override's attribution suffix appended. */
export function attributedPromptVersion(promptVersion: string, versionSuffix: string): string {
  return `${promptVersion}${versionSuffix}`
}
