import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createQuestionCollector, classifyQuestion, QuestionCollectorError } from '../../lib/modules/user-attention.js'

test('classification maps kinds onto the §7.4 buckets', () => {
  assert.equal(classifyQuestion({ id: 'a', question: 'q', kind: 'deterministic-blocker' }), 'batch')
  assert.equal(classifyQuestion({ id: 'a', question: 'q', kind: 'critical-uncertainty' }), 'ask-critical')
  assert.equal(classifyQuestion({ id: 'a', question: 'q', kind: 'non-blocking-uncertainty' }), 'defer')
  assert.equal(classifyQuestion({ id: 'a', question: 'q', kind: 'autonomously-resolvable' }), 'resolve')
})

test('a duplicate id is rejected and a duplicate question is deduplicated', () => {
  const collector = createQuestionCollector()
  assert.equal(collector.add({ id: 'a', question: 'Which port?', kind: 'deterministic-blocker' }).accepted, true)

  const sameId = collector.add({ id: 'a', question: 'Different text', kind: 'deterministic-blocker' })
  assert.equal(sameId.accepted, false)
  assert.equal(sameId.reason, 'duplicate id')

  const sameQuestion = collector.add({ id: 'b', question: '  which port?  ', kind: 'deterministic-blocker' })
  assert.equal(sameQuestion.accepted, false)
  assert.equal(sameQuestion.reason, 'duplicate question')

  assert.equal(collector.metrics().redundant_questions, 1)
})

test('an empty id is a programming error', () => {
  const collector = createQuestionCollector()
  assert.throws(() => collector.add({ id: '', question: 'q', kind: 'deterministic-blocker' }), QuestionCollectorError)
})

test('prepareBatch separates askable, deferred, and autonomously resolvable questions', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'blocker', question: 'Which database?', kind: 'deterministic-blocker' })
  collector.add({ id: 'critical', question: 'Is the migration destructive?', kind: 'critical-uncertainty' })
  collector.add({ id: 'unknown', question: 'Which font?', kind: 'non-blocking-uncertainty' })
  collector.add({ id: 'auto', question: 'What is the date today?', kind: 'autonomously-resolvable' })

  const batch = collector.prepareBatch()
  assert.deepEqual(
    batch.questions.map((question) => question.id),
    ['blocker', 'critical'],
  )
  assert.deepEqual(batch.deferred, ['unknown'])
  assert.deepEqual(batch.resolved, ['auto'])
})

test('five deterministic blockers with dependencies are ordered, and asked once', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'q1', question: 'one', kind: 'deterministic-blocker' })
  collector.add({ id: 'q2', question: 'two', kind: 'deterministic-blocker', dependsOn: ['q1'] })
  collector.add({ id: 'q3', question: 'three', kind: 'deterministic-blocker', dependsOn: ['q2'] })
  collector.add({ id: 'q4', question: 'four', kind: 'deterministic-blocker' })
  collector.add({ id: 'q5', question: 'five', kind: 'deterministic-blocker', dependsOn: ['q4'] })

  const batch = collector.prepareBatch()
  const ids = batch.questions.map((question) => question.id)

  assert.equal(ids.length, 5)
  assert.ok(ids.indexOf('q1') < ids.indexOf('q2'))
  assert.ok(ids.indexOf('q2') < ids.indexOf('q3'))
  assert.ok(ids.indexOf('q4') < ids.indexOf('q5'))

  collector.submitBatch(batch)
  // One interaction carried all five: this is the whole point of the module.
  const metrics = collector.metrics()
  assert.equal(metrics.batches_sent, 1)
  assert.equal(metrics.questions_sent, 5)
  assert.equal(metrics.average_questions_per_batch, 5)
  assert.deepEqual(collector.pending(), [])
})

test('a dependency cycle is refused', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'a', question: 'a', kind: 'deterministic-blocker', dependsOn: ['b'] })
  collector.add({ id: 'b', question: 'b', kind: 'deterministic-blocker', dependsOn: ['a'] })
  assert.throws(() => collector.prepareBatch(), /dependency cycle/)
})

test('a batch is capped, and the overflow is deferred rather than dropped', () => {
  const collector = createQuestionCollector()
  for (let index = 0; index < 12; index += 1) {
    collector.add({ id: `q${index}`, question: `question ${index}`, kind: 'deterministic-blocker' })
  }
  const batch = collector.prepareBatch({ maxQuestions: 5 })
  assert.equal(batch.questions.length, 5)
  assert.equal(batch.deferred.length, 7)
})

test('the ask request matches the host AskUserQuestionItem shape', () => {
  const collector = createQuestionCollector()
  collector.add({
    id: 'q1',
    question: 'Which database?',
    kind: 'deterministic-blocker',
    detail: 'affects the migration plan',
    options: ['postgres', 'sqlite'],
    multiSelect: false,
  })
  const request = collector.toAskRequest(collector.prepareBatch())

  assert.deepEqual(request, {
    questions: [
      {
        id: 'q1',
        question: 'Which database?',
        detail: 'affects the migration plan',
        options: [{ label: 'postgres' }, { label: 'sqlite' }],
        multiSelect: false,
      },
    ],
  })
})

test('an empty batch cannot be submitted, because the host raises EMPTY_QUESTIONS', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'deferred', question: 'later', kind: 'non-blocking-uncertainty' })
  const batch = collector.prepareBatch()
  assert.equal(batch.questions.length, 0)
  assert.throws(() => collector.submitBatch(batch), /empty batch/)
})

test('an answer batch must name every question exactly once', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'q1', question: 'one', kind: 'deterministic-blocker' })
  collector.add({ id: 'q2', question: 'two', kind: 'deterministic-blocker' })
  const batchId = collector.submitBatch(collector.prepareBatch())

  assert.throws(() => collector.recordAnswers(batchId, { q1: ['x'] }), /exactly once/)
  assert.throws(() => collector.recordAnswers('nope', {}), /unknown batch/)
  assert.doesNotThrow(() => collector.recordAnswers(batchId, { q1: ['x'], q2: ['y'] }))
})

test('a deferred question made unnecessary by an answer is dropped', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'q1', question: 'Use an ORM?', kind: 'deterministic-blocker', options: ['yes', 'no'] })
  // q2 is non-blocking now, but only meaningful if the answer to q1 is "yes".
  collector.add({
    id: 'q2',
    question: 'Which ORM?',
    kind: 'non-blocking-uncertainty',
    unnecessaryIf: { questionId: 'q1', answers: ['no'] },
  })

  const batch = collector.prepareBatch()
  assert.deepEqual(
    batch.questions.map((question) => question.id),
    ['q1'],
    'only the blocker is asked; q2 is deferred',
  )
  assert.deepEqual(batch.deferred, ['q2'])

  const batchId = collector.submitBatch(batch)
  collector.recordAnswers(batchId, { q1: ['no'] })

  // Answering "no" makes the deferred follow-up unnecessary: it is never asked.
  assert.deepEqual(collector.resolveDependents(), ['q2'])
  assert.deepEqual(collector.pending(), [])
})

test('a question that is still necessary is not dropped', () => {
  const collector = createQuestionCollector()
  collector.add({ id: 'q1', question: 'Use an ORM?', kind: 'deterministic-blocker', options: ['yes', 'no'] })
  collector.add({
    id: 'q2',
    question: 'Which ORM?',
    kind: 'non-blocking-uncertainty',
    unnecessaryIf: { questionId: 'q1', answers: ['no'] },
  })

  const batchId = collector.submitBatch(collector.prepareBatch())
  collector.recordAnswers(batchId, { q1: ['yes'] })

  assert.deepEqual(collector.resolveDependents(), [])
  assert.deepEqual(
    collector.pending().map((question) => question.id),
    ['q2'],
  )
})
