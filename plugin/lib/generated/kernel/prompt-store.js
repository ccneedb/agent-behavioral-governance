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
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { utf8Bytes } from './prompt-compiler.js';
import { composePromptOverride } from './prompt-override.js';
/** The prompt file's fixed name; always the sibling of the control-state file. */
export const PROMPT_FILE_NAME = 'prompt.md';
/** Adapt a composition result to the store's return shape. */
function outcome(composed, source, input, extraIssues, controlRefused) {
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
    };
}
/** Resolve the effective governance prompt for one profile. Pure; no I/O. */
export function resolveEffectivePrompt(input) {
    const base = input.basePrompt;
    let controlIssues = [];
    let controlRefused = false;
    // 1. Control plane. A non-empty prompt.md is the operator's current choice and
    //    outranks every configuration layer.
    if (typeof input.controlText === 'string' && input.controlText.trim() !== '') {
        const composed = composePromptOverride({
            mode: 'replace',
            overrideText: input.controlText,
            basePrompt: base,
            allowOverBudget: input.allowOverBudget,
        });
        if (composed.applied)
            return outcome(composed, 'control', input, [], false);
        controlRefused = true;
        controlIssues = composed.issues.map((issue) => `${PROMPT_FILE_NAME}: ${issue}`);
    }
    // 2. Configuration layer.
    const composed = composePromptOverride({
        mode: input.mode,
        append: input.append,
        overrideText: input.configText,
        basePrompt: base,
        allowOverBudget: input.allowOverBudget,
    });
    const source = composed.applied
        ? input.mode === 'replace'
            ? 'config-file'
            : 'config-append'
        : 'compiled';
    return outcome(composed, source, input, controlIssues, controlRefused);
}
/** Read `prompt.md`, tolerating absence and read errors. Never throws. */
export function readPromptFile(file) {
    try {
        return { text: readFileSync(file, 'utf8'), present: true };
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT')
            return { present: false };
        const message = error instanceof Error ? error.message : String(error);
        return { present: false, issue: `prompt.md could not be read (${message})` };
    }
}
/** Write `prompt.md` atomically: sibling temporary file, then rename. */
export function writePromptFile(file, text) {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, text);
    renameSync(temporary, file);
}
/** Delete `prompt.md`. Returns whether a file was actually removed. */
export function deletePromptFile(file) {
    try {
        unlinkSync(file);
        return true;
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT')
            return false;
        throw error;
    }
}
/** Validate candidate replacement text through the existing override kernel. */
export function validatePromptText(input) {
    const composed = composePromptOverride({
        mode: 'replace',
        overrideText: input.text,
        basePrompt: input.basePrompt,
        allowOverBudget: input.allowOverBudget,
    });
    return { ...composed, bytes: utf8Bytes(composed.text) };
}
/** `PROMPT_VERSION` with an override's attribution suffix appended. */
export function attributedPromptVersion(promptVersion, versionSuffix) {
    return `${promptVersion}${versionSuffix}`;
}
