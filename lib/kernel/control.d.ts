/**
 * IEG kernel — the control plane (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * `ieg start|pause|restart|exit` is how an operator turns governance on and off
 * for a profile **without touching the installation**. This module owns the one
 * durable record that carries that decision: a small, stable JSON control-state
 * file, written atomically, and read by both the `ieg` CLI and the mounted plugin.
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
 * `lib/kernel/control.js` is the `tsc` build artifact DSH loads.
 */
/** Shape version of the control record. A reader must refuse a newer one. */
export declare const CONTROL_SCHEMA = 1;
/** The three governance states a profile can be in. */
export type IegControlStatus = 'running' | 'paused' | 'stopped';
/** The states, in escalation order, for validation and help text. */
export declare const CONTROL_STATUSES: readonly IegControlStatus[];
/** The one durable control record. */
export interface IegControlState {
    schema: number;
    status: IegControlStatus;
    /** Bumped by `restart`; a change invalidates cached configuration and prompt. */
    generation: number;
    /** ISO-8601 timestamp of the last write. */
    updatedAt: string;
    /** `$EDITOR` used for the last `ieg prompt edit`; absent when none was recorded. */
    editor?: string;
}
/** Result of reading the control record: always a usable state, plus what was wrong. */
export interface IegControlReadResult {
    state: IegControlState;
    /** Whether the file existed at all. */
    present: boolean;
    /** Human-readable reason when the file existed but could not be trusted. */
    issue?: string;
}
/** The two paths that make up the control plane for one profile. */
export interface IegControlPaths {
    stateFile: string;
    promptFile: string;
    stateDir: string;
}
/** Diagnostic codes this module's consumers record for control-plane events. */
export type IegControlCode = 'ieg.control_paused' | 'ieg.control_resumed' | 'ieg.control_stopped' | 'ieg.control_generation_changed' | 'ieg.control_state_unreadable';
/** The default clock, injectable so tests do not depend on wall time. */
export type IegClock = () => string;
/** Is `value` one of the three states? */
export declare function isControlStatus(value: unknown): value is IegControlStatus;
/** The state assumed when nothing has been written yet. */
export declare function defaultControlState(now?: IegClock): IegControlState;
/**
 * Interpret one parsed JSON value as a control record.
 *
 * Never throws and never returns an unusable state: a malformed record degrades
 * to the running default with an `issue` that the caller records as
 * `ieg.control_state_unreadable`.
 */
export declare function parseControlValue(value: unknown, now?: IegClock): IegControlReadResult;
/** Parse control-file text. `undefined`/empty means the file is absent. */
export declare function parseControlText(text: string | undefined, now?: IegClock): IegControlReadResult;
/** Read the control record, tolerating absence and corruption. Never throws. */
export declare function readControlStateFile(file: string, now?: IegClock): IegControlReadResult;
/** Serialize a record exactly as it is written to disk. */
export declare function formatControlState(state: IegControlState): string;
/**
 * Write the control record atomically: sibling temporary file, then rename.
 * The temporary name carries the pid so two concurrent CLIs cannot collide.
 */
export declare function writeControlStateFile(file: string, state: IegControlState): void;
/**
 * Resolve the control-plane paths for one environment.
 *
 * Resolution order (documented in the README): `$IEG_STATE_FILE` wins outright;
 * otherwise `<state-dir>/ieg/state.json`, where `<state-dir>` is
 * `$XDG_STATE_HOME` else `$HOME/.local/state`. `prompt.md` is always the sibling
 * of the state file, so a profile's prompt travels with its control record.
 */
export declare function resolveControlPaths(input?: {
    env?: Record<string, string | undefined>;
    home?: string;
}): IegControlPaths;
/**
 * The diagnostic code for a state transition, or `undefined` when the state did
 * not change. `previous === undefined` is the first observation of a profile:
 * entering `paused` or `stopped` is still a transition worth reporting.
 */
export declare function transitionDiagnostic(previous: IegControlStatus | undefined, next: IegControlStatus): IegControlCode | undefined;
