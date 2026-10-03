/**
 * Locates the installed DeepSeek Harness distribution so integration tests can
 * mount the *real* first-party services rather than mocks.
 *
 * Kept outside `test/` because Node's test runner treats every file under a
 * `test/` directory as a test file.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Where the DSH CLI's own dependencies live. Overridable for other installs. */
export const DSH_PACKAGES =
  process.env.IEG_DSH_PACKAGES ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'

/**
 * @param {string} name
 * @returns {string}
 */
function packageDir(name) {
  return path.join(DSH_PACKAGES, name)
}

/**
 * Whether a usable DSH installation is present. Integration tests are skipped
 * (not failed) when it is absent, so the unit suite stays portable.
 *
 * @returns {boolean}
 */
export function dshAvailable() {
  return (
    existsSync(path.join(packageDir('cordis'), 'lib/index.js')) &&
    existsSync(path.join(packageDir('dsh-system-prompt'), 'lib/index.js')) &&
    existsSync(path.join(packageDir('dsh-tools'), 'lib/index.js'))
  )
}

/**
 * @param {string} name
 * @returns {Promise<any>}
 */
export function loadDshPackage(name) {
  return import(pathToFileURL(path.join(packageDir(name), 'lib/index.js')).href)
}

/** `@deepseek-ai/cordis` — Context and the plugin runtime. */
export const loadCordis = () => loadDshPackage('cordis')

/** `@deepseek-ai/dsh-system-prompt` — the real prompt registry. */
export const loadSystemPrompt = () => loadDshPackage('dsh-system-prompt')

/** `@deepseek-ai/dsh-tools` — the real tool registry and enforcement pipeline. */
export const loadTools = () => loadDshPackage('dsh-tools')

/** The version of the installed DSH CLI, read from its package.json. */
export function dshVersion() {
  const manifest = path.resolve(DSH_PACKAGES, '..', '..', 'package.json')
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).version
  } catch {
    return 'unknown'
  }
}
