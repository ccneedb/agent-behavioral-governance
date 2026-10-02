/**
 * ABG seam contract — the exact slice of the DeepSeek Harness runtime this
 * plugin depends on.
 *
 * This file is a **global script declaration file**: it has no imports and no
 * exports, so every type below is ambient and visible to all of `lib/`. It also
 * doubles as the auditable record of which host seams ABG binds to, and with
 * what shape — so the package typechecks without resolving any first-party
 * package.
 *
 * Every member was verified against the installed distribution
 * `@deepseek-ai/dsh` `0.2.0-rc.2`. See `ARCHITECTURE-SPEC-AGENT-REFERENCE.md`
 * §17 for the citations.
 */

/* ────────────────────────────── host: logging ────────────────────────────── */

/** Cordis logger surface (subset). */
interface AbgLogger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
}

/* ───────────────────────── host: system-prompt seam ──────────────────────── */

/**
 * The per-assembly context handed to a section text provider. Merge-extended by
 * `@deepseek-ai/dsh-agent` to carry `agent`, so one ABG section can render
 * per-agent governance prose (verified: `AssembleContext.agent?: Agent`).
 */
interface AbgAssembleContext {
  agent?: unknown
  scope?: unknown
}

/**
 * One contributed prompt section. `complete` must never be set by ABG: a single
 * effective complete section replaces the whole assembled prompt, and two make
 * assembly fail.
 */
interface AbgPromptSection {
  name: string
  order: number
  text: string | ((context: AbgAssembleContext) => string)
  interpolate?: boolean
  complete?: boolean
}

/**
 * One registered dynamic runtime context. The host materialises it as a durable
 * user-role snapshot, which is what makes it usable as ABG's operator-visible
 * governance status line (ARCHITECTURE-SPEC §17.2, Part B §28.3 channel A).
 */
interface AbgPromptContext {
  name: string
  order: number
  text: string | ((context: AbgAssembleContext) => string)
}

/**
 * One section of an assembly, with its text resolved. The host's
 * `AssembledSection` carries `name`, `text`, and `interpolate` — **not** `order`,
 * so the array position is the resolved placement (ARCHITECTURE-SPEC §29.3).
 */
interface AbgAssembledSection {
  name: string
  text: string
  interpolate?: boolean
}

/** One assembly as the `system-prompt/assemble` waterfall observes it. */
interface AbgPromptAssembly {
  sections: AbgAssembledSection[]
  contexts?: ReadonlyArray<{ name: string, text: string }>
  tools?: readonly unknown[]
  variables?: Record<string, string | undefined>
}

/** `ctx.systemPrompt` surface (subset). */
interface AbgSystemPromptService {
  section(section: AbgPromptSection): () => void
  context?(context: AbgPromptContext): () => void
  getSectionOrder?(name: string): number
  getContextOrder?(name: string): number
}

/* ───────────────────────── host: tool enforcement seam ───────────────────── */

/**
 * One pending tool call as an enforcement listener sees it. Read-only: the host
 * excludes argument rewriting because arguments are already logged and shown.
 */
interface AbgToolExecution {
  name: string
  arguments: unknown
  agent?: unknown
  callId?: string
}

/**
 * Pre-dispatch decision. `ask` is resolved by the tool registry through
 * `ctx.approval`; with no approval channel the host degrades `ask` to denial.
 */
type AbgPreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string }

/**
 * Tool-owned canonical output contract. `schema` is enforced against every
 * successful return value, and `render` projects it to model content.
 */
interface AbgToolOutputDefinition {
  schema: unknown
  render(args: unknown, value: unknown): unknown[]
}

/**
 * A registered model-facing tool. `execute` returns only the canonical lossless
 * JSON value declared by `output.schema`.
 */
interface AbgToolDefinition {
  name: string
  description: string
  parameters: unknown
  output: AbgToolOutputDefinition
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** `ctx.tools` surface (subset). */
interface AbgToolRuntimeService {
  guard(guard: (execution: AbgToolExecution) => string | undefined): () => void
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  register(definition: AbgToolDefinition): () => void
}

/* ───────────────────────── host: pre-step seam ───────────────────────────── */

/**
 * Either reject the proposed step or enter it with (possibly replaced) messages.
 * Returning `reject` ends the turn with the durable reason `blocked`.
 */
type AbgPreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }

/** Payload of `agent/pre-step` (scope-filtered waterfall). */
interface AbgPreStepPayload {
  agent: unknown
  messages: unknown[]
  turn: number
  step: number
  signal?: unknown
}

/* ─────────────────────── host: filesystem (read only) ────────────────────── */

/** One child of a listed directory. */
interface AbgFsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: AbgFsTarget
  size?: number
}

/** Opaque resolved path handle. ABG never interprets the key. */
interface AbgFsTarget {
  targetKey?: unknown
  displayPath?: string
}

/** The read-only slice of `ctx.fs` that the overlap check uses. */
interface AbgFileSystemService {
  resolve(path: string, opts?: unknown): Promise<AbgFsTarget>
  stat(target: AbgFsTarget, signal?: unknown): Promise<unknown | undefined>
  readText(target: AbgFsTarget, signal?: unknown): Promise<string>
  listDir(target: AbgFsTarget, signal?: unknown): Promise<AbgFsDirEntry[]>
}

/* ───────────────────────── host: web server (GUI) ────────────────────────── */

/**
 * The minimal response surface the ABG status route touches. The host route
 * handler owns the whole response lifecycle; ABG only ever writes one JSON body.
 */
interface AbgWebRequest {
  method?: string
  url?: string
  on(event: 'data', listener: (chunk: { length: number }) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: unknown) => void): void
  destroy?(): void
}

/** Node's `Buffer`, used only to join request-body chunks. */
declare const Buffer: {
  concat(chunks: readonly { length: number }[]): { toString(encoding: string): string }
}

interface AbgWebResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/**
 * `ctx.webServer` (`@deepseek-ai/dsh-host-webserver`), a subset: named route
 * registration. Duplicate (kind, path) throws, and the returned disposer removes
 * the route. Paths under `/api` are behind the deployment's browser-trust fence.
 */
interface AbgWebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: AbgWebRequest, res: AbgWebResponse) => void | Promise<void>
  }): () => void
}

/* ───────────────────────────── host: cordis ctx ──────────────────────────── */

/** The Cordis context surface ABG uses. Nothing outside this interface is touched. */
interface AbgContext {
  logger?: AbgLogger
  systemPrompt?: AbgSystemPromptService
  tools?: AbgToolRuntimeService
  fs?: AbgFileSystemService
  on(name: string, listener: (...args: any[]) => any, options?: { global?: boolean }): () => void
  get?(name: string): unknown
  webServer?: AbgWebServerService
  inject?(services: readonly string[], callback: (scoped: AbgContext) => void): void
  effect?(action: () => (() => void) | void, label?: string): () => void
}

/* ───────────────────────────── host: runtime ─────────────────────────────── */

/**
 * The two runtime globals the optional feedback channel touches (`ARCHITECTURE-SPEC`
 * §28.6). The package has no dependencies and no `@types/node`, so the exact
 * slice it uses is declared here, next to the host seams, for the same reason:
 * what the package depends on stays auditable in one file.
 */
declare const process: { env: Record<string, string | undefined> } | undefined

/** One HTTP response, as far as the feedback channel inspects it. */
interface AbgFetchResponse {
  ok: boolean
  status: number
  json(): Promise<any>
}

/** Request options used by the feedback channel. */
interface AbgFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** Node's global `fetch` (>= 18), used only in opt-in `api` mode. */
interface AbgFetch {
  (url: string, init?: AbgFetchInit): Promise<AbgFetchResponse>
}

declare const fetch: AbgFetch | undefined

/**
 * The filesystem slice the host layer (never the pure kernel) uses: reading a
 * user-supplied prompt override, and writing the opt-in diagnostics export.
 */
declare module 'node:path' {
  export function dirname(path: string): string
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
}

/* ──────────────────────────────── ABG config ─────────────────────────────── */

interface AbgWorkspacePolicy {
  policy: 'allow' | 'ask' | 'deny'
  mutatingTools: readonly string[]
  protectedPaths: readonly string[]
  /** What to do when a newly created document duplicates an existing one. */
  overlapCheck: 'off' | 'ask' | 'deny'
  /**
   * Classify a shell command by its text, so a write performed without a
   * file-effect tool is still governed. Quoted text is data unless the command
   * wraps another command (`ARCHITECTURE-SPEC` §18 D13 amendment).
   */
  classifyShellCommands: boolean
}

interface AbgPreStepPolicy {
  orientationGate: 'off' | 'warn' | 'reject'
  /**
   * Opt-in strict mode: refuse the first persistent mutation until orientation
   * has been recorded. Defaults to `false` (`ARCHITECTURE-SPEC` §34.2 Q1).
   */
  requireBeforeMutation: boolean
}

interface AbgUserAttentionPolicy {
  /** Refuse an ask batch that omits questions registered with the ledger. */
  enforceBatchCompleteness: boolean
}

/** The subset of the ABG mount record the feedback channel reads. */
interface AbgFeedbackMount {
  mounted?: boolean
  degraded?: readonly string[]
  modules?: readonly string[]
  configError?: string
  compatibility?: { verdict?: string }
}

/**
 * Optional feedback channel (`ARCHITECTURE-SPEC` §28.6). `url` mode composes a
 * prefilled issue link locally and makes no network call; `api` mode is strictly
 * opt-in and reads its token from the environment, never from configuration.
 */
interface AbgFeedbackPolicy {
  enabled: boolean
  mode: 'url' | 'api'
  /** `owner/name` of the repository that receives feedback issues. */
  repository: string
  /** Environment variable holding the API token, read only in `api` mode. */
  tokenEnvVar: string
  labels: readonly string[]
  includeDiagnostics: boolean
}

interface AbgModuleToggle {
  enabled: boolean
}

/**
 * The Web GUI data route (the panel's read path). Exposes the same payload as
 * `abg_status` and the diagnostics mirror, on the deployment's own web server.
 */
interface AbgGuiPolicy {
  enabled: boolean
}

/**
 * User-editable prompt (`ARCHITECTURE-SPEC` §27.1). `compiled` uses the audited
 * generated section; `append` adds guidance to it; `replace` substitutes a file
 * wholesale, which trades the soft conformance invariants for flexibility and is
 * therefore attributed through `PROMPT_VERSION` as `0.2.0+user:<hash>`.
 */
interface AbgPromptPolicy {
  mode: 'compiled' | 'append' | 'replace'
  /** Extra guidance appended in `append` mode. */
  append: string
  /** Path read in `replace` mode. Required when `mode` is `replace`. */
  file: string
  /** Accept text over the §11 byte ceiling, deliberately and visibly. */
  allowOverBudget: boolean
}

/**
 * Opt-in diagnostics mirror for a front end (the GUI integration). Empty `file`
 * means off: the plugin performs no file I/O unless a deployment asks for it.
 */
interface AbgDiagnosticsExportPolicy {
  file: string
  limit: number
}

interface AbgConfig {
  enabled: boolean
  sectionOrder: number
  modules: Record<string, AbgModuleToggle>
  workspace: AbgWorkspacePolicy
  preStep: AbgPreStepPolicy
  userAttention: AbgUserAttentionPolicy
  feedback: AbgFeedbackPolicy
  prompt: AbgPromptPolicy
  gui: AbgGuiPolicy
  diagnostics: boolean
  diagnosticsExport: AbgDiagnosticsExportPolicy
}

/* ───────────────────────── governance module contract ────────────────────── */

/** The module contract of `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §6. */
interface GovernanceModule {
  id: string
  version: string
  problem: string
  objective: string
  principles: readonly string[]
  prompt?: string
  dependencies?: readonly string[]
  risk: 'low' | 'medium' | 'high'
  enabledByDefault: boolean
  /**
   * ABG extension to the §6 contract: the PRODUCT-SPEC §2 failure classes this
   * module addresses (`FC-2.1` … `FC-2.4`). Declared so success criterion #2 —
   * "the five initial failure classes are represented as distinct modules" — is
   * machine-checkable rather than asserted.
   */
  addresses?: readonly string[]
}

/** Structural probe used by the registry to validate untrusted module input. */
type ModuleCandidate = Record<string, unknown>
