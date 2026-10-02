/**
 * ABG kernel — the control plane (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * `abg start|pause|restart|exit` is how an operator turns governance on and off
 * for a profile **without touching the installation**. This module owns the one
 * durable record that carries that decision: a small, stable JSON control-state
 * file, written atomically, and read by both the `abg` CLI and the mounted plugin.
 *
 * Design rules:
 *
 * 1. **Absent means running.** Every existing install predates this file, so a
 *    missing file must behave exactly as the plugin did before: governance on.
 * 2. **Corruption never crashes.** An unreadable or unparsable file degrades to
 *    `running` **plus** a recorded diagnostic, so a malformed byte cannot switch
 *    governance off or take the host down.
 * 3. **Atomic.** Every write goes to a sibling temporary file and is renamed, so
 *    a reader never observes a half-written record.
 * 4. **Pure where it can be.** Parsing and transition classification are pure
 *    functions, so the whole state machine is unit-testable without a filesystem.
 *
 * The three modules migrated before this one (`prompt-compiler`, `prompt-override`,
 * `export`) established the pattern: this file is the source of truth and
 * `lib/generated/kernel/control.js` is the `tsc` build artifact DSH loads.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Shape version of the control record. A reader must refuse a newer one. */
export const CONTROL_SCHEMA = 1

/** The three governance states a profile can be in. */
export type AbgControlStatus = 'running' | 'paused' | 'stopped'

/** The states, in escalation order, for validation and help text. */
export const CONTROL_STATUSES: readonly AbgControlStatus[] = Object.freeze(['running', 'paused', 'stopped'])

/** The one durable control record. */
export interface AbgControlState {
  schema: number
  status: AbgControlStatus
  /** Bumped by `restart`; a change invalidates cached configuration and prompt. */
  generation: number
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string
  /** `$EDITOR` used for the last `abg prompt edit`; absent when none was recorded. */
  editor?: string
}

/** Result of reading the control record: always a usable state, plus what was wrong. */
export interface AbgControlReadResult {
  state: AbgControlState
  /** Whether the file existed at all. */
  present: boolean
  /** Human-readable reason when the file existed but could not be trusted. */
  issue?: string
}

/** The two paths that make up the control plane for one profile. */
export interface AbgControlPaths {
  stateFile: string
  promptFile: string
  stateDir: string
}

/** Diagnostic codes this module's consumers record for control-plane events. */
export type AbgControlCode =
  | 'abg.control_paused'
  | 'abg.control_resumed'
  | 'abg.control_stopped'
  | 'abg.control_generation_changed'
  | 'abg.control_state_unreadable'

/** The default clock, injectable so tests do not depend on wall time. */
export type AbgClock = () => string

const systemClock: AbgClock = () => new Date().toISOString()

/** Is `value` one of the three states? */
export function isControlStatus(value: unknown): value is AbgControlStatus {
  return typeof value === 'string' && (CONTROL_STATUSES as readonly string[]).includes(value)
}

/** The state assumed when nothing has been written yet. */
export function defaultControlState(now: AbgClock = systemClock): AbgControlState {
  return { schema: CONTROL_SCHEMA, status: 'running', generation: 0, updatedAt: now() }
}

/** A non-empty string, or `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A finite, non-negative integer, or `undefined`. */
function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * Interpret one parsed JSON value as a control record.
 *
 * Never throws and never returns an unusable state: a malformed record degrades
 * to the running default with an `issue` that the caller records as
 * `abg.control_state_unreadable`.
 */
export function parseControlValue(value: unknown, now: AbgClock = systemClock): AbgControlReadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { state: defaultControlState(now), present: true, issue: 'the control state is not a JSON object' }
  }
  const record = value as Record<string, unknown>
  const status = record.status
  if (!isControlStatus(status)) {
    return {
      state: defaultControlState(now),
      present: true,
      issue: `unknown control status ${JSON.stringify(status)}; treating governance as running`,
    }
  }

  const issues: string[] = []
  const generation = nonNegativeInteger(record.generation)
  if (generation === undefined && record.generation !== undefined) {
    issues.push(`ignoring non-integer generation ${JSON.stringify(record.generation)}`)
  }
  const schema = nonNegativeInteger(record.schema)
  if (schema !== undefined && schema > CONTROL_SCHEMA) {
    issues.push(`control schema ${schema} is newer than this build understands (${CONTROL_SCHEMA})`)
  }

  const state: AbgControlState = {
    schema: schema === undefined ? CONTROL_SCHEMA : schema,
    status,
    generation: generation === undefined ? 0 : generation,
    updatedAt: nonEmptyString(record.updatedAt) ?? now(),
  }
  const editor = nonEmptyString(record.editor)
  if (editor !== undefined) state.editor = editor

  if (issues.length === 0) return { state, present: true }
  return { state, present: true, issue: issues.join('; ') }
}

/** Parse control-file text. `undefined`/empty means the file is absent. */
export function parseControlText(text: string | undefined, now: AbgClock = systemClock): AbgControlReadResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { state: defaultControlState(now), present: false }
  }
  try {
    return parseControlValue(JSON.parse(text), now)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { state: defaultControlState(now), present: true, issue: `the control state is not valid JSON (${message})` }
  }
}

/** Read the control record, tolerating absence and corruption. Never throws. */
export function readControlStateFile(file: string, now: AbgClock = systemClock): AbgControlReadResult {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'ENOENT') return { state: defaultControlState(now), present: false }
    const message = error instanceof Error ? error.message : String(error)
    return { state: defaultControlState(now), present: false, issue: `the control state could not be read (${message})` }
  }
  return parseControlText(text, now)
}

/** Serialize a record exactly as it is written to disk. */
export function formatControlState(state: AbgControlState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

/**
 * Write the control record atomically: sibling temporary file, then rename.
 * The temporary name carries the pid so two concurrent CLIs cannot collide.
 */
export function writeControlStateFile(file: string, state: AbgControlState): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, formatControlState(state))
  renameSync(temporary, file)
}

/**
 * Resolve the control-plane paths for one environment.
 *
 * Resolution order (documented in the README): `$ABG_STATE_FILE` wins outright;
 * otherwise `<state-dir>/abg/state.json`, where `<state-dir>` is
 * `$XDG_STATE_HOME` else `$HOME/.local/state`. `prompt.md` is always the sibling
 * of the state file, so a profile's prompt travels with its control record.
 */
export function resolveControlPaths(input?: {
  env?: Record<string, string | undefined>
  home?: string
}): AbgControlPaths {
  const env = input?.env ?? {}
  const home = nonEmptyString(input?.home) ?? nonEmptyString(env.HOME) ?? homedir()
  const stateDir = nonEmptyString(env.XDG_STATE_HOME) ?? join(home, '.local', 'state')
  const stateFile = nonEmptyString(env.ABG_STATE_FILE) ?? join(stateDir, 'abg', 'state.json')
  return { stateFile, promptFile: join(dirname(stateFile), 'prompt.md'), stateDir }
}

/**
 * The diagnostic code for a state transition, or `undefined` when the state did
 * not change. `previous === undefined` is the first observation of a profile:
 * entering `paused` or `stopped` is still a transition worth reporting.
 */
export function transitionDiagnostic(
  previous: AbgControlStatus | undefined,
  next: AbgControlStatus,
): AbgControlCode | undefined {
  if (previous === next) return undefined
  if (next === 'paused') return 'abg.control_paused'
  if (next === 'stopped') return 'abg.control_stopped'
  if (next === 'running' && (previous === 'paused' || previous === 'stopped')) return 'abg.control_resumed'
  return undefined
}
