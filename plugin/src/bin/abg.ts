/**
 * ABG — the `abg` terminal interface (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * One program, two modes:
 *
 * ```text
 * abg                -> the ANSI numbered menu (no dependencies, usable over SSH)
 * abg <command>      -> the same commands non-interactively, with flags, for CI
 * ```
 *
 * Every command is implemented once and both modes call it, so the menu cannot
 * drift from the flag surface. Arg parsing, ANSI rendering and `$EDITOR`
 * invocation are all hand-rolled over Node builtins: the package ships with
 * **zero runtime dependencies**.
 *
 * Exit codes: 0 success · 1 refused/failed · 2 usage or environment error
 * (including the refusal to touch the live `$HOME/.dsh` without `--allow-live`).
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import {
  readControlStateFile,
  resolveControlPaths,
  transitionDiagnostic,
  writeControlStateFile,
  type AbgControlPaths,
  type AbgControlState,
  type AbgControlStatus,
} from '../kernel/control.js'
import {
  PROMPT_FILE_NAME,
  deletePromptFile,
  readPromptFile,
  resolveEffectivePrompt,
  validatePromptText,
  writePromptFile,
  type EffectivePrompt,
} from '../kernel/prompt-store.js'
import { runLifecycle, validateProfileName, type LifecycleResult } from '../kernel/lifecycle.js'


/** The slice of `lib/index.js` the CLI uses. Loaded lazily to keep `--version` cheap. */
interface AbgKernel {
  buildGovernance(raw?: unknown, options?: unknown): { compiledPrompt: string, compiledBytes: number }
  PROMPT_VERSION: string
  PLUGIN_VERSION: string
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** The package root: `lib/generated/bin` -> `plugin/`. */
const PLUGIN_DIR = join(HERE, '..', '..', '..')
const PACKAGE_NAME = 'dsh-agent-behavioral-governance'

let kernelPromise: Promise<AbgKernel> | undefined

/**
 * Load the plugin entry lazily and by computed path.
 *
 * The entry is JavaScript (not a migrated `.ts` module), so it is imported at
 * runtime rather than statically referenced: the CLI only needs its exported
 * kernel, and the computed specifier keeps the TypeScript build from trying to
 * type-resolve a JavaScript file.
 */
async function loadKernel(): Promise<AbgKernel> {
  if (kernelPromise === undefined) {
    const indexPath = join(HERE, '..', '..', 'index.js')
    kernelPromise = import(indexPath) as Promise<AbgKernel>
  }
  return kernelPromise
}

/** The audited compiled default, which every override is validated against. */
async function compiledDefault(): Promise<{ text: string, promptVersion: string, pluginVersion: string }> {
  const kernel = await loadKernel()
  const built = kernel.buildGovernance({ prompt: { mode: 'compiled' } })
  return { text: built.compiledPrompt, promptVersion: kernel.PROMPT_VERSION, pluginVersion: kernel.PLUGIN_VERSION }
}

/* ── output ──────────────────────────────────────────────────────────────── */

function out(text = ''): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

function err(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`)
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/* ── argument parsing ────────────────────────────────────────────────────── */

interface ParsedArgs {
  command: string
  subcommand: string
  home: string
  stateFile: string
  profile: string
  from: string
  json: boolean
  yes: boolean
  dryRun: boolean
  allowLive: boolean
  help: boolean
  version: boolean
}

function defaultHome(env: Record<string, string | undefined>): string {
  if (typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '') return env.DSH_HOME
  const home = typeof env.HOME === 'string' && env.HOME !== '' ? env.HOME : homedir()
  return join(home, '.dsh')
}

function parseArgs(argv: string[], env: Record<string, string | undefined>): ParsedArgs {
  const parsed: ParsedArgs = {
    command: '',
    subcommand: '',
    home: defaultHome(env),
    stateFile: '',
    profile: typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '' ? env.DSH_PROFILE : 'default',
    from: '',
    json: false,
    yes: false,
    dryRun: false,
    allowLive: false,
    help: false,
    version: false,
  }

  const positional: string[] = []
  let index = 0
  const valueOf = (flag: string): string => {
    const token = argv[index]
    if (token.includes('=')) return token.slice(token.indexOf('=') + 1)
    index += 1
    const next = argv[index]
    if (next === undefined) throw new UsageError(`${flag} needs a value`)
    return next
  }

  for (; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (token === '--home' || token.startsWith('--home=')) parsed.home = valueOf('--home')
    else if (token === '--state' || token.startsWith('--state=')) parsed.stateFile = valueOf('--state')
    else if (token === '--profile' || token.startsWith('--profile=')) parsed.profile = valueOf('--profile')
    else if (token === '--from' || token.startsWith('--from=')) parsed.from = valueOf('--from')
    else if (token === '--json') parsed.json = true
    else if (token === '--yes' || token === '-y') parsed.yes = true
    else if (token === '--dry-run') parsed.dryRun = true
    else if (token === '--allow-live') parsed.allowLive = true
    else if (token === '--help' || token === '-h') parsed.help = true
    else if (token === '--version' || token === '-V') parsed.version = true
    else if (token.startsWith('--')) throw new UsageError(`unknown option: ${token}`)
    else positional.push(token)
  }

  parsed.command = positional[0] ?? ''
  parsed.subcommand = positional[1] ?? ''
  return parsed
}

/** Raised for anything the user can fix on the command line. */
class UsageError extends Error {}

/* ── control state ───────────────────────────────────────────────────────── */

function controlPathsFor(parsed: ParsedArgs, env: Record<string, string | undefined>): AbgControlPaths {
  if (parsed.stateFile === '') return resolveControlPaths({ env })
  return {
    stateDir: dirname(parsed.stateFile),
    stateFile: parsed.stateFile,
    promptFile: join(dirname(parsed.stateFile), PROMPT_FILE_NAME),
  }
}

interface StateChange {
  status: AbgControlStatus
  generation: number
}

/** Write one control transition, preserving generation and the recorded editor. */
function applyStateChange(paths: AbgControlPaths, change: StateChange): { before: AbgControlState, after: AbgControlState, warning: string } {
  const read = readControlStateFile(paths.stateFile)
  const before = read.state
  const after: AbgControlState = {
    schema: 1,
    status: change.status,
    generation: change.generation,
    updatedAt: new Date().toISOString(),
  }
  if (before.editor !== undefined) after.editor = before.editor
  writeControlStateFile(paths.stateFile, after)
  return { before, after, warning: read.issue ?? '' }
}

/* ── commands ────────────────────────────────────────────────────────────── */

async function commandState(
  parsed: ParsedArgs,
  env: Record<string, string | undefined>,
  status: AbgControlStatus,
): Promise<number> {
  const paths = controlPathsFor(parsed, env)
  const read = readControlStateFile(paths.stateFile)
  const generation = status === 'running' && parsed.command === 'restart' ? read.state.generation + 1 : read.state.generation
  const { before, after, warning } = applyStateChange(paths, { status, generation })
  const code = transitionDiagnostic(read.present ? before.status : undefined, status)
  if (warning !== '') err(`abg: ${warning}`)
  if (parsed.json) {
    emitJson({ action: parsed.command, state: after, stateFile: paths.stateFile, diagnostic: code ?? null })
  } else {
    const change = before.status === status ? status : `${before.status} -> ${status}`
    out(`abg: control ${change} (generation ${after.generation})`)
    if (parsed.command === 'restart') out(`abg: generation ${before.generation} -> ${after.generation}; configuration and prompt.md will be re-read`)
    if (code !== null && code !== undefined) out(`abg: recorded ${code}`)
    out(`abg: state file ${paths.stateFile}`)
  }
  return 0
}

async function effectivePromptFor(
  paths: AbgControlPaths,
): Promise<{ effective: EffectivePrompt, compiled: { text: string, promptVersion: string, pluginVersion: string }, promptIssue: string }> {
  const compiled = await compiledDefault()
  const read = readPromptFile(paths.promptFile)
  const effective = resolveEffectivePrompt({
    basePrompt: compiled.text,
    mode: 'compiled',
    controlText: read.text,
    controlPath: paths.promptFile,
  })
  return { effective, compiled, promptIssue: read.issue ?? '' }
}

async function commandPrompt(
  parsed: ParsedArgs,
  env: Record<string, string | undefined>,
): Promise<number> {
  const paths = controlPathsFor(parsed, env)
  const { effective, compiled, promptIssue } = await effectivePromptFor(paths)
  if (promptIssue !== '') err(`abg: ${promptIssue}`)
  const version = `${compiled.promptVersion}${effective.versionSuffix}`

  if (parsed.json) {
    emitJson({
      version,
      source: effective.source,
      bytes: effective.bytes,
      overridden: effective.applied,
      issues: effective.issues,
      promptFile: paths.promptFile,
      text: effective.text,
    })
    return 0
  }
  process.stdout.write(effective.text.endsWith('\n') ? effective.text : `${effective.text}\n`)
  out('')
  out(`abg prompt: version ${version} bytes ${effective.bytes} source ${effective.source} file ${paths.promptFile}`)
  for (const issue of effective.issues) err(`abg: refused: ${issue}`)
  return 0
}

async function commandPromptEdit(
  parsed: ParsedArgs,
  env: Record<string, string | undefined>,
): Promise<number> {
  const paths = controlPathsFor(parsed, env)
  const { effective, compiled } = await effectivePromptFor(paths)
  const editor = (env.EDITOR ?? env.VISUAL ?? '').trim()
  if (editor === '') throw new UsageError('$EDITOR (or $VISUAL) is not set; `abg prompt edit` needs an editor')

  const scratch = mkdtempSync(join(tmpdir(), 'abg-prompt-'))
  const temporary = join(scratch, PROMPT_FILE_NAME)
  writeFileSync(temporary, effective.text)

  const parts = editor.split(/\s+/)
  const launched = spawnSync(parts[0], [...parts.slice(1), temporary], { stdio: 'inherit' })
  if (launched.error !== undefined) {
    err(`abg: could not run the editor (${launched.error.message})`)
    return 1
  }
  if (launched.status !== 0) {
    err(`abg: the editor exited with status ${String(launched.status)}; nothing was stored`)
    return 1
  }

  const edited = readFileSync(temporary, 'utf8')
  const validated = validatePromptText({ basePrompt: compiled.text, text: edited })
  if (!validated.applied) {
    err('abg: prompt edit refused; the previous effective text is unchanged')
    for (const issue of validated.issues) err(`abg:   - ${issue}`)
    return 1
  }

  writePromptFile(paths.promptFile, validated.text)
  const read = readControlStateFile(paths.stateFile)
  writeControlStateFile(paths.stateFile, { ...read.state, editor, updatedAt: new Date().toISOString() })
  const version = `${compiled.promptVersion}${validated.versionSuffix}`
  if (parsed.json) {
    emitJson({ applied: true, version, bytes: validated.bytes, promptFile: paths.promptFile, editor })
  } else {
    out(`abg: prompt stored in ${paths.promptFile}`)
    out(`abg: version ${version} bytes ${validated.bytes} (applied from the next step)`)
  }
  return 0
}

async function commandPromptReset(parsed: ParsedArgs, env: Record<string, string | undefined>): Promise<number> {
  const paths = controlPathsFor(parsed, env)
  const removed = deletePromptFile(paths.promptFile)
  const compiled = await compiledDefault()
  if (parsed.json) {
    emitJson({ removed, promptFile: paths.promptFile, version: compiled.promptVersion })
  } else {
    out(removed ? `abg: removed ${paths.promptFile}; the compiled default is in effect` : `abg: no ${PROMPT_FILE_NAME} present; the compiled default is already in effect`)
    out(`abg: PROMPT_VERSION ${compiled.promptVersion}`)
  }
  return 0
}

function lifecycleOptions(parsed: ParsedArgs, env: Record<string, string | undefined>): Parameters<typeof runLifecycle>[0] {
  return {
    action: parsed.command as 'install' | 'update' | 'uninstall' | 'status',
    profile: parsed.profile,
    home: parsed.home,
    pluginDir: PLUGIN_DIR,
    from: parsed.from === '' ? undefined : parsed.from,
    allowLive: parsed.allowLive,
    dryRun: parsed.dryRun,
    yes: parsed.yes,
    env,
  }
}

function reportLifecycle(result: LifecycleResult, json: boolean): number {
  if (json) {
    emitJson({
      ok: result.ok,
      action: result.action,
      profile: result.profile,
      home: result.home,
      profileDir: result.profileDir,
      npmCache: result.npmCache,
      source: result.source,
      version: result.version,
      composed: result.composed,
      messages: result.messages,
      error: result.error,
    })
  } else {
    for (const line of result.messages) {
      if (line.startsWith('abg: error:')) err(line)
      else out(line)
    }
  }
  return result.exitCode
}

function commandLifecycle(parsed: ParsedArgs, env: Record<string, string | undefined>): number {
  const profileError = validateProfileName(parsed.profile)
  if (profileError !== undefined) throw new UsageError(profileError)
  return reportLifecycle(runLifecycle(lifecycleOptions(parsed, env)), parsed.json)
}

async function commandStatus(parsed: ParsedArgs, env: Record<string, string | undefined>): Promise<number> {
  const paths = controlPathsFor(parsed, env)
  const read = readControlStateFile(paths.stateFile)
  const { effective, compiled } = await effectivePromptFor(paths)
  const install = runLifecycle(lifecycleOptions({ ...parsed, command: 'status' }, env))

  const payload = {
    schema: 1,
    plugin: PACKAGE_NAME,
    pluginVersion: compiled.pluginVersion,
    promptVersion: compiled.promptVersion,
    stateFile: paths.stateFile,
    promptFile: paths.promptFile,
    control: {
      status: read.state.status,
      generation: read.state.generation,
      updatedAt: read.state.updatedAt,
      present: read.present,
      editor: read.state.editor ?? null,
      warning: read.issue ?? null,
    },
    prompt: {
      source: effective.source,
      overridden: effective.applied,
      version: `${compiled.promptVersion}${effective.versionSuffix}`,
      bytes: effective.bytes,
      present: readPromptFile(paths.promptFile).present,
      issues: effective.issues,
    },
    install: {
      profile: parsed.profile,
      home: parsed.home,
      ok: install.ok,
      version: install.version,
      composed: install.composed,
      error: install.error,
    },
  }

  if (parsed.json) {
    emitJson(payload)
    return 0
  }

  out(`control      ${read.state.status}${read.present ? '' : ' (no state file: default)'}`)
  out(`generation   ${read.state.generation}`)
  out(`updatedAt    ${read.state.updatedAt}`)
  out(`state file   ${paths.stateFile}`)
  if (read.issue !== undefined) out(`state note   ${read.issue}`)
  out(`prompt       ${effective.source} (${effective.bytes} bytes) version ${compiled.promptVersion}${effective.versionSuffix}`)
  out(`prompt file  ${paths.promptFile}`)
  out(`PROMPT_VERSION ${compiled.promptVersion}`)
  out(`plugin       ${compiled.pluginVersion}`)
  out(`install      profile ${parsed.profile}: ${install.version === '' ? 'not installed' : `installed (version ${install.version})`}`)
  out(`composes     ${install.composed === '' ? 'no' : 'yes'}`)
  if (!install.ok && install.error !== '') out(`install note ${install.error}`)
  return 0
}

/* ── the ANSI menu ───────────────────────────────────────────────────────── */

interface MenuItem {
  key: string
  label: string
  command: string
  subcommand?: string
}

const MENU: readonly MenuItem[] = Object.freeze([
  { key: '1', label: 'start          resume governance', command: 'start' },
  { key: '2', label: 'pause          suppress the section, pass hooks through', command: 'pause' },
  { key: '3', label: 'restart        reload config and prompt.md (generation+1)', command: 'restart' },
  { key: '4', label: 'exit           stop governance for this profile', command: 'exit' },
  { key: '5', label: 'status         control, prompt and install state', command: 'status' },
  { key: '6', label: 'prompt         print the effective prompt', command: 'prompt' },
  { key: '7', label: 'prompt edit    edit, validate and store prompt.md', command: 'prompt', subcommand: 'edit' },
  { key: '8', label: 'prompt reset   delete prompt.md (compiled default)', command: 'prompt', subcommand: 'reset' },
  { key: '9', label: 'install        npm lifecycle into the profile', command: 'install' },
  { key: '10', label: 'update         reinstall the current artifact', command: 'update' },
  { key: '11', label: 'uninstall      remove from the profile', command: 'uninstall' },
])

/** Render the menu. Plain ANSI only: no ncurses, no dependency, SSH-safe. */
function renderMenu(parsed: ParsedArgs, pluginVersion: string): string {
  const lines = [
    `\u001b[1mABG ${pluginVersion} — Agent Behavioral Governance\u001b[0m`,
    `profile ${parsed.profile}    home ${parsed.home}`,
    '',
  ]
  for (const item of MENU) lines.push(`  \u001b[36m${item.key.padStart(2)}\u001b[0m) ${item.label}`)
  lines.push(`   \u001b[36m q\u001b[0m) quit`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

async function runMenu(parsed: ParsedArgs, env: Record<string, string | undefined>): Promise<number> {
  const compiled = await compiledDefault()
  const terminal = process.stdin.isTTY === true
  process.stdout.write(renderMenu(parsed, compiled.pluginVersion))
  process.stdout.write('Select: ')
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal })
  try {
    for await (const line of rl) {
      const choice = line.trim()
      if (choice === '' ) continue
      if (choice === 'q' || choice === 'quit' || choice === '0') break
      const item = MENU.find((candidate) => candidate.key === choice)
      if (item === undefined) {
        err(`abg: "${choice}" is not a menu item`)
      } else {
        const next: ParsedArgs = { ...parsed, command: item.command, subcommand: item.subcommand ?? '' }
        try {
          await execute(next, env)
        } catch (error) {
          err(`abg: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      process.stdout.write(`\n${renderMenu(parsed, compiled.pluginVersion)}Select: `)
    }
  } finally {
    rl.close()
  }
  out('')
  return 0
}

/* ── dispatch ────────────────────────────────────────────────────────────── */

const HELP = `abg — Agent Behavioral Governance terminal interface

usage: abg [command] [options]

commands:
  (none), menu        ANSI numbered menu (interactive; also usable over SSH)
  start               control status=running
  pause               control status=paused; the section is not emitted
  restart             control status=running, generation+1, reload config and prompt.md
  exit                control status=stopped (governance off; installation untouched)
  status              control state, generation, prompt and install/compose state
  prompt              print the effective prompt, its version and byte count
  prompt edit         $EDITOR on a temp copy; validate; store prompt.md
  prompt reset        delete prompt.md -> back to the compiled default
  install             npm lifecycle: install into a profile
  update              npm lifecycle: update the installed artifact
  uninstall           npm lifecycle: remove from a profile

options:
  --home <dir>        DSH home (default $DSH_HOME or ~/.dsh)
  --state <file>      control-state file (default $ABG_STATE_FILE or
                      <state-dir>/abg/state.json, state-dir = $XDG_STATE_HOME
                      or ~/.local/state)
  --profile <P>       profile for the lifecycle and status (default: default)
  --from <src>        tarball/url/dir for install/update (default: npm pack)
  --json              machine-readable output
  --yes               never prompt (the lifecycle never prompts anyway)
  --dry-run           lifecycle only: describe, do not execute
  --allow-live        permit writing the live $HOME/.dsh profile
  --help, -h          this text
  --version, -V       print the plugin version

exit codes: 0 success · 1 refused/failed · 2 usage or environment error
`

async function execute(parsed: ParsedArgs, env: Record<string, string | undefined>): Promise<number> {
  switch (parsed.command) {
    case '':
    case 'menu':
      return runMenu(parsed, env)
    case 'start':
    case 'pause':
    case 'exit':
      return commandState(parsed, env, parsed.command === 'start' ? 'running' : parsed.command === 'pause' ? 'paused' : 'stopped')
    case 'restart':
      return commandState(parsed, env, 'running')
    case 'status':
      return commandStatus(parsed, env)
    case 'prompt':
      if (parsed.subcommand === 'edit') return commandPromptEdit(parsed, env)
      if (parsed.subcommand === 'reset') return commandPromptReset(parsed, env)
      if (parsed.subcommand !== '') throw new UsageError(`unknown prompt subcommand: ${parsed.subcommand}`)
      return commandPrompt(parsed, env)
    case 'install':
    case 'update':
    case 'uninstall':
      return commandLifecycle(parsed, env)
    default:
      throw new UsageError(`unknown command: ${parsed.command} (try --help)`)
  }
}

/** Program entry. Returns the process exit code; never throws. */
export async function main(argv: string[]): Promise<number> {
  const env = process.env
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv, env)
  } catch (error) {
    err(`abg: ${error instanceof Error ? error.message : String(error)}`)
    err('abg: try `abg --help`')
    return 2
  }

  if (parsed.help) {
    process.stdout.write(HELP)
    return 0
  }

  try {
    if (parsed.version) {
      const compiled = await compiledDefault()
      out(parsed.json ? JSON.stringify({ name: PACKAGE_NAME, version: compiled.pluginVersion, promptVersion: compiled.promptVersion }) : compiled.pluginVersion)
      return 0
    }
    return await execute(parsed, env)
  } catch (error) {
    if (error instanceof UsageError) {
      err(`abg: ${error.message}`)
      err('abg: try `abg --help`')
      return 2
    }
    err(`abg: fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    return 1
  }
}
