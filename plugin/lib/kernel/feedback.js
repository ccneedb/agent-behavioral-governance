/**
 * ABG kernel — optional feedback channel (`ARCHITECTURE-SPEC` §28.6).
 *
 * ABG is a prototype under volunteer testing, so a tester who observes a
 * behavioural deviation must be able to file a report in one step. This module
 * registers one read-only tool, `abg_report_issue`, that composes a **redacted**
 * issue body from facts the plugin already holds (mount record, degraded
 * capabilities, compatibility verdict, diagnostic codes) plus the tester's own
 * account of what happened.
 *
 * Two deliberate design choices:
 *
 * 1. **It never files anything by itself.** The default `url` mode returns a
 *    prefilled `github.com/.../issues/new` link and the markdown body. Nothing
 *    leaves the machine, no credential is read, and a human decides to submit.
 *    `api` mode is strictly opt-in and reads a token from the environment, never
 *    from configuration.
 * 2. **It is redaction-by-construction.** Diagnostic entries are reduced to
 *    `code`/`time`/`module`; `data`, agent ids, session ids, file contents,
 *    prompts, and session logs are dropped before composition, so a careless
 *    caller cannot leak them through this channel.
 *
 * Everything here fails open: if the network, the token, or the GitHub API is
 * unavailable, the caller still receives the prefilled link.
 */

import { DEFAULT_FEEDBACK_REPOSITORY, DEFAULT_FEEDBACK_TOKEN_ENV } from './config.js'

/** The read-only tool the model and operator can call. */
export const FEEDBACK_TOOL_NAME = 'abg_report_issue'

/**
 * Longest composed body carried inside the prefilled URL. GitHub tolerates long
 * URLs, but browsers and terminals do not, so a longer body is truncated in the
 * link and returned in full as `markdown` for pasting.
 */
export const MAX_URL_BODY = 6000

/** Longest issue title, to keep the URL and the issue list readable. */
export const MAX_TITLE = 120

/** How many diagnostics are included, newest first. */
export const MAX_DIAGNOSTICS = 15

/**
 * Reduce one diagnostic entry to non-identifying fields.
 *
 * `data` is intentionally dropped: it can carry file paths, tool arguments, or
 * free text. The code, the time, and the owning module are the triage signal.
 *
 * @param {{ code?: string, time?: string, module?: string }} entry
 * @returns {{ code: string, time: string, module?: string }}
 */
export function redactDiagnostic(entry) {
  /** @type {{ code: string, time: string, module?: string }} */
  const safe = {
    code: typeof entry?.code === 'string' ? entry.code : 'abg.unknown',
    time: typeof entry?.time === 'string' ? entry.time : '',
  }
  if (typeof entry?.module === 'string' && entry.module !== '') safe.module = entry.module
  return safe
}

/**
 * @param {unknown} value
 * @returns {string} the value trimmed, or an explicit placeholder.
 */
function orPlaceholder(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : '_(not stated)_'
}

/**
 * Compose the issue title, body, and prefilled link.
 *
 * @param {object} input
 * @param {string} input.summary - one-line account of the deviation.
 * @param {string} [input.expected]
 * @param {string} [input.actual]
 * @param {AbgFeedbackMount} [input.mount] - the ABG mount record.
 * @param {readonly { code?: string, time?: string, module?: string }[]} [input.diagnostics] - newest first.
 * @param {string} [input.repository]
 * @param {readonly string[]} [input.labels]
 * @param {string} [input.pluginVersion]
 * @param {string} [input.promptVersion]
 * @param {boolean} [input.includeDiagnostics]
 * @returns {{ title: string, body: string, url: string, truncated: boolean }}
 */
export function composeFeedback(input) {
  const repository = typeof input.repository === 'string' && input.repository !== ''
    ? input.repository
    : DEFAULT_FEEDBACK_REPOSITORY
  const summary = orPlaceholder(input.summary)
  const title = (`[feedback] ${summary}`).slice(0, MAX_TITLE)
  const mount = /** @type {AbgFeedbackMount} */ (input.mount ?? {})
  const degraded = Array.isArray(mount.degraded) ? mount.degraded : []
  const modules = Array.isArray(mount.modules) ? mount.modules : []
  const includeDiagnostics = input.includeDiagnostics !== false
  const diagnostics = includeDiagnostics
    ? (input.diagnostics ?? []).slice(0, MAX_DIAGNOSTICS).map(redactDiagnostic)
    : []

  const lines = [
    '### What happened',
    '',
    summary,
    '',
    '### Expected',
    '',
    orPlaceholder(input.expected),
    '',
    '### Actual',
    '',
    orPlaceholder(input.actual),
    '',
    '### Governance state (redacted)',
    '',
    `- package: \`dsh-agent-behavioral-governance\` ${input.pluginVersion ?? 'unknown'}`,
    `- PROMPT_VERSION: ${input.promptVersion ?? 'unknown'}`,
    `- mounted: ${mount.mounted === undefined ? 'unknown' : String(mount.mounted)}`,
    `- degraded: ${degraded.length === 0 ? 'none' : degraded.map((d) => `\`${d}\``).join(', ')}`,
    `- modules: ${modules.length === 0 ? '_(none reported)_' : modules.map((m) => `\`${m}\``).join(', ')}`,
    `- compatibility: ${mount.compatibility?.verdict ?? 'unknown'}`,
  ]
  if (typeof mount.configError === 'string' && mount.configError !== '') {
    lines.push(`- configuration error: ${mount.configError}`)
  }

  lines.push('', `### Diagnostics (newest first, codes only${includeDiagnostics ? '' : ' — excluded by configuration'})`, '')
  if (diagnostics.length === 0) {
    lines.push('_(none recorded)_')
  } else {
    for (const entry of diagnostics) {
      lines.push(`- \`${entry.code}\`${entry.module ? ` (${entry.module})` : ''}${entry.time ? ` at ${entry.time}` : ''}`)
    }
  }

  lines.push(
    '',
    '### Not included',
    '',
    'This report was composed by ABG with redaction: it contains no file contents,',
    'no prompts, no session logs, no credentials, and no agent or session',
    'identifiers. Diagnostic payloads are reduced to their code, time, and module.',
    '',
    '### Before filing',
    '',
    '- [ ] I re-ran the same task with ABG disabled (`enabled: false`) and noted whether the outcome changed.',
    '- [ ] This is not one of the known limitations listed in `SECURITY.md`.',
    '',
  )

  const body = lines.join('\n')
  const titlePart = encodeURIComponent(title)
  const labelsPart = Array.isArray(input.labels) && input.labels.length > 0
    ? `&labels=${encodeURIComponent(input.labels.join(','))}`
    : ''
  const base = `https://github.com/${repository}/issues/new?title=${titlePart}${labelsPart}&body=`

  const fullUrl = `${base}${encodeURIComponent(body)}`
  if (fullUrl.length <= MAX_URL_BODY) {
    return { title, body, url: fullUrl, truncated: false }
  }

  // Truncate the URL payload at a line boundary and say so, rather than emitting
  // a link that a browser or terminal will silently mangle.
  const notice = '\n\n---\n_Truncated in this link. Paste the full `markdown` field from the tool result._'
  let clipped = body
  while (clipped.length > 0 && `${base}${encodeURIComponent(clipped + notice)}`.length > MAX_URL_BODY) {
    clipped = clipped.slice(0, -200)
  }
  return {
    title,
    body,
    url: `${base}${encodeURIComponent(clipped + notice)}`,
    truncated: true,
  }
}

/**
 * File the composed report through the GitHub API. Strictly opt-in.
 *
 * The token is read from the environment named by `tokenEnvVar` and is never
 * logged, returned, or persisted. Any failure resolves to `undefined` so the
 * caller can fall back to the prefilled link.
 *
 * @param {object} input
 * @param {string} input.repository - `owner/name`.
 * @param {string} input.title
 * @param {string} input.body
 * @param {readonly string[]} [input.labels]
 * @param {string} input.tokenEnvVar
 * @param {Record<string, string | undefined>} [input.env]
 * @param {AbgFetch} [input.fetchImpl]
 * @returns {Promise<{ ok: true, issueUrl: string, issueNumber?: number } | { ok: false, reason: string }>}
 */
export async function fileFeedbackIssue(input) {
  const env = input.env ?? process?.env ?? {}
  const token = env?.[input.tokenEnvVar]
  if (typeof token !== 'string' || token === '') {
    return { ok: false, reason: `no token in $${input.tokenEnvVar}` }
  }
  const fetchImpl = input.fetchImpl ?? fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'no fetch implementation available' }
  }

  try {
    const response = await fetchImpl(`https://api.github.com/repos/${input.repository}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'dsh-agent-behavioral-governance',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        ...(input.labels && input.labels.length > 0 ? { labels: [...input.labels] } : {}),
      }),
    })
    if (!response.ok) return { ok: false, reason: `GitHub responded ${response.status}` }
    const payload = await response.json().catch(() => ({}))
    return {
      ok: true,
      issueUrl: typeof payload.html_url === 'string' ? payload.html_url : '',
      issueNumber: typeof payload.number === 'number' ? payload.number : undefined,
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The read-only tool definition. `execute` never throws and never posts unless
 * `mode` is `api` and a token is present.
 *
 * @param {object} input
 * @param {AbgFeedbackPolicy} input.config
 * @param {AbgFeedbackMount} input.mount - the live mount record.
 * @param {{ recent?: (limit: number) => unknown[] }} input.diagnostics
 * @param {string} input.pluginVersion
 * @param {string | (() => string)} input.promptVersion - read live when a function.
 * @param {Record<string, string | undefined>} [input.env]
 * @param {AbgFetch} [input.fetchImpl]
 * @returns {AbgToolDefinition}
 */
export function feedbackToolDefinition(input) {
  return {
    name: FEEDBACK_TOOL_NAME,
    description:
      'Draft a feedback issue for the ABG project after you observe a behavioural deviation (a wrong block, a missed violation, an unreadable state). Pass a one-line summary plus, optionally, what you expected and what happened. Returns a prefilled issue link and the markdown body, already redacted: no file contents, prompts, session logs, credentials, or agent identifiers are included. Read-only; it never files anything unless the deployment opted into API mode.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One line: what deviated from expectation.' },
        expected: { type: 'string', description: 'What ABG or the host should have done.' },
        actual: { type: 'string', description: 'What it did instead.' },
      },
      required: ['summary'],
    },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async (args) => {
      const record = /** @type {Record<string, unknown>} */ (args ?? {})
      const promptVersion =
        typeof input.promptVersion === 'function' ? input.promptVersion() : input.promptVersion
      const composed = composeFeedback({
        summary: typeof record.summary === 'string' ? record.summary : '',
        expected: typeof record.expected === 'string' ? record.expected : '',
        actual: typeof record.actual === 'string' ? record.actual : '',
        mount: input.mount,
        diagnostics: /** @type {{ code?: string, time?: string, module?: string }[]} */ (
          typeof input.diagnostics?.recent === 'function' ? input.diagnostics.recent(MAX_DIAGNOSTICS) : []
        ),
        repository: input.config.repository,
        labels: input.config.labels,
        pluginVersion: input.pluginVersion,
        promptVersion,
        includeDiagnostics: input.config.includeDiagnostics,
      })

      /** @type {Record<string, unknown>} */
      const result = {
        mode: input.config.mode,
        filed: false,
        issue_url: composed.url,
        title: composed.title,
        markdown: composed.body,
        truncated_in_url: composed.truncated,
        repository: input.config.repository,
        token_env_var: input.config.tokenEnvVar,
      }

      if (input.config.mode === 'api') {
        const filed = await fileFeedbackIssue({
          repository: input.config.repository,
          title: composed.title,
          body: composed.body,
          labels: input.config.labels,
          tokenEnvVar: input.config.tokenEnvVar,
          env: input.env,
          fetchImpl: input.fetchImpl,
        })
        result.filed = filed.ok
        result.file_result = filed.ok ? { issue_url: filed.issueUrl, issue_number: filed.issueNumber } : { reason: filed.reason }
        if (filed.ok && filed.issueUrl !== '') result.issue_url = filed.issueUrl
      }

      return result
    },
  }
}
