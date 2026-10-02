/**
 * Unit: the 0.6.0 control plane (`plugin/src/kernel/control.ts`).
 *
 * The state machine's three rules — absent means running, corruption never
 * crashes, writes are atomic — are the whole reason the file exists, so they are
 * asserted directly against the compiled kernel the host loads.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  CONTROL_SCHEMA,
  CONTROL_STATUSES,
  defaultControlState,
  formatControlState,
  parseControlText,
  parseControlValue,
  readControlStateFile,
  resolveControlPaths,
  transitionDiagnostic,
  writeControlStateFile,
} from '../../lib/generated/kernel/control.js'

const AT = '2026-10-03T00:00:00.000Z'
const now = () => AT

test('control: the schema is 1 and the three statuses are frozen', () => {
  assert.equal(CONTROL_SCHEMA, 1)
  assert.deepEqual([...CONTROL_STATUSES], ['running', 'paused', 'stopped'])
  assert.ok(Object.isFrozen(CONTROL_STATUSES))
})

test('control: an absent file means running with generation 0', () => {
  const result = parseControlText(undefined, now)
  assert.equal(result.present, false)
  assert.deepEqual(result.state, { schema: 1, status: 'running', generation: 0, updatedAt: AT })
  assert.equal(result.issue, undefined)
})

test('control: an unparsable or unknown record degrades to running plus a diagnostic', () => {
  for (const raw of ['{ not json', '[]', '"running"', '{"status":"sleeping"}']) {
    const result = parseControlText(raw, now)
    assert.equal(result.state.status, 'running', `${raw} must not switch governance off`)
    assert.equal(typeof result.issue, 'string', `${raw} must be reported`)
  }
})

test('control: a malformed field is coerced and reported, but a valid status is honoured', () => {
  const result = parseControlText('{"status":"paused","generation":"x"}', now)
  assert.equal(result.state.status, 'paused', 'the operator asked for pause; the bad field is not it')
  assert.equal(result.state.generation, 0, 'the generation is coerced rather than trusted')
  assert.match(result.issue, /generation/)
})

test('control: a valid record round-trips with its editor and generation', () => {
  const written = { schema: 1, status: 'paused', generation: 7, updatedAt: AT, editor: 'vi' }
  const result = parseControlValue(JSON.parse(formatControlState(written)), now)
  assert.equal(result.issue, undefined)
  assert.deepEqual(result.state, written)
})

test('control: writing is atomic and leaves no temporary sibling', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'abg-control-unit-'))
  try {
    const file = path.join(dir, 'state.json')
    writeControlStateFile(file, { schema: 1, status: 'stopped', generation: 2, updatedAt: AT })
    assert.deepEqual(readdirSync(dir), ['state.json'], 'only the renamed file remains')
    assert.equal(readControlStateFile(file, now).state.generation, 2)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      schema: 1,
      status: 'stopped',
      generation: 2,
      updatedAt: AT,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('control: an unreadable record is reported, not thrown', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'abg-control-unit-'))
  try {
    const file = path.join(dir, 'state.json')
    writeFileSync(file, '{ nope')
    const result = readControlStateFile(file, now)
    assert.equal(result.state.status, 'running')
    assert.match(result.issue, /valid JSON/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('control: ABG_STATE_FILE wins; otherwise XDG_STATE_HOME; otherwise HOME', () => {
  const explicit = resolveControlPaths({ env: { ABG_STATE_FILE: '/tmp/abg/x.json', XDG_STATE_HOME: '/tmp/ignored' } })
  assert.equal(explicit.stateFile, '/tmp/abg/x.json')
  assert.equal(explicit.promptFile, '/tmp/abg/prompt.md', 'prompt.md is always the state file sibling')

  const xdg = resolveControlPaths({ env: { XDG_STATE_HOME: '/xdg' } })
  assert.equal(xdg.stateFile, '/xdg/abg/state.json')
  assert.equal(xdg.promptFile, '/xdg/abg/prompt.md')

  const home = resolveControlPaths({ env: { HOME: '/home/u' } })
  assert.equal(home.stateFile, '/home/u/.local/state/abg/state.json')
})

test('control: the transition diagnostic names each edge exactly once', () => {
  assert.equal(transitionDiagnostic(undefined, 'running'), undefined)
  assert.equal(transitionDiagnostic(undefined, 'paused'), 'abg.control_paused')
  assert.equal(transitionDiagnostic(undefined, 'stopped'), 'abg.control_stopped')
  assert.equal(transitionDiagnostic('running', 'paused'), 'abg.control_paused')
  assert.equal(transitionDiagnostic('paused', 'running'), 'abg.control_resumed')
  assert.equal(transitionDiagnostic('stopped', 'running'), 'abg.control_resumed')
  assert.equal(transitionDiagnostic('running', 'stopped'), 'abg.control_stopped')
  assert.equal(transitionDiagnostic('paused', 'paused'), undefined)
  assert.equal(transitionDiagnostic('running', 'running'), undefined)
})

test('control: the default state is the running one', () => {
  assert.deepEqual(defaultControlState(now), { schema: 1, status: 'running', generation: 0, updatedAt: AT })
})
