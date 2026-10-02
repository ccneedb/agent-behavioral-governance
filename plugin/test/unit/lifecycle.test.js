/**
 * Unit: the npm-native lifecycle kernel (`plugin/src/kernel/lifecycle.ts`).
 *
 * The kernel performs real I/O, so these tests assert only the pure decisions
 * (name validation, home normalisation, the live-home refusal, the npm-cache
 * default) and the read-only `status` failure path. The end-to-end lifecycle is
 * proven separately by `scripts/abg-npm-lifecycle-check.sh`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import {
  PACKAGE_NAME,
  liveHome,
  normalizeHome,
  resolveNpmCache,
  runLifecycle,
  validateProfileName,
} from '../../lib/generated/kernel/lifecycle.js'

const dshAvailable = spawnSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8' }).status === 0

test('lifecycle: profile names that could escape <home>/profiles are refused', () => {
  assert.equal(validateProfileName('abg'), undefined)
  assert.equal(validateProfileName('abg-test'), undefined)
  assert.match(validateProfileName(''), /required/)
  assert.match(validateProfileName('.'), /invalid/)
  assert.match(validateProfileName('..'), /invalid/)
  assert.match(validateProfileName('a/b'), /invalid/)
  assert.match(validateProfileName('a\\b'), /invalid/)
  assert.match(validateProfileName('node_modules'), /invalid/)
})

test('lifecycle: home normalisation trims slashes without losing the root', () => {
  assert.equal(normalizeHome('/tmp/x/'), '/tmp/x')
  assert.equal(normalizeHome('/tmp/x///'), '/tmp/x')
  assert.equal(normalizeHome('/'), '/')
})

test('lifecycle: the live home is $HOME/.dsh', () => {
  assert.equal(liveHome({ HOME: '/home/u' }), '/home/u/.dsh')
  assert.equal(liveHome({ HOME: '/home/u/' }), '/home/u/.dsh')
})

test('lifecycle: the live home resolves a relative $HOME against the working directory', () => {
  assert.equal(liveHome({ HOME: 'relative-home' }), `${process.cwd()}/relative-home/.dsh`)
  assert.equal(liveHome({ HOME: '' }), '')
})

test('lifecycle: npm cache is explicit-wins, otherwise home-local (never ~/.npm)', () => {
  assert.equal(resolveNpmCache('/h', { npm_config_cache: '/cache' }), '/cache')
  assert.equal(resolveNpmCache('/h', {}), '/h/.abg-npm-cache')
  assert.equal(resolveNpmCache('/h', { npm_config_cache: '' }), '/h/.abg-npm-cache')
})

test('lifecycle: modifying the live home is refused with exit 2 unless --allow-live', () => {
  const home = liveHome({ HOME: '/home/u' })
  const refused = runLifecycle({
    action: 'install',
    profile: 'p',
    home,
    pluginDir: '/irrelevant',
    env: { HOME: '/home/u', DSH_BIN: 'dsh', NPM_BIN: 'npm' },
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.exitCode, 2)
  assert.match(refused.error, /live profile home/)
  assert.match(refused.error, /--allow-live/)

  // A *relative* `--home` must resolve to the same absolute path before the
  // guard compares it, or a relative spelling of the live home would slip past.
  const relativeRefusal = runLifecycle({
    action: 'install',
    profile: 'p',
    home: '.dsh',
    pluginDir: '/irrelevant',
    env: { HOME: process.cwd(), DSH_BIN: 'dsh', NPM_BIN: 'npm' },
  })
  assert.equal(relativeRefusal.ok, false)
  assert.equal(relativeRefusal.exitCode, 2)
  assert.equal(relativeRefusal.home, `${process.cwd()}/.dsh`)
  assert.match(relativeRefusal.error, /live profile home/)

  // `--allow-live` gets past that gate; the environment check still applies.
  const allowed = runLifecycle({
    action: 'status',
    profile: 'p',
    home,
    pluginDir: '/irrelevant',
    env: { HOME: '/home/u', DSH_BIN: 'dsh', NPM_BIN: 'npm' },
  })
  assert.notEqual(allowed.error, '')
  assert.doesNotMatch(allowed.error, /live profile home/)
})

test('lifecycle: status on a missing profile is exit 1, not a crash', { skip: !dshAvailable }, () => {
  const result = runLifecycle({
    action: 'status',
    profile: 'abg-does-not-exist',
    home: '/tmp/abg-lifecycle-unit-missing',
    pluginDir: process.cwd(),
    env: process.env,
  })
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.match(result.error, /profile directory does not exist/)
})

test('lifecycle: a dry run describes the work and touches nothing', { skip: !dshAvailable }, () => {
  const home = '/tmp/abg-lifecycle-unit-dryrun'
  const result = runLifecycle({
    action: 'install',
    profile: 'abg-dry',
    home,
    pluginDir: process.cwd(),
    dryRun: true,
    env: process.env,
  })
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.ok(result.messages.some((line) => line.includes('dry-run')))
  assert.equal(result.version, '')
})

test('lifecycle: the managed package name is the published one', () => {
  assert.equal(PACKAGE_NAME, 'dsh-agent-behavioral-governance')
})
