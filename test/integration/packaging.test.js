/**
 * Structural regression: the repository must be installable as a DSH bundle.
 *
 * This is the test that the 0.7.0 install defect demanded. DSH refuses any
 * package whose manifest does not declare `dsh.bundle` (`not-a-bundle` →
 * "<name> declares no dsh.bundle"), and it installs whatever package the
 * repository root declares. A repository whose package lived in a
 * subdirectory therefore installed fine by hand and failed from the Web UI's
 * Git flow, because the root had no manifest at all.
 *
 * These assertions are deliberately structural. They establish that the
 * *mechanism* can install and mount; they say nothing about whether a governed
 * agent behaves better, which only `eval/` can establish.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** @param {string} rel @returns {string} */
const at = (rel) => join(REPO, rel)

const manifest = JSON.parse(readFileSync(at('package.json'), 'utf8'))

/** The single DSH baseline this package supports (§3 of the Batch 2 policy). */
const DECLARED_BASELINE = '0.2.1-alpha.1'

/** Every file a runtime source tree may contain, as repo-relative paths. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(at(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(js|ts|mjs)$/.test(entry.name)) out.push(rel)
  }
  return out
}

test('the repository root is the installable DSH bundle', () => {
  assert.equal(manifest.name, 'dsh-information-environment-governance')

  // Publishable, not published: Batch 4 made the package npm-ready, while
  // publication itself stays a gated release action. `private: true` would make
  // `npm publish` impossible, so the two states must be checked together.
  assert.notEqual(manifest.private, true, 'a publishable package must not be private')
  assert.equal(manifest.publishConfig?.access, 'public')

  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string', 'the manifest must declare dsh.bundle.patch')
  assert.ok(existsSync(at(patch)), `the declared bundle patch must exist: ${patch}`)

  assert.equal(typeof manifest.main, 'string')
  assert.ok(existsSync(at(manifest.main)), `the declared main entry must exist: ${manifest.main}`)

  const bin = manifest.bin?.['dsh-ieg']
  assert.equal(typeof bin, 'string', 'the package must install the dsh-ieg command')
  assert.ok(existsSync(at(bin)), `the declared bin must exist: ${bin}`)
})

test('the declared baseline is the only supported one', () => {
  const range = manifest.dsh?.engines?.dsh
  assert.equal(typeof range, 'string')
  assert.ok(range.includes(DECLARED_BASELINE), `the peer range must admit ${DECLARED_BASELINE}`)
  assert.ok(!range.includes('0.2.0-rc.2'), 'the retired baseline must be gone from the peer range')

  const releases = Object.keys(manifest.dsh?.compatibility?.dshReleases ?? {})
  assert.deepEqual(releases, [DECLARED_BASELINE])
})

test('the committed baseline file describes the declared baseline', () => {
  const baseline = JSON.parse(readFileSync(at('lib/compatibility-baseline.json'), 'utf8'))
  assert.equal(baseline.hostVersion, DECLARED_BASELINE)
  assert.ok(Array.isArray(baseline.sectionNames))
  assert.ok(baseline.sectionNames.includes('ieg:governance'), 'the IEG section must appear in the baseline')
  assert.deepEqual(baseline.capabilities, ['systemPrompt'])
})

test('the files allowlist ships every declared entry, and only what is needed', () => {
  const allowed = manifest.files
  assert.ok(Array.isArray(allowed) && allowed.length > 0)
  for (const entry of allowed) {
    assert.ok(existsSync(at(entry)), `the files allowlist names a missing path: ${entry}`)
  }
  for (const required of ['lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    assert.ok(allowed.includes(required), `the files allowlist must ship ${required}`)
  }
  // A git-installable bundle must ship the built runtime: pnpm does not run a
  // build step for a git dependency, so the compiled entry has to be committed.
  assert.ok(existsSync(at('lib/index.js')), 'the compiled entry must be committed for Git installs')
  // The published artifact is exactly the runtime: development trees must never
  // ship. A consumer that needs `src/` or the test suite means the package is
  // carrying files nobody installs.
  for (const forbidden of ['src', 'test', 'test-support', 'eval', 'docs', '.github', 'tsconfig.json']) {
    assert.ok(!allowed.includes(forbidden), `the files allowlist must not ship ${forbidden}`)
  }
})

test('no obsolete package layout or withdrawn capability remains', () => {
  assert.ok(!existsSync(at('plugin')), 'the nested plugin/ package must not exist')
  assert.ok(!existsSync(at('lib/kernel/questions.js')), 'the question ledger must be gone')
  assert.ok(!existsSync(at('lib/modules/user-attention.js')), 'the user-attention module must be gone')
  // Build output must live beside the sources it mirrors, not in a second
  // output directory. Spelled in two parts so a path sweep cannot silently
  // rewrite this assertion into a tautology.
  const nestedOutput = `lib/${'generated'}`
  assert.ok(!existsSync(at(nestedOutput)), `build output must not live in ${nestedOutput}`)
})

test('the runtime carries no retired baseline or withdrawn-capability reference', () => {
  // Identifiers, not prose: the sources deliberately record *why* the
  // capability was withdrawn, and that history is allowed to name it. What must
  // not survive is anything that could re-bind it — the config key, the module
  // id as a quoted string, the old file names, the tool names, the old host
  // baseline.
  const stale = ['0.2.0-rc.2', 'userAttention', "'user-attention'", 'user-attention.js', 'questions.js', 'ieg_questions', 'record_question']
  for (const file of [...sourceFiles('lib'), ...sourceFiles('src')]) {
    const text = readFileSync(at(file), 'utf8')
    for (const needle of stale) {
      assert.ok(!text.includes(needle), `${file} still references ${needle}`)
    }
  }
})

test('the runtime is fully migrated: every built module has a TypeScript source', () => {
  // The TypeScript policy: src/**/*.ts is the source of truth and lib/** is its
  // build output. A hand-written .js in lib/ with no src/ counterpart is exactly
  // the "second, hand-maintained source" the policy forbids.
  const built = sourceFiles('lib').filter((file) => file.endsWith('.js'))
  assert.ok(built.length > 0, 'the compiled runtime must be committed')
  for (const file of built) {
    const source = file.replace(/^lib\//, 'src/').replace(/\.js$/, '.ts')
    assert.ok(existsSync(at(source)), `${file} has no TypeScript source at ${source}`)
  }
  // lib/contract.d.ts is the one deliberate hand-authored declaration file.
  assert.ok(statSync(at('lib/contract.d.ts')).isFile())
})
