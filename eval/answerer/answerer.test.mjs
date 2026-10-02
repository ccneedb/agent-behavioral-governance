/**
 * Unit tests for the evaluation answerer.
 *
 * The pure decision function carries the behaviour worth asserting; the plugin
 * wrapper is a thin claim-or-delegate around it. The live path — a real agent
 * reaching `ask_user_question` and receiving these answers — is measured by
 * `eval/e2e.mjs`, not here.
 *
 * Run: node --test eval/answerer/answerer.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ANSWER, answerFor, apply } from './index.js'

test('answerer: answers every question in one batch, preserving ids', () => {
  const result = answerFor({
    questions: [
      { id: 'q1', question: 'Which database?', options: [{ label: 'PostgreSQL' }, { label: 'SQLite' }] },
      { id: 'q2', question: 'Which region?', options: [{ label: 'eu-central-1' }] },
      { id: 'q3', question: 'Anything else?' },
    ],
  })

  assert.deepEqual(
    result?.answers.map((answer) => answer.id),
    ['q1', 'q2', 'q3'],
  )
  assert.deepEqual(result?.answers[0], { id: 'q1', selected: ['PostgreSQL'] })
  assert.deepEqual(result?.answers[1], { id: 'q2', selected: ['eu-central-1'] })
  assert.deepEqual(result?.answers[2], { id: 'q3', selected: [], custom: DEFAULT_ANSWER })
})

test('answerer: selects every option for a multi-select question', () => {
  const result = answerFor({
    questions: [{ id: 'q1', question: 'Which checks?', multiSelect: true, options: [{ label: 'lint' }, { label: 'test' }] }],
  })
  assert.deepEqual(result?.answers[0], { id: 'q1', selected: ['lint', 'test'] })
})

test('answerer: applies byKeyword before the default answer', () => {
  const result = answerFor(
    { questions: [{ id: 'q1', question: 'Which database engine should we use?' }] },
    { byKeyword: { database: 'PostgreSQL' } },
  )
  assert.deepEqual(result?.answers[0], { id: 'q1', selected: [], custom: 'PostgreSQL' })
})

test('answerer: byId overrides options and keywords', () => {
  const result = answerFor(
    { questions: [{ id: 'q1', question: 'Which database?', options: [{ label: 'SQLite' }] }] },
    { byId: { q1: { selected: ['PostgreSQL'], custom: 'chosen deliberately' } }, byKeyword: { database: 'ignored' } },
  )
  assert.deepEqual(result?.answers[0], { id: 'q1', selected: ['PostgreSQL'], custom: 'chosen deliberately' })
})

test('answerer: a custom defaultAnswer is used verbatim', () => {
  const result = answerFor({ questions: [{ id: 'q1', question: 'Proceed?' }] }, { defaultAnswer: 'Yes.' })
  assert.deepEqual(result?.answers[0], { id: 'q1', selected: [], custom: 'Yes.' })
})

test('answerer: delegates rather than guessing when nothing is answerable', () => {
  assert.equal(answerFor({ questions: [] }), null)
  assert.equal(answerFor({}), null)
  assert.equal(answerFor(undefined), null)
  assert.equal(answerFor({ questions: [{ question: 'no id' }] }), null)
  assert.equal(answerFor({ questions: 'not-an-array' }), null)
})

test('answerer: malformed entries never throw and valid siblings still answer', () => {
  const result = answerFor({ questions: [null, 42, { id: 'q1', question: 'ok' }, { id: '', question: 'skip' }] })
  assert.deepEqual(result?.answers, [{ id: 'q1', selected: [], custom: DEFAULT_ANSWER }])
})

test('answerer: the listener claims a batch and calls next for an unanswerable request', async () => {
  /** @type {Array<{ name: string, listener: (...args: any[]) => any }>} */
  const registered = []
  const ctx = { on: (/** @type {string} */ name, /** @type {any} */ listener) => registered.push({ name, listener }) }

  apply(ctx, { defaultAnswer: 'Proceed.' })
  assert.deepEqual(
    registered.map((entry) => entry.name),
    ['user-questions/request'],
  )

  let delegated = 0
  const next = async () => {
    delegated += 1
    return { answers: [] }
  }

  const claimed = await registered[0].listener({ questions: [{ id: 'q1', question: 'Proceed?' }] }, next)
  assert.deepEqual(claimed, { answers: [{ id: 'q1', selected: [], custom: 'Proceed.' }] })
  assert.equal(delegated, 0, 'a claimed request must not also delegate')

  const delegatedAnswer = await registered[0].listener({ questions: [] }, next)
  assert.deepEqual(delegatedAnswer, { answers: [] })
  assert.equal(delegated, 1, 'an unanswerable request must delegate to the host chain')
})
