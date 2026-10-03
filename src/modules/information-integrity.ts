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
 *
 * Information-state semantics (Batch 1, 0.7.0). The module keeps six
 * distinguishable dimensions and never collapses them into one "valid" flag:
 *
 *   existence             the item is present in the environment at all
 *   status                its lifecycle position (see INFORMATION_STATUSES)
 *   authority             whether it may be presented as authoritative knowledge
 *   provenance            where it came from and on whose word
 *   supersession          what replaced it, if anything
 *   retrieval eligibility whether it may be returned by a normal/default lookup
 *
 * The operative boundary is that existence and retrieval eligibility are
 * independent: an obsolete or superseded item may remain **stored** without
 * being eligible for normal/default retrieval. `isUsableAsAuthoritative()`
 * answers the authority question and `isUsable()` the retrieval-eligibility
 * question. No retrieval system is implemented here or implied by this module.
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
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  AUTHORITATIVE: Object.freeze(['SUSPECT', 'DEPRECATED', 'SUPERSEDED', 'INVALID', 'PENDING_CONFIRMATION']),
  PROVISIONAL: Object.freeze(['AUTHORITATIVE', 'SUSPECT', 'INVALID', 'DEPRECATED', 'SUPERSEDED', 'PENDING_CONFIRMATION']),
  PENDING_CONFIRMATION: Object.freeze(['AUTHORITATIVE', 'SUSPECT', 'INVALID', 'DEPRECATED', 'SUPERSEDED']),
  SUSPECT: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL', 'INVALID', 'DEPRECATED', 'SUPERSEDED', 'PENDING_CONFIRMATION']),
  INVALID: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
  DEPRECATED: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
  SUPERSEDED: Object.freeze(['AUTHORITATIVE', 'PROVISIONAL']),
})

export interface InformationRecord {
  id: string
  status: string
  value: string
  provenance: string
  disposition: string | null
  revision: number
}

export function createRecord(input: {
  id: string
  value?: string
  status?: string
  provenance?: string
}): InformationRecord {
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
 */
export function transition(
  record: InformationRecord,
  to: string,
  justification: { evidence?: string, userConfirmation?: boolean } = {},
): { ok: true, record: InformationRecord } | { ok: false, reason: string } {
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
 */
export function dispose(
  record: InformationRecord,
  disposition: 'CORRECTED' | 'REPLACED' | 'QUARANTINED' | 'REMOVED',
  replacement = '',
): InformationRecord {
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
 */
export function isUsableAsAuthoritative(record: InformationRecord): boolean {
  return record.status === 'AUTHORITATIVE' && record.disposition === null
}

/**
 * Whether a record may be used at all (authoritative or provisional).
 */
export function isUsable(record: InformationRecord): boolean {
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
 * @returns the offending record, or null when clean.
 */
export function findReintroduced(records: readonly InformationRecord[], incomingValue: string): InformationRecord | null {
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
  version: '0.2.0',
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
