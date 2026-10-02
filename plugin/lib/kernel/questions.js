/**
 * ABG kernel — user-question interaction ledger.
 *
 * PRODUCT-SPEC success criterion #3 requires question batching to be "supported
 * by explicit state rather than prompt prose alone". The collector in
 * `modules/user-attention.js` provides the state; this module is what actually
 * holds it at runtime and enforces a rule over it.
 *
 * Two verified host facts shape the design (§17.5):
 *
 * - `ctx.userQuestions.ask({ questions })` already accepts an **array**, so
 *   batching within one call is native. There is no host API that merges
 *   independent pending requests, and the client renders one at a time.
 * - `answer()` rejects a batch that does not name each of that call's questions
 *   exactly once, so a batch must be complete before it is submitted.
 *
 * ABG therefore cannot merge questions on the host's behalf, but it *can* refuse
 * to let a batch be submitted while questions it has been told about are left
 * out. That turns "ask them together" from advice into a rule.
 */

import { createQuestionCollector } from '../modules/user-attention.js'

/** The runtime question ledger. */
/** @typedef {ReturnType<typeof createQuestionCollector>} QuestionLedger */

/** The model-facing tool that registers a question with the ledger. */
export const QUESTION_TOOL_NAME = 'record_question'

/** The model-facing read-only tool that reports the ledger's current state. */
export const QUESTIONS_TOOL_NAME = 'abg_questions'

/** The host tool whose batches the ledger governs. */
export const ASK_TOOL_NAME = 'ask_user_question'

/** Raised when a `record_question` call is malformed. */
export class QuestionLedgerError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(`abg question ledger: ${message}`)
    this.name = 'QuestionLedgerError'
  }
}

/**
 * Create the runtime question ledger.
 *
 * @returns {QuestionLedger}
 */
export function createQuestionLedger() {
  return createQuestionCollector()
}

/**
 * The model-facing tool that gives the ledger its explicit state.
 *
 * The ledger is resolved **per call** from the execution's live agent, because
 * question state is per-agent (ARCHITECTURE-SPEC Part B §25).
 *
 * @param {(exec: unknown) => QuestionLedger} getLedger
 * @returns {AbgToolDefinition}
 */
export function questionToolDefinition(getLedger) {
  return {
    name: QUESTION_TOOL_NAME,
    description:
      'Register a question you need answered before continuing, so it can be asked together with every other open question in one interaction instead of one at a time. Register the question when you discover it, then submit all registered questions in a single ask_user_question call.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable identifier for this question.' },
        question: { type: 'string', description: 'The question to put to the user.' },
        kind: {
          type: 'string',
          enum: ['deterministic-blocker', 'critical-uncertainty', 'non-blocking-uncertainty', 'autonomously-resolvable'],
          description: 'Blockers must be asked; non-blocking uncertainty is deferred instead.',
        },
        detail: { type: 'string', description: 'Supporting context shown with the question.' },
        options: { type: 'array', items: { type: 'string' }, description: 'Selectable answers, when the choice is enumerable.' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ids of questions that must be answered first.' },
        unnecessaryIf: {
          type: 'object',
          description: 'A question this one becomes unnecessary after, and the answers that make it so.',
          properties: {
            questionId: { type: 'string' },
            answers: { type: 'array', items: { type: 'string' } },
          },
          required: ['questionId', 'answers'],
        },
      },
      required: ['id', 'question', 'kind'],
    },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async (args, exec) => {
      const ledger = getLedger(exec)
      if (typeof args !== 'object' || args === null) throw new QuestionLedgerError('the payload must be an object')
      const payload = /** @type {Record<string, unknown>} */ (args)
      if (typeof payload.id !== 'string' || payload.id.trim() === '') {
        throw new QuestionLedgerError('"id" is required')
      }
      if (typeof payload.question !== 'string' || payload.question.trim() === '') {
        throw new QuestionLedgerError('"question" is required')
      }
      const result = ledger.add(/** @type {any} */ (payload))
      return {
        ...result,
        registered: result.accepted,
        pending_blockers: ledger.pendingBlockers().map((question) => question.id),
        note: result.accepted
          ? 'Registered. Submit every registered blocker in one ask_user_question call.'
          : `Not registered: ${result.reason}. Add the question to the next batch instead.`,
      }
    },
  }
}

/**
 * The read-only tool that reports the calling agent's question ledger.
 *
 * ARCHITECTURE-SPEC Part B §30.3: the model composes the batch, so it needs to
 * see the ledger's state. This tool is deliberately free of side effects — it
 * must not call `prepareBatch`, whose metrics counter would then be inflated by
 * a read.
 *
 * @param {(exec: unknown) => QuestionLedger} getLedger
 * @returns {AbgToolDefinition}
 */
export function questionsToolDefinition(getLedger) {
  return {
    name: QUESTIONS_TOOL_NAME,
    description:
      'Read the current question ledger: every registered question that is still open, which of them block progress, and the single batch you should submit next. Use it before calling ask_user_question so no registered blocker is left out.',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async (_args, exec) => {
      const ledger = getLedger(exec)
      const blockers = ledger.pendingBlockers()
      return {
        pending: ledger.pending().map((question) => question.id),
        blockers: blockers.map((question) => question.id),
        recommended_batch: blockers.map((question) => ({
          id: question.id,
          question: question.question,
          dependsOn: question.dependsOn ?? [],
        })),
        metrics: ledger.metrics(),
        guidance:
          'Submit every listed blocker together in one ask_user_question call; leave deferred uncertainty for later.',
      }
    },
  }
}

/**
 * Extract the question ids a proposed `ask_user_question` call carries.
 *
 * @param {unknown} args
 * @returns {string[]}
 */
export function submittedQuestionIds(args) {
  if (typeof args !== 'object' || args === null) return []
  const questions = /** @type {{ questions?: unknown }} */ (args).questions
  if (!Array.isArray(questions)) return []
  return questions
    .map((entry) =>
      typeof entry === 'object' && entry !== null && typeof (/** @type {any} */ (entry).id) === 'string'
        ? /** @type {string} */ (/** @type {any} */ (entry).id)
        : undefined,
    )
    .filter((id) => id !== undefined)
}

/**
 * Decide whether an `ask_user_question` call must be refused because it omits
 * questions the ledger was told about.
 *
 * @param {AbgToolExecution} execution
 * @param {QuestionLedger} ledger
 * @param {{ enforceBatchCompleteness: boolean }} config
 * @returns {{ kind: 'deny', reason: string } | null}
 */
export function batchCompletenessRequirement(execution, ledger, config) {
  if (!config.enforceBatchCompleteness) return null
  if (execution.name !== ASK_TOOL_NAME) return null

  const submitted = submittedQuestionIds(execution.arguments)
  const owed = ledger.pendingBlockers().filter((question) => !submitted.includes(question.id))
  if (owed.length === 0) return null

  return {
    kind: 'deny',
    reason:
      `abg: this batch omits ${owed.length} registered question(s): ${owed.map((question) => question.id).join(', ')}. ` +
      'Ask every currently deterministic question together in one interaction rather than across several.',
  }
}

/**
 * Retire the questions a host-accepted batch carried.
 *
 * @param {AbgToolExecution} execution
 * @param {QuestionLedger} ledger
 * @returns {void}
 */
export function recordSubmittedBatch(execution, ledger) {
  if (execution.name !== ASK_TOOL_NAME) return
  const ids = submittedQuestionIds(execution.arguments)
  if (ids.length > 0) ledger.markSubmitted(ids)
}
