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
/** Shape version of the control record. A reader must refuse a newer one. */
export declare const CONTROL_SCHEMA = 1;
/** The three governance states a profile can be in. */
export type AbgControlStatus = 'running' | 'paused' | 'stopped';
/** The states, in escalation order, for validation and help text. */
export declare const CONTROL_STATUSES: readonly AbgControlStatus[];
/** The one durable control record. */
export interface AbgControlState {
    schema: number;
    status: AbgControlStatus;
    /** Bumped by `restart`; a change invalidates cached configuration and prompt. */
    generation: number;
    /** ISO-8601 timestamp of the last write. */
    updatedAt: string;
    /** `$EDITOR` used for the last `abg prompt edit`; absent when none was recorded. */
    editor?: string;
}
/** Result of reading the control record: always a usable state, plus what was wrong. */
export interface AbgControlReadResult {
    state: AbgControlState;
    /** Whether the file existed at all. */
    present: boolean;
    /** Human-readable reason when the file existed but could not be trusted. */
    issue?: string;
}
/** The two paths that make up the control plane for one profile. */
export interface AbgControlPaths {
    stateFile: string;
    promptFile: string;
    stateDir: string;
}
/** Diagnostic codes this module's consumers record for control-plane events. */
export type AbgControlCode = 'abg.control_paused' | 'abg.control_resumed' | 'abg.control_stopped' | 'abg.control_generation_changed' | 'abg.control_state_unreadable';
/** The default clock, injectable so tests do not depend on wall time. */
export type AbgClock = () => string;
/** Is `value` one of the three states? */
export declare function isControlStatus(value: unknown): value is AbgControlStatus;
/** The state assumed when nothing has been written yet. */
export declare function defaultControlState(now?: AbgClock): AbgControlState;
/**
 * Interpret one parsed JSON value as a control record.
 *
 * Never throws and never returns an unusable state: a malformed record degrades
 * to the running default with an `issue` that the caller records as
 * `abg.control_state_unreadable`.
 */
export declare function parseControlValue(value: unknown, now?: AbgClock): AbgControlReadResult;
/** Parse control-file text. `undefined`/empty means the file is absent. */
export declare function parseControlText(text: string | undefined, now?: AbgClock): AbgControlReadResult;
/** Read the control record, tolerating absence and corruption. Never throws. */
export declare function readControlStateFile(file: string, now?: AbgClock): AbgControlReadResult;
/** Serialize a record exactly as it is written to disk. */
export declare function formatControlState(state: AbgControlState): string;
/**
 * Write the control record atomically: sibling temporary file, then rename.
 * The temporary name carries the pid so two concurrent CLIs cannot collide.
 */
export declare function writeControlStateFile(file: string, state: AbgControlState): void;
/**
 * Resolve the control-plane paths for one environment.
 *
 * Resolution order (documented in the README): `$ABG_STATE_FILE` wins outright;
 * otherwise `<state-dir>/abg/state.json`, where `<state-dir>` is
 * `$XDG_STATE_HOME` else `$HOME/.local/state`. `prompt.md` is always the sibling
 * of the state file, so a profile's prompt travels with its control record.
 */
export declare function resolveControlPaths(input?: {
    env?: Record<string, string | undefined>;
    home?: string;
}): AbgControlPaths;
/**
 * The diagnostic code for a state transition, or `undefined` when the state did
 * not change. `previous === undefined` is the first observation of a profile:
 * entering `paused` or `stopped` is still a transition worth reporting.
 */
export declare function transitionDiagnostic(previous: AbgControlStatus | undefined, next: AbgControlStatus): AbgControlCode | undefined;
