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
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveConfig, DEFAULT_SECTION_ORDER } from './kernel/config.js';
import { createRegistry } from './kernel/registry.js';
// `lib/**` is the compiled JavaScript of `src/**/*.ts` (see
// TYPESCRIPT-MIGRATION.md). These modules are migrated; the rest of `lib/`
// is still hand-written JavaScript.
import { compilePrompt, promptStats } from './kernel/prompt-compiler.js';
import { createDiagnosticsExporter } from './kernel/export.js';
// The 0.6.0 control plane: the durable `ieg start|pause|exit` record and the
// `prompt.md` store beside it. The CLI writes them; this host layer reads them.
import { readControlStateFile, resolveControlPaths, transitionDiagnostic, } from './kernel/control.js';
import { readPromptFile, resolveEffectivePrompt } from './kernel/prompt-store.js';
import { projectGovernanceModule, createProjectState, evaluateOrientationGate } from './modules/project-governance.js';
import { informationIntegrityModule } from './modules/information-integrity.js';
import { workspaceGovernanceModule, classifyMutation, decideMutation, guardBackstop, } from './modules/workspace-governance.js';
import { orientationRequirement, orientationToolDefinition, } from './kernel/orientation.js';
import { checkDocumentOverlap } from './kernel/overlap.js';
import { createDiagnostics } from './kernel/diagnostics.js';
import { createCompatibilityAdapter, DEFAULT_BASELINE } from './kernel/compatibility.js';
import { createGovernanceState, agentIdOf } from './kernel/state.js';
import { createDurableStore, sessionIdOf } from './kernel/durability.js';
/**
 * Project one read-only tool's canonical JSON value to model content.
 *
 * `ieg_status` is the surface an operator or agent reads to learn what the
 * governance layer is doing. Its canonical value is already lossless JSON, but
 * a tool result only reaches the model through `render`, and returning no
 * content there made the tool silently useless: the call succeeded and the
 * model saw nothing. Rendering the value fixes that.
 *
 * @param {unknown} _args
 * @param {unknown} value
 * @returns {Array<{ type: 'text', text: string }>}
 */
function renderJson(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
/** Cordis plugin name. */
export const name = 'ieg';
/**
 * IEG's core contribution is the prompt section, so it mounts where the prompt
 * registry exists. Tool seams attach defensively, so a composition
 * without them still gets policy and orientation behaviour.
 */
export const inject = ['systemPrompt'];
/** The single IEG section name. Occupies no host-reserved name. */
export const SECTION_NAME = 'ieg:governance';
/** The runtime-context channel that carries the governance status line. */
export const STATUS_CONTEXT_NAME = 'ieg:status';
/** The read-only tool that reports governance state to the model and operator. */
export const STATUS_TOOL_NAME = 'ieg_status';
/**
 * Version of the compiled governance prompt. It changes whenever the injected
 * model-facing text changes, so a behavioural regression is attributable to one
 * prompt revision (ARCHITECTURE-SPEC Part B §22.3, PRODUCT-SPEC PR-07).
 */
export const PROMPT_VERSION = '0.4.0';
/**
 * Version of the plugin package, kept in step with `package.json` `version`.
 * Declared here so the `ieg` CLI can name the build without reading the
 * filesystem at runtime.
 */
export const PLUGIN_VERSION = '0.9.1';
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
export const KERNEL_PRINCIPLES = Object.freeze([
    'Prefer a safe refusal over an action the user has not authorized.',
    'Unresolved uncertainty may persist unless proceeding would be unsafe.',
    'Diagnose before acting destructively, and report the blocking condition in project terms rather than implementation detail.',
]);
/**
 * The three failure classes of PRODUCT-SPEC §2. Success criterion #2 requires
 * each to be represented; every class must be claimed by at least one enabled
 * module, which the prompt-conformance test enforces. `FC-2.4` (fragmented user
 * questioning) and its module were withdrawn in 0.7.0 with the user-attention
 * capability.
 */
export const FAILURE_CLASSES = Object.freeze([
    'FC-2.1', // project ownership and semantic drift
    'FC-2.2', // unauthorized workspace mutation
    'FC-2.3', // reuse of known-invalid information
]);
/** The three shipped modules, in registration order. */
export const MODULES = Object.freeze([
    projectGovernanceModule,
    informationIntegrityModule,
    workspaceGovernanceModule,
]);
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
export function buildGovernance(raw, options = {}) {
    const config = resolveConfig(raw);
    const registry = createRegistry();
    for (const module of MODULES)
        registry.registerModule(module);
    registry.configure(config.modules);
    const enabled = registry.getEnabledModules();
    const basePrompt = config.enabled ? compilePrompt({ kernelPrinciples: KERNEL_PRINCIPLES, modules: enabled }) : '';
    const effective = config.enabled
        ? resolveEffectivePrompt({
            mode: config.prompt.mode,
            append: config.prompt.append,
            configText: options.overrideText,
            controlText: options.controlText,
            controlPath: options.controlPath,
            basePrompt,
            allowOverBudget: config.prompt.allowOverBudget,
        })
        : {
            text: '',
            applied: false,
            source: 'compiled',
            versionSuffix: '',
            issues: [],
            unchecked: [],
            bytes: 0,
            controlPath: '',
            controlRefused: false,
        };
    return {
        config,
        registry,
        enabled,
        prompt: effective.text,
        stats: promptStats(effective.text),
        /** Why a user prompt edit was refused or ignored; surfaced as diagnostics on mount. */
        promptIssues: effective.issues,
        promptOverridden: effective.applied,
        /** `control` | `config-file` | `config-append` | `compiled`. */
        promptSource: effective.source,
        /** Soft invariants that no longer apply once the text is user-authored. */
        promptUnchecked: effective.unchecked,
        /** `PROMPT_VERSION`, suffixed when a user edit is in force, so one text is one version. */
        promptVersion: `${PROMPT_VERSION}${effective.versionSuffix}`,
        /** Bytes of the audited compiled default, for a diff in any front end. */
        compiledBytes: promptStats(basePrompt).bytes,
        /** The audited compiled text, which every override is validated against. */
        compiledPrompt: basePrompt,
    };
}
/**
 * Mount the observable surface of IEG when the kernel cannot be built.
 *
 * `ARCHITECTURE-SPEC` §26.2: `apply()` must not throw, because the host reports a
 * throwing entry as `warning: N entry did not activate` and continues without the
 * plugin. A governance layer that fails to mount must at least be **visible**, so
 * this path registers no prompt section and no enforcement, and exposes the fault
 * through the read-only status surface instead. Fail-safe, and observable: an
 * operator reading only the transcript can tell that IEG is inert and why.
 */
function mountConfigFaultSurface(ctx, error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
        const diagnostics = createDiagnostics({ limit: 200 });
        diagnostics.record({ code: 'ieg.config_invalid', data: { message } });
        /** Seams that are absent even for the fault surface itself. */
        const degraded = [];
        const mount = {
            mounted: false,
            degraded,
            configError: message,
            promptVersion: PROMPT_VERSION,
            sectionName: SECTION_NAME,
            sectionOrder: DEFAULT_SECTION_ORDER,
            modules: [],
            moduleCount: 0,
            compatibility: { verdict: 'PENDING', reasons: [] },
        };
        if (ctx.systemPrompt === undefined) {
            degraded.push('systemPrompt');
        }
        else {
            try {
                ctx.systemPrompt.context?.({
                    name: STATUS_CONTEXT_NAME,
                    order: DEFAULT_SECTION_ORDER,
                    text: () => diagnostics.formatLine(),
                });
            }
            catch {
                // The tool and the log line below still carry the fault.
            }
        }
        if (ctx.inject === undefined) {
            degraded.push('tools');
        }
        else {
            ctx.inject(['tools'], (toolCtx) => {
                try {
                    toolCtx.tools?.register({
                        name: STATUS_TOOL_NAME,
                        description: 'Read IEG governance state. Read-only. A mount record with "mounted: false" and a configError means the governance layer is inert: no IEG prompt section and no IEG enforcement is active.',
                        parameters: { type: 'object', properties: {} },
                        output: { schema: { type: 'object' }, render: renderJson },
                        execute: async () => ({
                            mount,
                            status_line: diagnostics.formatLine(),
                            diagnostics: diagnostics.recent(20),
                        }),
                    });
                }
                catch {
                    // A registry that refuses the tool must not resurrect the mount fault.
                }
            });
        }
        try {
            ctx.logger?.warn(`ieg: config_invalid ${message}`);
        }
        catch {
            // Log narration is best effort by design (§28.3 channel D).
        }
    }
    catch {
        // Even the diagnostic surface is best effort: `apply()` must never throw.
    }
}
/**
 * Read the replacement prompt file named by the raw configuration.
 *
 * Deliberately here, in the host-touching layer, rather than in the pure kernel:
 * `buildGovernance()` stays free of I/O and unit-testable without a filesystem.
 * An unreadable file is not fatal — the audited compiled default is used and the
 * reason is reported as a diagnostic.
 */
function readPromptOverride(rawConfig) {
    if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig))
        return {};
    const prompt = rawConfig.prompt;
    if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt))
        return {};
    const { mode, file } = prompt;
    if (mode !== 'replace' || typeof file !== 'string' || file.trim() === '')
        return {};
    try {
        return { text: readFileSync(file, 'utf8') };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { issue: `prompt.file could not be read (${message}); the compiled default is in use` };
    }
}
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
export function apply(ctx, rawConfig) {
    let kernel;
    let overrideIssue = '';
    let controlFileIssue = '';
    const controlPaths = resolveControlPaths({ env: process.env });
    try {
        const override = readPromptOverride(rawConfig);
        if (override.issue !== undefined)
            overrideIssue = override.issue;
        const controlPrompt = readPromptFile(controlPaths.promptFile);
        if (controlPrompt.issue !== undefined)
            controlFileIssue = controlPrompt.issue;
        kernel = buildGovernance(rawConfig, {
            overrideText: override.text,
            controlText: controlPrompt.text,
            controlPath: controlPaths.promptFile,
        });
    }
    catch (error) {
        mountConfigFaultSurface(ctx, error);
        return;
    }
    const { config, registry, enabled, prompt, stats } = kernel;
    if (!config.enabled) {
        try {
            ctx.logger?.info('ieg: governance disabled by configuration');
        }
        catch {
            // Best-effort narration only.
        }
        return;
    }
    // Governance state is per live agent, keyed by the agent object itself
    // (ARCHITECTURE-SPEC §17.7, Part B §25). One composition therefore serves many
    // agents without letting them observe each other's orientation.
    const governance = createGovernanceState();
    /* ── observability (Part B §28) ───────────────────────────────────────── */
    // The ring always records: it is bounded, in-memory, and cheap, and the
    // read-only status surface must work even when log narration is switched off.
    // `config.diagnostics` gates only the `ctx.logger` narration, because that is
    // the channel that is invisible in stock compositions anyway (§28.1).
    const diagnostics = createDiagnostics({ limit: 200 });
    /**
     * Capabilities whose registration failed or whose seam was absent. Empty means
     * a complete mount. `mounted: true` alone cannot distinguish a full mount from a
     * partial one, so this is what an external health check must key on (§26.1).
     */
    const degradedCapabilities = [];
    /** Mount facts reported by the status tool and the status line. */
    const mount = {
        mounted: true,
        degraded: degradedCapabilities,
        promptVersion: kernel.promptVersion,
        promptOverridden: kernel.promptOverridden,
        promptIssues: kernel.promptIssues,
        compiledPromptBytes: kernel.compiledBytes,
        sectionName: SECTION_NAME,
        sectionOrder: config.sectionOrder,
        promptBytes: stats.bytes,
        modules: enabled.map((module) => module.id),
        moduleCount: enabled.length,
        /** Replaced by the compatibility adapter's snapshot once it observes one. */
        compatibility: { verdict: 'PENDING', reasons: [] },
    };
    /**
     * The live prompt facts. `ieg prompt edit` / `ieg prompt reset` change the
     * on-disk `prompt.md`, and `ieg restart` (a `generation` bump) is what rebuilds
     * these; the section text provider and the read-only `ieg_status` tool read
     * them, so a reload applies to the next assembly without a remount.
     */
    const promptState = {
        text: prompt,
        bytes: stats.bytes,
        overridden: kernel.promptOverridden,
        version: kernel.promptVersion,
        issues: [...kernel.promptIssues],
        unchecked: [...kernel.promptUnchecked],
    };
    /** Set once the exporter exists; `note()` calls it so every record can mirror. */
    let flushExport = () => { };
    /**
     * Record one diagnostic and, when narration is enabled, keep the historical
     * `ctx.logger` line byte-for-byte so existing behaviour and tests are stable.
     *
     * @param code
     * @param data
     * @param narration
     * @param level
     */
    const note = (code, data, narration, level = 'info') => {
        diagnostics.record({ code, data });
        flushExport();
        if (!config.diagnostics || narration === undefined)
            return;
        // Log narration is best effort (§28.3 channel D): a deployment with a broken
        // or absent logger must still get the ring, the status line, and the tools.
        try {
            if (level === 'warn')
                ctx.logger?.warn(narration);
            else
                ctx.logger?.info(narration);
        }
        catch {
            // Deliberately swallowed: narration must never affect enforcement.
        }
    };
    /**
     * Register one capability, degrading a failure to a diagnostic.
     *
     * `ARCHITECTURE-SPEC` §26.2 requires `apply()` not to throw: the host reports a
     * throwing entry as `warning: N entry did not activate` and continues without
     * IEG. Isolating each registration means one unavailable seam costs only that
     * seam, and the fault is recorded where the status surface can report it.
     *
     * @param capability
     * @param action
     */
    const guarded = (capability, action) => {
        try {
            action();
        }
        catch (error) {
            degradedCapabilities.push(capability);
            const message = error instanceof Error ? error.message : String(error);
            note('ieg.error', { capability, message }, `ieg: ${capability} failed: ${message}`, 'warn');
        }
    };
    /**
     * Record a seam that is absent, which is not the same as a seam IEG does not
     * need: without this, a vanished host service is indistinguishable from a
     * capability that was never required.
     *
     * @param capability
     */
    const noteMissing = (capability) => {
        degradedCapabilities.push(capability);
        note('ieg.capability_missing', { capability }, `ieg: capability_missing ${capability}`, 'warn');
    };
    /* ── control plane: start | pause | exit (0.6.0) ──────────────────────── */
    // The control record is a second, independent input beside the mount config.
    // It is re-read cheaply: a re-stat per assembly and per step is allowed, and
    // only a changed mtime costs a read. `ieg restart` bumps `generation`, which is
    // the signal to invalidate the cached configuration and prompt so the next step
    // sees on-disk truth.
    const control = {
        // Distinguishes "never read" from "read and still absent". An absent file
        // also yields the default cache key, so an uninitialised cache must not be
        // treated as an unchanged one: the first read is what establishes the
        // previous state a transition (and a generation change) is measured against.
        initialised: false,
        mtimeKey: '-Infinity:0',
        status: undefined,
        generation: 0,
        unreadable: false,
    };
    /**
     * The control file's cache key: mtime **and** size.
     *
     * The mtime alone is what the contract asks for, but two writes inside the same
     * clock millisecond share an mtime on coarse clocks. Adding the byte size is
     * free (same `stat`) and closes that window for any transition that changes the
     * record's length — every `status` change does.
     */
    const controlMtime = () => {
        try {
            const info = statSync(controlPaths.stateFile);
            return `${info.mtimeMs}:${info.size}`;
        }
        catch {
            return '-Infinity:0';
        }
    };
    /**
     * Rebuild the kernel after a generation change, re-reading every on-disk
     * input: the config-supplied prompt file and the control-plane `prompt.md`.
     */
    const rebuildKernel = () => {
        const override = readPromptOverride(rawConfig);
        overrideIssue = override.issue ?? '';
        const controlPrompt = readPromptFile(controlPaths.promptFile);
        controlFileIssue = controlPrompt.issue ?? '';
        kernel = buildGovernance(rawConfig, {
            overrideText: override.text,
            controlText: controlPrompt.text,
            controlPath: controlPaths.promptFile,
        });
        promptState.text = kernel.prompt;
        promptState.bytes = kernel.stats.bytes;
        promptState.overridden = kernel.promptOverridden;
        promptState.version = kernel.promptVersion;
        promptState.issues = [...kernel.promptIssues];
        promptState.unchecked = [...kernel.promptUnchecked];
        mount.promptVersion = kernel.promptVersion;
        mount.promptOverridden = kernel.promptOverridden;
        mount.promptIssues = kernel.promptIssues;
        mount.promptBytes = kernel.stats.bytes;
        mount.compiledPromptBytes = kernel.compiledBytes;
    };
    /**
     * Read the control record when it changed, classify the transition, and apply
     * a generation change. Always returns a usable status; never throws.
     */
    const refreshControl = () => {
        const mtimeKey = controlMtime();
        if (control.initialised && mtimeKey === control.mtimeKey)
            return control.status ?? 'running';
        control.initialised = true;
        let read;
        try {
            read = readControlStateFile(controlPaths.stateFile);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            read = { state: { schema: 1, status: 'running', generation: control.generation, updatedAt: '' }, present: false, issue: message };
        }
        const previous = control.status;
        control.mtimeKey = mtimeKey;
        control.status = read.state.status;
        const issue = read.issue ?? '';
        if (issue !== '' && !control.unreadable) {
            control.unreadable = true;
            note('ieg.control_state_unreadable', { file: controlPaths.stateFile, issue }, `ieg: control_state_unreadable ${issue}`, 'warn');
        }
        else if (issue === '') {
            control.unreadable = false;
        }
        const transition = transitionDiagnostic(previous, read.state.status);
        if (transition !== undefined) {
            note(transition, { status: read.state.status, generation: read.state.generation, file: controlPaths.stateFile }, `ieg: ${transition.slice('ieg.'.length)} status=${read.state.status}`);
        }
        if (previous !== undefined && read.state.generation !== control.generation) {
            const from = control.generation;
            control.generation = read.state.generation;
            note('ieg.control_generation_changed', { from, to: read.state.generation }, `ieg: control_generation_changed ${from}->${read.state.generation}`);
            try {
                rebuildKernel();
            }
            catch (error) {
                note('ieg.error', { capability: 'control.reload', message: error instanceof Error ? error.message : String(error) }, `ieg: control.reload failed: ${error instanceof Error ? error.message : String(error)}`, 'warn');
            }
        }
        else {
            control.generation = read.state.generation;
        }
        return read.state.status;
    };
    if (controlFileIssue !== '') {
        note('ieg.prompt_override_missing', { issue: controlFileIssue }, `ieg: prompt_override_missing ${controlFileIssue}`, 'warn');
    }
    // Observe the control plane once at mount, so a `stopped` profile behaves as if
    // governance were switched off and a `paused` profile records its transition.
    const initialControl = refreshControl();
    if (initialControl === 'stopped') {
        // `exit` means "off for this profile", and the installation is untouched.
        try {
            ctx.logger?.info('ieg: governance stopped by control state');
        }
        catch {
            // Best-effort narration only.
        }
        return;
    }
    /** Governance is live only in `running`. `paused` and `stopped` pass through. */
    const controlIsActive = () => refreshControl() === 'running';
    /* ── user-editable prompt (§27.1) ─────────────────────────────────────── */
    // A refused or ignored user edit is a governance event, not a silent fallback:
    // the deployment must be able to see that its text is not in force.
    for (const issue of kernel.promptIssues) {
        note('ieg.prompt_override_rejected', { issue }, `ieg: prompt_override_rejected ${issue}`, 'warn');
    }
    if (overrideIssue !== '') {
        note('ieg.prompt_override_missing', { issue: overrideIssue }, `ieg: prompt_override_missing ${overrideIssue}`, 'warn');
    }
    if (kernel.promptOverridden) {
        note('ieg.prompt_override_applied', { promptVersion: kernel.promptVersion, bytes: stats.bytes, unchecked: kernel.promptUnchecked }, `ieg: prompt_override_applied version=${kernel.promptVersion} bytes=${stats.bytes} ` +
            `unchecked=${kernel.promptUnchecked.length}`, 'warn');
    }
    /* ── opt-in diagnostics mirror (§28.7) ────────────────────────────────── */
    // A front end cannot read the in-process ring; this mirrors it to a path the
    // deployment chooses, at most once per interval, and only when asked for.
    const exporter = createDiagnosticsExporter({
        file: config.diagnosticsExport.file,
        limit: config.diagnosticsExport.limit,
        snapshot: () => ({
            mount,
            status_line: diagnostics.formatLine(),
            counts: diagnostics.counts(),
            diagnostics: diagnostics.recent(config.diagnosticsExport.limit),
        }),
        writeFile: config.diagnosticsExport.file === ''
            ? undefined
            : (path, text) => {
                mkdirSync(dirname(path), { recursive: true });
                const temporary = `${path}.tmp`;
                writeFileSync(temporary, text);
                renameSync(temporary, path);
            },
        onError: (message) => note('ieg.diagnostics_export_failed', { message }, `ieg: diagnostics_export_failed ${message}`, 'warn'),
    });
    if (exporter.file !== '') {
        flushExport = () => {
            exporter.flush();
        };
        guarded('diagnosticsExport', () => {
            exporter.flush(true);
        });
        guarded('dispose.diagnosticsExport', () => {
            ctx.effect?.(() => () => {
                exporter.close();
            }, 'ieg: stop mirroring diagnostics');
        });
    }
    /* ── compatibility adapter (Part B §29) ───────────────────────────────── */
    // Observes the host's own assembly on the `system-prompt/assemble` waterfall.
    // The listener always calls `next()`: IEG never blocks or replaces an
    // assembly, so a host drift is reported, never enforced (fail open).
    const compatibility = createCompatibilityAdapter({
        baseline: DEFAULT_BASELINE,
        capabilities: () => ['systemPrompt', 'tools', 'fs', 'storageDomain', 'approval'].filter((name) => ctx.get?.(name) !== undefined),
        onVerdict: (result, snapshot) => {
            mount.compatibility = snapshot;
            note('ieg.host_compatibility', { verdict: result.verdict, reasons: result.reasons });
        },
    });
    guarded('system-prompt/assemble', () => {
        ctx.on('system-prompt/assemble', (assembly, context, next) => {
            try {
                compatibility.observe(assembly, context);
            }
            catch (error) {
                note('ieg.error', { phase: 'compatibility', message: String((error?.message) ?? error) });
            }
            return next();
        });
    });
    /* ── durable state (handoff Gate F) ───────────────────────────────────── */
    // Storage is optional and every failure degrades to "no persistence"; IEG's
    // enforcement never depends on it. The fallback also covers a storage seam that
    // throws during construction, rather than only one that reports an error.
    let durable = {
        available: async () => false,
        load: async () => undefined,
        save: async () => false,
        close: async () => { },
    };
    guarded('storageDomain', () => {
        durable = createDurableStore(ctx, {
            onError: (error) => note('ieg.capability_missing', { capability: 'storageDomain' }, `ieg: governance persistence unavailable: ${String((error?.message) ?? error)}`, 'warn'),
        });
    });
    /** Sessions already looked up, so a resumed session costs one read, not one per call. */
    const hydratedSessions = new Set();
    /**
     * Restore one agent's orientation from durable state. Called lazily, before
     * the orientation requirement is evaluated, so a resumed session is not asked
     * to re-orient work that was already oriented (Gate F).
     *
     * @param agent
     * @returns whether a usable snapshot was restored.
     */
    const hydrateOrientation = async (agent) => {
        const { orientation } = governance.forAgent(agent);
        if (orientation.isRecorded())
            return true;
        const sessionId = sessionIdOf(agent);
        if (sessionId === '' || hydratedSessions.has(sessionId))
            return false;
        hydratedSessions.add(sessionId);
        const snapshot = await durable.load(sessionId);
        if (snapshot === undefined)
            return false;
        if (!orientation.hydrate(snapshot))
            return false;
        note('ieg.orientation_restored', { sessionId }, 'ieg: orientation_restored');
        return true;
    };
    const persistOrientation = async (snapshot, exec) => {
        const agent = (exec ?? {}).agent;
        await durable.save(sessionIdOf(agent), snapshot);
    };
    guarded('dispose.storageDomain', () => {
        ctx.effect?.(() => () => {
            void durable.close();
        }, 'ieg: release the governance domain handle');
    });
    /* ── 1. the one additive prompt section ───────────────────────────────── */
    // `interpolate: false` is mandatory: governance text is literal, and the host
    // would otherwise throw on an unknown `{{variable}}` reference. `complete` is
    // deliberately never set (§4).
    if (ctx.systemPrompt === undefined) {
        // `inject` declares this seam as required, so its absence is a host-contract
        // breach that must be visible rather than a silently empty contribution.
        noteMissing('systemPrompt');
    }
    else {
        guarded('systemPrompt.section', () => {
            ctx.systemPrompt?.section({
                name: SECTION_NAME,
                order: config.sectionOrder,
                interpolate: false,
                // A function-valued provider is re-evaluated per assembly, which is what
                // lets a `prompt.md` edit or an `ieg restart` take effect on the next step.
                // `pause`/`exit` suppress the section entirely: it contributes no text.
                text: () => (controlIsActive() ? promptState.text : ''),
            });
        });
        // Channel A (§28.3): one bounded status line, registered once. The host
        // re-evaluates a function-valued `text` on every assembly and supersedes the
        // previous snapshot instead of accumulating one, and it renders through the
        // runtime-context channel rather than the compiled prompt — both verified
        // against the real `dsh-system-prompt`, which resolves assumption B2.
        if (config.diagnostics) {
            guarded('systemPrompt.context', () => {
                ctx.systemPrompt?.context?.({
                    name: STATUS_CONTEXT_NAME,
                    order: config.sectionOrder,
                    text: () => diagnostics.formatLine(),
                });
            });
        }
    }
    /* ── 2. pre-step orientation gate ─────────────────────────────────────── */
    const onPreStep = async (payload, next) => {
        // Control plane first: `paused`/`stopped` let the step through untouched,
        // before any IEG bookkeeping.
        if (!controlIsActive())
            return next();
        // The step's own agent decides which orientation is evaluated.
        const agent = payload?.agent;
        const { orientation } = governance.forAgent(agent);
        const { decision, missing } = evaluateOrientationGate(orientation.state(), config.preStep.orientationGate);
        if (decision !== null) {
            note('ieg.orientation_required', { phase: 'pre-step', missing, agentId: agentIdOf(agent) }, `ieg: pre_step_rejected missing=${missing.join(',')} agent=${agentIdOf(agent) || '-'}`, 'warn');
            return decision;
        }
        if (config.preStep.orientationGate === 'warn' && missing.length > 0) {
            note('ieg.orientation_required', { phase: 'pre-step', outcome: 'warn', missing }, `ieg: orientation_incomplete missing=${missing.join(',')}`);
        }
        return next();
    };
    guarded('agent/pre-step', () => {
        ctx.on('agent/pre-step', onPreStep);
    });
    /* ── 3. mutation gate: tools/pre-execute ──────────────────────────────── */
    const onPreExecute = async (exec, next) => {
        // Control plane first: `paused`/`stopped` pass the call straight through, so
        // a paused profile neither gates nor observes a mutation.
        if (!controlIsActive())
            return next();
        // Every decision below is taken against the calling agent's own state.
        const agent = exec?.agent;
        const { orientation } = governance.forAgent(agent);
        const classification = classifyMutation(exec.name, exec.arguments, config.workspace);
        if (classification.kind === 'read-only') {
            return next();
        }
        // Gate F: a resumed, forked, or restarted session must not be asked to
        // re-establish orientation it has already declared. One lookup per session,
        // restored into this agent's own store.
        await hydrateOrientation(agent);
        // Precedence: a protected path is refused outright, then the orientation
        // requirement, then the configured workspace policy. The requirement is a
        // process step, so it denies rather than asking the user.
        if (classification.protected) {
            const protectedDecision = decideMutation(classification, config.workspace);
            note('ieg.workspace_mutation_blocked', { tool: exec.name, reason: 'protected', agentId: agentIdOf(agent) }, `ieg: workspace_mutation_blocked tool=${exec.name} reason=protected`);
            return protectedDecision;
        }
        const orientationDecision = orientationRequirement(classification, config.preStep, orientation);
        if (orientationDecision !== null) {
            note('ieg.orientation_required', { tool: exec.name, agentId: agentIdOf(agent) }, `ieg: orientation_required tool=${exec.name}`);
            return orientationDecision;
        }
        // OBJ-2: refuse to let a new document duplicate an existing one. This runs
        // before the workspace policy so its more specific reason wins, and it
        // fails open — a heuristic must never break a call.
        // `ctx.get` is used deliberately: a direct `ctx.fs` accessor throws when the
        // filesystem service is absent, whereas `get` returns undefined and lets the
        // check degrade to "no overlap".
        const fsService = ctx.get?.('fs');
        const overlapDecision = await checkDocumentOverlap({
            fs: fsService,
            execution: exec,
            mode: config.workspace.overlapCheck,
        });
        if (overlapDecision !== null) {
            const outcome = overlapDecision.kind === 'deny' ? 'blocked' : 'gated';
            note('ieg.document_overlap_flagged', { tool: exec.name, outcome, agentId: agentIdOf(agent) }, `ieg: document_overlap_${outcome} tool=${exec.name}`);
            return overlapDecision;
        }
        const decision = decideMutation(classification, config.workspace);
        if (decision.kind === 'allow') {
            note('ieg.workspace_mutation_allowed', {
                tool: exec.name,
                targets: classification.targets,
                agentId: agentIdOf(agent),
            });
            return next();
        }
        const outcome = decision.kind === 'deny' ? 'blocked' : 'gated';
        note('ieg.workspace_mutation_blocked', { tool: exec.name, outcome, targets: classification.targets, agentId: agentIdOf(agent) }, `ieg: workspace_mutation_${outcome} tool=${exec.name} targets=${classification.targets.join(',') || '-'}`);
        return decision;
    };
    guarded('tools/pre-execute', () => {
        ctx.on('tools/pre-execute', onPreExecute);
    });
    /* ── 4. tool registry: the orientation tool and the guard backstop ────── */
    // Registered through `ctx.inject` so they attach whenever the tool registry
    // becomes available, without making IEG unmountable in tool-less compositions.
    const attachTools = (toolCtx) => {
        /**
         * Wrap a tool so its calls are auditable without changing its contract.
         *
         * @param definition
         * @param code
         */
        const observed = (definition, code) => ({
            ...definition,
            execute: async (args, exec) => {
                const result = await definition.execute(args, exec);
                note(code, { tool: definition.name, agentId: agentIdOf((exec ?? {}).agent) });
                return result;
            },
        });
        // Each tool is registered in its own guarded step: a registry that refuses
        // one definition must not cost the model the other tool, nor the backstop.
        // The agent's only sanctioned way to satisfy the orientation requirement.
        // Recording it also persists it, so a resumed session skips the requirement.
        guarded('tools.record_orientation', () => {
            toolCtx.tools?.register(observed(orientationToolDefinition((exec) => governance.forAgent((exec ?? {}).agent).orientation, {
                onRecorded: persistOrientation,
            }), 'ieg.orientation_recorded'));
        });
        // Channel B (§28.3): the read-only surface an agent or operator can query.
        guarded('tools.ieg_status', () => {
            toolCtx.tools?.register({
                name: STATUS_TOOL_NAME,
                description: 'Read IEG governance state: mount record, enabled modules, active configuration, host-compatibility verdict, and the recent diagnostic ring. Read-only; call it when you need to know what the governance layer is doing.',
                parameters: { type: 'object', properties: {} },
                output: { schema: { type: 'object' }, render: renderJson },
                execute: async (_args, exec) => ({
                    mount,
                    control: {
                        status: refreshControl(),
                        generation: control.generation,
                        stateFile: controlPaths.stateFile,
                        promptFile: controlPaths.promptFile,
                        promptSource: kernel.promptSource,
                    },
                    compatibility: mount.compatibility,
                    agentId: agentIdOf((exec ?? {}).agent),
                    status_line: diagnostics.formatLine(),
                    diagnostics: diagnostics.recent(20),
                    diagnostic_counts: diagnostics.counts(),
                }),
            });
        });
        const guard = (execution) => guardBackstop(execution, config.workspace);
        guarded('tools.guard', () => {
            toolCtx.tools?.guard(guard);
        });
    };
    if (ctx.inject === undefined) {
        // No injection seam means no capture surfaces at all; that is a degradation
        // to record, not a quiet no-op.
        noteMissing('tools');
    }
    else {
        guarded('tools', () => {
            ctx.inject?.(['tools'], attachTools);
        });
    }
    /* ── 5. mount record ──────────────────────────────────────────────────── */
    // Emitted as late as possible, so a partially registered plugin is visible as
    // a partially registered plugin (Part B §26.1).
    note('ieg.mount', {
        modules: enabled.map((module) => module.id),
        promptVersion: kernel.promptVersion,
        promptOverridden: kernel.promptOverridden,
        promptBytes: stats.bytes,
    }, `ieg: governance mounted modules=${enabled.map((module) => module.id).join(',')} ` +
        `section=${SECTION_NAME}@${config.sectionOrder} bytes=${stats.bytes} ` +
        `workspace=${config.workspace.policy} gate=${config.preStep.orientationGate}`);
    // The mount records exist only now, and the throttle would otherwise suppress
    // them: flush once, here, so a mirror reader never sees an empty ring.
    guarded('diagnosticsExport.mount', () => {
        exporter.flush(true);
    });
    if (config.diagnostics) {
        // Best effort, like every other narration call: the ring and the status
        // surface already carry this, and a logger fault must not unmount IEG.
        try {
            for (const [key, value] of Object.entries(registry.diagnostics())) {
                if (Array.isArray(value) && value.length > 0)
                    ctx.logger?.info(`ieg: ${key}=${value.join(',')}`);
            }
        }
        catch {
            // Deliberately swallowed.
        }
    }
}
export { resolveConfig, createRegistry, compilePrompt, createProjectState, evaluateOrientationGate, classifyMutation, decideMutation, guardBackstop, };
