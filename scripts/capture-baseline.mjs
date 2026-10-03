#!/usr/bin/env node
/**
 * Regenerate `lib/compatibility-baseline.json` from the installed host
 * (ARCHITECTURE-SPEC §29.4, PR-07).
 *
 * The baseline records what IEG was verified against, so the compatibility
 * adapter can turn silent host drift into a reviewed baseline update. This script
 * boots the **real** `@deepseek-ai/dsh-system-prompt` (located through
 * `test-support/dsh.js`), assembles a prompt exactly the way
 * `test/integration/composition.test.js` does — the prompt registry, the tool
 * registry, and IEG's own section — and prints the baseline JSON to stdout.
 *
 * ```bash
 * cd plugin && node scripts/capture-baseline.mjs > lib/compatibility-baseline.json
 * ```
 *
 * It exits non-zero with a clear message when the host is unavailable, so it can
 * be used as a maintainer step without silently writing a bogus baseline.
 *
 * The script prefers mounting the real plugin from `lib/index.js` and falls back
 * to registering `ieg:governance` directly at the configured section order. Both
 * produce the same baseline, because section *text* is not recorded: IEG's own
 * wording may evolve without invalidating the baseline.
 */

import { DSH_PACKAGES, dshAvailable, dshVersion, loadCordis, loadSystemPrompt, loadTools } from '../test-support/dsh.js'
import { IEG_SECTION_NAME, BASELINE_VERSION, stableHash } from '../lib/kernel/compatibility.js'
import { resolveConfig } from '../lib/kernel/config.js'

/**
 * Host services this baseline actually requires. `systemPrompt` is IEG's `inject`
 * dependency (§29.4's "capability set for the declared host version"); the tool,
 * filesystem, storage, and approval seams are optional, so requiring them
 * would report a healthy host as `UNSUPPORTED`.
 */
const REQUIRED_CAPABILITIES = ['systemPrompt']

/**
 * Exit non-zero with a maintainer-readable message.
 *
 * @param {string} message
 * @returns {void}
 */
function fail(message) {
  process.stderr.write(`capture-baseline: ${message}\n`)
  process.exitCode = 1
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mount the real prompt and tool registries, exactly as the composition test does.
 *
 * @returns {Promise<any>} the mounted Cordis context
 */
async function bootServices() {
  const { Context } = await loadCordis()
  const systemPromptModule = await loadSystemPrompt()
  const toolsModule = await loadTools()

  const ctx = new Context()
  await ctx.plugin(systemPromptModule.default, { personaPrefix: '' })
  await ctx.plugin(toolsModule.ToolRuntime ?? toolsModule.default, {})
  return ctx
}

/**
 * Boot through the shipped plugin entry, so the capture exercises the same
 * registration path a real profile uses.
 *
 * @returns {Promise<any>}
 */
async function bootWithPlugin() {
  const ctx = await bootServices()
  const iegModule = await import('../lib/index.js')
  await ctx.plugin(iegModule, {})
  return ctx
}

/**
 * Fallback: register IEG's section directly at the configured order. Used only
 * when `lib/index.js` cannot be mounted (for example while it is being edited);
 * the captured facts are identical because the section's text is not recorded.
 *
 * @returns {Promise<any>}
 */
async function bootWithDirectSection() {
  const ctx = await bootServices()
  const config = resolveConfig(undefined)
  ctx.systemPrompt.section({
    name: IEG_SECTION_NAME,
    order: config.sectionOrder,
    interpolate: false,
    text: () => '',
  })
  return ctx
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  if (!dshAvailable()) {
    fail(`no DeepSeek Harness installation found under ${DSH_PACKAGES}; cannot capture a baseline`)
    return
  }

  /** @type {any} */
  let ctx
  try {
    ctx = await bootWithPlugin()
    const probe = await ctx.systemPrompt.assemble({})
    if (!probe.sections.some((/** @type {any} */ section) => section.name === IEG_SECTION_NAME)) {
      throw new Error(`the mounted plugin did not register the "${IEG_SECTION_NAME}" section`)
    }
  } catch (error) {
    process.stderr.write(
      `capture-baseline: mounting the IEG plugin failed (${messageOf(error)}); ` +
        `registering "${IEG_SECTION_NAME}" directly instead\n`,
    )
    try {
      ctx = await bootWithDirectSection()
    } catch (fallbackError) {
      fail(`could not boot the real system-prompt service: ${messageOf(fallbackError)}`)
      return
    }
  }

  /** @type {any} */
  let assembly
  try {
    assembly = await ctx.systemPrompt.assemble({})
  } catch (error) {
    fail(`the real system-prompt service failed to assemble: ${messageOf(error)}`)
    return
  }

  const sections = Array.isArray(assembly?.sections) ? assembly.sections : []
  const sectionNames = sections
    .map((/** @type {any} */ section) => section?.name)
    .filter((/** @type {unknown} */ name) => typeof name === 'string')

  if (!sectionNames.includes(IEG_SECTION_NAME)) {
    fail(`the assembled prompt does not contain "${IEG_SECTION_NAME}"; the baseline would be meaningless`)
    return
  }

  const hostTexts = sections
    .filter((/** @type {any} */ section) => section?.name !== IEG_SECTION_NAME)
    .map((/** @type {any} */ section) => (typeof section?.text === 'string' ? section.text : ''))

  const capabilities = REQUIRED_CAPABILITIES.filter(
    (/** @type {string} */ name) => typeof ctx.get === 'function' && ctx.get(name) !== undefined,
  )
  if (capabilities.length !== REQUIRED_CAPABILITIES.length) {
    fail(
      `required host capabilities are missing: ${REQUIRED_CAPABILITIES.filter((name) => !capabilities.includes(name)).join(', ')}`,
    )
    return
  }

  const baseline = {
    version: BASELINE_VERSION,
    hostVersion: dshVersion(),
    sectionNames,
    hostPromptHash: stableHash(hostTexts.join('\n')),
    capabilities,
  }
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`)
}

main().catch((error) => {
  fail(`unexpected failure: ${messageOf(error)}`)
})
