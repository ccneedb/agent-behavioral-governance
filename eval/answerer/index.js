/**
 * ABG behavioural evaluation — scripted answerer for `user-questions/request`.
 *
 * A headless composition has no human client, so `ask_user_question` is never
 * reached and question-consolidation behaviour cannot be measured
 * (`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part B §30.4). This plugin claims the
 * `user-questions/request` waterfall (Part A §17.5) and returns a deterministic
 * answer for every question, which lets a headless trial exercise the batching
 * path end to end.
 *
 * **Evaluation-only.** It answers on the user's behalf, so it must never be
 * mounted in a profile a human uses.
 */

/** Cordis plugin name. */
export const name = 'abg-eval-answerer'

/** Default free-text answer when a question offers no options and no keyword matches. */
export const DEFAULT_ANSWER = 'Proceed with the documented default.'

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
}

/**
 * Answer one batch deterministically.
 *
 * Precedence per question: an exact `byId` entry, then the first option (all
 * options for `multiSelect`), then a `byKeyword` free-text match, then
 * `defaultAnswer`. Answering the whole batch is the point: a partial answer is
 * rejected by the host (`BAD_ANSWER`), and delegating would leave the tool call
 * pending forever in a headless run.
 *
 * @param {unknown} request `{ questions: Array<{id, question, detail?, header?, options?, multiSelect?}> }`
 * @param {{ byId?: unknown, byKeyword?: unknown, defaultAnswer?: unknown }} [config]
 * @returns {{ answers: Array<{ id: string, selected: string[], custom?: string }> } | null}
 *   `null` when the request carries no answerable question, so the caller delegates.
 */
export function answerFor(request, config = {}) {
  const questions = /** @type {unknown[]} */ (asRecord(request).questions)
  if (!Array.isArray(questions) || questions.length === 0) return null

  const byId = asRecord(config.byId)
  const byKeyword = asRecord(config.byKeyword)
  const fallback =
    typeof config.defaultAnswer === 'string' && config.defaultAnswer.trim() !== '' ? config.defaultAnswer : DEFAULT_ANSWER

  /** @type {Array<{ id: string, selected: string[], custom?: string }>} */
  const answers = []

  for (const raw of questions) {
    const question = asRecord(raw)
    const id = typeof question.id === 'string' ? question.id : ''
    if (id === '') continue

    const pinned = asRecord(byId[id])
    if (Object.keys(pinned).length > 0) {
      const selected = Array.isArray(pinned.selected)
        ? pinned.selected.filter((entry) => typeof entry === 'string')
        : []
      const custom = typeof pinned.custom === 'string' && pinned.custom !== '' ? pinned.custom : undefined
      answers.push(custom === undefined ? { id, selected } : { id, selected, custom })
      continue
    }

    const options = Array.isArray(question.options) ? question.options : []
    const labels = options
      .map((option) => (typeof option === 'string' ? option : asRecord(option).label))
      .filter((label) => typeof label === 'string' && label !== '')
    if (labels.length > 0) {
      answers.push({ id, selected: question.multiSelect === true ? labels : labels.slice(0, 1) })
      continue
    }

    const haystack = `${typeof question.question === 'string' ? question.question : ''} ${
      typeof question.header === 'string' ? question.header : ''
    }`.toLowerCase()
    let matched
    for (const [keyword, value] of Object.entries(byKeyword)) {
      if (keyword !== '' && haystack.includes(keyword.toLowerCase())) {
        matched = typeof value === 'string' ? value : JSON.stringify(value)
        break
      }
    }
    answers.push({ id, selected: [], custom: matched ?? fallback })
  }

  return answers.length === 0 ? null : { answers }
}

/**
 * Mount the answerer.
 *
 * @param {{ on: (name: string, listener: (...args: any[]) => any) => unknown }} ctx
 * @param {unknown} [rawConfig]
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = asRecord(rawConfig)
  ctx.on('user-questions/request', async (/** @type {unknown} */ request, /** @type {() => Promise<unknown>} */ next) => {
    const answer = answerFor(request, config)
    // Claim the request when there is an answer; otherwise delegate, because a
    // sibling answerer or the host may still be able to serve it.
    return answer === null ? next() : answer
  })
}
