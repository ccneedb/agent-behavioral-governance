/**
 * Optional feedback channel (`ARCHITECTURE-SPEC` §28.6).
 *
 * Two properties are worth more than the happy path and are pinned here:
 *
 * 1. **Redaction by construction.** A diagnostic entry carries `data`, which can
 *    hold file paths or free text. If that ever reaches a public issue body, the
 *    channel becomes a data-leak path, so the tests assert that a planted secret
 *    never appears in either the markdown or the URL.
 * 2. **Never files by itself.** `url` mode must make no network call at all, and
 *    `api` mode must fail open to the prefilled link when the token is absent or
 *    the API refuses.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FEEDBACK_TOOL_NAME,
  MAX_URL_BODY,
  composeFeedback,
  feedbackToolDefinition,
  fileFeedbackIssue,
  redactDiagnostic,
} from '../../lib/kernel/feedback.js'
import { resolveConfig, AbgConfigError } from '../../lib/kernel/config.js'

const MOUNT = {
  mounted: true,
  degraded: [],
  modules: ['project-governance', 'information-integrity', 'user-attention', 'workspace-governance'],
  compatibility: { verdict: 'COMPATIBLE' },
}

const DIAGNOSTICS = [
  { seq: 3, time: '2026-10-02T10:00:00.000Z', code: 'abg.document_overlap_flagged', module: 'workspace-governance', data: { path: '/home/alice/secret-project/AUTH.md', token: 'planted-secret-value' }, agentId: 'agent-42', sessionId: 'session-7' },
  { seq: 2, time: '2026-10-02T09:59:00.000Z', code: 'abg.workspace_mutation_blocked', data: { targets: ['/home/alice/secret-project/AUTH.md'] } },
]

test('redactDiagnostic keeps the triage signal and drops everything identifying', () => {
  const redacted = redactDiagnostic(DIAGNOSTICS[0])
  assert.deepEqual(redacted, {
    code: 'abg.document_overlap_flagged',
    time: '2026-10-02T10:00:00.000Z',
    module: 'workspace-governance',
  })
  assert.equal('data' in redacted, false, 'data can carry files and free text')
  assert.equal('agentId' in redacted, false)
  assert.equal('sessionId' in redacted, false)
})

test('a composed report never contains diagnostic payloads or identifiers', () => {
  const composed = composeFeedback({
    summary: 'The overlap gate blocked a genuinely new document',
    expected: 'the write should have been admitted',
    actual: 'it was denied as a duplicate',
    mount: MOUNT,
    diagnostics: DIAGNOSTICS,
    repository: 'owner/name',
    pluginVersion: '0.3.0',
    promptVersion: '0.2.0',
  })

  for (const leak of ['planted-secret-value', '/home/alice', 'agent-42', 'session-7']) {
    assert.equal(composed.body.includes(leak), false, `body leaked ${leak}`)
    assert.equal(decodeURIComponent(composed.url).includes(leak), false, `url leaked ${leak}`)
  }
  // And the signal that makes the report triageable is present.
  assert.match(composed.body, /abg\.document_overlap_flagged/)
  assert.match(composed.body, /COMPATIBLE/)
  assert.match(composed.body, /`workspace-governance`/)
})

test('the prefilled link targets the repository issue form with title, labels, and body', () => {
  const composed = composeFeedback({
    summary: 'Blocked a legitimate edit',
    mount: MOUNT,
    diagnostics: [],
    repository: 'ccneedb/agent-behavioral-governance',
    labels: ['feedback'],
  })
  assert.ok(composed.url.startsWith('https://github.com/ccneedb/agent-behavioral-governance/issues/new?'))
  const query = new URL(composed.url).searchParams
  assert.match(query.get('title'), /^\[feedback\] Blocked a legitimate edit$/)
  assert.equal(query.get('labels'), 'feedback')
  assert.match(query.get('body'), /### What happened/)
  assert.match(query.get('body'), /\(not stated\)/)
  assert.equal(composed.truncated, false)
})

test('diagnostics can be excluded by configuration', () => {
  const composed = composeFeedback({
    summary: 's',
    mount: MOUNT,
    diagnostics: DIAGNOSTICS,
    includeDiagnostics: false,
  })
  assert.match(composed.body, /excluded by configuration/)
  assert.equal(composed.body.includes('abg.document_overlap_flagged'), false)
})

test('an over-long report is truncated in the link and flagged, not silently mangled', () => {
  const composed = composeFeedback({
    summary: 'x'.repeat(400),
    expected: 'y'.repeat(4000),
    actual: 'z'.repeat(4000),
    mount: MOUNT,
    diagnostics: DIAGNOSTICS,
  })
  assert.equal(composed.truncated, true)
  assert.ok(composed.url.length <= MAX_URL_BODY, `url is ${composed.url.length} bytes`)
  assert.ok(composed.body.length > composed.url.length, 'the full markdown is still returned')
  assert.match(decodeURIComponent(composed.url), /Truncated in this link/)
})

test('url mode makes no network call and never claims to have filed anything', async () => {
  let calls = 0
  const tool = feedbackToolDefinition({
    config: { enabled: true, mode: 'url', repository: 'o/r', tokenEnvVar: 'T', labels: ['feedback'], includeDiagnostics: true },
    mount: MOUNT,
    diagnostics: { recent: () => DIAGNOSTICS },
    pluginVersion: '0.3.0',
    promptVersion: '0.2.0',
    fetchImpl: async () => {
      calls += 1
      return { ok: true, status: 201, json: async () => ({ html_url: 'https://example.invalid/1', number: 1 }) }
    },
  })
  assert.equal(tool.name, FEEDBACK_TOOL_NAME)
  const result = await tool.execute({ summary: 'deviation' }, {})
  assert.equal(calls, 0, 'url mode must not touch the network')
  assert.equal(result.filed, false)
  assert.match(result.issue_url, /^https:\/\/github\.com\/o\/r\/issues\/new\?/)
})

test('api mode without a token fails open to the prefilled link', async () => {
  const tool = feedbackToolDefinition({
    config: { enabled: true, mode: 'api', repository: 'o/r', tokenEnvVar: 'ABG_TEST_TOKEN', labels: [], includeDiagnostics: true },
    mount: MOUNT,
    diagnostics: { recent: () => [] },
    pluginVersion: '0.3.0',
    promptVersion: '0.2.0',
    env: {},
  })
  const result = await tool.execute({ summary: 'deviation' }, {})
  assert.equal(result.filed, false)
  assert.match(result.file_result.reason, /ABG_TEST_TOKEN/)
  assert.match(result.issue_url, /issues\/new\?/)
})

test('api mode files once when a token is present, and reports the issue URL', async () => {
  const seen = []
  const tool = feedbackToolDefinition({
    config: { enabled: true, mode: 'api', repository: 'o/r', tokenEnvVar: 'ABG_TEST_TOKEN', labels: ['feedback'], includeDiagnostics: true },
    mount: MOUNT,
    diagnostics: { recent: () => DIAGNOSTICS },
    pluginVersion: '0.3.0',
    promptVersion: '0.2.0',
    env: { ABG_TEST_TOKEN: 'token-value' },
    fetchImpl: async (url, init) => {
      seen.push({ url, auth: init?.headers?.Authorization, body: JSON.parse(init?.body ?? '{}') })
      return { ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/o/r/issues/9', number: 9 }) }
    },
  })
  const result = await tool.execute({ summary: 'deviation', expected: 'e', actual: 'a' }, {})
  assert.equal(result.filed, true)
  assert.equal(result.issue_url, 'https://github.com/o/r/issues/9')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.github.com/repos/o/r/issues')
  assert.equal(seen[0].auth, 'Bearer token-value')
  assert.deepEqual(seen[0].body.labels, ['feedback'])
})

test('fileFeedbackIssue fails open on a rejected or broken API', async () => {
  const base = { repository: 'o/r', title: 't', body: 'b', tokenEnvVar: 'T', env: { T: 'x' } }
  assert.deepEqual(
    await fileFeedbackIssue({ ...base, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }),
    { ok: false, reason: 'GitHub responded 403' },
  )
  const thrown = await fileFeedbackIssue({
    ...base,
    fetchImpl: async () => {
      throw new Error('network down')
    },
  })
  assert.equal(thrown.ok, false)
  assert.match(thrown.reason, /network down/)
  assert.equal((await fileFeedbackIssue({ ...base, env: {} })).ok, false)
})

test('resolveConfig applies feedback defaults and rejects malformed feedback config', () => {
  const config = resolveConfig(undefined)
  assert.deepEqual(
    { ...config.feedback, labels: [...config.feedback.labels] },
    {
      enabled: true,
      mode: 'url',
      repository: 'ccneedb/agent-behavioral-governance',
      tokenEnvVar: 'ABG_GITHUB_TOKEN',
      labels: ['feedback'],
      includeDiagnostics: true,
    },
  )
  assert.equal(resolveConfig({ feedback: { enabled: false } }).feedback.enabled, false)
  assert.equal(resolveConfig({ feedback: { mode: 'api' } }).feedback.mode, 'api')
  assert.throws(() => resolveConfig({ feedback: { mode: 'email' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ feedback: { nope: 1 } }), AbgConfigError)
  assert.throws(() => resolveConfig({ feedback: { repository: '' } }), AbgConfigError)
  assert.throws(() => resolveConfig({ feedback: { labels: 'feedback' } }), AbgConfigError)
})
