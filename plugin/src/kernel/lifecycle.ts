/**
 * ABG kernel — the npm-native plugin lifecycle (`ARCHITECTURE-SPEC` §28.6, 0.6.0).
 *
 * `abg install|update|uninstall` is the **one** implementation of the lifecycle.
 * `scripts/abg-npm.sh` is a thin wrapper over it, so there is no second copy of
 * the npm logic to drift.
 *
 * Why this exists at all: `dsh plugin --profile <p> add|remove ...` forwards its
 * arguments verbatim to **pnpm**, which the host hard-codes. A host that only has
 * npm cannot use that path. This module does the same job with npm and then
 * performs the one step `dsh plugin` does *outside* the package manager:
 * registering the package name in the profile manifest's `dsh.profile.bundles`
 * list, which is what makes DSH compose the `abg` row at boot.
 *
 * Design rules (carried over from the shell script it replaces):
 *
 *   - POSIX-hostile only in the sense that it needs `node`, `npm` and `dsh`;
 *     there are no runtime package dependencies.
 *   - Fails loudly: every step checks its result and reports a non-zero exit.
 *   - Idempotent: `install` twice is a no-op, `uninstall` on a clean profile is a
 *     no-op that still verifies absence.
 *   - Never writes to the live profile (`$HOME/.dsh`) unless explicitly told with
 *     `--allow-live` (or `ABG_NPM_ALLOW_LIVE=1`); `status` is read-only.
 *   - npm's cache defaults to a writable directory derived from the resolved
 *     `--home`, never the read-only `$HOME/.npm`.
 *
 * With no `--from`, `install`/`update` pack the repository's own `plugin/`
 * directory with `npm pack` — the canonical artifact producer — and copy the
 * resulting tarball into the profile first, so the recorded dependency is a
 * stable `file:.abg-artifacts/<name>.tgz` rather than a path back into the
 * source tree.
 *
 * Exit codes: 0 success · 1 verification/lifecycle failure · 2 usage/environment.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync, type AbgSpawnResult } from 'node:child_process'
import { join, resolve } from 'node:path'

/** The package this lifecycle manages. */
export const PACKAGE_NAME = 'dsh-agent-behavioral-governance'

/** Where `npm install` records the artifact inside the profile. */
export const ARTIFACTS_DIR = '.abg-artifacts'

export type LifecycleAction = 'install' | 'update' | 'uninstall' | 'status'

export interface LifecycleOptions {
  action: LifecycleAction
  profile: string
  /** Resolved absolute `$DSH_HOME`. */
  home: string
  /** Directory of this package (the `npm pack` source when `from` is empty). */
  pluginDir: string
  /** `--from <tarball|url|dir>`. */
  from?: string
  allowLive?: boolean
  dryRun?: boolean
  /** Accepted for non-interactive callers; the lifecycle never prompts. */
  yes?: boolean
  env?: Record<string, string | undefined>
  /** Override the profile template used to initialize a missing profile. */
  template?: string
}

export interface LifecycleStep {
  command: string
  args: string[]
  cwd?: string
}

export interface LifecycleResult {
  ok: boolean
  exitCode: number
  action: LifecycleAction
  profile: string
  home: string
  profileDir: string
  npmCache: string
  source: string
  version: string
  composed: string
  messages: string[]
  error: string
  steps: LifecycleStep[]
}

/** Names that could escape `<home>/profiles` and must never be accepted. */
export function validateProfileName(profile: string): string | undefined {
  if (profile === '') return 'a profile name is required (--profile P)'
  if (profile === '.' || profile === '..') return `invalid profile name: ${profile}`
  if (profile.includes('/') || profile.includes('\\')) return `invalid profile name: ${profile}`
  if (profile === 'node_modules') return 'invalid profile name: node_modules'
  return undefined
}

/** Trim trailing slashes without requiring the path to exist. */
export function normalizeHome(home: string): string {
  let normalized = home
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return normalized
}

/** The live `$HOME/.dsh`, which lifecycle writes must refuse by default. */
export function liveHome(env: Record<string, string | undefined>): string {
  const home = env.HOME !== undefined && env.HOME !== '' ? normalizeHome(env.HOME) : ''
  if (home === '') return ''
  return normalizeHome(`${resolve(home)}/.dsh`)
}

/**
 * npm's cache directory. An explicit `npm_config_cache` always wins; otherwise a
 * writable directory derived from the resolved home is used, because a restricted
 * `$HOME/.npm` fails every npm operation with EROFS before it starts.
 */
export function resolveNpmCache(home: string, env: Record<string, string | undefined>): string {
  const explicit = env.npm_config_cache
  if (typeof explicit === 'string' && explicit !== '') return explicit
  return join(home, '.abg-npm-cache')
}

/** The environment the child processes run with. */
function childEnv(home: string, npmCache: string, env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...process.env, ...env, DSH_HOME: home, npm_config_cache: npmCache }
}

/** Run one command, capturing its output. Never throws. */
function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string, env: Record<string, string | undefined> },
): AbgSpawnResult {
  return spawnSync(command, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8' })
}

/** Whether a command is on `PATH`. */
function commandExists(command: string, env: Record<string, string | undefined>): boolean {
  const probe = run('sh', ['-c', `command -v ${command}`], { env })
  return probe.status === 0
}

/** Read `dsh --dump-config` output for a profile, or the error that prevented it. */
function dumpConfig(
  dsh: string,
  profile: string,
  env: Record<string, string | undefined>,
): { stdout: string, error?: string } {
  const result = run(dsh, ['--profile', profile, '--dump-config'], { env })
  if (result.status !== 0) {
    return { stdout: result.stdout, error: (result.stderr || result.stdout || 'dsh --dump-config failed').trim() }
  }
  return { stdout: result.stdout }
}

/** The composed `abg` row, or `''` when it does not compose. */
function composedRow(stdout: string): string {
  const lines = stdout.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    // The row is emitted as a YAML list item, i.e. `- id: abg`.
    if (/^\s*-?\s*id:\s*abg\s*$/.test(lines[index])) return lines.slice(index, index + 5).join('\n')
  }
  return ''
}

/** JSON edit of `dsh.profile.bundles`: add appends if absent; remove drops. */
function editBundles(manifest: string, mode: 'add' | 'remove'): void {
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
  const dsh = (typeof parsed.dsh === 'object' && parsed.dsh !== null ? parsed.dsh : {}) as Record<string, unknown>
  const profile = (typeof dsh.profile === 'object' && dsh.profile !== null ? dsh.profile : {}) as Record<string, unknown>
  const list = Array.isArray(profile.bundles) ? (profile.bundles as unknown[]) : []
  profile.bundles =
    mode === 'add'
      ? list.includes(PACKAGE_NAME)
        ? list
        : list.concat([PACKAGE_NAME])
      : list.filter((name) => name !== PACKAGE_NAME)
  dsh.profile = profile
  parsed.dsh = dsh
  writeFileSync(manifest, `${JSON.stringify(parsed, null, 2)}\n`)
}

/** Installed package version, or `''`. */
function installedVersion(profileDir: string): string {
  const manifest = join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json')
  if (!existsSync(manifest)) return ''
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : ''
  } catch {
    return ''
  }
}

/** A failure result, with the lifecycle's usage/lifecycle exit convention. */
function failure(
  options: LifecycleOptions,
  message: string,
  exitCode: number,
  messages: string[],
): LifecycleResult {
  const home = resolve(normalizeHome(options.home))
  return {
    ok: false,
    exitCode,
    action: options.action,
    profile: options.profile,
    home,
    profileDir: join(home, 'profiles', options.profile),
    npmCache: resolveNpmCache(home, options.env ?? {}),
    source: options.from ?? '',
    version: '',
    composed: '',
    messages: [...messages, `abg: error: ${message}`],
    error: message,
    steps: [],
  }
}

/**
 * Execute one lifecycle action. Pure description in `steps`; the side effects are
 * the npm/dsh invocations and the profile-manifest edits, exactly as the shell
 * script performed them.
 */
export function runLifecycle(options: LifecycleOptions): LifecycleResult {
  const env = options.env ?? {}
  const messages: string[] = []
  const say = (line: string): void => {
    messages.push(line)
  }

  const profileError = validateProfileName(options.profile)
  if (profileError !== undefined) return failure(options, profileError, 2, messages)

  // Resolve to an absolute path first: the live-home guard compares against
  // `$HOME/.dsh`, and a relative `--home` would otherwise slip past it (and make
  // npm's `--pack-destination` resolve against the wrong working directory).
  const home = resolve(normalizeHome(options.home))
  const profileDir = join(home, 'profiles', options.profile)
  const npmCache = resolveNpmCache(home, env)
  const allowLive = options.allowLive === true || env.ABG_NPM_ALLOW_LIVE === '1'
  if (options.action !== 'status' && home === liveHome(env) && !allowLive) {
    return failure(
      options,
      `refusing to modify the live profile home (${home}); pass --allow-live ` +
        '(or set ABG_NPM_ALLOW_LIVE=1) if that is really intended',
      2,
      messages,
    )
  }

  const childEnvironment = childEnv(home, npmCache, env)
  const dsh = env.DSH_BIN !== undefined && env.DSH_BIN !== '' ? env.DSH_BIN : 'dsh'
  const npm = env.NPM_BIN !== undefined && env.NPM_BIN !== '' ? env.NPM_BIN : 'npm'
  const template = options.template ?? (env.ABG_PROFILE_TEMPLATE !== undefined && env.ABG_PROFILE_TEMPLATE !== ''
    ? env.ABG_PROFILE_TEMPLATE
    : 'headless')
  const artifacts = join(profileDir, ARTIFACTS_DIR)
  const manifest = join(profileDir, 'package.json')

  say(`profile   ${options.profile}`)
  say(`DSH_HOME  ${home}`)
  say(`npm cache ${npmCache}`)

  if (!commandExists('node', childEnvironment)) return failure(options, "'node' not found on PATH", 2, messages)
  if (!commandExists(npm, childEnvironment)) return failure(options, `'${npm}' not found on PATH`, 2, messages)
  if (!commandExists(dsh, childEnvironment)) return failure(options, `'${dsh}' not found on PATH`, 2, messages)

  const steps: LifecycleStep[] = []
  const note = (command: string, args: string[], cwd?: string): void => {
    steps.push({ command, args, ...(cwd === undefined ? {} : { cwd }) })
  }

  /* ── status (read-only, allowed anywhere) ─────────────────────────────── */

  if (options.action === 'status') {
    if (!existsSync(profileDir)) {
      say('package    NOT installed (no such profile)')
      say('composes   no')
      return { ...failure(options, `profile directory does not exist: ${profileDir}`, 1, messages), steps }
    }
    const version = installedVersion(profileDir)
    say(version === '' ? 'package    NOT installed' : `package    installed (version ${version})`)
    const referenced = existsSync(manifest) && readFileSync(manifest, 'utf8').includes(`"${PACKAGE_NAME}"`)
    say(referenced ? 'manifest   referenced in dsh.profile.bundles' : 'manifest   not referenced')
    const dump = dumpConfig(dsh, options.profile, childEnvironment)
    const row = composedRow(dump.stdout)
    if (row === '') {
      say('composes   no')
      return { ...failure(options, 'the abg row does not compose', 1, messages), steps }
    }
    say('composes   yes')
    say(row)
    return {
      ok: true,
      exitCode: 0,
      action: options.action,
      profile: options.profile,
      home,
      profileDir,
      npmCache,
      source: '',
      version,
      composed: row,
      messages,
      error: '',
      steps,
    }
  }

  /* ── dry run: describe, never execute ─────────────────────────────────── */

  if (options.dryRun === true) {
    const verb = options.action === 'uninstall' ? 'npm uninstall' : `npm install${options.from === undefined ? ' (after npm pack)' : ''}`
    say(`dry-run: would ${verb} into ${profileDir}`)
    say(`dry-run: would ${options.action === 'uninstall' ? 'remove' : 'add'} ${PACKAGE_NAME} in dsh.profile.bundles`)
    return {
      ok: true,
      exitCode: 0,
      action: options.action,
      profile: options.profile,
      home,
      profileDir,
      npmCache,
      source: options.from ?? '',
      version: '',
      composed: '',
      messages,
      error: '',
      steps,
    }
  }

  /* ── uninstall ────────────────────────────────────────────────────────── */

  if (options.action === 'uninstall') {
    if (!existsSync(profileDir)) return failure(options, `profile directory does not exist: ${profileDir}`, 1, messages)
    const installed = existsSync(join(profileDir, 'node_modules', PACKAGE_NAME, 'package.json'))
    const referenced = existsSync(manifest) && readFileSync(manifest, 'utf8').includes(`"${PACKAGE_NAME}"`)
    if (installed || referenced) {
      say(`npm uninstall ${PACKAGE_NAME} (from profile "${options.profile}")`)
      note(npm, ['uninstall', '--no-audit', '--no-fund', PACKAGE_NAME], profileDir)
      const result = run(npm, ['uninstall', '--no-audit', '--no-fund', PACKAGE_NAME], {
        cwd: profileDir,
        env: childEnvironment,
      })
      if (result.status !== 0) return failure(options, `npm uninstall failed: ${(result.stderr || '').trim()}`, 1, messages)
    } else {
      say(`${PACKAGE_NAME} is not installed in profile "${options.profile}"; cleaning any stale bundle entry`)
    }
    if (existsSync(manifest)) editBundles(manifest, 'remove')
    rmSync(artifacts, { recursive: true, force: true })
    if (existsSync(manifest) && readFileSync(manifest, 'utf8').includes(`"${PACKAGE_NAME}"`)) {
      return failure(options, `${PACKAGE_NAME} is still a dependency in ${manifest}`, 1, messages)
    }
    const dump = dumpConfig(dsh, options.profile, childEnvironment)
    if (composedRow(dump.stdout) !== '') {
      return failure(options, `the abg row still composes into profile "${options.profile}" after uninstall`, 1, messages)
    }
    say(`uninstalled; profile "${options.profile}" no longer composes an abg row`)
    return {
      ok: true,
      exitCode: 0,
      action: options.action,
      profile: options.profile,
      home,
      profileDir,
      npmCache,
      source: '',
      version: '',
      composed: '',
      messages,
      error: '',
      steps,
    }
  }

  /* ── install / update ─────────────────────────────────────────────────── */

  mkdirSync(home, { recursive: true })
  if (!existsSync(manifest)) {
    say(`initializing profile "${options.profile}" from the "${template}" template`)
    note(dsh, ['--profile', options.profile, '--from-default-profile', template, '--dump-config'])
    const created = run(dsh, ['--profile', options.profile, '--from-default-profile', template, '--dump-config'], {
      env: childEnvironment,
    })
    if (created.status !== 0) {
      return failure(options, `could not initialize profile "${options.profile}" (template: ${template})`, 1, messages)
    }
  }
  if (!existsSync(manifest)) return failure(options, `profile manifest missing after init: ${manifest}`, 1, messages)

  let source = options.from ?? ''
  // A directory source is packed, exactly like the no-source default: the recorded
  // dependency must be a stable tarball copy under .abg-artifacts/, and `npm pack`
  // is the canonical artifact producer. Only a tarball or URL is used as an npm
  // spec directly.
  const packSource =
    source === ''
      ? options.pluginDir
      : existsSync(source) && statSync(source).isDirectory()
        ? source
        : ''
  if (packSource !== '') {
    const scratch = join(home, '.abg-npm-cache')
    mkdirSync(scratch, { recursive: true })
    for (const entry of readdirSync(scratch)) {
      if (entry.startsWith(`${PACKAGE_NAME}-`) && entry.endsWith('.tgz')) unlinkSync(join(scratch, entry))
    }
    say(`packing ${packSource} (npm pack)`)
    note(npm, ['pack', '--pack-destination', scratch], packSource)
    const packed = run(npm, ['pack', '--pack-destination', scratch], { cwd: packSource, env: childEnvironment })
    if (packed.status !== 0) return failure(options, `npm pack failed: ${(packed.stderr || '').trim()}`, 1, messages)
    const produced = readdirSync(scratch)
      .filter((entry) => entry.startsWith(`${PACKAGE_NAME}-`) && entry.endsWith('.tgz'))
      .sort()
    if (produced.length === 0) return failure(options, `npm pack produced no ${PACKAGE_NAME}-*.tgz in ${scratch}`, 1, messages)
    source = join(scratch, produced[produced.length - 1])
  }

  mkdirSync(artifacts, { recursive: true })
  let spec = source
  if (existsSync(source)) {
    const base = source.slice(source.lastIndexOf('/') + 1)
    for (const entry of readdirSync(artifacts)) {
      if (entry.startsWith(`${PACKAGE_NAME}-`) && entry.endsWith('.tgz')) unlinkSync(join(artifacts, entry))
    }
    copyFileSync(source, join(artifacts, base))
    spec = `./${ARTIFACTS_DIR}/${base}`
  }
  say(`npm install ${spec} (into profile "${options.profile}")`)
  note(npm, ['install', '--no-audit', '--no-fund', spec], profileDir)
  const installed = run(npm, ['install', '--no-audit', '--no-fund', spec], { cwd: profileDir, env: childEnvironment })
  if (installed.status !== 0) return failure(options, `npm install failed for ${spec}: ${(installed.stderr || '').trim()}`, 1, messages)
  editBundles(manifest, 'add')

  const dump = dumpConfig(dsh, options.profile, childEnvironment)
  const row = composedRow(dump.stdout)
  if (row === '') {
    return failure(options, `the abg row does not compose into profile "${options.profile}"; the install did not take effect`, 1, messages)
  }
  if (!row.includes(`name: ${PACKAGE_NAME}`)) {
    return failure(options, `the abg row does not name ${PACKAGE_NAME}; got: ${row}`, 1, messages)
  }
  const version = installedVersion(profileDir) || 'unknown'
  say(`installed ${PACKAGE_NAME}@${version} into profile "${options.profile}"`)
  say(`verify: ${dsh} --profile ${options.profile} --dump-config | grep -A4 'id: abg'`)
  return {
    ok: true,
    exitCode: 0,
    action: options.action,
    profile: options.profile,
    home,
    profileDir,
    npmCache,
    source,
    version,
    composed: row,
    messages,
    error: '',
    steps,
  }
}
