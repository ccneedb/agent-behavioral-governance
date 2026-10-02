/**
 * Module: `information-integrity` (M2).
 *
 * **Problem:** known-invalid information remains reusable.
 * **Objective:** prevent invalid information from being treated as authoritative.
 *
 * The critical requirement (handoff §8) is not that the agent *notices* an
 * error, but that after recognising invalidity the information stops being
 * usable as authoritative — and that re-promotion demands evidence or explicit
 * user confirmation rather than an assertion.
 */

/** Valid statuses (handoff §5). */
export const INFORMATION_STATUSES = Object.freeze([
  'AUTHORITATIVE',
  'PROVISIONAL',
  'SUSPECT',
  'INVALID',
  'DEPRECATED',
  'SUPERSEDED',
  'PENDING_CONFIRMATION',
])

/** Terminal dispositions applied when invalid information is dealt with. */
export const INFORMATION_DISPOSITIONS = Object.freeze(['CORRECTED', 'REPLACED', 'QUARANTINED', 'REMOVED'])

/** Statuses that must never be presented as authoritative project knowledge. */
export const NON_AUTHORITATIVE_STATUSES = Object.freeze([
  'PROVISIONAL',
  'SUSPECT',
  'INVALID',
  'DEPRECATED',
  'SUPERSEDED',
  'PENDING_CONFIRMATION',
])

/**
 * Permitted status transitions. Anything absent is refused outright, so the
 * model cannot invent an escalation path.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  AUTHORITATIVE: Object.freeze(['SUSPECT', 'DEPRECATED', 'SUPERSEDED', 'INVALID', 'PENDING_CONFIRMATION']),
  PROVISIONAL: Object.freeze(['AUTHORITATIVE', 'SUSPECT', 'INVALID', 'DEPRECATED', 'SUPERSEDED', 'PENDING_CONFIRMATION']),
  PENDING_CONFIRMATION: Object.freeze(['AUTHORITATIVE', 'SUSPECT', 'INVALID', 'DEPRECATED', 'SUPERSEDED']),
  SUSPECT: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL', 'INVALID', 'DEPRECATED', 'SUPERSEDED', 'PENDING_CONFIRMATION']),
  INVALID: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
  DEPRECATED: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
  SUPERSEDED: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
})

/**
 * @typedef {object} InformationRecord
 * @property {string} id
 * @property {string} status
 * @property {string} value
 * @property {string} provenance
 * @property {string | null} disposition
 * @property {number} revision
 */

/**
 * @param {object} input
 * @param {string} input.id
 * @param {string} [input.value]
 * @param {string} [input.status]
 * @param {string} [input.provenance]
 * @returns {InformationRecord}
 */
export function createRecord(input) {
  const status = input.status ?? 'PROVISIONAL'
  if (!INFORMATION_STATUSES.includes(status)) throw new Error(`unknown information status "${status}"`)
  return {
    id: input.id,
    status,
    value: input.value ?? '',
    provenance: input.provenance ?? '',
    disposition: null,
    revision: 1,
  }
}

/**
 * Attempt a status transition.
 *
 * Promotion to `AUTHORITATIVE` always requires evidence or explicit user
 * confirmation. This is the mechanical expression of PR-03: invalidity cannot be
 * undone by assertion.
 *
 * @param {InformationRecord} record
 * @param {string} to
 * @param {{ evidence?: string, userConfirmation?: boolean }} [justification]
 * @returns {{ ok: true, record: InformationRecord } | { ok: false, reason: string }}
 */
export function transition(record, to, justification = {}) {
  if (!INFORMATION_STATUSES.includes(to)) return { ok: false, reason: `unknown information status "${to}"` }

  const allowed = ALLOWED_TRANSITIONS[record.status] ?? []
  if (!allowed.includes(to)) {
    return { ok: false, reason: `transition ${record.status} -> ${to} is not permitted` }
  }

  const hasEvidence = typeof justification.evidence === 'string' && justification.evidence.trim() !== ''
  const hasConfirmation = justification.userConfirmation === true

  if (to === 'AUTHORITATIVE' && !hasEvidence && !hasConfirmation) {
    return {
      ok: false,
      reason: `promoting ${record.status} -> AUTHORITATIVE requires evidence or explicit user confirmation`,
    }
  }

  return {
    ok: true,
    record: {
      ...record,
      status: to,
      disposition: null,
      revision: record.revision + 1,
    },
  }
}

/**
 * Apply a terminal disposition, which also drops the record out of the
 * authoritative set.
 *
 * @param {InformationRecord} record
 * @param {'CORRECTED' | 'REPLACED' | 'QUARANTINED' | 'REMOVED'} disposition
 * @param {string} [replacement]
 * @returns {InformationRecord}
 */
export function dispose(record, disposition, replacement = '') {
  if (!INFORMATION_DISPOSITIONS.includes(disposition)) throw new Error(`unknown disposition "${disposition}"`)
  return {
    ...record,
    status: 'INVALID',
    disposition,
    value: disposition === 'CORRECTED' || disposition === 'REPLACED' ? replacement : record.value,
    revision: record.revision + 1,
  }
}

/**
 * Whether a record may be treated as authoritative project knowledge.
 *
 * @param {InformationRecord} record
 * @returns {boolean}
 */
export function isUsableAsAuthoritative(record) {
  return record.status === 'AUTHORITATIVE' && record.disposition === null
}

/**
 * Whether a record may be used at all (authoritative or provisional).
 *
 * @param {InformationRecord} record
 * @returns {boolean}
 */
export function isUsable(record) {
  return isUsableAsAuthoritative(record) || (record.status === 'PROVISIONAL' && record.disposition === null)
}

/**
 * Detect re-introduction of known-invalid content: an incoming value that
 * matches the value of a record already marked invalid, deprecated, or
 * superseded.
 *
 * This is the `information_reintroduced` diagnostic (§12) and the concrete form
 * of the handoff's §8 "reintroduced stale content" case.
 *
 * @param {readonly InformationRecord[]} records
 * @param {string} incomingValue
 * @returns {InformationRecord | null} the offending record, or null when clean.
 */
export function findReintroduced(records, incomingValue) {
  const needle = incomingValue.trim().toLowerCase()
  if (needle === '') return null
  for (const record of records) {
    if (record.status === 'AUTHORITATIVE') continue
    if (!['INVALID', 'DEPRECATED', 'SUPERSEDED'].includes(record.status)) continue
    if (record.value.trim().toLowerCase() === needle) return record
  }
  return null
}

/** The §6 module descriptor. */
export const informationIntegrityModule = Object.freeze({
  id: 'information-integrity',
  version: '0.1.0',
  problem: 'known-invalid information remains reusable',
  objective: 'prevent invalid information from being treated as authoritative',
  principles: Object.freeze([
    'Treat project information as having a status, and keep that status explicit.',
    'Delete information you have established is wrong. Never leave it in place annotated as wrong, because a later reader can still pick it up and the annotation does not stop them.',
    'Delete outdated and superseded content as well, except in a software development project, where version history matters: there, mark it explicitly as outdated instead of removing it.',
    'Never present invalid, deprecated, superseded, suspect, or unconfirmed information as authoritative.',
    'Re-promoting deleted or invalidated information requires new evidence or explicit user confirmation.',
  ]),
  prompt: 'When something written down is wrong, remove it at the source; a later reader must not be able to encounter the old claim on its own.',
  dependencies: Object.freeze(['project-governance']),
  risk: 'medium',
  enabledByDefault: true,
  addresses: Object.freeze(['FC-2.3']),
})
