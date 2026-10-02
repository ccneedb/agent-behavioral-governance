/**
 * Module: `project-governance` (M1, delivered first because it establishes the
 * common project-state vocabulary).
 *
 * **Problem:** the agent advances without a sufficiently stable project model.
 * **Objective:** maintain semantic alignment across the task lifetime.
 *
 * State is a compact, structured record — never a transcript copy. The whole
 * value is replaced on every transition, matching the host rule that a
 * state-carrying log event carries the complete post-change state.
 *
 * Boundary: DSH plan mode remains the host's planning mechanism. This module
 * governs project orientation and continuity, not a replacement plan workflow.
 */

/**
 * @typedef {object} ProjectState
 * @property {string} intent
 * @property {string} objective
 * @property {string} scope
 * @property {Record<string, string>} terminology
 * @property {string[]} constraints
 * @property {string[]} assumptions
 * @property {string[]} unknowns
 * @property {string[]} plan
 * @property {string} currentPhase
 */

/**
 * @typedef {object} ProjectEvent
 * @property {'set-intent' | 'set-objective' | 'set-scope' | 'set-phase'
 *   | 'define-term' | 'add-constraint' | 'add-assumption' | 'add-unknown'
 *   | 'add-plan-step' | 'resolve-unknown'} type
 * @property {string} [value]
 * @property {string} [term]
 * @property {string} [definition]
 */

/** The orientation fields required before major execution (PR-01). */
export const REQUIRED_ORIENTATION_FIELDS = Object.freeze(['intent', 'objective', 'scope'])

/**
 * @returns {ProjectState}
 */
export function createProjectState() {
  return {
    intent: '',
    objective: '',
    scope: '',
    terminology: {},
    constraints: [],
    assumptions: [],
    unknowns: [],
    // The ordered task flow. An ABG extension to the §5.3 state groups, required
    // by acceptance objective OBJ-1 ("plan the global task flow").
    plan: [],
    currentPhase: 'orientation',
  }
}

/**
 * Apply one project-state event, returning a **new** state. The input is never
 * mutated.
 *
 * @param {ProjectState} state
 * @param {ProjectEvent} event
 * @returns {ProjectState}
 */
export function applyProjectEvent(state, event) {
  const next = { ...state, terminology: { ...state.terminology } }
  switch (event.type) {
    case 'set-intent':
      next.intent = event.value ?? ''
      break
    case 'set-objective':
      next.objective = event.value ?? ''
      break
    case 'set-scope':
      next.scope = event.value ?? ''
      break
    case 'set-phase':
      next.currentPhase = event.value ?? state.currentPhase
      break
    case 'define-term':
      if (event.term !== undefined) next.terminology[event.term] = event.definition ?? ''
      break
    case 'add-constraint':
      next.constraints = [...state.constraints, event.value ?? '']
      break
    case 'add-assumption':
      next.assumptions = [...state.assumptions, event.value ?? '']
      break
    case 'add-unknown':
      next.unknowns = [...state.unknowns, event.value ?? '']
      break
    case 'add-plan-step':
      next.plan = [...state.plan, event.value ?? ''].filter((step) => step !== '')
      break
    case 'resolve-unknown':
      next.unknowns = state.unknowns.filter((entry) => entry !== event.value)
      break
    default:
      return state
  }
  return next
}

/**
 * Whether the project model is sufficiently established for major execution,
 * and which orientation fields are still missing.
 *
 * @param {ProjectState} state
 * @returns {{ oriented: boolean, missing: string[] }}
 */
export function orientationStatus(state) {
  /** @type {Record<string, string>} */
  const fieldValues = {
    intent: state.intent,
    objective: state.objective,
    scope: state.scope,
  }
  /** @type {string[]} */
  const missing = REQUIRED_ORIENTATION_FIELDS.filter((field) => (fieldValues[field] ?? '').trim() === '')
  if (Object.keys(state.terminology).length === 0) missing.push('terminology')
  return { oriented: missing.length === 0, missing }
}

/**
 * Evaluate the pre-step orientation gate.
 *
 * Returns `null` when the caller should admit the step, or a rejection decision
 * when the configured gate forbids entering it. `off` and `warn` never block:
 * P6 (uncertainty is allowed to persist) and P8 (diagnose before acting) make a
 * hard block the exception, not the default.
 *
 * @param {ProjectState} state
 * @param {'off' | 'warn' | 'reject'} gate
 * @returns {{ decision: null | { kind: 'reject' }, missing: string[] }}
 */
export function evaluateOrientationGate(state, gate) {
  const status = orientationStatus(state)
  if (gate === 'reject' && !status.oriented) {
    return { decision: { kind: 'reject' }, missing: status.missing }
  }
  return { decision: null, missing: status.missing }
}

/** The §6 module descriptor. */
export const projectGovernanceModule = Object.freeze({
  id: 'project-governance',
  version: '0.1.0',
  problem: 'the agent advances without a sufficiently stable project model',
  objective: 'maintain semantic alignment across the task lifetime',
  principles: Object.freeze([
    'Before your first change, state the project intent and scope as you understand them, and the terms you will use for its central concepts.',
    'Distinguish explicit user requirements from your own assumptions and from open unknowns.',
    "When intent is unstated, derive the best-supported reading from the project's own artifacts, state that reading, and proceed with the narrowest reversible work rather than stalling.",
    'Preserve established project terminology; do not silently redefine the task.',
    'Re-check scope when the project direction changes, and state the change explicitly.',
  ]),
  prompt: 'State the ordered task flow before you begin it, and revise it explicitly when it changes.',
  dependencies: Object.freeze([]),
  risk: 'low',
  enabledByDefault: true,
  addresses: Object.freeze(['FC-2.1']),
})
