/**
 * IEG kernel — orientation capture and its enforcement gate.
 *
 * The behavioural evaluation exposed a real defect: the `agent/pre-step`
 * orientation gate could never be satisfied, because nothing in the plugin ever
 * populated project state. `orientationGate: 'reject'` would therefore have
 * blocked every step forever.
 *
 * This module closes that loop. It gives the agent one explicit way to declare
 * orientation, and it refuses the first persistent workspace mutation until that
 * declaration exists. That converts objective 1 ("proactively align intent and
 * terminology and plan the global task flow, without waiting for user
 * reminders") from a hope about prose into a mechanically enforced step.
 *
 * The gate fires at most once per session, before the first mutation, so it
 * costs one extra tool call rather than adding friction to every action.
 */
import { createProjectState } from '../modules/project-governance.js';
/** The model-facing tool that records orientation. */
export declare const ORIENTATION_TOOL_NAME = "record_orientation";
/** Raised when a tool call supplies an orientation the contract rejects. */
export declare class OrientationError extends Error {
    constructor(message: string);
}
/** The orientation store's public surface. */
interface OrientationStore {
    record(input: unknown): Record<string, unknown>;
    snapshot(): Record<string, unknown>;
    hydrate(value: unknown): boolean;
    state(): ReturnType<typeof createProjectState>;
    plan(): readonly string[];
    isRecorded(): boolean;
    status(): {
        oriented: boolean;
        missing: string[];
    };
}
/**
 * Create the orientation store.
 */
export declare function createOrientationStore(): OrientationStore;
/**
 * The model-facing tool definition. Registered through the tool registry, so the
 * agent discovers it exactly like any host tool.
 *
 * The store is resolved **per call** from the execution's live agent, because
 * orientation is per-agent state (ARCHITECTURE-SPEC Part B §25). Resolving at
 * call time rather than capturing one store at registration is what keeps two
 * concurrent agents from sharing a single orientation.
 */
export declare function orientationToolDefinition(getStore: (exec: unknown) => ReturnType<typeof createOrientationStore>, options?: {
    onRecorded?: (snapshot: Record<string, unknown>, exec: unknown) => Promise<void> | void;
}): IegToolDefinition;
/**
 * Decide whether a call must be refused because orientation is missing.
 *
 * Precedence in the pipeline is: read-only, then a protected path, then this
 * requirement, then the workspace policy. Returning `deny` (rather than `ask`)
 * is deliberate: the requirement is a process step, not a decision the user
 * should be asked to make.
 */
export declare function orientationRequirement(classification: {
    kind: 'read-only' | 'persistent-mutation';
    protected: boolean;
}, config: {
    requireBeforeMutation: boolean;
}, store: ReturnType<typeof createOrientationStore>): {
    kind: 'deny';
    reason: string;
} | null;
export {};
