#!/usr/bin/env node
/**
 * End-to-end evaluation: a real DSH agent, IEG installed into a throwaway
 * profile, run against seeded sandboxes.
 *
 * This is the only harness that exercises the **plugin** rather than the prompt.
 * The two arms differ solely in whether IEG is enabled in the composition:
 *
 *   treatment  --patch .ieg-e2e/ieg-config.yml   (IEG enabled, its gates active)
 *   control    --patch .ieg-e2e/ieg-off.yml      (same profile, IEG disabled)
 *
 * Usage: node eval/e2e.mjs [reps] [scenario ...]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCENARIOS } from './scenarios.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const HOME = path.join(REPO, '.ieg-e2e', 'dsh-home')
const SESSIONS = path.join(HOME, 'sessions')

const REPS = Number(process.argv[2] ?? 3)
const SCENARIO_IDS = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['auth-doc-request', 'vague-continuation']

/** Distinct from the prompt-only trials, which used reps 1-3. */
const REP_BASE = 10

const ARMS = [
  { arm: 'treatment', patch: path.join(REPO, '.ieg-e2e', 'ieg-config.yml'), ieg: true },
  { arm: 'control', patch: path.join(REPO, '.ieg-e2e', 'ieg-off.yml'), ieg: false },
]

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decode a multi-frame zstd session log. `zstdDecompressSync` stops at the first
 * frame, so the frames are located by their magic number and decoded in turn.
 *
 * @param {string} file
 * @returns {any[]}
 */
function readSessionEvents(file) {
  const buffer = readFileSync(file)
  const starts = []
  let index = buffer.indexOf(MAGIC)
  while (index !== -1) {
    starts.push(index)
    index = buffer.indexOf(MAGIC, index + 4)
  }
  let text = ''
  for (let n = 0; n < starts.length; n += 1) {
    const end = n + 1 < starts.length ? starts[n + 1] : buffer.length
    try {
      text += zstdDecompressSync(buffer.subarray(starts[n], end)).toString('utf8')
    } catch {
      /* skip an unreadable frame rather than losing the whole log */
    }
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * The session log for one sandbox, matched by the workspace path it was run in.
 *
 * @param {string} workspace
 * @returns {any[]}
 */
function sessionEventsFor(workspace) {
  if (!existsSync(SESSIONS)) return []
  /** @type {{ file: string, mtime: number }[]} */
  const candidates = []
  for (const bucket of readdirSync(SESSIONS)) {
    for (const session of readdirSync(path.join(SESSIONS, bucket))) {
      const file = path.join(SESSIONS, bucket, session, 'session.v4.jsonl.zstd')
      if (!existsSync(file)) continue
      const slug = `-${workspace.replace(/\//g, '-')}-`
      if (!bucket.includes(slug) && !bucket.includes(workspace.replace(/\//g, '-'))) continue
      candidates.push({ file, mtime: statSync(file).mtimeMs })
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates.length === 0 ? [] : readSessionEvents(candidates[0].file)
}

/**
 * Where in the session, relative to the first file mutation, orientation was declared.
 *
 * @param {any[]} events
 * @returns {{ orientationAt: number, firstMutationAt: number, ordered: boolean, orientationCalled: boolean }}
 */
function orientationOrdering(events) {
  const firstIndexContaining = (needle) => events.findIndex((event) => JSON.stringify(event).includes(needle))
  const orientationAt = firstIndexContaining('record_orientation')
  const mutationAt = firstIndexContaining('"write"') !== -1
    ? Math.min(
        ...[firstIndexContaining('"edit"'), firstIndexContaining('"write"'), firstIndexContaining('src/index.js'), firstIndexContaining('SPEC.md'), firstIndexContaining('API-REFERENCE.md')].filter((n) => n !== -1),
      )
    : firstIndexContaining('"edit"')
  return {
    orientationAt,
    firstMutationAt: mutationAt,
    ordered: orientationAt !== -1 && mutationAt !== -1 && orientationAt < mutationAt,
    orientationCalled: orientationAt !== -1,
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 600_000,
    env: { ...process.env, DSH_HOME: HOME },
    maxBuffer: 32 * 1024 * 1024,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// Re-install before running. The profile links the plugin at install time, so
// without this step a re-run silently exercises the code as it was when last
// installed. That happened once here: a re-run intended to validate a detector
// fix actually measured the pre-fix build and produced a misleading result.
console.log('re-installing the plugin so the profile runs the current source')
const install = run('dsh', ['plugin', '--profile', 'iege2e', 'add', `file:${REPO}`], REPO)
if (install.status !== 0) console.warn(`  install reported ${install.status}: ${install.stderr.slice(0, 300)}`)

/** @type {any[]} */
const results = []

for (const scenarioId of SCENARIO_IDS) {
  const scenario = SCENARIOS[scenarioId]
  if (scenario === undefined) throw new Error(`unknown scenario "${scenarioId}"`)

  for (const { arm, patch, ieg } of ARMS) {
    for (let rep = 1; rep <= REPS; rep += 1) {
      const runRep = REP_BASE + rep
      const seeded = run('node', ['eval/harness.mjs', 'seed', scenarioId, arm, String(runRep)], REPO)
      const runId = seeded.stdout.trim()
      if (runId === '') {
        results.push({ scenario: scenarioId, arm, rep, error: `seed failed: ${seeded.stderr.slice(0, 200)}` })
        continue
      }
      const workspace = path.join(REPO, 'eval', 'runs', runId, 'workspace')

      const started = Date.now()
      const boot = run('dsh', ['--profile', 'iege2e', '--patch', patch, scenario.task], workspace)
      const elapsedMs = Date.now() - started

      const measured = run('node', ['eval/harness.mjs', 'measure', runId], REPO)
      /** @type {any} */
      let metrics = null
      try {
        metrics = JSON.parse(measured.stdout)
      } catch {
        /* leave null; recorded below */
      }

      const ordering = orientationOrdering(sessionEventsFor(workspace))
      results.push({
        scenario: scenarioId,
        objective: scenario.objective,
        arm,
        ieg,
        rep,
        runId,
        exitStatus: boot.status,
        elapsedMs,
        duplicateDocCreated: metrics?.overlap?.flagged ?? null,
        staleResolved: metrics?.contradiction?.resolved ?? null,
        created: metrics?.created ?? null,
        deleted: metrics?.deleted ?? null,
        orientationCalled: ordering.orientationCalled,
        orientationAt: ordering.orientationAt,
        firstMutationAt: ordering.firstMutationAt,
        orientationBeforeMutation: ordering.ordered,
        error: metrics === null ? 'measurement failed' : null,
      })

      const flag = results.at(-1)
      console.log(
        `${runId.padEnd(38)} dup=${String(flag.duplicateDocCreated).padEnd(5)} stale=${String(flag.staleResolved).padEnd(5)} ` +
          `created=${String((flag.created ?? []).length).padEnd(2)} orient=${String(flag.orientationCalled).padEnd(5)} ordered=${flag.orientationBeforeMutation}`,
      )
    }
  }
}

const out = path.join(HERE, 'e2e-results.json')
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`)

console.log('\n=== summary ===')
for (const scenarioId of SCENARIO_IDS) {
  for (const arm of ['control', 'treatment']) {
    const rows = results.filter((row) => row.scenario === scenarioId && row.arm === arm)
    if (rows.length === 0) continue
    const dup = rows.filter((row) => row.duplicateDocCreated === true).length
    const stale = rows.filter((row) => row.staleResolved === true).length
    const ordered = rows.filter((row) => row.orientationBeforeMutation).length
    const created = rows.reduce((n, row) => n + (row.created?.length ?? 0), 0)
    console.log(
      `${scenarioId.padEnd(20)} ${arm.padEnd(10)} n=${rows.length}  dup_doc=${dup}  stale_resolved=${stale}  orientation_ordered=${ordered}  files_created=${created}`,
    )
  }
}
