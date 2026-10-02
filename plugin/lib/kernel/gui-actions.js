/**
 * ABG kernel — GUI write actions (`ARCHITECTURE-SPEC` §28.8).
 *
 * The status panel only reads. The prompt editor and the feedback form need to
 * *write*, so they are the first ABG surface that accepts input from a browser.
 * Three rules shape this module:
 *
 * 1. **Nothing is written unless the deployment said where.** Editing is enabled
 *    only when `prompt.mode` is `replace` and `prompt.file` names a path; a
 *    deployment that never opted in gets a read-only editor and a 409, not a
 *    surprise file. There is deliberately no "default" prompt path.
 * 2. **The same kernels decide, not a second implementation.** Prompt edits go
 *    through `composePromptOverride` (so the interpolation and byte-ceiling rules
 *    apply identically to the GUI, the file and the config), and feedback goes
 *    through `composeFeedback` (so the redaction tests cover the browser path
 *    too). A GUI that composed its own report would be a second, leakier
 *    composer.
 * 3. **Pure and injected.** These functions do no I/O: the caller supplies the
 *    write, the diagnostics window, the token environment and the fetch. That is
 *    what makes every branch — including the refusal and the API failure —
 *    unit-testable without a host, a browser or a network.
 */

import { composePromptOverride } from './prompt-override.js'
import { composeFeedback, fileFeedbackIssue, MAX_DIAGNOSTICS } from './feedback.js'
import { DEFAULT_MAX_PROMPT_BYTES } from './prompt-compiler.js'

/** Largest accepted JSON request body, to bound a browser's influence on memory. */
export const MAX_REQUEST_BYTES = 65536

/**
 * The prompt editor's view of the world, for the panel.
 *
 * @param {object} input
 * @param {AbgConfig} input.config
 * @param {{ text: string, bytes: number, overridden: boolean, version: string, issues: string[], unchecked: string[] }} input.state
 * @returns {Record<string, unknown>}
 */
export function promptEditorState(input) {
  const { config, state } = input
  return {
    editable: config.prompt.mode === 'replace' && config.prompt.file !== '',
    mode: config.prompt.mode,
    file: config.prompt.file,
    allowOverBudget: config.prompt.allowOverBudget,
    text: state.text,
    bytes: state.bytes,
    budget: DEFAULT_MAX_PROMPT_BYTES,
    overridden: state.overridden,
    version: state.version,
    issues: state.issues,
    unchecked: state.unchecked,
    hint:
      config.prompt.mode === 'replace' && config.prompt.file !== ''
        ? `Saved to ${config.prompt.file} and applied on the next step.`
        : 'Read-only here: set prompt.mode to "replace" and prompt.file to a path to edit from the GUI.',
  }
}

/**
 * Validate a prompt edit without performing it.
 *
 * @param {object} input
 * @param {AbgConfig} input.config
 * @param {string} input.basePrompt - the audited compiled section.
 * @param {unknown} input.text - the submitted replacement text.
 * @returns {{ status: number, body: Record<string, unknown>, composed?: ReturnType<typeof composePromptOverride> }}
 */
export function planPromptEdit(input) {
  const { config, basePrompt } = input
  if (config.prompt.mode !== 'replace' || config.prompt.file === '') {
    return {
      status: 409,
      body: {
        error: 'prompt editing is disabled for this profile',
        hint: 'set prompt.mode: replace and prompt.file: <path>, then restart',
      },
    }
  }
  if (typeof input.text !== 'string') {
    return { status: 400, body: { error: 'text must be a string' } }
  }

  const composed = composePromptOverride({
    mode: 'replace',
    overrideText: input.text,
    basePrompt,
    allowOverBudget: config.prompt.allowOverBudget,
  })
  if (!composed.applied) {
    // A refusal is information, not a failure of the request: the panel shows it.
    return { status: 422, body: { error: 'the edit was refused', issues: composed.issues } }
  }
  return {
    status: 200,
    body: {
      applied: true,
      bytes: composed.text.length,
      version: composed.versionSuffix,
      issues: composed.issues,
      unchecked: composed.unchecked,
    },
    composed,
  }
}

/**
 * Compose a feedback report for the panel, and optionally file it.
 *
 * `fileRequested` is honoured only in `api` mode; otherwise the response says so
 * and still returns the prefilled link, so the tester can submit it by hand.
 *
 * @param {object} input
 * @param {AbgFeedbackPolicy} input.config
 * @param {AbgFeedbackMount} input.mount
 * @param {{ recent: (limit: number) => unknown[] }} input.diagnostics
 * @param {string} input.pluginVersion
 * @param {string} input.promptVersion
 * @param {Record<string, unknown>} input.payload
 * @param {AbgFetch} [input.fetchImpl]
 * @param {Record<string, string | undefined>} [input.env]
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function submitFeedback(input) {
  const payload = input.payload ?? {}
  const summary = typeof payload.summary === 'string' ? payload.summary : ''
  if (summary.trim() === '') {
    return { status: 400, body: { error: 'summary is required' } }
  }

  const composed = composeFeedback({
    summary,
    expected: typeof payload.expected === 'string' ? payload.expected : '',
    actual: typeof payload.actual === 'string' ? payload.actual : '',
    mount: input.mount,
    diagnostics: /** @type {{ code?: string, time?: string, module?: string }[]} */ (
      input.diagnostics.recent(MAX_DIAGNOSTICS)
    ),
    repository: input.config.repository,
    labels: input.config.labels,
    pluginVersion: input.pluginVersion,
    promptVersion: input.promptVersion,
    includeDiagnostics: input.config.includeDiagnostics,
  })

  /** @type {Record<string, unknown>} */
  const body = {
    title: composed.title,
    markdown: composed.body,
    issue_url: composed.url,
    truncated_in_url: composed.truncated,
    repository: input.config.repository,
    mode: input.config.mode,
    filed: false,
  }

  if (payload.file === true) {
    if (input.config.mode !== 'api') {
      body.file_result = { reason: 'feedback.mode is "url"; open the link to submit it' }
    } else {
      const filed = await fileFeedbackIssue({
        repository: input.config.repository,
        title: composed.title,
        body: composed.body,
        labels: input.config.labels,
        tokenEnvVar: input.config.tokenEnvVar,
        env: input.env,
        fetchImpl: input.fetchImpl,
      })
      body.filed = filed.ok
      body.file_result = filed.ok ? { issue_url: filed.issueUrl, issue_number: filed.issueNumber } : { reason: filed.reason }
      if (filed.ok && filed.issueUrl !== '') body.issue_url = filed.issueUrl
    }
  }

  return { status: 200, body }
}
