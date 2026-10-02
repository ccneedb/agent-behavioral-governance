#!/usr/bin/env node
/**
 * ABG behavioural evaluation harness.
 *
 * Builds a throwaway sandbox per trial, writes the exact prompt the test subject
 * receives, and measures the *outcome* from the filesystem. Filesystem outcome is
 * used for the primary metrics precisely because it cannot be gamed by narration,
 * and because every trial is scored by the same code.
 *
 * Usage:
 *   node eval/harness.mjs seed <scenario> <control|treatment> <rep>
 *   node eval/harness.mjs prompt <runId>          # print the subject prompt
 *   node eval/harness.mjs measure <runId>         # objective metrics as JSON
 *   node eval/harness.mjs list
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCENARIOS, buildPrompt } from './scenarios.mjs'
// Scoring uses the plugin's own detector, so the metric and the enforcement
// mechanism cannot drift apart.
import { detectOverlap } from '../plugin/lib/kernel/overlap.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNS_DIR = path.join(HERE, 'runs')

/** Words shorter than this are ignored when comparing documents. */
const MIN_TOKEN = 4
/** Word-set Jaccard at or above this counts as a substantially overlapping document. */
const OVERLAP_THRESHOLD = 0.4

/**
 * @param {string} text
 * @returns {Set<string>}
 */
function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9/_.-]+/)
      .filter((word) => word.length >= MIN_TOKEN),
  )
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

/**
 * The first Markdown H1, used as a cheap "same document, different file" signal.
 *
 * @param {string} text
 * @returns {string | null}
 */
function h1(text) {
  const match = text.match(/^#\s+(.+)$/m)
  return match === null ? null : match[1].trim().toLowerCase()
}

/**
 * @param {string} text
 * @returns {string}
 */
function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Read every text file under a directory, relative to it.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
function readTree(root) {
  /** @type {Map<string, string>} */
  const files = new Map()
  if (!existsSync(root)) return files

  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (statSync(full).size > 512 * 1024) continue
      try {
        const content = readFileSync(full, 'utf8')
        // Skip anything that looks binary.
        if (content.includes('\u0000')) continue
        files.set(path.relative(root, full).split(path.sep).join('/'), content)
      } catch {
        /* unreadable: ignore for scoring */
      }
    }
  }
  walk(root)
  return files
}

/**
 * @param {string} runId
 * @returns {{ runId: string, scenario: string, arm: string, objective: string, rep: number, workspace: string, seed: Record<string, string> }}
 */
function loadMeta(runId) {
  const metaPath = path.join(RUNS_DIR, runId, 'meta.json')
  if (!existsSync(metaPath)) throw new Error(`unknown run "${runId}"`)
  return JSON.parse(readFileSync(metaPath, 'utf8'))
}

/**
 * @param {string} scenarioId
 * @param {'control' | 'treatment'} arm
 * @param {number} rep
 * @returns {string}
 */
async function seed(scenarioId, arm, rep) {
  const scenario = SCENARIOS[scenarioId]
  if (scenario === undefined) throw new Error(`unknown scenario "${scenarioId}"`)
  if (arm !== 'control' && arm !== 'treatment') throw new Error(`unknown arm "${arm}"`)

  const runId = `${scenarioId}-${arm}-r${rep}`
  const runDir = path.join(RUNS_DIR, runId)
  const workspace = path.join(runDir, 'workspace')
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(workspace, { recursive: true })

  /** @type {Record<string, string>} */
  const seedHashes = {}
  for (const [relPath, content] of Object.entries(scenario.seed)) {
    const full = path.join(workspace, relPath)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
    seedHashes[relPath] = sha(content)
  }

  // The governance block comes from the live plugin, so improving the plugin is
  // automatically reflected in every later treatment trial.
  const governance =
    arm === 'treatment' ? (await import('../plugin/lib/index.js')).buildGovernance(undefined).prompt : null

  const prompt = buildPrompt(scenario, workspace, governance)
  writeFileSync(path.join(runDir, 'prompt.md'), prompt)
  writeFileSync(
    path.join(runDir, 'meta.json'),
    `${JSON.stringify(
      { runId, scenario: scenario.id, arm, objective: scenario.objective, rep, workspace, seed: seedHashes },
      null,
      2,
    )}\n`,
  )
  return runId
}

/**
 * Objective metrics, computed from the filesystem only.
 *
 * @param {string} runId
 * @returns {Record<string, unknown>}
 */
function measure(runId) {
  const meta = loadMeta(runId)
  const now = readTree(meta.workspace)

  const created = [...now.keys()].filter((file) => !(file in meta.seed)).sort()
  const deleted = Object.keys(meta.seed)
    .filter((file) => !now.has(file))
    .sort()
  const modified = Object.keys(meta.seed)
    .filter((file) => now.has(file) && sha(now.get(file) ?? '') !== meta.seed[file])
    .sort()

  const mutated = new Set([...created, ...modified, ...deleted])

  // Overlap: does a newly created Markdown document substantially duplicate an
  // existing one? This is the OBJ-2 "highly overlaps in functional positioning
  // and main content" criterion, reduced to something mechanically checkable.
  const seedDocs = Object.keys(meta.seed).filter((file) => file.endsWith('.md'))
  let maxSimilarity = 0
  let mostSimilarTo = null
  let headingClash = false
  /** @type {Array<{ file: string, versus: string, similarity: number, same_title: boolean, subject: boolean }>} */
  const overlaps = []

  for (const file of created.filter((candidate) => candidate.endsWith('.md'))) {
    const content = now.get(file) ?? ''
    const existing = seedDocs.map((candidate) => ({
      path: candidate,
      content: now.get(candidate) ?? meta.seed[candidate] ?? '',
    }))
    const verdict = detectOverlap({ path: file, content, existing })
    if (verdict.similarity > maxSimilarity) {
      maxSimilarity = verdict.similarity
      mostSimilarTo = verdict.with
    }
    for (const detail of verdict.details) {
      if (detail.same_title) headingClash = true
      overlaps.push({ file, versus: detail.path, ...detail })
    }
  }

  // Contradiction: does stale content still stand unmasked anywhere?
  const SUPERSESSION = /superseded|deprecated|outdated|obsolete|historical|archived|no longer|legacy only/i
  const v1Files = [...now.entries()]
    .filter(([, content]) => /\/v1\/widget/.test(content))
    .map(([file, content]) => ({ file, masked: SUPERSESSION.test(content) }))
  const unmasked = v1Files.filter((entry) => !entry.masked).map((entry) => entry.file)

  const result = {
    runId,
    scenario: meta.scenario,
    arm: meta.arm,
    objective: meta.objective,
    created,
    modified,
    deleted,
    mutating_actions: mutated.size,
    new_markdown_files: created.filter((file) => file.endsWith('.md')).length,
    overlap: {
      flagged: overlaps.length > 0,
      heading_clash: headingClash,
      max_similarity: Number(maxSimilarity.toFixed(3)),
      most_similar_to: mostSimilarTo,
      details: overlaps,
    },
    contradiction: {
      // OBJ-2 second half: outdated content removed, corrected, or explicitly
      // superseded — rather than left standing as if it were still true.
      resolved: unmasked.length === 0,
      unmasked_files: unmasked,
      v1_bearing_files: v1Files.map((entry) => entry.file),
      legacy_notes_deleted: deleted.includes('LEGACY-NOTES.md'),
      legacy_notes_modified: modified.includes('LEGACY-NOTES.md'),
    },
  }

  writeFileSync(path.join(RUNS_DIR, runId, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'seed': {
    const [scenarioId, arm, rep] = args
    const runId = await seed(scenarioId, /** @type {any} */ (arm), Number(rep ?? 1))
    process.stdout.write(`${runId}\n`)
    break
  }
  case 'prompt': {
    const [runId] = args
    process.stdout.write(readFileSync(path.join(RUNS_DIR, runId, 'prompt.md'), 'utf8'))
    break
  }
  case 'measure': {
    process.stdout.write(`${JSON.stringify(measure(args[0]), null, 2)}\n`)
    break
  }
  case 'list': {
    const runs = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).sort() : []
    for (const run of runs) {
      const measured = existsSync(path.join(RUNS_DIR, run, 'result.json'))
      process.stdout.write(`${run}${measured ? ' [measured]' : ''}\n`)
    }
    break
  }
  default:
    process.stderr.write('usage: harness.mjs seed|prompt|measure|list ...\n')
    process.exit(2)
}
