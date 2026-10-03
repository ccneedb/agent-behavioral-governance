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
import { applyProjectEvent, createProjectState, orientationStatus } from '../modules/project-governance.js';
/** The model-facing tool that records orientation. */
export const ORIENTATION_TOOL_NAME = 'record_orientation';
/** Raised when a tool call supplies an orientation the contract rejects. */
export class OrientationError extends Error {
    constructor(message) {
        super(`ieg orientation: ${message}`);
        this.name = 'OrientationError';
    }
}
/**
 * Assert a value is a non-empty string.
 */
function requireText(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new OrientationError(`"${field}" is required and must be a non-empty string`);
    }
    return value.trim();
}
/**
 * Create the orientation store.
 */
export function createOrientationStore() {
    let state = createProjectState();
    let plan = [];
    let recorded = false;
    /**
     * Validate and commit one orientation declaration.
     */
    function record(input) {
        if (typeof input !== 'object' || input === null) {
            throw new OrientationError('the orientation payload must be an object');
        }
        const payload = input;
        const intent = requireText(payload.intent, 'intent');
        const objective = requireText(payload.objective, 'objective');
        const scope = requireText(payload.scope, 'scope');
        let terminology = [];
        if (payload.terminology !== undefined) {
            if (!Array.isArray(payload.terminology))
                throw new OrientationError('"terminology" must be an array');
            terminology = payload.terminology.map((entry, index) => {
                if (typeof entry !== 'object' || entry === null) {
                    throw new OrientationError(`"terminology[${index}]" must be an object`);
                }
                const term = entry;
                return {
                    term: requireText(term.term, `terminology[${index}].term`),
                    definition: requireText(term.definition, `terminology[${index}].definition`),
                };
            });
        }
        let steps = [];
        if (payload.plan !== undefined) {
            if (!Array.isArray(payload.plan))
                throw new OrientationError('"plan" must be an array of strings');
            steps = payload.plan.map((step, index) => requireText(step, `plan[${index}]`));
        }
        let next = createProjectState();
        next = applyProjectEvent(next, { type: 'set-intent', value: intent });
        next = applyProjectEvent(next, { type: 'set-objective', value: objective });
        next = applyProjectEvent(next, { type: 'set-scope', value: scope });
        for (const entry of terminology) {
            next = applyProjectEvent(next, { type: 'define-term', term: entry.term, definition: entry.definition });
        }
        for (const step of steps)
            next = applyProjectEvent(next, { type: 'add-plan-step', value: step });
        next = applyProjectEvent(next, { type: 'set-phase', value: 'executing' });
        state = next;
        plan = Object.freeze(steps);
        recorded = true;
        const status = orientationStatus(state);
        return {
            recorded: true,
            oriented: status.oriented,
            intent: state.intent,
            objective: state.objective,
            scope: state.scope,
            terminology: state.terminology,
            plan: [...plan],
            note: 'Orientation recorded. Persistent workspace changes are now permitted for this session.',
        };
    }
    /**
     * A serialisable snapshot of the orientation, for durable storage.
     */
    function snapshot() {
        return {
            state: {
                intent: state.intent,
                objective: state.objective,
                scope: state.scope,
                terminology: { ...state.terminology },
                constraints: [...state.constraints],
                assumptions: [...state.assumptions],
                unknowns: [...state.unknowns],
                plan: [...state.plan],
                currentPhase: state.currentPhase,
            },
            plan: [...plan],
        };
    }
    /**
     * Restore orientation from a durable snapshot. Used when a session is resumed,
     * forked, or restarted, so the requirement is not re-imposed on work that was
     * already oriented. Malformed snapshots are ignored rather than partially
     * applied.
     *
     * @returns whether a usable snapshot was restored.
     */
    function hydrate(value) {
        if (typeof value !== 'object' || value === null)
            return false;
        const restored = value.state;
        if (typeof restored !== 'object' || restored === null)
            return false;
        const record = restored;
        const intent = typeof record.intent === 'string' ? record.intent : '';
        const objective = typeof record.objective === 'string' ? record.objective : '';
        const scope = typeof record.scope === 'string' ? record.scope : '';
        if (intent === '' || objective === '' || scope === '')
            return false;
        let next = createProjectState();
        next = applyProjectEvent(next, { type: 'set-intent', value: intent });
        next = applyProjectEvent(next, { type: 'set-objective', value: objective });
        next = applyProjectEvent(next, { type: 'set-scope', value: scope });
        if (record.terminology !== null && typeof record.terminology === 'object') {
            for (const [term, definition] of Object.entries(record.terminology)) {
                if (typeof definition === 'string')
                    next = applyProjectEvent(next, { type: 'define-term', term, definition });
            }
        }
        const restoredPlan = Array.isArray(record.plan) ? record.plan : [];
        for (const step of restoredPlan) {
            if (typeof step === 'string')
                next = applyProjectEvent(next, { type: 'add-plan-step', value: step });
        }
        next = applyProjectEvent(next, { type: 'set-phase', value: 'executing' });
        state = next;
        plan = Object.freeze(restoredPlan.filter((step) => typeof step === 'string'));
        recorded = true;
        return true;
    }
    return {
        record,
        snapshot,
        hydrate,
        state: () => state,
        plan: () => plan,
        isRecorded: () => recorded,
        status: () => orientationStatus(state),
    };
}
/**
 * The model-facing tool definition. Registered through the tool registry, so the
 * agent discovers it exactly like any host tool.
 *
 * The store is resolved **per call** from the execution's live agent, because
 * orientation is per-agent state (ARCHITECTURE-SPEC Part B §25). Resolving at
 * call time rather than capturing one store at registration is what keeps two
 * concurrent agents from sharing a single orientation.
 */
export function orientationToolDefinition(getStore, options = {}) {
    return {
        name: ORIENTATION_TOOL_NAME,
        description: 'Record the project orientation for this session: the intent, objective, scope, the terminology you will use for the project\'s central concepts, and the ordered task flow you intend to follow. Call this before your first persistent workspace change. It is required once per session and is cheap; prefer recording your best-supported reading over stalling.',
        parameters: {
            type: 'object',
            properties: {
                intent: { type: 'string', description: 'What the project is for, in your own words.' },
                objective: { type: 'string', description: 'What this task must achieve.' },
                scope: { type: 'string', description: 'What is in scope, and explicitly what is out of scope.' },
                terminology: {
                    type: 'array',
                    description: 'The central concepts and the terms you will use for them.',
                    items: {
                        type: 'object',
                        properties: {
                            term: { type: 'string' },
                            definition: { type: 'string' },
                        },
                        required: ['term', 'definition'],
                    },
                },
                plan: {
                    type: 'array',
                    description: 'The ordered task flow: the steps you intend to take, in order.',
                    items: { type: 'string' },
                },
            },
            required: ['intent', 'objective', 'scope'],
        },
        output: { schema: { type: 'object' }, render: () => [] },
        execute: async (args, exec) => {
            const store = getStore(exec);
            const result = store.record(args);
            // Persist best-effort: a storage failure must not fail the tool call, or
            // the agent would be unable to satisfy the orientation requirement at all.
            try {
                await options.onRecorded?.(store.snapshot(), exec);
            }
            catch {
                /* durability is best-effort */
            }
            return result;
        },
    };
}
/**
 * Decide whether a call must be refused because orientation is missing.
 *
 * Precedence in the pipeline is: read-only, then a protected path, then this
 * requirement, then the workspace policy. Returning `deny` (rather than `ask`)
 * is deliberate: the requirement is a process step, not a decision the user
 * should be asked to make.
 */
export function orientationRequirement(classification, config, store) {
    if (!config.requireBeforeMutation)
        return null;
    if (classification.kind !== 'persistent-mutation')
        return null;
    if (classification.protected)
        return null;
    if (store.isRecorded())
        return null;
    return {
        kind: 'deny',
        reason: `ieg: record the project orientation before changing the workspace — call ${ORIENTATION_TOOL_NAME} ` +
            'with the intent, objective, scope, terminology, and ordered task flow',
    };
}
