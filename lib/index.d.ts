/**
 * Information Environment Governance (IEG) — Cordis plugin entry.
 *
 * Contributes exactly **one** additive system-prompt section and binds
 * deterministic enforcement to verified host seams (`ARCHITECTURE-SPEC` §17):
 *
 * ```text
 * system prompt     -> ctx.systemPrompt.section()      (advisory)
 * step admission    -> agent/pre-step                  (veto: reject)
 * mutation gate     -> tools/pre-execute               (gate: ask / deny)
 * mutation backstop -> ctx.tools.guard()               (monotonic deny)
 * ```
 *
 * The plugin has **zero runtime imports** from first-party packages: everything
 * it needs arrives through the injected Cordis context. That keeps it mountable
 * in any composition and immune to the profile's module-resolution layout.
 */
import { resolveConfig } from './kernel/config.js';
import { createRegistry } from './kernel/registry.js';
import { compilePrompt } from './kernel/prompt-compiler.js';
import { createProjectState, evaluateOrientationGate } from './modules/project-governance.js';
import { classifyMutation, decideMutation, guardBackstop } from './modules/workspace-governance.js';
/** Options for {@link buildGovernance}. */
interface BuildGovernanceOptions {
    overrideText?: string;
    controlText?: string;
    controlPath?: string;
}
/** Cordis plugin name. */
export declare const name = "ieg";
/**
 * IEG's core contribution is the prompt section, so it mounts where the prompt
 * registry exists. Tool seams attach defensively, so a composition
 * without them still gets policy and orientation behaviour.
 */
export declare const inject: string[];
/** The single IEG section name. Occupies no host-reserved name. */
export declare const SECTION_NAME = "ieg:governance";
/** The runtime-context channel that carries the governance status line. */
export declare const STATUS_CONTEXT_NAME = "ieg:status";
/** The read-only tool that reports governance state to the model and operator. */
export declare const STATUS_TOOL_NAME = "ieg_status";
/**
 * Version of the compiled governance prompt. It changes whenever the injected
 * model-facing text changes, so a behavioural regression is attributable to one
 * prompt revision (ARCHITECTURE-SPEC Part B §22.3, PRODUCT-SPEC PR-07).
 */
export declare const PROMPT_VERSION = "0.4.0";
/**
 * Version of the plugin package, kept in step with `package.json` `version`.
 * Declared here so the `ieg` CLI can name the build without reading the
 * filesystem at runtime.
 */
export declare const PLUGIN_VERSION = "0.9.0";
/**
 * Stable kernel invariants: the statements that hold regardless of which modules
 * are enabled. Compiled ahead of module principles.
 *
 * Content rule (handoff §11, "distinguish policy from implementation"): every
 * statement here must be addressable to the *agent*. PRODUCT-SPEC P7 ("prefer
 * deterministic enforcement over repeated prompting") is deliberately **not**
 * included — it governs how this plugin is built, not a behaviour the model can
 * adopt, and emitting it would leak implementation detail into the prompt.
 */
export declare const KERNEL_PRINCIPLES: readonly string[];
/**
 * The three failure classes of PRODUCT-SPEC §2. Success criterion #2 requires
 * each to be represented; every class must be claimed by at least one enabled
 * module, which the prompt-conformance test enforces. `FC-2.4` (fragmented user
 * questioning) and its module were withdrawn in 0.7.0 with the user-attention
 * capability.
 */
export declare const FAILURE_CLASSES: readonly string[];
/** The three shipped modules, in registration order. */
export declare const MODULES: readonly (Readonly<{
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
}> | Readonly<{
    id: "information-integrity";
    version: "0.2.0";
    problem: "known-invalid information remains reusable";
    objective: "prevent invalid information from being treated as authoritative";
    principles: readonly string[];
    prompt: "When something written down is wrong, remove it at the source; a later reader must not be able to encounter the old claim on its own.";
    dependencies: readonly string[];
    risk: "medium";
    enabledByDefault: true;
    addresses: readonly string[];
}> | Readonly<{
    id: "workspace-governance";
    version: "0.2.0";
    problem: "unauthorized persistent workspace mutation";
    objective: "make workspace structure an explicitly governed part of project state";
    principles: readonly string[];
    prompt: "Inspect freely. A previous approval or an existing convention is not standing authorization: each approval covers only that one change.";
    dependencies: readonly string[];
    risk: "high";
    enabledByDefault: true;
    addresses: readonly string[];
}>)[];
/**
 * Build the governance kernel: validated config, registered modules, and the
 * compiled prompt section. Pure — no Cordis context required — so it is directly
 * unit-testable.
 *
 * Precedence is the prompt store's, not this function's: a control-plane
 * `prompt.md` read by the caller (`controlText`) outranks the config layer, which
 * outranks the compiled default. The caller does the I/O; this stays pure.
 *
 * @param raw
 * @param options
 */
export declare function buildGovernance(raw?: unknown, options?: BuildGovernanceOptions): {
    config: IegConfig;
    registry: import("./kernel/registry.js").ModuleRegistry;
    enabled: readonly GovernanceModule[];
    prompt: string;
    stats: import("./kernel/prompt-compiler.js").PromptStats;
    /** Why a user prompt edit was refused or ignored; surfaced as diagnostics on mount. */
    promptIssues: string[] | never[];
    promptOverridden: boolean;
    /** `control` | `config-file` | `config-append` | `compiled`. */
    promptSource: string;
    /** Soft invariants that no longer apply once the text is user-authored. */
    promptUnchecked: string[] | never[];
    /** `PROMPT_VERSION`, suffixed when a user edit is in force, so one text is one version. */
    promptVersion: string;
    /** Bytes of the audited compiled default, for a diff in any front end. */
    compiledBytes: number;
    /** The audited compiled text, which every override is validated against. */
    compiledPrompt: string;
};
/**
 * Mount IEG.
 *
 * Contract (`ARCHITECTURE-SPEC` §26.2): **this function does not throw.**
 * Configuration faults degrade to a diagnostic, and each capability is
 * registered inside its own guarded step, so one failing seam cannot cost the
 * deployment the rest of the governance layer.
 *
 * 0.6.0 adds a second, independent input: the control plane. `ieg start|pause|
 * exit` writes a small state file that this function re-reads (cached by mtime),
 * and `ieg restart` bumps its `generation`, which invalidates the cached
 * configuration and prompt so the next step re-reads from disk.
 */
export declare function apply(ctx: IegContext, rawConfig?: unknown): void;
export { resolveConfig, createRegistry, compilePrompt, createProjectState, evaluateOrientationGate, classifyMutation, decideMutation, guardBackstop, };
