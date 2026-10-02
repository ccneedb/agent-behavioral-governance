/**
 * Agent Behavioral Governance (ABG) — Cordis plugin entry.
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

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { resolveConfig, DEFAULT_SECTION_ORDER } from './kernel/config.js'
import { createRegistry } from './kernel/registry.js'
import { compilePrompt, promptStats, utf8Bytes } from './kernel/prompt-compiler.js'
import { composePromptOverride } from './kernel/prompt-override.js'
import { createDiagnosticsExporter } from './kernel/export.js'
import { MAX_REQUEST_BYTES, planPromptEdit, promptEditorState, submitFeedback } from './kernel/gui-actions.js'
import { projectGovernanceModule, createProjectState, evaluateOrientationGate } from './modules/project-governance.js'
import { informationIntegrityModule } from './modules/information-integrity.js'
import { userAttentionModule, createQuestionCollector } from './modules/user-attention.js'
import {
  workspaceGovernanceModule,
  classifyMutation,
  decideMutation,
  guardBackstop,
} from './modules/workspace-governance.js'
import {
  ORIENTATION_TOOL_NAME,
  orientationRequirement,
  orientationToolDefinition,
} from './kernel/orientation.js'
import { checkDocumentOverlap } from './kernel/overlap.js'
import {
  batchCompletenessRequirement,
  questionToolDefinition,
  questionsToolDefinition,
  recordSubmittedBatch,
} from './kernel/questions.js'
import { createDiagnostics } from './kernel/diagnostics.js'
import { FEEDBACK_TOOL_NAME, feedbackToolDefinition } from './kernel/feedback.js'
import { createCompatibilityAdapter, DEFAULT_BASELINE } from './kernel/compatibility.js'
import { createGovernanceState, agentIdOf } from './kernel/state.js'
import { createDurableStore, sessionIdOf } from './kernel/durability.js'

/** Cordis plugin name. */
export const name = 'abg'

/**
 * ABG's core contribution is the prompt section, so it mounts where the prompt
 * registry exists. Tool seams attach defensively, so a composition
 * without them still gets policy and orientation behaviour.
 */
export const inject = ['systemPrompt']

/** The single ABG section name. Occupies no host-reserved name. */
export const SECTION_NAME = 'abg:governance'

/** The runtime-context channel that carries the governance status line. */
export const STATUS_CONTEXT_NAME = 'abg:status'

/** The read-only tool that reports governance state to the model and operator. */
export const STATUS_TOOL_NAME = 'abg_status'

/**
 * The read-only JSON route the Web GUI panel reads (the same payload as
 * `abg_status` and the diagnostics mirror). Registered on the deployment's own
 * web server under the browser-trust fence, and only when one is mounted.
 */
export const STATUS_ROUTE_PATH = '/api/abg/status'

/** The prompt-editor write route (POST `{ text }`). Enabled only for `prompt.mode: replace`. */
export const PROMPT_ROUTE_PATH = '/api/abg/prompt'

/** The feedback-form write route (POST `{ summary, expected, actual, file? }`). */
export const FEEDBACK_ROUTE_PATH = '/api/abg/feedback'

/**
 * Version of the compiled governance prompt. It changes whenever the injected
 * model-facing text changes, so a behavioural regression is attributable to one
 * prompt revision (ARCHITECTURE-SPEC Part B §22.3, PRODUCT-SPEC PR-07).
 */
export const PROMPT_VERSION = '0.2.0'

/**
 * Version of the plugin package, kept in step with `package.json` `version`.
 * Declared here so a feedback report can name the build it came from without the
 * plugin reading the filesystem at runtime.
 */
export const PLUGIN_VERSION = '0.5.0'

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
  'This governance layer supplements the host instructions; it never replaces them and never outranks a direct user instruction.',
  'Prefer a safe refusal over an action the user has not authorized.',
  'Unresolved uncertainty may persist unless proceeding would be unsafe.',
  'Diagnose before acting destructively, and report the blocking condition in project terms rather than implementation detail.',
])

/**
 * The four failure classes of PRODUCT-SPEC §2. Success criterion #2 requires
 * each to be represented; every class must be claimed by at least one enabled
 * module, which the prompt-conformance test enforces.
 */
export const FAILURE_CLASSES = Object.freeze([
  'FC-2.1', // project ownership and semantic drift
  'FC-2.2', // unauthorized workspace mutation
  'FC-2.3', // reuse of known-invalid information
  'FC-2.4', // fragmented user questioning
])

/** The four shipped modules, in registration order. */
export const MODULES = Object.freeze([
  projectGovernanceModule,
  informationIntegrityModule,
  userAttentionModule,
  workspaceGovernanceModule,
])

/**
 * Build the governance kernel: validated config, registered modules, and the
 * compiled prompt section. Pure — no Cordis context required — so it is directly
 * unit-testable.
 *
 * @param {unknown} [raw]
 * @param {{ overrideText?: string }} [options] - replacement text for `prompt.mode: replace`.
 * @returns {{
 *   config: AbgConfig,
 *   registry: ReturnType<typeof createRegistry>,
 *   enabled: readonly GovernanceModule[],
 *   prompt: string,
 *   stats: { bytes: number, characters: number, lines: number },
 *   promptIssues: string[],
 *   promptOverridden: boolean,
 *   promptUnchecked: string[],
 *   promptVersion: string,
 *   compiledBytes: number,
 *   compiledPrompt: string,
 * }}
 */
export function buildGovernance(raw, options = {}) {
  const config = resolveConfig(raw)
  const registry = createRegistry()
  for (const module of MODULES) registry.registerModule(module)
  registry.configure(config.modules)

  const enabled = registry.getEnabledModules()
  const basePrompt = config.enabled ? compilePrompt({ kernelPrinciples: KERNEL_PRINCIPLES, modules: enabled }) : ''
  const composed = config.enabled
    ? composePromptOverride({
        mode: config.prompt.mode,
        append: config.prompt.append,
        overrideText: options.overrideText,
        basePrompt,
        allowOverBudget: config.prompt.allowOverBudget,
      })
    : { text: '', applied: false, versionSuffix: '', issues: [], unchecked: [] }

  return {
    config,
    registry,
    enabled,
    prompt: composed.text,
    stats: promptStats(composed.text),
    /** Why a user prompt edit was refused or ignored; surfaced as diagnostics on mount. */
    promptIssues: composed.issues,
    promptOverridden: composed.applied,
    /** Soft invariants that no longer apply once the text is user-authored. */
    promptUnchecked: composed.unchecked,
    /** `PROMPT_VERSION`, suffixed when a user edit is in force, so one text is one version. */
    promptVersion: `${PROMPT_VERSION}${composed.versionSuffix}`,
    /** Bytes of the audited compiled default, for a diff in any front end. */
    compiledBytes: promptStats(basePrompt).bytes,
    /** The audited compiled text, which every override is validated against. */
    compiledPrompt: basePrompt,
  }
}

/**
 * Mount the observable surface of ABG when the kernel cannot be built.
 *
 * `ARCHITECTURE-SPEC` §26.2: `apply()` must not throw, because the host reports a
 * throwing entry as `warning: N entry did not activate` and continues without the
 * plugin. A governance layer that fails to mount must at least be **visible**, so
 * this path registers no prompt section and no enforcement, and exposes the fault
 * through the read-only status surface instead. Fail-safe, and observable: an
 * operator reading only the transcript can tell that ABG is inert and why.
 *
 * @param {AbgContext} ctx
 * @param {unknown} error
 * @returns {void}
 */
function mountConfigFaultSurface(ctx, error) {
  const message = error instanceof Error ? error.message : String(error)
  try {
    const diagnostics = createDiagnostics({ limit: 200 })
    diagnostics.record({ code: 'abg.config_invalid', data: { message } })
    /** Seams that are absent even for the fault surface itself. @type {string[]} */
    const degraded = []
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
    }

    if (ctx.systemPrompt === undefined) {
      degraded.push('systemPrompt')
    } else {
      try {
        ctx.systemPrompt.context?.({
          name: STATUS_CONTEXT_NAME,
          order: DEFAULT_SECTION_ORDER,
          text: () => diagnostics.formatLine(),
        })
      } catch {
        // The tool and the log line below still carry the fault.
      }
    }

    if (ctx.inject === undefined) {
      degraded.push('tools')
    } else {
      ctx.inject(['tools'], (toolCtx) => {
        try {
          toolCtx.tools?.register({
            name: STATUS_TOOL_NAME,
            description:
              'Read ABG governance state. Read-only. A mount record with "mounted: false" and a configError means the governance layer is inert: no ABG prompt section and no ABG enforcement is active.',
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'object' }, render: () => [] },
            execute: async () => ({
              mount,
              status_line: diagnostics.formatLine(),
              diagnostics: diagnostics.recent(20),
            }),
          })
        } catch {
          // A registry that refuses the tool must not resurrect the mount fault.
        }
      })
    }

    try {
      ctx.logger?.warn(`abg: config_invalid ${message}`)
    } catch {
      // Log narration is best effort by design (§28.3 channel D).
    }
  } catch {
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
 *
 * @param {unknown} rawConfig
 * @returns {{ text?: string, issue?: string }}
 */
function readPromptOverride(rawConfig) {
  if (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig)) return {}
  const prompt = /** @type {{ prompt?: unknown }} */ (rawConfig).prompt
  if (typeof prompt !== 'object' || prompt === null || Array.isArray(prompt)) return {}
  const { mode, file } = /** @type {{ mode?: unknown, file?: unknown }} */ (prompt)
  if (mode !== 'replace' || typeof file !== 'string' || file.trim() === '') return {}
  try {
    return { text: readFileSync(file, 'utf8') }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { issue: `prompt.file could not be read (${message}); the compiled default is in use` }
  }
}

/**
 * Persist a prompt override so the panel's "applied" means durable.
 *
 * Written to a temporary sibling and renamed, so a reader (the next process
 * start, or an editor) never observes a half-written prompt.
 *
 * @param {string} path
 * @param {string} text
 * @returns {void}
 */
function writeTextFile(path, text) {
  const temporary = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

/**
 * Mount ABG.
 *
 * Contract (`ARCHITECTURE-SPEC` §26.2): **this function does not throw.**
 * Configuration faults degrade to a diagnostic, and each capability is
 * registered inside its own guarded step, so one failing seam cannot cost the
 * deployment the rest of the governance layer.
 *
 * @param {AbgContext} ctx
 * @param {unknown} [rawConfig]
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  /** @type {ReturnType<typeof buildGovernance>} */
  let kernel
  let overrideIssue = ''
  try {
    const override = readPromptOverride(rawConfig)
    if (override.issue !== undefined) overrideIssue = override.issue
    kernel = buildGovernance(rawConfig, { overrideText: override.text })
  } catch (error) {
    mountConfigFaultSurface(ctx, error)
    return
  }

  const { config, registry, enabled, prompt, stats } = kernel

  if (!config.enabled) {
    try {
      ctx.logger?.info('abg: governance disabled by configuration')
    } catch {
      // Best-effort narration only.
    }
    return
  }

  // Governance state is per live agent, keyed by the agent object itself
  // (ARCHITECTURE-SPEC §17.7, Part B §25). One composition therefore serves many
  // agents without letting them observe each other's orientation or questions.
  const governance = createGovernanceState()

  /* ── observability (Part B §28) ───────────────────────────────────────── */

  // The ring always records: it is bounded, in-memory, and cheap, and the
  // read-only status surface must work even when log narration is switched off.
  // `config.diagnostics` gates only the `ctx.logger` narration, because that is
  // the channel that is invisible in stock compositions anyway (§28.1).
  const diagnostics = createDiagnostics({ limit: 200 })

  /**
   * Capabilities whose registration failed or whose seam was absent. Empty means
   * a complete mount. `mounted: true` alone cannot distinguish a full mount from a
   * partial one, so this is what an external health check must key on (§26.1).
   * @type {string[]}
   */
  const degradedCapabilities = []

  /** Mount facts reported by the status tool and the status line. */
  const mount = /** @type {{
   *   mounted: boolean,
   *   degraded: string[],
   *   promptVersion: string,
   *   promptOverridden: boolean,
   *   promptIssues: string[],
   *   compiledPromptBytes: number,
   *   sectionName: string,
   *   sectionOrder: number,
   *   promptBytes: number,
   *   modules: string[],
   *   moduleCount: number,
   *   compatibility: { verdict: string, reasons: string[], [key: string]: unknown },
   * }} */ ({
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
  })

  /**
   * The live prompt facts. The GUI editor mutates these, and the section text
   * provider, the status route and the feedback report all read them, so an edit
   * applies to the next assembly without a restart.
   */
  const promptState = {
    text: prompt,
    bytes: stats.bytes,
    overridden: kernel.promptOverridden,
    version: kernel.promptVersion,
    issues: [...kernel.promptIssues],
    unchecked: [...kernel.promptUnchecked],
  }

  /** Set once the exporter exists; `note()` calls it so every record can mirror. */
  let flushExport = () => {}

  /**
   * Record one diagnostic and, when narration is enabled, keep the historical
   * `ctx.logger` line byte-for-byte so existing behaviour and tests are stable.
   *
   * @param {string} code
   * @param {Record<string, unknown>} [data]
   * @param {string} [narration]
   * @param {'info' | 'warn'} [level]
   * @returns {void}
   */
  const note = (code, data, narration, level = 'info') => {
    diagnostics.record({ code, data })
    flushExport()
    if (!config.diagnostics || narration === undefined) return
    // Log narration is best effort (§28.3 channel D): a deployment with a broken
    // or absent logger must still get the ring, the status line, and the tools.
    try {
      if (level === 'warn') ctx.logger?.warn(narration)
      else ctx.logger?.info(narration)
    } catch {
      // Deliberately swallowed: narration must never affect enforcement.
    }
  }

  /**
   * Register one capability, degrading a failure to a diagnostic.
   *
   * `ARCHITECTURE-SPEC` §26.2 requires `apply()` not to throw: the host reports a
   * throwing entry as `warning: N entry did not activate` and continues without
   * ABG. Isolating each registration means one unavailable seam costs only that
   * seam, and the fault is recorded where the status surface can report it.
   *
   * @param {string} capability
   * @param {() => void} action
   * @returns {void}
   */
  const guarded = (capability, action) => {
    try {
      action()
    } catch (error) {
      degradedCapabilities.push(capability)
      const message = error instanceof Error ? error.message : String(error)
      note('abg.error', { capability, message }, `abg: ${capability} failed: ${message}`, 'warn')
    }
  }

  /**
   * Record a seam that is absent, which is not the same as a seam ABG does not
   * need: without this, a vanished host service is indistinguishable from a
   * capability that was never required.
   *
   * @param {string} capability
   * @returns {void}
   */
  const noteMissing = (capability) => {
    degradedCapabilities.push(capability)
    note('abg.capability_missing', { capability }, `abg: capability_missing ${capability}`, 'warn')
  }

  /* ── user-editable prompt (§27.1) ─────────────────────────────────────── */

  // A refused or ignored user edit is a governance event, not a silent fallback:
  // the deployment must be able to see that its text is not in force.
  for (const issue of kernel.promptIssues) {
    note('abg.prompt_override_rejected', { issue }, `abg: prompt_override_rejected ${issue}`, 'warn')
  }
  if (overrideIssue !== '') {
    note('abg.prompt_override_missing', { issue: overrideIssue }, `abg: prompt_override_missing ${overrideIssue}`, 'warn')
  }
  if (kernel.promptOverridden) {
    note(
      'abg.prompt_override_applied',
      { promptVersion: kernel.promptVersion, bytes: stats.bytes, unchecked: kernel.promptUnchecked },
      `abg: prompt_override_applied version=${kernel.promptVersion} bytes=${stats.bytes} ` +
        `unchecked=${kernel.promptUnchecked.length}`,
      'warn',
    )
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
    writeFile:
      config.diagnosticsExport.file === ''
        ? undefined
        : (path, text) => {
            mkdirSync(dirname(path), { recursive: true })
            const temporary = `${path}.tmp`
            writeFileSync(temporary, text)
            renameSync(temporary, path)
          },
    onError: (message) =>
      note('abg.diagnostics_export_failed', { message }, `abg: diagnostics_export_failed ${message}`, 'warn'),
  })
  if (exporter.file !== '') {
    flushExport = () => {
      exporter.flush()
    }
    guarded('diagnosticsExport', () => {
      exporter.flush(true)
    })
    guarded('diagnosticsExport.mount', () => {
    // The setup flush happens before the mount records exist, and the throttle
    // then suppresses them, so the mirror would otherwise show an empty ring.
    exporter.flush(true)
  })
  guarded('dispose.diagnosticsExport', () => {
      ctx.effect?.(() => () => {
        exporter.close()
      }, 'abg: stop mirroring diagnostics')
    })
  }

  /* ── compatibility adapter (Part B §29) ───────────────────────────────── */

  // Observes the host's own assembly on the `system-prompt/assemble` waterfall.
  // The listener always calls `next()`: ABG never blocks or replaces an
  // assembly, so a host drift is reported, never enforced (fail open).
  const compatibility = createCompatibilityAdapter({
    baseline: DEFAULT_BASELINE,
    capabilities: () =>
      ['systemPrompt', 'tools', 'fs', 'storageDomain', 'userQuestions', 'approval'].filter(
        (name) => ctx.get?.(name) !== undefined,
      ),
    onVerdict: (result, snapshot) => {
      mount.compatibility = snapshot
      note('abg.host_compatibility', { verdict: result.verdict, reasons: result.reasons })
    },
  })

  guarded('system-prompt/assemble', () => {
    ctx.on('system-prompt/assemble', (assembly, context, next) => {
      try {
        compatibility.observe(assembly, context)
      } catch (error) {
        note('abg.error', { phase: 'compatibility', message: String(/** @type {any} */ (error)?.message ?? error) })
      }
      return next()
    })
  })

  /* ── durable state (handoff Gate F) ───────────────────────────────────── */

  // Storage is optional and every failure degrades to "no persistence"; ABG's
  // enforcement never depends on it. The fallback also covers a storage seam that
  // throws during construction, rather than only one that reports an error.
  /** @type {ReturnType<typeof createDurableStore>} */
  let durable = {
    available: async () => false,
    load: async () => undefined,
    save: async () => false,
    close: async () => {},
  }
  guarded('storageDomain', () => {
    durable = createDurableStore(ctx, {
      onError: (error) =>
        note(
          'abg.capability_missing',
          { capability: 'storageDomain' },
          `abg: governance persistence unavailable: ${/** @type {any} */ (error)?.message ?? error}`,
          'warn',
        ),
    })
  })
  /** Sessions already looked up, so a resumed session costs one read, not one per call. */
  const hydratedSessions = new Set()

  /**
   * Restore one agent's orientation from durable state. Called lazily, before
   * the orientation requirement is evaluated, so a resumed session is not asked
   * to re-orient work that was already oriented (Gate F).
   *
   * @param {unknown} agent
   * @returns {Promise<boolean>} whether a usable snapshot was restored.
   */
  const hydrateOrientation = async (agent) => {
    const { orientation } = governance.forAgent(agent)
    if (orientation.isRecorded()) return true
    const sessionId = sessionIdOf(agent)
    if (sessionId === '' || hydratedSessions.has(sessionId)) return false
    hydratedSessions.add(sessionId)
    const snapshot = await durable.load(sessionId)
    if (snapshot === undefined) return false
    if (!orientation.hydrate(snapshot)) return false
    note('abg.orientation_restored', { sessionId }, 'abg: orientation_restored')
    return true
  }

  /**
   * @param {Record<string, unknown>} snapshot
   * @param {unknown} exec
   * @returns {Promise<void>}
   */
  const persistOrientation = async (snapshot, exec) => {
    const agent = /** @type {{ agent?: unknown }} */ (exec ?? {}).agent
    await durable.save(sessionIdOf(agent), snapshot)
  }

  guarded('dispose.storageDomain', () => {
    ctx.effect?.(() => () => {
      void durable.close()
    }, 'abg: release the governance domain handle')
  })

  /* ── 1. the one additive prompt section ───────────────────────────────── */

  // `interpolate: false` is mandatory: governance text is literal, and the host
  // would otherwise throw on an unknown `{{variable}}` reference. `complete` is
  // deliberately never set (§4).
  if (ctx.systemPrompt === undefined) {
    // `inject` declares this seam as required, so its absence is a host-contract
    // breach that must be visible rather than a silently empty contribution.
    noteMissing('systemPrompt')
  } else {
    guarded('systemPrompt.section', () => {
      ctx.systemPrompt?.section({
        name: SECTION_NAME,
        order: config.sectionOrder,
        interpolate: false,
        // A function-valued provider is re-evaluated per assembly, which is what
        // lets a GUI edit take effect on the next step.
        text: () => promptState.text,
      })
    })

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
        })
      })
    }
  }

  /* ── 2. pre-step orientation gate ─────────────────────────────────────── */

  /**
   * @param {AbgPreStepPayload} payload
   * @param {() => Promise<AbgPreStepDecision>} next
   * @returns {Promise<AbgPreStepDecision>}
   */
  const onPreStep = async (payload, next) => {
    // The step's own agent decides which orientation is evaluated.
    const agent = payload?.agent
    const { orientation } = governance.forAgent(agent)
    const { decision, missing } = evaluateOrientationGate(orientation.state(), config.preStep.orientationGate)
    if (decision !== null) {
      note(
        'abg.orientation_required',
        { phase: 'pre-step', missing, agentId: agentIdOf(agent) },
        `abg: pre_step_rejected missing=${missing.join(',')} agent=${agentIdOf(agent) || '-'}`,
        'warn',
      )
      return decision
    }
    if (config.preStep.orientationGate === 'warn' && missing.length > 0) {
      note(
        'abg.orientation_required',
        { phase: 'pre-step', outcome: 'warn', missing },
        `abg: orientation_incomplete missing=${missing.join(',')}`,
      )
    }
    return next()
  }
  guarded('agent/pre-step', () => {
    ctx.on('agent/pre-step', onPreStep)
  })

  /* ── 3. mutation gate: tools/pre-execute ──────────────────────────────── */

  /**
   * @param {AbgToolExecution} exec
   * @param {() => Promise<AbgPreToolDecision>} next
   * @returns {Promise<AbgPreToolDecision>}
   */
  const onPreExecute = async (exec, next) => {
    // Every decision below is taken against the calling agent's own ledgers.
    const agent = exec?.agent
    const { orientation, questions } = governance.forAgent(agent)

    // user-attention observation: how many questions one interaction carried.
    // This is the batch-size input to the §7 evaluation metrics. The host owns
    // the interaction; ABG only measures it.
    if (exec.name === 'ask_user_question') {
      const args = /** @type {{ questions?: unknown[] }} */ (exec.arguments ?? {})
      const count = Array.isArray(args.questions) ? args.questions.length : 0
      note(
        'abg.question_submitted',
        { questions: count, agentId: agentIdOf(agent) },
        `abg: question_submitted questions=${count}`,
      )
    }

    // Criterion #3: batching is backed by the ledger's explicit state, so a batch
    // that leaves registered questions behind is refused. This runs before the
    // read-only early return because `ask_user_question` is not a mutation.
    const batchDecision = batchCompletenessRequirement(exec, questions, config.userAttention)
    if (batchDecision !== null) {
      note(
        'abg.question_batch_blocked',
        { tool: exec.name, agentId: agentIdOf(agent) },
        `abg: question_batch_blocked tool=${exec.name}`,
      )
      return batchDecision
    }

    const classification = classifyMutation(exec.name, exec.arguments, config.workspace)
    if (classification.kind === 'read-only') {
      const decision = await next()
      // Only retire the questions once the host has actually accepted the batch.
      if (decision.kind === 'allow') recordSubmittedBatch(exec, questions)
      return decision
    }

    // Gate F: a resumed, forked, or restarted session must not be asked to
    // re-establish orientation it has already declared. One lookup per session,
    // restored into this agent's own store.
    await hydrateOrientation(agent)

    // Precedence: a protected path is refused outright, then the orientation
    // requirement, then the configured workspace policy. The requirement is a
    // process step, so it denies rather than asking the user.
    if (classification.protected) {
      const protectedDecision = decideMutation(classification, config.workspace)
      note(
        'abg.workspace_mutation_blocked',
        { tool: exec.name, reason: 'protected', agentId: agentIdOf(agent) },
        `abg: workspace_mutation_blocked tool=${exec.name} reason=protected`,
      )
      return protectedDecision
    }

    const orientationDecision = orientationRequirement(classification, config.preStep, orientation)
    if (orientationDecision !== null) {
      note(
        'abg.orientation_required',
        { tool: exec.name, agentId: agentIdOf(agent) },
        `abg: orientation_required tool=${exec.name}`,
      )
      return orientationDecision
    }

    // OBJ-2: refuse to let a new document duplicate an existing one. This runs
    // before the workspace policy so its more specific reason wins, and it
    // fails open — a heuristic must never break a call.
    // `ctx.get` is used deliberately: a direct `ctx.fs` accessor throws when the
    // filesystem service is absent, whereas `get` returns undefined and lets the
    // check degrade to "no overlap".
    const fsService = /** @type {AbgFileSystemService | undefined} */ (ctx.get?.('fs'))
    const overlapDecision = await checkDocumentOverlap({
      fs: fsService,
      execution: exec,
      mode: config.workspace.overlapCheck,
    })
    if (overlapDecision !== null) {
      const outcome = overlapDecision.kind === 'deny' ? 'blocked' : 'gated'
      note(
        'abg.document_overlap_flagged',
        { tool: exec.name, outcome, agentId: agentIdOf(agent) },
        `abg: document_overlap_${outcome} tool=${exec.name}`,
      )
      return overlapDecision
    }

    const decision = decideMutation(classification, config.workspace)
    if (decision.kind === 'allow') {
      note('abg.workspace_mutation_allowed', {
        tool: exec.name,
        targets: classification.targets,
        agentId: agentIdOf(agent),
      })
      return next()
    }

    const outcome = decision.kind === 'deny' ? 'blocked' : 'gated'
    note(
      'abg.workspace_mutation_blocked',
      { tool: exec.name, outcome, targets: classification.targets, agentId: agentIdOf(agent) },
      `abg: workspace_mutation_${outcome} tool=${exec.name} targets=${classification.targets.join(',') || '-'}`,
    )
    return decision
  }
  guarded('tools/pre-execute', () => {
    ctx.on('tools/pre-execute', onPreExecute)
  })

  /* ── 4. tool registry: the orientation tool and the guard backstop ────── */

  // Registered through `ctx.inject` so they attach whenever the tool registry
  // becomes available, without making ABG unmountable in tool-less compositions.
  /**
   * @param {AbgContext} toolCtx
   * @returns {void}
   */
  const attachTools = (toolCtx) => {
    /**
     * Wrap a tool so its calls are auditable without changing its contract.
     *
     * @param {AbgToolDefinition} definition
     * @param {string} code
     * @returns {AbgToolDefinition}
     */
    const observed = (definition, code) => ({
      ...definition,
      execute: async (args, exec) => {
        const result = await definition.execute(args, exec)
        note(code, { tool: definition.name, agentId: agentIdOf(/** @type {any} */ (exec ?? {}).agent) })
        return result
      },
    })

    // Each tool is registered in its own guarded step: a registry that refuses
    // one definition must not cost the model the other three, nor the backstop.
    // The agent's only sanctioned way to satisfy the orientation requirement.
    // Recording it also persists it, so a resumed session skips the requirement.
    guarded('tools.record_orientation', () => {
      toolCtx.tools?.register(
        observed(
          orientationToolDefinition((exec) => governance.forAgent(/** @type {any} */ (exec ?? {}).agent).orientation, {
            onRecorded: persistOrientation,
          }),
          'abg.orientation_recorded',
        ),
      )
    })
    // The explicit state that makes batching enforceable (criterion #3).
    guarded('tools.record_question', () => {
      toolCtx.tools?.register(
        observed(
          questionToolDefinition((exec) => governance.forAgent(/** @type {any} */ (exec ?? {}).agent).questions),
          'abg.question_registered',
        ),
      )
    })
    // Channel B (§28.3): the read-only surface an agent or operator can query.
    guarded('tools.abg_status', () => {
      toolCtx.tools?.register({
        name: STATUS_TOOL_NAME,
        description:
          'Read ABG governance state: mount record, enabled modules, active configuration, host-compatibility verdict, and the recent diagnostic ring. Read-only; call it when you need to know what the governance layer is doing.',
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'object' }, render: () => [] },
        execute: async (_args, exec) => ({
          mount,
          compatibility: mount.compatibility,
          agentId: agentIdOf(/** @type {any} */ (exec ?? {}).agent),
          status_line: diagnostics.formatLine(),
          diagnostics: diagnostics.recent(20),
          diagnostic_counts: diagnostics.counts(),
        }),
      })
    })
    // The read-only question surface (§30.3): the model composes the batch.
    guarded('tools.abg_questions', () => {
      toolCtx.tools?.register(
        questionsToolDefinition((exec) => governance.forAgent(/** @type {any} */ (exec ?? {}).agent).questions),
      )
    })
    // Optional feedback channel (§28.6). Off only when a deployment says so: in
    // `url` mode it composes a prefilled issue link locally and makes no network
    // call, so the tester can file a redacted report in one step.
    if (config.feedback.enabled) {
      guarded(`tools.${FEEDBACK_TOOL_NAME}`, () => {
        toolCtx.tools?.register(
          feedbackToolDefinition({
            config: config.feedback,
            mount,
            diagnostics,
            pluginVersion: PLUGIN_VERSION,
            promptVersion: kernel.promptVersion,
          }),
        )
      })
    }

    /**
     * @param {AbgToolExecution} execution
     * @returns {string | undefined}
     */
    const guard = (execution) => guardBackstop(execution, config.workspace)
    guarded('tools.guard', () => {
      toolCtx.tools?.guard(guard)
    })
  }
  if (ctx.inject === undefined) {
    // No injection seam means no capture surfaces at all; that is a degradation
    // to record, not a quiet no-op.
    noteMissing('tools')
  } else {
    /* ── Web GUI routes (§28.8) ───────────────────────────────────────────── */

  // One read route (the same JSON shape as `abg_status` and the on-disk mirror)
  // and two write routes: the prompt editor and the feedback form. All three sit
  // under `/api`, behind the deployment's browser-trust fence, and are registered
  // in one guarded step. A headless composition has no such seam, which is an
  // optional capability and not a degradation — but the reason is recorded
  // in-band, because an `inject` that never fires leaves no trace at all.
  if (config.gui.enabled) {
    ctx.inject?.(['webServer'], (webCtx) => {
      const webServer = webCtx.webServer
      if (webServer === undefined) {
        noteMissing('webServer')
        return
      }

      /** The live mount view: prompt facts change when the editor writes. */
      const mountView = () => ({
        ...mount,
        promptBytes: promptState.bytes,
        promptVersion: promptState.version,
        promptOverridden: promptState.overridden,
        promptIssues: promptState.issues,
        compiledPromptBytes: kernel.compiledBytes,
      })

      /**
       * @param {AbgWebResponse} res
       * @param {number} status
       * @param {unknown} body
       */
      const sendJson = (res, status, body) => {
        // The route handler owns the response lifecycle: a client that already
        // went away must not turn into an unhandled exception in the host.
        try {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(`${JSON.stringify(body)}\n`)
        } catch {
          /* the response is already gone */
        }
      }

      /** Collect a bounded request body. Never leaves the request unread. */
      /**
       * @param {AbgWebRequest} req
       * @returns {Promise<string>}
       */
      const readBody = async (req) => {
        /** @type {{ length: number }[]} */
        const chunks = []
        let size = 0
        await new Promise((resolve, reject) => {
          req.on('data', (chunk) => {
            size += chunk.length
            if (size > MAX_REQUEST_BYTES) {
              reject(new Error(`request body exceeds ${MAX_REQUEST_BYTES} bytes`))
              req.destroy?.()
              return
            }
            chunks.push(chunk)
          })
          req.on('end', () => resolve(undefined))
          req.on('error', reject)
        })
        return Buffer.concat(chunks).toString('utf8')
      }

      /**
       * @param {AbgWebRequest} req
       * @returns {Promise<Record<string, unknown>>}
       */
      const jsonRequest = async (req) => {
        const raw = await readBody(req)
        if (raw.trim() === '') return {}
        return JSON.parse(raw)
      }

      guarded('webserver.routes', () => {
        /** @type {Array<() => void>} */
        const disposers = []
        /**
         * @param {string} path
         * @param {(req: AbgWebRequest, res: AbgWebResponse) => void} handler
         */
        const route = (path, handler) => {
          const dispose = webServer.register({ kind: 'exact', path, handler })
          if (typeof dispose === 'function') disposers.push(dispose)
          note('abg.gui_route_registered', { path, kind: 'exact' }, `abg: gui_route_registered path=${path}`)
        }

        // 1. Read: governance state, the prompt editor's view, and feedback mode.
        route(STATUS_ROUTE_PATH, (_req, res) => {
          sendJson(res, 200, {
            schema: 1,
            generatedAt: new Date().toISOString(),
            mount: mountView(),
            status_line: diagnostics.formatLine(),
            counts: diagnostics.counts(),
            diagnostics: diagnostics.recent(50),
            prompt: promptEditorState({ config, state: promptState }),
            feedback: {
              mode: config.feedback.mode,
              enabled: config.feedback.enabled,
              repository: config.feedback.repository,
              token_env_var: config.feedback.tokenEnvVar,
              can_file: config.feedback.mode === 'api',
            },
          })
        })

        // 2. Write: the prompt editor. Refusals are the same rules the file and
        //    the config obey, because they are the same kernel.
        route(PROMPT_ROUTE_PATH, (req, res) => {
          void (async () => {
            try {
              if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'use POST' })
                return
              }
              const payload = await jsonRequest(req)
              const plan = planPromptEdit({ config, basePrompt: kernel.compiledPrompt, text: payload.text })
              if (plan.status !== 200 || plan.composed === undefined) {
                sendJson(res, plan.status, plan.body)
                note(
                  'abg.prompt_override_rejected',
                  { source: 'gui', status: plan.status, issues: plan.body.issues ?? plan.body.error },
                  `abg: prompt_override_rejected source=gui status=${plan.status}`,
                  'warn',
                )
                return
              }

              // Persist first, then adopt: a panel that reports success must be
              // reporting a durable fact, not an in-memory one.
              writeTextFile(config.prompt.file, plan.composed.text)
              promptState.text = plan.composed.text
              promptState.bytes = utf8Bytes(plan.composed.text)
              promptState.overridden = true
              promptState.version = `${PROMPT_VERSION}${plan.composed.versionSuffix}`
              promptState.issues = plan.composed.issues
              promptState.unchecked = plan.composed.unchecked
              note(
                'abg.prompt_override_applied',
                {
                  source: 'gui',
                  promptVersion: promptState.version,
                  bytes: promptState.bytes,
                  unchecked: promptState.unchecked,
                },
                `abg: prompt_override_applied source=gui version=${promptState.version} bytes=${promptState.bytes}`,
                'warn',
              )
              sendJson(res, 200, { applied: true, ...promptEditorState({ config, state: promptState }) })
            } catch (error) {
              sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
            }
          })()
        })

        // 3. Write: the feedback form. Composition stays in the kernel, so the
        //    redaction tests cover the browser path too.
        route(FEEDBACK_ROUTE_PATH, (req, res) => {
          void (async () => {
            try {
              if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'use POST' })
                return
              }
              const payload = await jsonRequest(req)
              const result = await submitFeedback({
                config: config.feedback,
                mount: mountView(),
                diagnostics,
                pluginVersion: PLUGIN_VERSION,
                promptVersion: promptState.version,
                payload,
              })
              sendJson(res, result.status, result.body)
            } catch (error) {
              sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
            }
          })()
        })

        if (disposers.length > 0) {
          ctx.effect?.(() => () => {
            for (const dispose of disposers) dispose()
          }, 'abg: remove the GUI routes')
        }
      })
    })
  }

  guarded('tools', () => {
      ctx.inject?.(['tools'], attachTools)
    })
  }

  /* ── 5. mount record ──────────────────────────────────────────────────── */

  // Emitted as late as possible, so a partially registered plugin is visible as
  // a partially registered plugin (Part B §26.1).
  note(
    'abg.mount',
    {
      modules: enabled.map((module) => module.id),
      promptVersion: kernel.promptVersion,
      promptOverridden: kernel.promptOverridden,
      promptBytes: stats.bytes,
    },
    `abg: governance mounted modules=${enabled.map((module) => module.id).join(',')} ` +
      `section=${SECTION_NAME}@${config.sectionOrder} bytes=${stats.bytes} ` +
      `workspace=${config.workspace.policy} gate=${config.preStep.orientationGate}`,
  )
  if (config.diagnostics) {
    // Best effort, like every other narration call: the ring and the status
    // surface already carry this, and a logger fault must not unmount ABG.
    try {
      for (const [key, value] of Object.entries(registry.diagnostics())) {
        if (Array.isArray(value) && value.length > 0) ctx.logger?.info(`abg: ${key}=${value.join(',')}`)
      }
    } catch {
      // Deliberately swallowed.
    }
  }
}

export {
  resolveConfig,
  createRegistry,
  compilePrompt,
  createProjectState,
  evaluateOrientationGate,
  createQuestionCollector,
  classifyMutation,
  decideMutation,
  guardBackstop,
}
