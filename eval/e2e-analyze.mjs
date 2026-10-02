#!/usr/bin/env node
/**
 * Post-hoc analysis of the end-to-end session logs.
 *
 * Re-reads the logs produced by `e2e.mjs` and derives the ordering facts from
 * actual `tool/call` session events rather than from substring matches anywhere
 * in the log. The naive version matched tool *schemas* in each request header,
 * which appear long before any call, so it reported ordering incorrectly.
 *
 * No model calls: this only re-reads logs that already exist.
 *
 * Usage: node eval/e2e-analyze.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const SESSIONS = path.join(REPO, '.abg-e2e', 'dsh-home', 'sessions')
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * @param {string} file
 * @returns {any[]}
 */
function readEvents(file) {
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
      /* skip unreadable frame */
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
 * The ordered list of tool *calls* in one sandbox's session.
 *
 * @param {string} runId
 * @returns {{ names: string[], args: any[] } | null}
 */
function toolCallsFor(runId) {
  if (!existsSync(SESSIONS)) return null
  /** @type {string[]} */
  const candidates = []
  for (const bucket of readdirSync(SESSIONS)) {
    if (!bucket.includes(runId)) continue
    for (const session of readdirSync(path.join(SESSIONS, bucket))) {
      const file = path.join(SESSIONS, bucket, session, 'session.v4.jsonl.zstd')
      if (existsSync(file)) candidates.push(file)
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  const events = readEvents(candidates[0])
  /** @type {string[]} */
  const names = []
  /** @type {any[]} */
  const args = []
  for (const event of events) {
    if (event?.type !== 'tool/call') continue
    names.push(event.data?.name ?? '?')
    args.push(event.data?.arguments)
  }
  return { names, args }
}

const MUTATING = new Set(['write', 'edit', 'str_replace_editor'])

/**
 * @param {any[]} results
 * @returns {any[]}
 */
function analyse(results) {
  return results.map((row) => {
    // Metrics always come from the freshly measured result.json, so that
    // improving the detector and re-running `harness.mjs measure` re-scores
    // existing sandboxes without spending another model call.
    /** @type {any} */
    let measured = null
    const fresh = path.join(REPO, 'eval', 'runs', row.runId, 'result.json')
    if (existsSync(fresh)) {
      try {
        measured = JSON.parse(readFileSync(fresh, 'utf8'))
      } catch {
        measured = null
      }
    }

    const calls = toolCallsFor(row.runId)
    if (calls === null) return { ...row, ...(measured ?? {}), toolCalls: null, analysisError: 'no session log' }

    const { names, args } = calls
    const orientationAt = names.indexOf('record_orientation')
    const firstMutationAt = names.findIndex((name) => MUTATING.has(name))
    const askCalls = names
      .map((name, index) => (name === 'ask_user_question' ? index : -1))
      .filter((index) => index !== -1)
      .map((index) => {
        try {
          const parsed = typeof args[index] === 'string' ? JSON.parse(args[index]) : args[index]
          return Array.isArray(parsed?.questions) ? parsed.questions.length : 0
        } catch {
          return 0
        }
      })

    return {
      ...row,
      ...(measured === null
        ? {}
        : {
            duplicateDocCreated: measured.overlap?.flagged ?? row.duplicateDocCreated,
            staleResolved: measured.contradiction?.resolved ?? row.staleResolved,
            created: measured.created ?? row.created,
            deleted: measured.deleted ?? row.deleted,
          }),
      toolCalls: names.length,
      tools: [...new Set(names)],
      orientationAt,
      firstMutationAt,
      orientationCalled: orientationAt !== -1,
      orientationBeforeMutation:
        orientationAt !== -1 && firstMutationAt !== -1
          ? orientationAt < firstMutationAt
          : orientationAt !== -1 && firstMutationAt === -1,
      askCalls,
    }
  })
}

// Ordering evidence lives in the session logs, which only an end-to-end run
// creates. Without them the analysis cannot fail safe: every row would report
// `orientation_first = 0`, contradicting the recorded finding. Refuse to run and
// write nothing, rather than emit or overwrite a misleading artifact.
if (!existsSync(SESSIONS)) {
  console.error(`abg: no session logs at ${path.relative(REPO, SESSIONS)}.`)
  console.error('Ordering is derived from tool/call events in those logs, so this analysis')
  console.error('cannot be reproduced without them. Re-run an end-to-end evaluation first:')
  console.error('  node eval/e2e.mjs 4 auth-doc-request')
  console.error('Nothing was written.')
  process.exit(2)
}

// The run list comes from the evidence store itself, so the analysis covers every
// sandbox on disk. It previously read the previous invocation's `e2e-results.json`
// and therefore covered only the last run, however many matters the docs cite.
const RUN_ID = /^(.+)-(control|treatment)-r(\d+)$/
const rows = readdirSync(path.join(HERE, 'runs'))
  .map((name) => RUN_ID.exec(name))
  .filter((match) => match !== null)
  .map((match) => ({ scenario: match[1], arm: match[2], rep: Number(match[3]), runId: match[0] }))

const analysed = analyse(rows)
writeFileSync(path.join(HERE, 'e2e-analysis.json'), `${JSON.stringify(analysed, null, 2)}\n`)

/** @type {string[]} */
const scenarioIds = [...new Set(analysed.map((row) => row.scenario))]
console.log('=== end-to-end, derived from tool/call events ===\n')
for (const scenario of scenarioIds) {
  console.log(scenario)
  for (const arm of ['control', 'treatment']) {
    const rows = analysed.filter((row) => row.scenario === scenario && row.arm === arm)
    if (rows.length === 0) continue
    const n = rows.length
    const dup = rows.filter((row) => row.duplicateDocCreated === true).length
    const stale = rows.filter((row) => row.staleResolved === true).length
    const oriented = rows.filter((row) => row.orientationBeforeMutation).length
    const called = rows.filter((row) => row.orientationCalled).length
    const created = rows.reduce((total, row) => total + (row.created?.length ?? 0), 0)
    const asks = rows.reduce((total, row) => total + (row.askCalls?.length ?? 0), 0)
    const maxBatch = Math.max(0, ...rows.flatMap((row) => row.askCalls ?? []))
    console.log(
      `  ${arm.padEnd(10)} n=${n}  dup_doc=${dup}/${n}  stale_resolved=${stale}/${n}  ` +
        `orientation_called=${called}/${n}  orientation_first=${oriented}/${n}  files_created=${created}  ask_calls=${asks}  max_batch=${maxBatch}`,
    )
  }
}
