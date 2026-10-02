/**
 * Unit tests for the ABG diagnostics ring (`lib/kernel/diagnostics.js`,
 * ARCHITECTURE-SPEC §28.2–§28.3).
 *
 * These cover the contract the status line and the `abg_status` tool depend on:
 * sequence monotonicity, the ring bound, retained-ring counts, the UTF-8 byte
 * cap, `formatLine` stability, and total tolerance of malformed input. They
 * import the kernel module directly, not `lib/index.js`, so they stay valid
 * while the plugin wiring is in flux.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  STATUS_LINE_MAX_BYTES,
  DIAGNOSTIC_CODES,
  createDiagnostics,
} from '../../lib/kernel/diagnostics.js'

/** The §28.2 vocabulary, written out independently of the module. */
const EXPECTED_CODES = [
  'abg.mount',
  'abg.config_invalid',
  'abg.capability_missing',
  'abg.module_enabled',
  'abg.module_conflict',
  'abg.host_compatibility',
  'abg.prompt_assembly',
  'abg.orientation_recorded',
  'abg.orientation_restored',
  'abg.orientation_required',
  'abg.question_registered',
  'abg.question_batch_created',
  'abg.question_deferred',
  'abg.question_submitted',
  'abg.question_batch_blocked',
  'abg.question_redundant',
  'abg.workspace_mutation_allowed',
  'abg.workspace_mutation_blocked',
  'abg.document_overlap_flagged',
  'abg.information_invalidated',
  'abg.information_reintroduced',
  'abg.error',
]

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

test('unit: STATUS_LINE_MAX_BYTES is the §28.3 200-byte cap', () => {
  assert.equal(STATUS_LINE_MAX_BYTES, 200)
})

test('unit: DIAGNOSTIC_CODES is the frozen §28.2 vocabulary, in order', () => {
  assert.ok(Array.isArray(DIAGNOSTIC_CODES))
  assert.ok(Object.isFrozen(DIAGNOSTIC_CODES), 'the vocabulary must be frozen')
  assert.deepEqual([...DIAGNOSTIC_CODES], EXPECTED_CODES)
  assert.equal(new Set(DIAGNOSTIC_CODES).size, DIAGNOSTIC_CODES.length, 'no duplicate codes')
  assert.throws(() => {
    // @ts-expect-error — mutating a frozen array must fail at runtime too.
    DIAGNOSTIC_CODES.push('abg.rogue')
  }, TypeError)
})

test('unit: the module has zero runtime imports', () => {
  const source = readFileSync(new URL('../../lib/kernel/diagnostics.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*import\s/m, 'no import statements are permitted')
  assert.doesNotMatch(source, /require\(/, 'no CommonJS require is permitted')
})

test('unit: record assigns monotonic seq and an ISO time, and returns a plain object', () => {
  const diagnostics = createDiagnostics()
  const first = diagnostics.record({ code: 'abg.mount', module: 'project-governance' })
  const second = diagnostics.record({ code: 'abg.module_enabled', module: 'workspace-governance' })

  assert.equal(first.seq, 1)
  assert.equal(second.seq, 2)
  assert.ok(first.seq < second.seq)
  assert.match(first.time, ISO)
  assert.match(second.time, ISO)
  assert.equal(first.code, 'abg.mount')
  assert.equal(first.module, 'project-governance')
  assert.equal(Object.getPrototypeOf(first), Object.prototype, 'entries must be plain objects')
  assert.equal(diagnostics.size(), 2)
})

test('unit: optional identity fields are kept, and structured data is stored by reference', () => {
  const diagnostics = createDiagnostics()
  const data = { reason: 'protected path', path: '/repo/secrets' }
  const entry = diagnostics.record({
    code: 'abg.workspace_mutation_blocked',
    module: 'workspace-governance',
    sessionId: 'session-1',
    agentId: 'agent-2',
    data,
  })

  assert.equal(entry.module, 'workspace-governance')
  assert.equal(entry.sessionId, 'session-1')
  assert.equal(entry.agentId, 'agent-2')
  assert.equal(entry.data, data)
})

test('unit: an injected clock supplies the timestamp', () => {
  const diagnostics = createDiagnostics({ now: () => '2024-01-02T03:04:05.000Z' })
  const entry = diagnostics.record({ code: 'abg.mount' })
  assert.equal(entry.time, '2024-01-02T03:04:05.000Z')
})

test('unit: a throwing or non-string clock degrades to a real ISO timestamp', () => {
  const broken = createDiagnostics({
    now: () => {
      throw new Error('clock unavailable')
    },
  })
  assert.doesNotThrow(() => broken.record({ code: 'abg.mount' }))
  assert.match(broken.record({ code: 'abg.mount' }).time, ISO)

  const nonString = createDiagnostics({ now: () => 42 })
  assert.match(nonString.record({ code: 'abg.mount' }).time, ISO)
})

test('unit: recent(count) returns up to count entries oldest to newest', () => {
  const diagnostics = createDiagnostics()
  for (let index = 1; index <= 25; index += 1) diagnostics.record({ code: 'abg.mount', agentId: String(index) })

  const five = diagnostics.recent(5)
  assert.deepEqual(five.map((entry) => entry.seq), [21, 22, 23, 24, 25])
  assert.deepEqual(five.map((entry) => entry.agentId), ['21', '22', '23', '24', '25'])

  // Default window is 20.
  const twenty = diagnostics.recent()
  assert.equal(twenty.length, 20)
  assert.equal(twenty[0].seq, 6)
  assert.equal(twenty[19].seq, 25)

  // More than retained is clamped to what exists.
  assert.equal(diagnostics.recent(1000).length, 25)

  // Zero and malformed counts never throw.
  assert.deepEqual(diagnostics.recent(0), [])
  assert.equal(diagnostics.recent(-1).length, 20)
  assert.equal(diagnostics.recent('nonsense').length, 20)
  assert.equal(diagnostics.recent(Number.NaN).length, 20)
  assert.equal(diagnostics.recent(null).length, 20)
})

test('unit: the ring is bounded by limit and evicts oldest first', () => {
  const diagnostics = createDiagnostics({ limit: 3 })
  for (let index = 1; index <= 5; index += 1) diagnostics.record({ code: 'abg.mount', agentId: String(index) })

  assert.equal(diagnostics.size(), 3)
  assert.deepEqual(diagnostics.recent().map((entry) => entry.seq), [3, 4, 5])
  assert.deepEqual(diagnostics.recent(2).map((entry) => entry.agentId), ['4', '5'])
})

test('unit: the default ring holds the newest 200 of 250 records', () => {
  const diagnostics = createDiagnostics()
  for (let index = 1; index <= 250; index += 1) diagnostics.record({ code: 'abg.mount' })

  assert.equal(diagnostics.size(), 200)
  const retained = diagnostics.recent(1000)
  assert.equal(retained.length, 200)
  assert.equal(retained[0].seq, 51)
  assert.equal(retained[199].seq, 250)
})

test('unit: an unusable limit falls back to the default 200', () => {
  for (const limit of [0, -3, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 'many', null, {}, []]) {
    const diagnostics = createDiagnostics({ limit })
    for (let index = 0; index < 205; index += 1) diagnostics.record({ code: 'abg.mount' })
    assert.equal(diagnostics.size(), 200, `limit ${JSON.stringify(limit)} must fall back to 200`)
  }
  const fractional = createDiagnostics({ limit: 2.9 })
  fractional.record({ code: 'abg.mount' })
  fractional.record({ code: 'abg.mount' })
  fractional.record({ code: 'abg.mount' })
  assert.equal(fractional.size(), 2, 'a fractional limit floors to the ring capacity')
  assert.equal(createDiagnostics(null).record({ code: 'abg.mount' }).seq, 1, 'malformed options must be tolerated')
})

test('unit: counts() covers exactly the retained ring and is a fresh object', () => {
  const diagnostics = createDiagnostics({ limit: 3 })
  diagnostics.record({ code: 'abg.mount' })
  diagnostics.record({ code: 'abg.mount' })
  diagnostics.record({ code: 'abg.error' })
  diagnostics.record({ code: 'abg.mount' }) // evicts the oldest abg.mount

  assert.deepEqual(diagnostics.counts(), { 'abg.mount': 2, 'abg.error': 1 })

  const snapshot = diagnostics.counts()
  snapshot['abg.mount'] = 999
  assert.deepEqual(diagnostics.counts(), { 'abg.mount': 2, 'abg.error': 1 }, 'counts must not expose ring state')

  assert.equal(diagnostics.lastCode(), 'abg.mount')
})

test('unit: counts() reports unknown codes without touching the prototype', () => {
  const diagnostics = createDiagnostics()
  diagnostics.record({ code: 'abg.not-a-real-code' })
  diagnostics.record({ code: '__proto__' })
  diagnostics.record({ code: 'constructor' })

  const totals = diagnostics.counts()
  assert.equal(totals['abg.not-a-real-code'], 1)
  assert.ok(Object.hasOwn(totals, '__proto__'), '__proto__ must be an own data property')
  assert.equal(totals['__proto__'], 1)
  assert.ok(Object.hasOwn(totals, 'constructor'))
  assert.equal({}.polluted, undefined)
})

test('unit: lastCode() is null while empty and follows the newest entry', () => {
  const diagnostics = createDiagnostics()
  assert.equal(diagnostics.lastCode(), null)
  diagnostics.record({ code: 'abg.mount' })
  assert.equal(diagnostics.lastCode(), 'abg.mount')
  diagnostics.record({ code: 'abg.error' })
  assert.equal(diagnostics.lastCode(), 'abg.error')
})

test('unit: formatLine() summarises material state and is stable between records', () => {
  const diagnostics = createDiagnostics()
  assert.equal(diagnostics.formatLine(), 'abg: diagnostics=0 last=none warnings=0')

  diagnostics.record({ code: 'abg.mount' })
  const afterMount = diagnostics.formatLine()
  assert.equal(afterMount, 'abg: diagnostics=1 last=abg.mount warnings=0')
  assert.equal(diagnostics.formatLine(), afterMount, 'repeated calls must be identical')

  diagnostics.record({ code: 'abg.workspace_mutation_blocked' })
  const afterBlock = diagnostics.formatLine()
  assert.equal(afterBlock, 'abg: diagnostics=2 last=abg.workspace_mutation_blocked warnings=1')
  assert.notEqual(afterBlock, afterMount)
  assert.equal(diagnostics.formatLine(), afterBlock)
})

test('unit: formatLine() stays within 200 UTF-8 bytes and on one line', () => {
  const diagnostics = createDiagnostics()
  diagnostics.record({ code: 'x'.repeat(500) })
  const long = diagnostics.formatLine()
  assert.ok(Buffer.byteLength(long, 'utf8') <= STATUS_LINE_MAX_BYTES, `byte length was ${Buffer.byteLength(long, 'utf8')}`)
  assert.doesNotMatch(long, /\n/)
  // A byte cap must not split a multi-byte code point.
  assert.equal(Buffer.from(Buffer.from(long, 'utf8').toString('utf8'), 'utf8').toString('utf8'), long)
})

test('unit: formatLine() counts bytes, not UTF-16 code units, for non-ASCII codes', () => {
  const diagnostics = createDiagnostics()
  diagnostics.record({ code: 'é'.repeat(200) }) // 400 UTF-8 bytes, 200 code units
  const line = diagnostics.formatLine()
  assert.ok(Buffer.byteLength(line, 'utf8') <= STATUS_LINE_MAX_BYTES)
  assert.ok(!line.includes('\uFFFD'), 'truncation must not leave a broken code point')
})

test('unit: formatLine() cannot emit a control character or newline', () => {
  const diagnostics = createDiagnostics()
  diagnostics.record({ code: 'abg.mount\nabg.error\tabg.x' })
  const line = diagnostics.formatLine()
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f\u2028\u2029]/)
  assert.equal(line.split('\n').length, 1)
})

test('unit: record never throws on malformed input and still records an entry', () => {
  const diagnostics = createDiagnostics()
  const inputs = [
    undefined,
    null,
    '',
    'not-an-object',
    42,
    Number.NaN,
    true,
    [],
    () => {},
    { code: 123 },
    { code: null },
    { code: '' },
    { code: '   ' },
    { code: 'abg.mount', module: 7, sessionId: {}, agentId: [], data: 'not-an-object' },
    { code: 'abg.mount', data: [] },
    { code: 'abg.mount', data: null },
    Object.create(null),
  ]

  for (const [index, input] of inputs.entries()) {
    let entry
    assert.doesNotThrow(() => {
      entry = diagnostics.record(input)
    }, `record(input #${index}) must not throw`)
    assert.equal(typeof entry.seq, 'number')
    assert.equal(typeof entry.code, 'string')
    assert.ok(entry.code.length > 0)
    assert.match(entry.time, ISO)
  }

  assert.equal(diagnostics.size(), inputs.length, 'every malformed input still produces one entry')
  for (let index = 1; index < inputs.length; index += 1) {
    const previous = diagnostics.recent(inputs.length)[index - 1]
    const current = diagnostics.recent(inputs.length)[index]
    assert.equal(current.seq, previous.seq + 1, 'seq stays monotonic through malformed input')
  }

  // The final malformed input has no `code`, so it is coerced rather than dropped.
  assert.equal(diagnostics.recent(1)[0].code, 'abg.error')
})

test('unit: a non-string code coerces to abg.error, recorded codes are trimmed', () => {
  const diagnostics = createDiagnostics()
  assert.equal(diagnostics.record({ code: 17 }).code, 'abg.error')
  assert.equal(diagnostics.record({ code: '  abg.mount  ' }).code, 'abg.mount')
  assert.equal(diagnostics.record({ code: 'abg.custom_unknown' }).code, 'abg.custom_unknown')
  assert.equal(diagnostics.record({ code: 'abg.error', module: 12345 }).module, '12345')
  assert.equal(diagnostics.record({ code: 'abg.error', data: 'text' }).data, undefined)
})

test('unit: reset empties the ring and counts but keeps seq monotonic', () => {
  const diagnostics = createDiagnostics({ limit: 2 })
  diagnostics.record({ code: 'abg.mount' })
  diagnostics.record({ code: 'abg.error' })
  const before = diagnostics.recent(1)[0].seq

  diagnostics.reset()
  assert.equal(diagnostics.size(), 0)
  assert.deepEqual(diagnostics.recent(), [])
  assert.deepEqual(diagnostics.counts(), {})
  assert.equal(diagnostics.lastCode(), null)
  assert.equal(diagnostics.formatLine(), 'abg: diagnostics=0 last=none warnings=0')

  const after = diagnostics.record({ code: 'abg.mount' })
  assert.ok(after.seq > before, 'seq must keep increasing across reset')
  assert.equal(after.seq, before + 1)
})

test('unit: a record after eviction keeps formatLine consistent with recent()', () => {
  const diagnostics = createDiagnostics({ limit: 2 })
  diagnostics.record({ code: 'abg.mount' })
  diagnostics.record({ code: 'abg.error' })
  diagnostics.record({ code: 'abg.mount' })

  assert.equal(diagnostics.formatLine(), 'abg: diagnostics=2 last=abg.mount warnings=1')
  assert.deepEqual(diagnostics.counts(), { 'abg.mount': 1, 'abg.error': 1 })
})
