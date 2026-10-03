/**
 * Integration test: the OBJ-2 overlap gate, exercised against the **real**
 * `dsh-fs-local` provider and the **real** tool pipeline.
 *
 * The unit suite proves the comparison logic with a stub filesystem; this proves
 * the wiring — that IEG can actually read the workspace through the host's own
 * service and can stop a genuine duplicate document from being created.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { dshAvailable, loadCordis, loadDshPackage, loadSystemPrompt, loadTools } from '../../test-support/dsh.js'
import * as ieg from '../../lib/index.js'

const skip = dshAvailable() ? false : 'no DeepSeek Harness installation found'

const SPEC = `# Widget Service — Specification

Status: current and authoritative. Last reviewed 2026-10-01.

## API surface (v2)

Every request carries a bearer token in the Authorization header.
Tokens are issued by the accounts service and expire after 24 hours.
Widgets live in the widgets table, one row per widget.
`

const UNRELATED = `# Deployment runbook

Roll the canary forward in ten percent increments and watch the error budget.
Page the on-call engineer when the burn rate exceeds the threshold.
`

/**
 * Boot a real composition: prompt registry, tool registry, local filesystem,
 * and IEG.
 *
 * @param {string} workspace
 * @param {unknown} iegConfig
 * @returns {Promise<any>}
 */
async function boot(workspace, iegConfig) {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()
  const fsLocal = await loadDshPackage('dsh-fs-local')

  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  await ctx.plugin(fsLocal.default ?? fsLocal, { cwd: workspace })
  await ctx.plugin(ieg, iegConfig)

  ctx.tools.register({
    name: 'write',
    description: 'write',
    parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  return ctx
}

test('integration: the real filesystem is available to the overlap check', { skip }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ieg-overlap-'))
  try {
    writeFileSync(path.join(workspace, 'SPEC.md'), SPEC)
    const ctx = await boot(workspace, { workspace: { policy: 'allow', overlapCheck: 'deny' } })
    assert.ok(ctx.get('fs'), 'the local filesystem service is mounted')
    const target = await ctx.fs.resolve(path.join(workspace, 'SPEC.md'))
    assert.match(await ctx.fs.readText(target), /Widget Service/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('integration: a duplicate new document is refused by name', { skip }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ieg-overlap-'))
  try {
    writeFileSync(path.join(workspace, 'SPEC.md'), SPEC)
    const ctx = await boot(workspace, {
      // The orientation requirement is disabled so this test isolates the
      // overlap gate.
      workspace: { policy: 'allow', overlapCheck: 'deny' },
      preStep: { requireBeforeMutation: false },
    })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: 'c-duplicate',
      name: 'write',
      arguments: { file_path: path.join(workspace, 'AUTH.md'), content: SPEC },
      signal,
    })

    assert.equal(result.isError, true, 'a duplicate document must not be created')
    assert.match(result.error.message, /substantially duplicates existing documentation/)
    assert.match(result.error.message, /SPEC\.md/)
    assert.match(result.error.message, /Extend the existing document/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('integration: a genuinely new document is allowed through', { skip }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ieg-overlap-'))
  try {
    writeFileSync(path.join(workspace, 'SPEC.md'), SPEC)
    const ctx = await boot(workspace, {
      workspace: { policy: 'allow', overlapCheck: 'deny' },
      preStep: { requireBeforeMutation: false },
    })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: 'c-new',
      name: 'write',
      arguments: { file_path: path.join(workspace, 'DEPLOY.md'), content: UNRELATED },
      signal,
    })
    assert.equal(result.isError ?? false, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('integration: overwriting an inspected file is never gated', { skip }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ieg-overlap-'))
  try {
    writeFileSync(path.join(workspace, 'SPEC.md'), SPEC)
    const ctx = await boot(workspace, {
      workspace: { policy: 'allow', overlapCheck: 'deny' },
      preStep: { requireBeforeMutation: false },
    })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: 'c-overwrite',
      name: 'write',
      arguments: { file_path: path.join(workspace, 'SPEC.md'), content: `${SPEC}\nUpdated.\n` },
      signal,
    })
    assert.equal(result.isError ?? false, false, 'updating an existing document is the desired path')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('integration: with overlapCheck off the gate is inert', { skip }, async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'ieg-overlap-'))
  try {
    writeFileSync(path.join(workspace, 'SPEC.md'), SPEC)
    const ctx = await boot(workspace, {
      workspace: { policy: 'allow', overlapCheck: 'off' },
      preStep: { requireBeforeMutation: false },
    })

    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      callId: 'c-off',
      name: 'write',
      arguments: { file_path: path.join(workspace, 'AUTH.md'), content: SPEC },
      signal,
    })
    assert.equal(result.isError ?? false, false)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
