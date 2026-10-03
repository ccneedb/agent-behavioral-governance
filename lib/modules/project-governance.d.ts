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
 *
 * Orientation semantics (Batch 1, 0.7.0). The recorded orientation is what the
 * agent has **declared**: intent, objective, scope, terminology, constraints,
 * assumptions, unknowns and phase. A declaration is not evidence of behavioural
 * consistency, and the two are deliberately separate concepts. A future
 * "Orientation Consistency" direction is therefore named but NOT implemented:
 *
 *   declared constraints -> observed actions -> consistency / drift evaluation
 *
 * Nothing here evaluates observed actions, and the gate must never be described
 * as if it did.
 */
export interface ProjectState {
    intent: string;
    objective: string;
    scope: string;
    terminology: Record<string, string>;
    constraints: string[];
    assumptions: string[];
    unknowns: string[];
    plan: string[];
    currentPhase: string;
}
export interface ProjectEvent {
    type: 'set-intent' | 'set-objective' | 'set-scope' | 'set-phase' | 'define-term' | 'add-constraint' | 'add-assumption' | 'add-unknown' | 'add-plan-step' | 'resolve-unknown';
    value?: string;
    term?: string;
    definition?: string;
}
/** The orientation fields required before major execution (PR-01). */
export declare const REQUIRED_ORIENTATION_FIELDS: readonly string[];
export declare function createProjectState(): ProjectState;
/**
 * Apply one project-state event, returning a **new** state. The input is never
 * mutated.
 */
export declare function applyProjectEvent(state: ProjectState, event: ProjectEvent): ProjectState;
/**
 * Whether the project model is sufficiently established for major execution,
 * and which orientation fields are still missing.
 */
export declare function orientationStatus(state: ProjectState): {
    oriented: boolean;
    missing: string[];
};
/**
 * Evaluate the pre-step orientation gate.
 *
 * Returns `null` when the caller should admit the step, or a rejection decision
 * when the configured gate forbids entering it. `off` and `warn` never block:
 * P6 (uncertainty is allowed to persist) and P8 (diagnose before acting) make a
 * hard block the exception, not the default.
 */
export declare function evaluateOrientationGate(state: ProjectState, gate: 'off' | 'warn' | 'reject'): {
    decision: null | {
        kind: 'reject';
    };
    missing: string[];
};
/** The §6 module descriptor. */
export declare const projectGovernanceModule: Readonly<{
    id: "project-governance";
    version: "0.2.0";
    problem: "the agent advances without a sufficiently stable project model";
    objective: "maintain semantic alignment across the task lifetime";
    principles: readonly string[];
    prompt: "State the ordered task flow before you begin it, and revise it explicitly when it changes.";
    dependencies: readonly never[];
    risk: "low";
    enabledByDefault: true;
    addresses: readonly string[];
}>;
