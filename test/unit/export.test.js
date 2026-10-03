/**
 * Opt-in diagnostics mirror (`ARCHITECTURE-SPEC` §28.7).
 *
 * The mirror is the only place IEG writes a file of its own, so the tests are
 * about restraint: off unless configured, throttled while diagnostics stream,
 * bounded, and silent-but-reported when the path is unwritable. The writer is
 * injected, which is what lets all of this be tested without a filesystem.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_EXPORT_MIN_INTERVAL_MS,
  EXPORT_SCHEMA_VERSION,
  createDiagnosticsExporter,
} from '../../lib/kernel/export.js'

/**
 * @param {object} [overrides]
 * @returns {{ writes: Array<{path: string, text: string}>, errors: string[], exporter: any, tick: (ms: number) => void }}
 */
function harness(overrides = {}) {
  const writes = []
  const errors = []
  let clock = 1_000
  const exporter = createDiagnosticsExporter({
    file: '/tmp/ieg-status.json',
    limit: 5,
    snapshot: () => ({ mount: { mounted: true }, diagnostics: [{ code: 'ieg.mount' }] }),
    writeFile: (path, text) => writes.push({ path, text }),
    onError: (message) => errors.push(message),
    now: () => clock,
    ...overrides,
  })
  return { writes, errors, exporter, tick: (ms) => { clock += ms } }
}

test('an empty path disables the mirror entirely', () => {
  const { writes, exporter } = harness({ file: '' })
  assert.equal(exporter.file, '')
  assert.equal(exporter.flush(true), false)
  assert.equal(writes.length, 0, 'no file I/O unless configured')
})

test('a write carries a schema version, a timestamp, and the live snapshot', () => {
  const { writes, exporter } = harness()
  assert.equal(exporter.flush(true), true)
  assert.equal(writes.length, 1)
  assert.match(writes[0].path, /ieg-status\.json$/)
  const payload = JSON.parse(writes[0].text)
  assert.equal(payload.schema, EXPORT_SCHEMA_VERSION)
  assert.match(payload.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(payload.mount.mounted, true)
  assert.deepEqual(payload.diagnostics, [{ code: 'ieg.mount' }])
  assert.equal(writes[0].text.endsWith('\n'), true, 'the file stays newline-terminated')
})

test('streaming diagnostics are throttled, and force bypasses the throttle', () => {
  const { writes, exporter, tick } = harness()
  assert.equal(exporter.flush(), true, 'first write goes out')
  assert.equal(exporter.flush(), false, 'an immediate second write is throttled')
  tick(DEFAULT_EXPORT_MIN_INTERVAL_MS - 1)
  assert.equal(exporter.flush(), false, 'still inside the window')
  tick(2)
  assert.equal(exporter.flush(), true, 'after the window it writes again')
  assert.equal(exporter.flush(true), true, 'force ignores the window')
  assert.equal(writes.length, 3)
})

test('a write failure is reported once, throttled, and never thrown', () => {
  const { errors, exporter, tick } = harness({
    writeFile: () => {
      throw new Error('EROFS: read-only file system')
    },
  })
  assert.equal(exporter.flush(true), false)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /EROFS/)
  assert.match(exporter.lastError(), /EROFS/)
  assert.equal(exporter.flush(true), false, 'a failing write never throws')
  assert.equal(errors.length, 1, 'the same failure inside the window is not repeated')
  tick(DEFAULT_EXPORT_MIN_INTERVAL_MS + 1)
  exporter.flush()
  assert.equal(errors.length, 2, 'after the window it reports again')
})

test('a reporting path that writes back cannot recurse', () => {
  let calls = 0
  const exporter = createDiagnosticsExporter({
    file: '/tmp/x.json',
    limit: 1,
    snapshot: () => ({ ok: true }),
    writeFile: () => {
      throw new Error('boom')
    },
    onError: () => {
      calls += 1
      // Simulates `note()` recording the failure, which flushes again.
      exporter.flush(true)
    },
  })
  exporter.flush(true)
  assert.equal(calls, 1, 're-entrant flush is refused')
})

test('close() stops the mirror', () => {
  const { writes, exporter } = harness()
  exporter.flush(true)
  exporter.close()
  assert.equal(exporter.flush(true), false)
  assert.equal(writes.length, 1)
})
