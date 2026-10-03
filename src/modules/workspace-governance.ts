/**
 * Module: `workspace-governance` (M4).
 *
 * **Problem:** unauthorized persistent workspace mutation.
 * **Objective:** make workspace structure an explicitly governed part of project state.
 *
 * Verified host facts that shape this module (`ARCHITECTURE-SPEC` §17.3, §17.4):
 *
 * - `tools/pre-execute` is the only pre-execution, scope-isolated view of a call,
 *   and it exposes `(name, arguments)` but **cannot rewrite** arguments.
 * - Returning `{ kind: 'ask' }` makes the tool registry resolve the human prompt
 *   through `ctx.approval`, inheriting its fail-closed path. IEG must not
 *   reimplement approval.
 * - `ctx.tools.guard()` is monotonic and deny-only, so it is the correct
 *   backstop for a rule that listener ordering must not be able to defeat.
 * - IEG must never compute filesystem containment; `ctx.sandboxPolicy` owns it.
 *
 * Boundary: this is **tool-mediated** mutation governance. A plugin calling
 * `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses
 * `tools/*`; IEG does not claim process-wide write coverage.
 */

export interface MutationClassification {
  kind: 'read-only' | 'persistent-mutation'
  tool: string
  targets: string[]
  protected: boolean
}

const TARGET_KEYS = Object.freeze(['file_path', 'path', 'target', 'notebook_path', 'output_path'])
/** Shell tools, whose command text is inspected to decide whether they mutate. */
export const SHELL_TOOLS = Object.freeze(['bash', 'pwsh', 'bash_persistent', 'pwsh_persistent'])

/**
 * Commands that write to the filesystem regardless of redirection.
 * Deliberately conservative: a false positive turns a read-only command into an
 * approval prompt, so everyday read-only commands (`ls`, `grep`, `cat`, `find`,
 * `node --test`, `git status`, `rg '=>'`) must not match. The patterns are
 * matched against the command's **code** text, with quoted segments treated as
 * data, unless the command is a shell wrapper whose quoted argument is itself a
 * command.
 */
const WRITING_COMMANDS = Object.freeze([
  /\btee\b/,
  /\bcp\s/,
  /\bmv\s/,
  /\brm\s/,
  /\btouch\s/,
  /\bmkdir\s/,
  /\brmdir\s/,
  /\bdd\s/,
  /\btruncate\b/,
  /\bln\s/,
  /\bsed\b[^|;]*\s-i/,
  /\bperl\b[^|;]*\s-i/,
])

/**
 * Shell wrappers whose quoted argument is itself a command. Inside one of these
 * the quoted text must still be inspected, because `bash -c 'rm -rf build'`
 * really does remove files.
 */
const COMMAND_WRAPPERS = Object.freeze([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'eval', 'pwsh', 'powershell', 'cmd',
])

/**
 * Whether a command line invokes a shell wrapper, so that its quoted arguments
 * are commands rather than data. The first token is compared by basename,
 * ignoring a Windows executable suffix.
 */
function isCommandWrapper(command: string): boolean {
  const first = command.trim().split(/[\s;|&()]+/, 1)[0] ?? ''
  const base = first.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
  return COMMAND_WRAPPERS.includes(base)
}

/**
 * Blank out the contents of single- and double-quoted segments.
 *
 * Quoted text is data, not shell syntax: `grep -rn '=>' src` searches for an
 * arrow rather than redirecting, and `git commit -m 'rm stale files'` carries a
 * message rather than removing files. An escape outside quotes is blanked with
 * the sequence it escapes.
 */
function blankQuotedSegments(command: string): string {
  let out = ''
  let quote: string | null = null
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (quote === null) {
      if (character === '\\') {
        out += '  '
        index += 1
        continue
      }
      if (character === "'" || character === '"') quote = character
      out += character
      continue
    }
    if (character === quote) {
      quote = null
      out += character
      continue
    }
    out += ' '
  }
  return out
}

/**
 * Whether the text contains a redirection operator rather than a comparison or
 * an arrow (`=>`, `->`, `>=`, `<=`, `!>`).
 */
function hasRedirect(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '>') continue
    const previous = text[index - 1]
    if (previous !== undefined && '=->!'.includes(previous)) continue
    if (text[index + 1] === '=') continue
    return true
  }
  return false
}

/**
 * Whether a shell command can create, overwrite, or remove a file.
 *
 * IEG excludes shell tools from `mutatingTools` and inspects the command text
 * instead, because gating every shell call would block `ls`, `grep`, and
 * `node --test`. The cost of that exclusion was a coverage hole: a document can
 * be created with a shell redirection rather than the `write` tool, bypassing
 * the overlap gate entirely. This closes that hole without opening one in the
 * other direction: quoted text is data unless the command wraps another command,
 * so `rg '=>' src` is not mistaken for a write.
 *
 * Two residual limits are measured by `test/unit/shell-classification.test.js`
 * rather than hidden: a wrapper invoked indirectly (`env bash -c '…'`) is
 * treated as data, and a PowerShell `Remove-Item` is not recognised as a write.
 */
export function commandWritesFiles(command: unknown): boolean {
  if (typeof command !== 'string' || command.trim() === '') return false

  const text = isCommandWrapper(command) ? command : blankQuotedSegments(command)
  // Discard-to-null and file-descriptor duplication are the two idioms that put a
  // `>` into an otherwise read-only command.
  const scrubbed = text.replace(/\d*>>?\s*\/dev\/null/g, ' ').replace(/\d*>&\d+/g, ' ')

  if (hasRedirect(scrubbed)) return true
  return WRITING_COMMANDS.some((pattern) => pattern.test(scrubbed))
}

/**
 * Normalise a path-like target for prefix comparison only. IEG does not perform
 * containment resolution; this is a string comparison for policy matching.
 */
function normaliseTarget(target: string): string {
  const unified = target.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return unified.length > 1 ? unified.replace(/\/+$/, '') : unified
}

/**
 * Extract the persistent targets a call names, if any.
 */
export function extractTargets(toolName: string, args: unknown): string[] {
  if (typeof args !== 'object' || args === null) return []
  const record = args as Record<string, unknown>
  const targets: string[] = []
  for (const key of TARGET_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') targets.push(normaliseTarget(value))
  }
  if (targets.length === 0 && SHELL_TOOLS.includes(toolName)) {
    const command = record.command
    if (typeof command === 'string' && command.trim() !== '') targets.push(`<shell> ${command.trim()}`)
  }
  return targets
}

/**
 * Whether a target is inside the protected set. A protected entry matches the
 * target itself or any path beneath it.
 */
export function isProtectedPath(target: string, protectedPaths: readonly string[]): boolean {
  const candidate = normaliseTarget(target)
  return protectedPaths.some((entry) => {
    const boundary = normaliseTarget(entry)
    return candidate === boundary || candidate.startsWith(`${boundary}/`)
  })
}

/**
 * Classify a tool call as read-only inspection or persistent mutation.
 *
 * A shell call is a mutation when its command can write to the filesystem, so
 * the hole left by excluding shell tools from `mutatingTools` is closed without
 * gating ordinary read-only shell work.
 */
export function classifyMutation(
  toolName: string,
  args: unknown,
  policy: { mutatingTools: readonly string[], protectedPaths: readonly string[], classifyShellCommands?: boolean },
): MutationClassification {
  const targets = extractTargets(toolName, args)

  const listed = policy.mutatingTools.includes(toolName)
  const shellWrites =
    policy.classifyShellCommands !== false &&
    SHELL_TOOLS.includes(toolName) &&
    typeof args === 'object' &&
    args !== null &&
    commandWritesFiles((args as Record<string, unknown>).command)

  const mutating = listed || shellWrites
  return {
    kind: mutating ? 'persistent-mutation' : 'read-only',
    tool: toolName,
    targets,
    protected: targets.some((target) => isProtectedPath(target, policy.protectedPaths)),
  }
}

/**
 * Decide the pre-execution outcome for a classified call.
 *
 * Precedence: a protected target is refused outright, then the configured
 * policy applies. `ask` delegates to the host approval service; IEG never
 * fabricates authorization (P1, §13).
 */
export function decideMutation(
  classification: MutationClassification,
  config: { policy: 'allow' | 'ask' | 'deny', protectedPaths: readonly string[] },
): { kind: 'allow' } | { kind: 'ask', reason: string } | { kind: 'deny', reason: string } {
  if (classification.kind === 'read-only') return { kind: 'allow' }

  const described = classification.targets.length === 0 ? 'workspace' : classification.targets.join(', ')

  if (classification.protected) {
    return {
      kind: 'deny',
      reason: `ieg: "${classification.tool}" targets a protected path (${described})`,
    }
  }

  switch (config.policy) {
    case 'allow':
      return { kind: 'allow' }
    case 'deny':
      return {
        kind: 'deny',
        reason: `ieg: persistent mutation via "${classification.tool}" is not authorized (${described})`,
      }
    case 'ask':
    default:
      return {
        kind: 'ask',
        reason: `ieg: confirm persistent workspace mutation via "${classification.tool}" (${described})`,
      }
  }
}

/**
 * The monotonic guard backstop. Runs after every `tools/pre-execute` listener,
 * so a later allow cannot reinstate a denied call. Deny-only and synchronous.
 */
export function guardBackstop(
  execution: IegToolExecution,
  policy: { mutatingTools: readonly string[], protectedPaths: readonly string[] },
): string | undefined {
  if (policy.protectedPaths.length === 0) return undefined
  const classification = classifyMutation(execution.name, execution.arguments, policy)
  if (classification.kind === 'persistent-mutation' && classification.protected) {
    return `ieg: "${classification.tool}" targets a protected path`
  }
  return undefined
}

/** The §6 module descriptor. */
export const workspaceGovernanceModule = Object.freeze({
  id: 'workspace-governance',
  version: '0.2.0',
  problem: 'unauthorized persistent workspace mutation',
  objective: 'make workspace structure an explicitly governed part of project state',
  principles: Object.freeze([
    'Distinguish read-only inspection from persistent workspace mutation.',
    'Do not create persistent artifacts merely because they seem convenient.',
    'Before creating a new artifact, look for an existing one that already serves the same purpose and extend it instead of adding a near-duplicate.',
    'Treat new persistent artifacts and structural changes as requiring authorization under the active policy.',
    'Never claim authorization the user has not given; prefer a safe refusal to mutate.',
  ]),
  // This fragment must NOT instruct the model to perform the check that
  // `tools/pre-execute` and `ctx.tools.guard` already enforce (handoff §11:
  // "instruct the model to perform a runtime operation that the plugin can
  // enforce deterministically"). It instead states the host's actual grant
  // semantics — `'allowed-once'` is the only grant — so the model's expectations
  // match what enforcement will do, and it removes the earlier implication that
  // an "existing project convention" is standing authorization.
  prompt: 'Inspect freely. A persistent mutation may be routed to the user for approval, and each approval covers only that one change; a previous approval or an existing convention is not standing authorization.',
  dependencies: Object.freeze(['project-governance', 'information-integrity']),
  risk: 'high',
  enabledByDefault: true,
  addresses: Object.freeze(['FC-2.2']),
})
