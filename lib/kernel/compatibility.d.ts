/**
 * IEG kernel — host compatibility adapter (ARCHITECTURE-SPEC §29, PR-07).
 *
 * A DSH peer range is declared and enforced at install and profile startup, but
 * nothing observes whether the **running** host's prompt surface still matches
 * what IEG was verified against (§29.1). This module closes that gap without
 * depending on a version string — the installed `0.2.1-alpha.1` exposes no
 * plugin-facing version service (§29.2) — by observing the seam facts that would
 * actually change a decision:
 *
 * ```text
 * ordered section names            assembly.sections.map(s => s.name)
 * IEG section presence + position  index of 'ieg:governance'
 * host section text hash           stableHash of the non-IEG section texts
 * contexts / tools counts          assembly.contexts.length, assembly.tools.length
 * capability inventory             supplied by the composition (ctx.get)
 * ```
 *
 * **`AssembledSection` carries `name`, `text`, and `interpolate` — not `order`.**
 * The ordered name array *is* the resolved placement, which is exactly the drift
 * signal that matters (§29.3).
 *
 * **Fail-open.** A listener on the `system-prompt/assemble` expert waterfall must
 * call `next()`; the adapter observes only and never blocks or denies. Nothing
 * here ever throws into the assembly path — a compatibility probe must never be
 * able to break prompt assembly — so both `observe` and `classify` accept any
 * malformed input and degrade to `PENDING`.
 *
 * Zero runtime dependencies: only language built-ins (`Math`, `JSON`, `Set`,
 * `WeakMap`).
 */
/** Version of the baseline *format* (not of the host). Bump with a reviewed change. */
export declare const BASELINE_VERSION = 1;
/** The four compatibility verdicts. */
export type VerdictName = 'PENDING' | 'COMPATIBLE' | 'COMPATIBLE_WITH_WARNINGS' | 'UNSUPPORTED';
/** Every verdict `classify` can return, in escalation order. */
export declare const VERDICTS: readonly VerdictName[];
/**
 * IEG's single prompt section. Kept here — rather than imported from the plugin
 * entry — so the kernel stays dependency-free and the compatibility rules can
 * name the section without a cycle.
 */
export declare const IEG_SECTION_NAME = "ieg:governance";
/** One observation of the running host's prompt surface. */
export interface CompatibilityObservation {
    /** the ordered resolved section names */
    sectionNames?: string[];
    /** hash of the non-IEG section texts */
    hostPromptHash?: string | null;
    sectionCount?: number;
    contextCount?: number;
    toolCount?: number;
    /** host services the composition can see */
    capabilities?: string[];
}
/** The reviewed baseline a snapshot is judged against. */
export interface CompatibilityBaseline {
    /** baseline format version */
    version?: number;
    /** the DSH release the baseline was captured against */
    hostVersion?: string;
    /** the expected ordered section names */
    sectionNames?: string[];
    /** the expected hash of the non-IEG section texts */
    hostPromptHash?: string | null;
    /** capabilities IEG requires of the host */
    capabilities?: string[];
    /** capabilities whose absence only warns */
    optionalCapabilities?: string[];
    /** optional expected context count (stricter baselines) */
    contextCount?: number;
    /** optional expected tool count (stricter baselines) */
    toolCount?: number;
}
/** The verdict and the reasons that produced it. */
export interface CompatibilityVerdict {
    verdict: VerdictName;
    reasons: string[];
}
/** The adapter's retained account of the last material observation. */
export interface CompatibilitySnapshot {
    verdict: VerdictName;
    reasons: string[];
    sectionNames: string[];
    /** index of `ieg:governance`, or -1 when absent */
    iegIndex: number;
    hostPromptHash: string | null;
    /** material observations recorded so far */
    assemblyCount: number;
    /** ISO timestamp (or the injected clock value) */
    observedAt: string | null;
}
/**
 * Deterministic FNV-1a 32-bit hash rendered as 8 lowercase hex digits.
 *
 * Chosen because it is short enough to read in a diagnostic and needs no
 * dependency. It is a **drift signal**, not a security primitive: the baseline
 * test only needs "same text → same hash, different text → different hash with
 * overwhelming probability" for prompt-sized inputs.
 *
 * @param text
 * @returns 8 lowercase hex digits, e.g. `ceb63ee5`
 */
export declare function stableHash(text: unknown): string;
/**
 * The committed baseline, mirroring `lib/compatibility-baseline.json` exactly.
 *
 * Captured by `scripts/capture-baseline.mjs` against the installed
 * `@deepseek-ai/dsh` `0.2.1-alpha.1` with a minimal real composition (the prompt
 * registry, the tool registry, and IEG's own section). Section *texts* are not
 * recorded: only the ordered names and the hash of the non-IEG texts, so IEG's
 * own prompt wording can evolve without a baseline update.
 *
 * `hostPromptHash` is `stableHash` of `harness:identity`'s text plus the two
 * empty persona sections, joined with `\n` in resolved order.
 *
 * `capabilities` names the host service IEG actually requires (`systemPrompt`,
 * its `inject` dependency — §29.4's "capability set for the declared host
 * version"). Tools, filesystem, storage, and approval are optional seams and
 * are deliberately not required here.
 */
export declare const DEFAULT_BASELINE: Readonly<{
    version: 1;
    hostVersion: "0.2.1-alpha.1";
    sectionNames: readonly string[];
    hostPromptHash: "ceb63ee5";
    capabilities: readonly string[];
}>;
/**
 * Compare one observation with one baseline and produce a §29.4 verdict.
 *
 * ```text
 * COMPATIBLE                 every expected fact matches
 * COMPATIBLE_WITH_WARNINGS   non-critical drift: new optional sections/contexts/
 *                            tools, or a changed host prompt hash
 * UNSUPPORTED                a required section is missing, the IEG section is
 *                            absent or displaced, or a required capability is absent
 * PENDING                    no baseline or no usable observation yet
 * ```
 *
 * Displacement is measured against the **baseline-required** sections only: a new
 * optional section inserted before `ieg:governance` is a warning, while IEG moving
 * relative to its baseline neighbours is unsupported. That keeps the two §29.4
 * rules from contradicting each other.
 *
 * Never throws. A malformed baseline or observation yields `PENDING`, and any
 * unexpected failure degrades to `PENDING` with the failure named in `reasons`.
 *
 * @param input `{ observed?: CompatibilityObservation, baseline?: CompatibilityBaseline }`
 * @returns the verdict and its reasons.
 */
export declare function classify(input: unknown): CompatibilityVerdict;
/** Options for {@link createCompatibilityAdapter}. */
export interface CompatibilityAdapterOptions {
    /** the baseline to judge against (default {@link DEFAULT_BASELINE}; pass `null` to report `PENDING`). */
    baseline?: unknown;
    /** a capability inventory, or a provider returning one. */
    capabilities?: readonly string[] | (() => readonly string[] | undefined);
    /** injectable clock (`() => Date | number | string`) for tests. */
    now?: () => unknown;
    /** called once per material observation, never for a debounced repeat. */
    onVerdict?: (result: CompatibilityVerdict, snapshot: CompatibilitySnapshot) => void;
}
/** The §29 compatibility adapter's public surface. */
export interface CompatibilityAdapter {
    observe(assembly: unknown, context?: unknown): CompatibilitySnapshot;
    snapshot(): CompatibilitySnapshot;
    verdict(): VerdictName;
}
/**
 * Create the §29 compatibility adapter.
 *
 * Wire it as an observing waterfall listener that **always calls `next()`**:
 *
 * ```js
 * const compatibility = createCompatibilityAdapter({
 *   capabilities: () => ['systemPrompt', 'tools'].filter((name) => ctx.get?.(name) !== undefined),
 * })
 * ctx.on('system-prompt/assemble', (assembly, context, next) => {
 *   compatibility.observe(assembly, context) // never throws, never blocks
 *   return next()
 * })
 * ```
 *
 * Options:
 * - `baseline` — the baseline to judge against (default {@link DEFAULT_BASELINE};
 *   pass `null` to report `PENDING`).
 * - `capabilities` — a capability inventory, or a provider returning one. When
 *   omitted the inventory is unknown, so required capabilities are reported as
 *   unverified rather than absent.
 * - `now` — injectable clock (`() => Date | number | string`) for tests.
 * - `onVerdict` — called once per **material** observation (first assembly per
 *   scope, then each shape change), never for a debounced repeat.
 *
 * @param options
 * @returns the compatibility adapter.
 */
export declare function createCompatibilityAdapter(options?: CompatibilityAdapterOptions): CompatibilityAdapter;
