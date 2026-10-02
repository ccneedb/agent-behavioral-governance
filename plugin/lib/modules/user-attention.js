/**
 * Module: `user-attention` (M3).
 *
 * **Problem:** deterministic blockers are asked in fragmented interactions.
 * **Objective:** maximise task progress per user interruption.
 *
 * Verified host facts that shape this module (see `ARCHITECTURE-SPEC` §17.5):
 *
 * - `ctx.userQuestions.ask({ questions })` accepts an **array**, so batching
 *   within one call is native. Nothing merges *independent pending* requests,
 *   and the client renders one pending request at a time.
 * - `answer()` rejects a batch that does not name each of that call's questions
 *   exactly once (`BAD_ANSWER`), so a batch must be complete when submitted.
 * - There is no host deferral record, dedup, dependency, or abandonment API, and
 *   asking requires the exact live **runtime root** agent (`DELEGATED_CALLER`).
 *
 * Therefore collection, classification, deduplication, dependency ordering and
 * "made unnecessary by another answer" are ABG-owned state. The host owns the
 * actual interaction.
 */

/** Buckets a candidate question can fall into (§7.4). */
export const QUESTION_BUCKETS = Object.freeze(['resolve', 'defer', 'batch', 'ask-critical'])

/**
 * @typedef {object} CandidateQuestion
 * @property {string} id
 * @property {string} question
 * @property {'deterministic-blocker' | 'non-blocking-uncertainty' | 'critical-uncertainty' | 'autonomously-resolvable'} kind
 * @property {string} [detail]
 * @property {string[]} [options]
 * @property {string[]} [dependsOn]
 * @property {string} [signature]
 * @property {boolean} [multiSelect]
 * @property {{ questionId: string, answers: string[] }} [unnecessaryIf]
 */

/** Raised when the collector is asked to do something the host would reject. */
export class QuestionCollectorError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(`abg question collector: ${message}`)
    this.name = 'QuestionCollectorError'
  }
}

/**
 * Map a question kind onto its handling bucket (§7.4 classification tree).
 *
 * @param {CandidateQuestion} question
 * @returns {'resolve' | 'defer' | 'batch' | 'ask-critical'}
 */
export function classifyQuestion(question) {
  switch (question.kind) {
    case 'autonomously-resolvable':
      return 'resolve'
    case 'non-blocking-uncertainty':
      return 'defer'
    case 'critical-uncertainty':
      return 'ask-critical'
    case 'deterministic-blocker':
    default:
      return 'batch'
  }
}

/**
 * Normalise a question for duplicate detection.
 *
 * @param {CandidateQuestion} question
 * @returns {string}
 */
function signatureOf(question) {
  return (question.signature ?? question.question).replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Create the question collector.
 *
 * @returns {{
 *   add: (question: CandidateQuestion) => { accepted: boolean, id: string, reason?: string },
 *   pending: () => readonly CandidateQuestion[],
 *   pendingBlockers: () => readonly CandidateQuestion[],
 *   markSubmitted: (ids: readonly string[]) => void,
 *   buckets: () => Record<string, string[]>,
 *   prepareBatch: (options?: { maxQuestions?: number }) => { questions: CandidateQuestion[], deferred: string[], resolved: string[] },
 *   toAskRequest: (batch: { questions: CandidateQuestion[] }) => { questions: object[] },
 *   submitBatch: (batch: { questions: CandidateQuestion[] }) => string,
 *   recordAnswers: (batchId: string, answers: Record<string, string[]>) => void,
 *   resolveDependents: () => string[],
 *   metrics: () => Record<string, number>,
 * }}
 */
export function createQuestionCollector() {
  /** @type {Map<string, CandidateQuestion>} */
  const pending = new Map()
  /** @type {Set<string>} */
  const seenSignatures = new Set()
  /** @type {Map<string, { id: string, questionIds: string[], answers: Record<string, string[]> }>} */
  const batches = new Map()

  let questionsGenerated = 0
  let questionsSent = 0
  let batchesSent = 0
  let redundantQuestions = 0
  let deferredCount = 0

  /**
   * @param {CandidateQuestion} question
   * @returns {{ accepted: boolean, id: string, reason?: string }}
   */
  function add(question) {
    questionsGenerated += 1
    if (typeof question.id !== 'string' || question.id.trim() === '') {
      throw new QuestionCollectorError('a candidate question requires a non-empty id')
    }
    if (pending.has(question.id)) {
      return { accepted: false, id: question.id, reason: 'duplicate id' }
    }
    const signature = signatureOf(question)
    if (seenSignatures.has(signature)) {
      redundantQuestions += 1
      return { accepted: false, id: question.id, reason: 'duplicate question' }
    }
    seenSignatures.add(signature)
    pending.set(question.id, { ...question })
    return { accepted: true, id: question.id }
  }

  /**
   * @returns {readonly CandidateQuestion[]}
   */
  function listPending() {
    return Object.freeze([...pending.values()])
  }

  /**
   * Group pending questions by handling bucket.
   *
   * @returns {Record<string, string[]>}
   */
  function buckets() {
    /** @type {Record<string, string[]>} */
    const result = { resolve: [], defer: [], batch: [], 'ask-critical': [] }
    for (const question of pending.values()) result[classifyQuestion(question)].push(question.id)
    return result
  }

  /**
   * Order questions so every question appears after the questions it depends on.
   *
   * @param {CandidateQuestion[]} questions
   * @returns {CandidateQuestion[]}
   */
  function dependencySort(questions) {
    /** @type {Map<string, CandidateQuestion>} */
    const byId = new Map(questions.map((question) => [question.id, question]))
    /** @type {CandidateQuestion[]} */
    const ordered = []
    /** @type {Set<string>} */
    const visiting = new Set()
    /** @type {Set<string>} */
    const done = new Set()

    /** @param {string} id */
    const visit = (id) => {
      if (done.has(id)) return
      const question = byId.get(id)
      if (question === undefined) return
      if (visiting.has(id)) throw new QuestionCollectorError(`question dependency cycle at "${id}"`)
      visiting.add(id)
      for (const dependency of question.dependsOn ?? []) visit(dependency)
      visiting.delete(id)
      done.add(id)
      ordered.push(question)
    }

    for (const question of questions) visit(question.id)
    return ordered
  }

  /**
   * Build the single batch to submit, in dependency order. Non-blocking
   * uncertainty is deferred rather than asked; autonomously resolvable
   * questions are dropped from the batch entirely (P6, PR-05).
   *
   * @param {{ maxQuestions?: number }} [options]
   * @returns {{ questions: CandidateQuestion[], deferred: string[], resolved: string[] }}
   */
  function prepareBatch(options = {}) {
    const maxQuestions = options.maxQuestions ?? 8
    /** @type {CandidateQuestion[]} */
    const askable = []
    /** @type {string[]} */
    const deferred = []
    /** @type {string[]} */
    const resolved = []

    for (const question of pending.values()) {
      switch (classifyQuestion(question)) {
        case 'resolve':
          resolved.push(question.id)
          break
        case 'defer':
          deferred.push(question.id)
          break
        default:
          askable.push(question)
          break
      }
    }

    const ordered = dependencySort(askable)
    const questions = ordered.slice(0, maxQuestions)
    if (ordered.length > questions.length) {
      deferred.push(...ordered.slice(maxQuestions).map((question) => question.id))
    }
    deferredCount += deferred.length
    return { questions, deferred, resolved }
  }

  /**
   * Convert a batch into the exact request shape `ctx.userQuestions.ask()`
   * accepts (`AskUserQuestionItem[]`).
   *
   * @param {{ questions: CandidateQuestion[] }} batch
   * @returns {{ questions: object[] }}
   */
  function toAskRequest(batch) {
    return {
      questions: batch.questions.map((question) => ({
        id: question.id,
        question: question.question,
        ...(question.detail === undefined ? {} : { detail: question.detail }),
        ...(question.options === undefined
          ? {}
          : { options: question.options.map((label) => ({ label })) }),
        ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
      })),
    }
  }

  /**
   * Submit a batch. Refuses an empty batch because the host raises
   * `EMPTY_QUESTIONS`, and refuses a batch exceeding the host's per-call shape.
   *
   * @param {{ questions: CandidateQuestion[] }} batch
   * @returns {string} the batch id
   */
  function submitBatch(batch) {
    if (batch.questions.length === 0) {
      throw new QuestionCollectorError('refusing to submit an empty batch (host raises EMPTY_QUESTIONS)')
    }
    const ids = batch.questions.map((question) => question.id)
    if (new Set(ids).size !== ids.length) {
      throw new QuestionCollectorError('a batch must name each question exactly once (host raises BAD_ANSWER)')
    }
    const id = `batch-${batches.size + 1}`
    batches.set(id, { id, questionIds: ids, answers: {} })
    questionsSent += ids.length
    batchesSent += 1
    for (const questionId of ids) pending.delete(questionId)
    return id
  }

  /**
   * Record the answers of a submitted batch.
   *
   * @param {string} batchId
   * @param {Record<string, string[]>} answers
   * @returns {void}
   */
  function recordAnswers(batchId, answers) {
    const batch = batches.get(batchId)
    if (batch === undefined) throw new QuestionCollectorError(`unknown batch "${batchId}"`)
    for (const questionId of batch.questionIds) {
      if (!(questionId in answers)) {
        throw new QuestionCollectorError(`answer batch for ${batchId} must name each of its questions exactly once`)
      }
    }
    batch.answers = { ...answers }
  }

  /**
   * Drop questions that became unnecessary because of an answer already given,
   * and questions whose dependencies are unsatisfied beyond answering.
   *
   * @returns {string[]} the ids that were removed
   */
  function resolveDependents() {
    /** @type {Record<string, string[]>} */
    const answered = {}
    for (const batch of batches.values()) Object.assign(answered, batch.answers)

    /** @type {string[]} */
    const removed = []
    for (const question of [...pending.values()]) {
      const condition = question.unnecessaryIf
      if (condition === undefined) continue
      const answer = answered[condition.questionId]
      if (answer === undefined) continue
      if (answer.some((value) => condition.answers.includes(value))) {
        pending.delete(question.id)
        removed.push(question.id)
      }
    }
    return removed
  }

  /**
   * The handoff §7 measurement set, computed from live collector state.
   *
   * @returns {Record<string, number>}
   */
  function metrics() {
    return {
      questions_generated: questionsGenerated,
      questions_sent: questionsSent,
      batches_sent: batchesSent,
      redundant_questions: redundantQuestions,
      deferred_questions: deferredCount,
      average_questions_per_batch: batchesSent === 0 ? 0 : questionsSent / batchesSent,
    }
  }

  /**
   * Questions the ledger knows must be asked and that have not yet been sent to
   * the host. This is the explicit state that makes batching enforceable rather
   * than merely advised (PRODUCT-SPEC success criterion #3).
   *
   * @returns {readonly CandidateQuestion[]}
   */
  function pendingBlockers() {
    return Object.freeze(
      [...pending.values()].filter((question) => {
        const bucket = classifyQuestion(question)
        return bucket === 'batch' || bucket === 'ask-critical'
      }),
    )
  }

  /**
   * Retire questions once the host has accepted the batch carrying them.
   *
   * @param {readonly string[]} ids
   * @returns {void}
   */
  function markSubmitted(ids) {
    for (const id of ids) pending.delete(id)
    questionsSent += ids.length
    batchesSent += 1
  }

  return {
    add,
    pending: listPending,
    pendingBlockers,
    markSubmitted,
    buckets,
    prepareBatch,
    toAskRequest,
    submitBatch,
    recordAnswers,
    resolveDependents,
    metrics,
  }
}

/** The §6 module descriptor. */
export const userAttentionModule = Object.freeze({
  id: 'user-attention',
  version: '0.1.0',
  problem: 'deterministic blockers are asked in fragmented interactions',
  objective: 'maximise task progress per user interruption',
  principles: Object.freeze([
    'Do not spend a user interruption on something you can determine or decide yourself.',
    'Resolve autonomously when it is safe; defer uncertainty that is not blocking.',
    'Before asking, collect, deduplicate, order by dependency, and ask once.',
    'A larger batch is not automatically better: group independent questions when it reduces interruption cost.',
    'Never defer a question whose answer is required to proceed safely.',
  ]),
  prompt: 'When you defer a question, record it where you will encounter it again, rather than holding it silently.',
  dependencies: Object.freeze(['project-governance']),
  risk: 'low',
  enabledByDefault: true,
  addresses: Object.freeze(['FC-2.4']),
})
