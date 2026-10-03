/**
 * IEG seam contract — the exact slice of the DeepSeek Harness runtime this
 * plugin depends on.
 *
 * This file is a **global script declaration file**: it has no imports and no
 * exports, so every type below is ambient and visible to all of `lib/`. It also
 * doubles as the auditable record of which host seams IEG binds to, and with
 * what shape — so the package typechecks without resolving any first-party
 * package.
 *
 * Every member was verified against the installed distribution
 * `@deepseek-ai/dsh` `0.2.1-alpha.1` (the current declared baseline). See `ARCHITECTURE-SPEC-AGENT-REFERENCE.md`
 * §17 for the citations.
 */

/* ────────────────────────────── host: logging ────────────────────────────── */

/** Cordis logger surface (subset). */
interface IegLogger {
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
}

/* ───────────────────────── host: system-prompt seam ──────────────────────── */

/**
 * The per-assembly context handed to a section text provider. Merge-extended by
 * `@deepseek-ai/dsh-agent` to carry `agent`, so one IEG section can render
 * per-agent governance prose (verified: `AssembleContext.agent?: Agent`).
 */
interface IegAssembleContext {
  agent?: unknown
  scope?: unknown
}

/**
 * One contributed prompt section. `complete` must never be set by IEG: a single
 * effective complete section replaces the whole assembled prompt, and two make
 * assembly fail.
 */
interface IegPromptSection {
  name: string
  order: number
  text: string | ((context: IegAssembleContext) => string)
  interpolate?: boolean
  complete?: boolean
}

/**
 * One registered dynamic runtime context. The host materialises it as a durable
 * user-role snapshot, which is what makes it usable as IEG's operator-visible
 * governance status line (ARCHITECTURE-SPEC §17.2, Part B §28.3 channel A).
 */
interface IegPromptContext {
  name: string
  order: number
  text: string | ((context: IegAssembleContext) => string)
}

/**
 * One section of an assembly, with its text resolved. The host's
 * `AssembledSection` carries `name`, `text`, and `interpolate` — **not** `order`,
 * so the array position is the resolved placement (ARCHITECTURE-SPEC §29.3).
 */
interface IegAssembledSection {
  name: string
  text: string
  interpolate?: boolean
}

/** One assembly as the `system-prompt/assemble` waterfall observes it. */
interface IegPromptAssembly {
  sections: IegAssembledSection[]
  contexts?: ReadonlyArray<{ name: string, text: string }>
  tools?: readonly unknown[]
  variables?: Record<string, string | undefined>
}

/** `ctx.systemPrompt` surface (subset). */
interface IegSystemPromptService {
  section(section: IegPromptSection): () => void
  context?(context: IegPromptContext): () => void
  getSectionOrder?(name: string): number
  getContextOrder?(name: string): number
}

/* ───────────────────────── host: tool enforcement seam ───────────────────── */

/**
 * One pending tool call as an enforcement listener sees it. Read-only: the host
 * excludes argument rewriting because arguments are already logged and shown.
 */
interface IegToolExecution {
  name: string
  arguments: unknown
  agent?: unknown
  callId?: string
}

/**
 * Pre-dispatch decision. `ask` is resolved by the tool registry through
 * `ctx.approval`; with no approval channel the host degrades `ask` to denial.
 */
type IegPreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string }

/**
 * Tool-owned canonical output contract. `schema` is enforced against every
 * successful return value, and `render` projects it to model content.
 */
interface IegToolOutputDefinition {
  schema: unknown
  render(args: unknown, value: unknown): unknown[]
}

/**
 * A registered model-facing tool. `execute` returns only the canonical lossless
 * JSON value declared by `output.schema`.
 */
interface IegToolDefinition {
  name: string
  description: string
  parameters: unknown
  output: IegToolOutputDefinition
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** `ctx.tools` surface (subset). */
interface IegToolRuntimeService {
  guard(guard: (execution: IegToolExecution) => string | undefined): () => void
  restrict(filter: { allow?: readonly string[]; deny?: readonly string[] }): () => void
  register(definition: IegToolDefinition): () => void
}

/* ───────────────────────── host: pre-step seam ───────────────────────────── */

/**
 * Either reject the proposed step or enter it with (possibly replaced) messages.
 * Returning `reject` ends the turn with the durable reason `blocked`.
 */
type IegPreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: unknown[]; startsRequestSeries?: true }

/** Payload of `agent/pre-step` (scope-filtered waterfall). */
interface IegPreStepPayload {
  agent: unknown
  messages: unknown[]
  turn: number
  step: number
  signal?: unknown
}

/* ─────────────────────── host: filesystem (read only) ────────────────────── */

/** One child of a listed directory. */
interface IegFsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  target: IegFsTarget
  size?: number
}

/** Opaque resolved path handle. IEG never interprets the key. */
interface IegFsTarget {
  targetKey?: unknown
  displayPath?: string
}

/** The read-only slice of `ctx.fs` that the overlap check uses. */
interface IegFileSystemService {
  resolve(path: string, opts?: unknown): Promise<IegFsTarget>
  stat(target: IegFsTarget, signal?: unknown): Promise<unknown | undefined>
  readText(target: IegFsTarget, signal?: unknown): Promise<string>
  listDir(target: IegFsTarget, signal?: unknown): Promise<IegFsDirEntry[]>
}

/* ───────────────────────────── host: cordis ctx ──────────────────────────── */

/** The Cordis context surface IEG uses. Nothing outside this interface is touched. */
interface IegContext {
  logger?: IegLogger
  systemPrompt?: IegSystemPromptService
  tools?: IegToolRuntimeService
  fs?: IegFileSystemService
  on(name: string, listener: (...args: any[]) => any, options?: { global?: boolean }): () => void
  get?(name: string): unknown
  inject?(services: readonly string[], callback: (scoped: IegContext) => void): void
  effect?(action: () => (() => void) | void, label?: string): () => void
}

/* ───────────────────── host: node runtime (declared slice) ───────────────── */

/**
 * The package has zero dependencies and no `@types/node`, so the exact Node
 * slice it uses is declared here, next to the host seams: what the package
 * depends on stays auditable in one file. **Type declarations only** — they add
 * no runtime code.
 */

interface IegProcess {
  argv: string[]
  env: Record<string, string | undefined>
  pid: number
  cwd(): string
  exitCode?: number
  exit(code?: number): never
  stdout: { write(text: string): boolean, isTTY?: boolean }
  stderr: { write(text: string): boolean, isTTY?: boolean }
  stdin: { isTTY?: boolean }
}

declare const process: IegProcess

declare module 'node:path' {
  export function dirname(path: string): string
  export function basename(path: string, suffix?: string): string
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function isAbsolute(path: string): boolean
}

declare module 'node:fs' {
  export interface IegStats {
    mtimeMs: number
    size: number
    isFile(): boolean
    isDirectory(): boolean
  }
  export interface IegDirent {
    name: string
    isFile(): boolean
    isDirectory(): boolean
  }
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
  export function renameSync(oldPath: string, newPath: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function mkdtempSync(prefix: string): string
  export function existsSync(path: string): boolean
  export function statSync(path: string): IegStats
  export function unlinkSync(path: string): void
  export function copyFileSync(source: string, destination: string): void
  export function rmSync(path: string, options?: { recursive?: boolean, force?: boolean }): void
  export function readdirSync(path: string): string[]
}

declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string
  export function pathToFileURL(path: string): { href: string }
}

declare module 'node:child_process' {
  export interface IegSpawnResult {
    status: number | null
    stdout: string
    stderr: string
    error?: Error
  }
  export interface IegSpawnOptions {
    cwd?: string
    env?: Record<string, string | undefined>
    encoding?: 'utf8'
    stdio?: 'inherit' | 'ignore' | 'pipe'
  }
  export function spawnSync(command: string, args?: readonly string[], options?: IegSpawnOptions): IegSpawnResult
}

declare module 'node:readline' {
  export interface IegReadlineInterface extends AsyncIterable<string> {
    close(): void
  }
  export function createInterface(options: {
    input: unknown
    output?: unknown
    terminal?: boolean
  }): IegReadlineInterface
}

/** `import.meta` is only available to modules; declared for the CLI entry. */
interface ImportMeta {
  url: string
}

/* ──────────────────────────────── IEG config ─────────────────────────────── */

interface IegWorkspacePolicy {
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

interface IegPreStepPolicy {
  orientationGate: 'off' | 'warn' | 'reject'
  /**
   * Opt-in strict mode: refuse the first persistent mutation until orientation
   * has been recorded. Defaults to `false` (`ARCHITECTURE-SPEC` §34.2 Q1).
   */
  requireBeforeMutation: boolean
}

interface IegModuleToggle {
  enabled: boolean
}

/**
 * User-editable prompt (`ARCHITECTURE-SPEC` §27.1). `compiled` uses the audited
 * generated section; `append` adds guidance to it; `replace` substitutes a file
 * wholesale, which trades the soft conformance invariants for flexibility and is
 * therefore attributed through `PROMPT_VERSION` as `0.2.0+user:<hash>`.
 */
interface IegPromptPolicy {
  mode: 'compiled' | 'append' | 'replace'
  /** Extra guidance appended in `append` mode. */
  append: string
  /** Path read in `replace` mode. Required when `mode` is `replace`. */
  file: string
  /** Accept text over the §11 byte ceiling, deliberately and visibly. */
  allowOverBudget: boolean
}

/**
 * Opt-in diagnostics mirror for a reader outside the host process — the `ieg`
 * terminal interface reads it. Empty `file` means off: the plugin performs no
 * file I/O unless a deployment asks for it.
 */
interface IegDiagnosticsExportPolicy {
  file: string
  limit: number
}

interface IegConfig {
  enabled: boolean
  sectionOrder: number
  modules: Record<string, IegModuleToggle>
  workspace: IegWorkspacePolicy
  preStep: IegPreStepPolicy
  prompt: IegPromptPolicy
  diagnostics: boolean
  diagnosticsExport: IegDiagnosticsExportPolicy
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
   * IEG extension to the §6 contract: the PRODUCT-SPEC §2 failure classes this
   * module addresses (`FC-2.1` … `FC-2.4`). Declared so success criterion #2 —
   * "the five initial failure classes are represented as distinct modules" — is
   * machine-checkable rather than asserted.
   */
  addresses?: readonly string[]
}

/** Structural probe used by the registry to validate untrusted module input. */
type ModuleCandidate = Record<string, unknown>
