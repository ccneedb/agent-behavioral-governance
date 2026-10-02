/**
 * ABG configuration resolution.
 *
 * Follows the DSH convention used by `dsh-plan-mode`'s `resolveConfig`: a plugin
 * may accept a plain object and validate it explicitly. ABG does this rather
 * than declaring a `static Config` schema so the package has **zero runtime
 * dependencies** and stays mountable in any composition.
 *
 * Validation is strict: unknown keys, blank strings, and wrong types fail at
 * plugin load instead of being silently ignored.
 */

/**
 * Tools whose call is treated as a persistent workspace mutation.
 *
 * **Shell tools are deliberately excluded.** Classifying `bash` or `pwsh` as a
 * mutation gates *every* shell command — including read-only ones such as `ls`,
 * `grep`, and `node --test` — because the gate sees only an opaque command
 * string. That blocks ordinary work, and under `policy: 'ask'` in a composition
 * with no approval channel it denies the agent its entire shell.
 *
 * The host already confines shell writes through its own sandbox
 * (`dsh-bash-sandbox` plus the `read-only` / `workspace-write` /
 * `danger-full-access` policy), so ABG governing them too would duplicate host
 * semantics, which PRODUCT-SPEC P1 forbids.
 *
 * ABG therefore governs *file-effect* mutations, where `(name, arguments)` is
 * unambiguous.
 */
export const DEFAULT_MUTATING_TOOLS = Object.freeze(['write', 'edit', 'str_replace_editor'])

/**
 * Default order for the single ABG prompt section. `ARCHITECTURE-SPEC` §17.2
 * verified that DSH exposes no plugin-allocatable placement, so the value is
 * explicit. It is exported because the configuration-fault path mounts the
 * status line at the same order when no validated configuration exists.
 */
export const DEFAULT_SECTION_ORDER = 8500

const TOP_LEVEL_KEYS = [
  'enabled',
  'sectionOrder',
  'modules',
  'workspace',
  'preStep',
  'userAttention',
  'prompt',
  'diagnostics',
  'diagnosticsExport',
]
const WORKSPACE_KEYS = ['policy', 'mutatingTools', 'protectedPaths', 'overlapCheck', 'classifyShellCommands']
const PRESTEP_KEYS = ['orientationGate', 'requireBeforeMutation']
const USER_ATTENTION_KEYS = ['enforceBatchCompleteness']
const PROMPT_KEYS = ['mode', 'append', 'file', 'allowOverBudget']
const DIAGNOSTICS_EXPORT_KEYS = ['file', 'limit']
const MODULE_TOGGLE_KEYS = ['enabled']

const WORKSPACE_POLICIES = ['allow', 'ask', 'deny']
const ORIENTATION_GATES = ['off', 'warn', 'reject']
const OVERLAP_MODES = ['off', 'ask', 'deny']
const PROMPT_MODES = ['compiled', 'append', 'replace']

/** Raised when a configuration value is missing, malformed, or unknown. */
export class AbgConfigError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(`abg config: ${message}`)
    this.name = 'AbgConfigError'
  }
}

/**
 * Assert a value is a non-empty string.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function requireString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AbgConfigError(`"${path}" must be a non-empty string`)
  }
  return value
}

/**
 * Assert a value is a string, **allowing the empty string**.
 *
 * Path-valued fields use this: `''` is a documented value meaning "none
 * configured" (`prompt.file` when `prompt.mode` is not `replace`;
 * `diagnosticsExport.file` meaning "off, do no file I/O"). Validating them with
 * `requireString` made the **shipped** `cordis.patch.yml` fail this plugin's own
 * validation, so `apply()` fell into the §26.2 fault surface and the plugin
 * contributed nothing at all — no prompt section, no hooks, no tools — while the
 * host reported nothing. Whitespace-only values are still
 * rejected: they are always a typo, never an intentional "none".
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {string}
 */
function requireOptionalPath(value, path) {
  if (typeof value !== 'string') {
    throw new AbgConfigError(`"${path}" must be a string`)
  }
  if (value !== '' && value.trim() === '') {
    throw new AbgConfigError(`"${path}" must be a path or an empty string`)
  }
  return value
}

/**
 * Assert a value is a boolean.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {boolean}
 */
function requireBoolean(value, path) {
  if (typeof value !== 'boolean') throw new AbgConfigError(`"${path}" must be a boolean`)
  return value
}

/**
 * Reject keys outside a permitted set.
 *
 * @param {Record<string, unknown>} object
 * @param {readonly string[]} allowed
 * @param {string} path
 * @returns {void}
 */
function rejectUnknownKeys(object, allowed, path) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new AbgConfigError(`unknown key "${path}${key}"`)
    }
  }
}

/**
 * Assert a value is an object with string keys.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function requireObject(value, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AbgConfigError(`"${path}" must be an object`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Validate a list of non-empty strings.
 *
 * @param {unknown} value
 * @param {string} path
 * @returns {readonly string[]}
 */
function requireStringArray(value, path) {
  if (!Array.isArray(value)) throw new AbgConfigError(`"${path}" must be an array of strings`)
  return Object.freeze(value.map((entry, index) => requireString(entry, `${path}[${index}]`)))
}

/**
 * Validate and detach the raw patch-layer config.
 *
 * @param {unknown} [raw] - the `config` block of the composition row.
 * @returns {AbgConfig} a frozen, fully populated configuration.
 */
export function resolveConfig(raw) {
  const input = raw === undefined ? {} : requireObject(raw, '')
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, '')

  const enabled = input.enabled === undefined ? true : requireBoolean(input.enabled, 'enabled')

  const sectionOrder = input.sectionOrder === undefined ? DEFAULT_SECTION_ORDER : input.sectionOrder
  if (typeof sectionOrder !== 'number' || !Number.isFinite(sectionOrder)) {
    // Verified host fact: `SystemPrompt.section()` throws on a non-finite order.
    throw new AbgConfigError('"sectionOrder" must be a finite number')
  }

  /** @type {Record<string, AbgModuleToggle>} */
  const modules = {}
  if (input.modules !== undefined) {
    const rawModules = requireObject(input.modules, 'modules.')
    for (const [id, value] of Object.entries(rawModules)) {
      const toggle = requireObject(value, `modules.${id}.`)
      rejectUnknownKeys(toggle, MODULE_TOGGLE_KEYS, `modules.${id}.`)
      modules[id] = Object.freeze({
        enabled: toggle.enabled === undefined ? true : requireBoolean(toggle.enabled, `modules.${id}.enabled`),
      })
    }
  }

  const rawWorkspace = input.workspace === undefined ? {} : requireObject(input.workspace, 'workspace.')
  rejectUnknownKeys(rawWorkspace, WORKSPACE_KEYS, 'workspace.')
  const policy = rawWorkspace.policy === undefined ? 'ask' : rawWorkspace.policy
  if (typeof policy !== 'string' || !WORKSPACE_POLICIES.includes(policy)) {
    throw new AbgConfigError(`"workspace.policy" must be one of ${WORKSPACE_POLICIES.join(' | ')}`)
  }
  const overlapCheck = rawWorkspace.overlapCheck === undefined ? 'ask' : rawWorkspace.overlapCheck
  if (typeof overlapCheck !== 'string' || !OVERLAP_MODES.includes(overlapCheck)) {
    throw new AbgConfigError(`"workspace.overlapCheck" must be one of ${OVERLAP_MODES.join(' | ')}`)
  }
  const workspace = Object.freeze({
    policy: /** @type {'allow' | 'ask' | 'deny'} */ (policy),
    overlapCheck: /** @type {'off' | 'ask' | 'deny'} */ (overlapCheck),
    // Shell tools are not listed in `mutatingTools`, so a shell command that can
    // write is classified from its command text instead. Disabling this restores
    // the (leaky) behaviour of governing file-effect tools only.
    classifyShellCommands:
      rawWorkspace.classifyShellCommands === undefined
        ? true
        : requireBoolean(rawWorkspace.classifyShellCommands, 'workspace.classifyShellCommands'),
    mutatingTools:
      rawWorkspace.mutatingTools === undefined
        ? DEFAULT_MUTATING_TOOLS
        : requireStringArray(rawWorkspace.mutatingTools, 'workspace.mutatingTools'),
    protectedPaths:
      rawWorkspace.protectedPaths === undefined
        ? Object.freeze([])
        : requireStringArray(rawWorkspace.protectedPaths, 'workspace.protectedPaths'),
  })

  const rawPreStep = input.preStep === undefined ? {} : requireObject(input.preStep, 'preStep.')
  rejectUnknownKeys(rawPreStep, PRESTEP_KEYS, 'preStep.')
  const orientationGate = rawPreStep.orientationGate === undefined ? 'off' : rawPreStep.orientationGate
  if (typeof orientationGate !== 'string' || !ORIENTATION_GATES.includes(orientationGate)) {
    throw new AbgConfigError(`"preStep.orientationGate" must be one of ${ORIENTATION_GATES.join(' | ')}`)
  }
  // Defaults to false (non-intrusive), per the user decision recorded in
  // `ARCHITECTURE-SPEC` §34.2 Q1: a deployment is not asked to authorize the
  // first write of every session. A strict deployment opts in with `true`, which
  // is what the evaluation harness states explicitly.
  const requireBeforeMutation =
    rawPreStep.requireBeforeMutation === undefined
      ? false
      : requireBoolean(rawPreStep.requireBeforeMutation, 'preStep.requireBeforeMutation')

  const diagnostics = input.diagnostics === undefined ? true : requireBoolean(input.diagnostics, 'diagnostics')

  const rawUserAttention = input.userAttention === undefined ? {} : requireObject(input.userAttention, 'userAttention.')
  rejectUnknownKeys(rawUserAttention, USER_ATTENTION_KEYS, 'userAttention.')
  // Refuse a batch that omits questions the agent registered with the ledger.
  // This is what makes criterion #3 state-backed rather than prose-backed.
  const enforceBatchCompleteness =
    rawUserAttention.enforceBatchCompleteness === undefined
      ? true
      : requireBoolean(rawUserAttention.enforceBatchCompleteness, 'userAttention.enforceBatchCompleteness')

  const rawPrompt = input.prompt === undefined ? {} : requireObject(input.prompt, 'prompt.')
  rejectUnknownKeys(rawPrompt, PROMPT_KEYS, 'prompt.')
  const promptMode = rawPrompt.mode === undefined ? 'compiled' : rawPrompt.mode
  if (typeof promptMode !== 'string' || !PROMPT_MODES.includes(promptMode)) {
    throw new AbgConfigError(`"prompt.mode" must be one of ${PROMPT_MODES.join(' | ')}`)
  }
  if (rawPrompt.append !== undefined && typeof rawPrompt.append !== 'string') {
    throw new AbgConfigError('"prompt.append" must be a string')
  }
  const promptFile = rawPrompt.file === undefined ? '' : requireOptionalPath(rawPrompt.file, 'prompt.file')
  if (promptMode === 'replace' && promptFile === '') {
    throw new AbgConfigError('"prompt.file" is required when "prompt.mode" is "replace"')
  }
  const prompt = Object.freeze({
    mode: /** @type {'compiled' | 'append' | 'replace'} */ (promptMode),
    append: typeof rawPrompt.append === 'string' ? rawPrompt.append : '',
    file: promptFile,
    // The escape hatch is deliberately explicit: exceeding the §11 byte ceiling
    // is a policy decision, not a default.
    allowOverBudget:
      rawPrompt.allowOverBudget === undefined
        ? false
        : requireBoolean(rawPrompt.allowOverBudget, 'prompt.allowOverBudget'),
  })

  const rawExport = input.diagnosticsExport === undefined ? {} : requireObject(input.diagnosticsExport, 'diagnosticsExport.')
  rejectUnknownKeys(rawExport, DIAGNOSTICS_EXPORT_KEYS, 'diagnosticsExport.')
  const diagnosticsExport = Object.freeze({
    // Empty path means "off": the plugin does no file I/O unless asked.
    file: rawExport.file === undefined ? '' : requireOptionalPath(rawExport.file, 'diagnosticsExport.file'),
    limit: rawExport.limit === undefined ? 50 : (() => {
      const value = rawExport.limit
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200) {
        throw new AbgConfigError('"diagnosticsExport.limit" must be an integer between 1 and 200')
      }
      return value
    })(),
  })

  return Object.freeze({
    enabled,
    sectionOrder,
    modules: Object.freeze(modules),
    workspace,
    preStep: Object.freeze({
      orientationGate: /** @type {'off' | 'warn' | 'reject'} */ (orientationGate),
      requireBeforeMutation,
    }),
    userAttention: Object.freeze({ enforceBatchCompleteness }),
    prompt,
    diagnostics,
    diagnosticsExport,
  })
}
