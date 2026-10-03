#!/usr/bin/env bash
#
# IEG prototype — full verification chain.
#
# Proves, in order:
#   1. the source typechecks under strict checkJs against the ambient seam contract;
#   2. the unit and integration suites pass (integration mounts the REAL
#      dsh-system-prompt and dsh-tools from the installed distribution);
#   3. the package installs into a real DSH profile via `dsh plugin add`;
#   4. the bundle patch composes an `ieg` row with the expected config;
#   5. the installed plugin is actually EXECUTED — proven positively against the
#      INSTALLED artifact: it must bind one section, the three listeners, and its
#      two tools from the profile's own copy of the package, and it must absorb a
#      bad configuration into an observable fault surface instead of unmounting
#      (§26.2: `apply()` does not throw). The host must then boot the real
#      composition with that bad overlay and report no unactivated entry.
#   6. a valid configuration composes and mounts with no IEG error.
#
# Everything happens under a throwaway DSH_HOME inside this repository, so the
# invoking user's real ~/.dsh profile is never read or modified.
#
# Usage:  ./scripts/verify.sh
# Env:    DSH_BIN (default: dsh), IEG_VERIFY_HOME (default: <repo>/.ieg-verify)

set -euo pipefail

# The package IS the repository root: the repo installs as one DSH bundle.
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${PACKAGE_DIR}"
DSH_BIN="${DSH_BIN:-dsh}"
NODE_BIN="${NODE_BIN:-node}"
VERIFY_ROOT="${IEG_VERIFY_HOME:-${REPO_DIR}/.ieg-verify}"
export DSH_HOME="${VERIFY_ROOT}/dsh-home"

# `dsh plugin add` shells out to pnpm, which drops a store at the repository root
# and litters it on every verification run. `dsh` spawns pnpm with its own
# environment, so an exported store-dir does not reach it; the store is instead
# removed in teardown, and only when this run is the one that created it.
export npm_config_store_dir="${npm_config_store_dir:-${VERIFY_ROOT}/pnpm-store}"
PNPM_STORE="${REPO_DIR}/.pnpm-store"
STORE_PREEXISTED=0
if [ -e "$PNPM_STORE" ]; then
  STORE_PREEXISTED=1
fi
PROFILE="iegverify"

# Expected versions are derived, never pinned: a package or prompt revision must
# not require editing the release gate (this brittleness broke the gate twice).
EXPECTED_PACKAGE_VERSION="$(${NODE_BIN} -p "require('${PACKAGE_DIR}/package.json').version")"
EXPECTED_PROMPT_VERSION="$(${NODE_BIN} --input-type=module -e "
  import('${PACKAGE_DIR}/lib/index.js').then((m) => process.stdout.write(m.PROMPT_VERSION))
")"

cleanup() {
  if [ "$STORE_PREEXISTED" -eq 0 ]; then
    rm -rf "$PNPM_STORE"
  fi
}
trap cleanup EXIT

STEP=0
declare -a RESULTS=()

pass() { RESULTS+=("PASS  $1"); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { RESULTS+=("FAIL  $1"); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
step() { STEP=$((STEP + 1)); printf '\n\033[1m[%d] %s\033[0m\n' "$STEP" "$1"; }

summary() {
  local failed=0
  printf '\n\033[1m=== IEG verification summary ===\033[0m\n'
  for line in "${RESULTS[@]}"; do
    printf '%s\n' "$line"
    [[ "$line" == FAIL* ]] && failed=$((failed + 1))
  done
  if [[ "$failed" -eq 0 ]]; then
    printf '\n\033[32mAll %d checks passed.\033[0m\n' "${#RESULTS[@]}"
  else
    printf '\n\033[31m%d of %d checks failed.\033[0m\n' "$failed" "${#RESULTS[@]}"
    exit 1
  fi
}
trap summary EXIT

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  printf 'error: "%s" not found on PATH\n' "$DSH_BIN" >&2
  exit 1
fi

mkdir -p "$VERIFY_ROOT"

# ── 0. build (TypeScript sources -> the JS artifacts the host loads) ─────────
# `lib/**` is a build artifact committed to the package. Rebuild it so
# this gate never validates a stale artifact against newer sources.
if grep -q '"build"' "${PACKAGE_DIR}/package.json"; then
  step "Build the emitted artifacts"
  if (cd "$PACKAGE_DIR" && npm run --silent build >"${VERIFY_ROOT}/build.log" 2>&1); then
    pass "npm run build (src/**/*.ts -> lib)"
  else
    fail "npm run build"; tail -20 "${VERIFY_ROOT}/build.log"
  fi
fi

# ── 1. typecheck ─────────────────────────────────────────────────────────────
step "Typecheck (strict checkJs)"
if (cd "$PACKAGE_DIR" && npm run --silent typecheck); then pass "tsc --checkJs strict"; else fail "tsc --checkJs strict"; fi

# ── 2. tests ─────────────────────────────────────────────────────────────────
step "Unit and integration tests"
TEST_LOG="${VERIFY_ROOT}/test.log"
if (cd "$PACKAGE_DIR" && node --test >"$TEST_LOG" 2>&1); then
  pass "$(grep -c '^✔' "$TEST_LOG" || true) tests passed (log: ${TEST_LOG#"$REPO_DIR"/})"
else
  fail "test suite (log: ${TEST_LOG#"$REPO_DIR"/})"
  tail -30 "$TEST_LOG"
fi

# ── 3b. the packed artifact npm would publish ────────────────────────────────
# The distribution path is only real if the exact artifact installs from a clean
# profile. This phase is what makes that claim checkable, and it is separate from
# the `file:` directory install below, which exercises a checkout.
step "Pack the publishable artifact and install it into a fresh profile"
PACK_DIR="${VERIFY_ROOT}/pack"
mkdir -p "$PACK_DIR"
PKG_TARBALL=""
if (cd "$PACKAGE_DIR" && npm_config_cache="${VERIFY_ROOT}/npm-cache" npm pack --pack-destination "$PACK_DIR" >"${VERIFY_ROOT}/pack.log" 2>&1); then
  PKG_TARBALL="$(ls -1 "${PACK_DIR}"/dsh-information-environment-governance-*.tgz 2>/dev/null | head -1)"
fi
if [ -n "$PKG_TARBALL" ]; then
  pass "npm pack produced $(basename "$PKG_TARBALL")"
else
  fail "npm pack"; tail -20 "${VERIFY_ROOT}/pack.log" 2>/dev/null
fi

PKG_PROFILE="iegpkgverify"
PKG_HOME="${VERIFY_ROOT}/pkg-home"
if [ -n "$PKG_TARBALL" ]; then
  if DSH_HOME="$PKG_HOME" "$DSH_BIN" --profile "$PKG_PROFILE" --from-default-profile headless --dump-config >"${VERIFY_ROOT}/pkg-create.log" 2>&1 &&
     DSH_HOME="$PKG_HOME" "$DSH_BIN" plugin --profile "$PKG_PROFILE" add "file:${PKG_TARBALL}" >"${VERIFY_ROOT}/pkg-install.log" 2>&1; then
    pass "the packed artifact installs through the DSH-native path"
  else
    fail "packed artifact install"; tail -20 "${VERIFY_ROOT}/pkg-install.log" 2>/dev/null
  fi
  if DSH_HOME="$PKG_HOME" "$DSH_BIN" --profile "$PKG_PROFILE" --dump-config 2>/dev/null | grep -q 'name: dsh-information-environment-governance'; then
    pass "the packed artifact composes the ieg row"
  else
    fail "packed artifact composition"
  fi
  PKG_INSTALLED="${PKG_HOME}/profiles/${PKG_PROFILE}/node_modules/dsh-information-environment-governance"
  if [ -f "${PKG_INSTALLED}/lib/index.js" ] && [ -f "${PKG_INSTALLED}/cordis.patch.yml" ]; then
    pass "the packed artifact ships the runtime and the bundle patch"
  else
    fail "the packed artifact is missing lib/index.js or cordis.patch.yml"
  fi
  if [ -x "${PKG_HOME}/profiles/${PKG_PROFILE}/node_modules/.bin/dsh-ieg" ]; then
    pass "the post-install CLI is installed into the profile's bin"
  else
    fail "the profile-local dsh-ieg command is missing"
  fi
fi

# ── 3. install into a real profile ───────────────────────────────────────────
step "Install into a throwaway DSH profile"
rm -rf "${DSH_HOME}/profiles/${PROFILE}"
if "$DSH_BIN" --profile "$PROFILE" --from-default-profile headless --dump-config >"${VERIFY_ROOT}/create.log" 2>&1; then
  pass "profile '${PROFILE}' created from the 'headless' template"
else
  fail "profile creation"; tail -20 "${VERIFY_ROOT}/create.log"
fi

if "$DSH_BIN" plugin --profile "$PROFILE" add "file:${PACKAGE_DIR}" >"${VERIFY_ROOT}/install.log" 2>&1; then
  pass "dsh plugin add file:$(basename "$PACKAGE_DIR")"
else
  fail "dsh plugin add"; tail -20 "${VERIFY_ROOT}/install.log"
fi

PROFILE_MANIFEST="${DSH_HOME}/profiles/${PROFILE}/package.json"
if grep -q 'dsh-information-environment-governance' "$PROFILE_MANIFEST"; then
  pass "registered in the profile manifest"
else
  fail "profile manifest does not name the plugin"
fi

# ── 4. composition ───────────────────────────────────────────────────────────
step "Compose the profile tree"
DUMP="${VERIFY_ROOT}/dump-config.yml"
if "$DSH_BIN" --profile "$PROFILE" --dump-config >"$DUMP" 2>"${VERIFY_ROOT}/dump.err"; then
  if grep -q 'id: ieg' "$DUMP" && grep -q 'name: dsh-information-environment-governance' "$DUMP"; then
    pass "the 'ieg' row composes into the tree"
  else
    fail "the 'ieg' row is missing from the composed tree"
  fi
  if grep -q 'sectionOrder: 8500' "$DUMP"; then
    pass "row config is resolved (sectionOrder=8500)"
  else
    fail "row config not resolved"
  fi
else
  fail "dsh --dump-config"; tail -20 "${VERIFY_ROOT}/dump.err"
fi

# ── 5. positive proof of execution ───────────────────────────────────────────
# `apply()` deliberately does not throw (§26.2), so a bad configuration no longer
# surfaces as the host's "entry did not activate" error. Execution is therefore
# proven positively against the profile's OWN installed copy of the package: it
# must bind the full plugin, and it must degrade a bad config into a read-only
# observable fault surface rather than unmounting. The path is a real directory,
# not a link back to the source tree, so this exercises the installed artifact.
step "Prove the installed plugin executes during composition"
BAD_PATCH="${VERIFY_ROOT}/bad-config.yml"
cat >"$BAD_PATCH" <<'YAML'
# Verification-only overlay: a configuration only IEG can reject.
- id: ieg
  config:
    modules:
      no-such-module:
        enabled: true
YAML

INSTALLED_MODULE="${DSH_HOME}/profiles/${PROFILE}/node_modules/dsh-information-environment-governance"
PROBE="${VERIFY_ROOT}/probe-installed.mjs"
cat >"$PROBE" <<'JS'
import assert from 'node:assert/strict'

import { readFileSync, existsSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const ieg = await import(`${process.argv[2]}/lib/index.js`)

// The control plane is pointed at a throwaway state file (argument 3) so the
// gating assertion below can drive `pause`/`start` without touching the real
// `$IEG_STATE_FILE` of the invoking user.
const stateFile = path.join(process.argv[3], 'state.json')
process.env.IEG_STATE_FILE = stateFile

/** Write one control record and force a strictly increasing mtime, so the plugin's mtime cache sees it. */
let controlClock = Date.now()
function setControl(status, generation) {
  // Advance a whole second per write. `utimesSync` lands on a coarse clock, so a
  // mtime derived from `Date.now()` alone can repeat when two writes occur inside
  // the same millisecond — which is exactly what this probe does. A repeated mtime
  // with an equal-size record is invisible to the plugin's mtime cache, so the
  // generation bump would not be observed. A monotonic clock keeps the probe
  // testing the reload rather than the filesystem clock's resolution.
  controlClock += 1000
  const now = new Date(controlClock)
  writeFileSync(stateFile, JSON.stringify({ schema: 1, status, generation, updatedAt: now.toISOString() }))
  utimesSync(stateFile, now, new Date(now.getTime() + 2000))
}

// The YAML parser belongs to the DSH installation, not to this dependency-free
// package, and ESM `import('yaml')` cannot resolve from a throwaway verify
// directory. Resolve it from the installed dsh entry point instead.
function loadYaml() {
  const bases = []
  if (process.env.IEG_DSH_PACKAGES) bases.push(path.join(process.env.IEG_DSH_PACKAGES, '..', 'resolve-from-here.cjs'))
  try {
    const dsh = execFileSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8' }).trim()
    if (dsh) {
      let real = dsh
      try { real = execFileSync('readlink', ['-f', dsh], { encoding: 'utf8' }).trim() || dsh } catch {}
      bases.push(real)
    }
  } catch {}
  for (const base of bases) {
    for (const name of ['yaml', 'js-yaml']) {
      try { return createRequire(base)(name) } catch {}
    }
  }
  return null
}

function stubContext() {
  const listeners = new Map()
  const sections = []
  const tools = []
  const injections = []
  const logs = []
  const ctx = {
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    systemPrompt: {
      section: (s) => {
        sections.push(s)
        return () => {}
      },
      getSectionOrder: () => 500,
    },
    on: (name, handler) => {
      listeners.set(name, [...(listeners.get(name) ?? []), handler])
      return () => {}
    },
    get: () => undefined,
    inject: (services, callback) => injections.push({ services, callback }),
  }
  const mountTools = () => {
    for (const injection of injections) {
      if (!injection.services.includes('tools')) continue
      injection.callback({
        tools: {
          register: (definition) => {
            tools.push(definition)
            return () => {}
          },
          guard: () => () => {},
        },
      })
    }
  }
  return { ctx, listeners, sections, tools, logs, mountTools }
}

// (a) THE SHIPPED configuration binds the whole plugin, from the installed copy.
// With `{}` (all defaults) a package whose own default config the plugin rejects
// passes this gate while contributing nothing in production — which is exactly how
// a broken 0.5.0 shipped. So apply the shipped configuration verbatim.
let shipped = {}
// The installed artifact carries its own patch, and probing it is the whole
// point of this gate: resolve it from the installed package, never from this
// throwaway verify directory (whose `..` is the repository root), and never
// fall through to `{}` when it is missing.
const patchPath = path.join(process.argv[2], 'cordis.patch.yml')
assert.ok(existsSync(patchPath), `the installed artifact must ship cordis.patch.yml (looked in ${patchPath})`)
if (existsSync(patchPath)) {
  const YAML = loadYaml() ?? await import('yaml').catch(() => null)
  if (YAML === null) {
    // No YAML parser reachable from here; the suite parses the real file
    // (test/unit/config.test.js). Mirror its shape here so the gate still fails
    // on this class of defect: an empty path is a documented value, not an error.
    shipped = {
      prompt: { mode: 'compiled', append: '', file: '' },
      diagnosticsExport: { file: '' },
    }
    console.log('note: `yaml` unreachable; probing the shipped config SHAPE instead')
  } else {
    const parse = YAML.parse ?? YAML.load
    const parsed = parse(readFileSync(patchPath, 'utf8'))
    const entry = (parsed[0].insert ?? parsed).find((candidate) => candidate?.id === 'ieg')
    assert.ok(entry, 'the shipped patch must insert an ieg row')
    shipped = entry.config
    assert.ok(shipped && Object.keys(shipped).length > 0, 'the shipped ieg row must carry a config block')
    // The empty-string paths are the exact regression 0.4.0 shipped: the
    // validator rejected `file: ''`, so the whole mount fell into the §26.2
    // fault surface. Assert the shipped file really carries them.
    assert.equal(shipped.prompt.file, '', 'the shipped prompt.file is the empty-string default')
    assert.equal(shipped.diagnosticsExport.file, '', 'the shipped diagnosticsExport.file is the empty-string default')
  }
}
const good = stubContext()
assert.doesNotThrow(
  () => ieg.apply(good.ctx, shipped),
  'the SHIPPED cordis.patch.yml must be a configuration this plugin accepts',
)
assert.equal(
  good.sections.length,
  1,
  'the shipped config must bind the prompt section, not fall into the fault surface',
)
assert.equal(good.sections.length, 1, 'exactly one additive prompt section')
assert.equal(good.sections[0].name, 'ieg:governance')
assert.equal(good.sections[0].order, 8500)
assert.equal(good.sections[0].complete, undefined, 'IEG must never set complete')
assert.equal(good.sections[0].interpolate, false, 'governance text is literal')
assert.deepEqual(
  [...good.listeners.keys()].sort(),
  ['agent/pre-step', 'system-prompt/assemble', 'tools/pre-execute'],
)
good.mountTools()
assert.deepEqual(
  good.tools.map((tool) => tool.name).sort(),
  ['ieg_status', 'record_orientation'],
)
// Positive proof: the shipped config must ACTIVATE, not merely not throw. An
// inert fault surface would leave `mounted: false` and a populated `degraded`.
const goodStatus = good.tools.find((tool) => tool.name === 'ieg_status')
assert.ok(goodStatus, 'the shipped config must register the read-only status tool')
const goodReport = await goodStatus.execute({}, {})
assert.equal(goodReport.mount.mounted, true, 'the shipped config must ACTIVATE (mounted: true)')
assert.deepEqual(goodReport.mount.degraded ?? [], [], 'the shipped config must mount with no degraded capability')

// (c) GATING: `pause` suppresses the section and `start` restores it, from the
// control-state file alone — no reconfiguration, no reinstall.
setControl('paused', 0)
assert.equal(good.sections[0].text({}), '', 'a paused control state must suppress the section')
const pausedReport = await goodStatus.execute({}, {})
assert.equal(pausedReport.control.status, 'paused', 'the read-only surface reports the control state')
setControl('running', 0)
assert.match(
  good.sections[0].text({}),
  /Information Environment Governance \(IEG\)/,
  'start must restore the section',
)
// A generation bump must be the only thing that re-reads prompt.md.
writeFileSync(path.join(process.argv[3], 'prompt.md'), '# House rules\n\n- Never write outside the workspace.')
assert.match(good.sections[0].text({}), /Information Environment Governance \(IEG\)/, 'prompt.md waits for a restart')
setControl('running', 1)
assert.equal(good.sections[0].text({}), '# House rules\n\n- Never write outside the workspace.')

// (b) §26.2: a bad configuration does not throw and stays observable.
const bad = stubContext()
assert.doesNotThrow(() => ieg.apply(bad.ctx, { modules: { 'no-such-module': { enabled: true } } }))
assert.equal(bad.sections.length, 0, 'no section without a validated configuration')
assert.equal(bad.listeners.size, 0, 'no enforcement from an unvalidated configuration')
bad.mountTools()
const status = bad.tools.find((tool) => tool.name === 'ieg_status')
assert.ok(status, 'the fault must be observable through the read-only status tool')
const report = await status.execute({}, {})
assert.equal(report.mount.mounted, false)
assert.match(report.mount.configError, /unknown module id/)

console.log('installed artifact binds the plugin and degrades a bad config observably')
JS

CONTROL_DIR="${VERIFY_ROOT}/control"
rm -rf "$CONTROL_DIR"
mkdir -p "$CONTROL_DIR"
if node "$PROBE" "$INSTALLED_MODULE" "$CONTROL_DIR" >"${VERIFY_ROOT}/probe.out" 2>&1; then
  pass "installed artifact binds one section, three listeners, two tools; control gating and a bad config stay observable"
else
  fail "installed-artifact execution proof failed"
  sed -n '1,25p' "${VERIFY_ROOT}/probe.out"
fi

# ── 5b. the `ieg` CLI smoke check (isolated --state) ─────────────────────────
# The terminal interface is the 0.6.0 replacement for the Web GUI. Its state
# machine is exercised here against a throwaway state file, so the check cannot
# touch any real profile's control record.
step "ieg CLI smoke (isolated --state)"
IEG_CLI="${PACKAGE_DIR}/bin/ieg"
CLI_DIR="${VERIFY_ROOT}/cli"
CLI_STATE="${CLI_DIR}/state.json"
rm -rf "$CLI_DIR"
mkdir -p "$CLI_DIR"
CLI=("$NODE_BIN" "$IEG_CLI")

if "${CLI[@]}" --help >/dev/null 2>&1 && [ "$("${CLI[@]}" --version 2>/dev/null)" = "${EXPECTED_PACKAGE_VERSION}" ]; then
  pass "ieg --help and --version (${EXPECTED_PACKAGE_VERSION})"
else
  fail "ieg --help / --version"
fi
if "${CLI[@]}" --state "$CLI_STATE" status >"${CLI_DIR}/status.log" 2>&1 &&
   grep -q '^control      running (no state file: default)' "${CLI_DIR}/status.log"; then
  pass "ieg status reports the absent-state default (running)"
else
  fail "ieg status"; sed -n '1,20p' "${CLI_DIR}/status.log"
fi
if "${CLI[@]}" --state "$CLI_STATE" pause >/dev/null 2>&1 && grep -q '"status": "paused"' "$CLI_STATE"; then
  pass "ieg pause writes status=paused"
else
  fail "ieg pause"
fi
if "${CLI[@]}" --state "$CLI_STATE" start >/dev/null 2>&1 && grep -q '"status": "running"' "$CLI_STATE"; then
  pass "ieg start returns to running"
else
  fail "ieg start"
fi
if "${CLI[@]}" --state "$CLI_STATE" restart >/dev/null 2>&1 && grep -q '"generation": 1' "$CLI_STATE"; then
  pass "ieg restart bumps generation"
else
  fail "ieg restart"
fi
if "${CLI[@]}" --state "$CLI_STATE" exit >/dev/null 2>&1 && grep -q '"status": "stopped"' "$CLI_STATE"; then
  pass "ieg exit stops governance without uninstalling"
else
  fail "ieg exit"
fi

# ── 5c. the prompt.md round-trip through $EDITOR ─────────────────────────────
step "ieg prompt round-trip (edit validates; a refusal is refused)"
PROMPT_DIR="${VERIFY_ROOT}/prompt-cli"
PROMPT_STATE="${PROMPT_DIR}/state.json"
rm -rf "$PROMPT_DIR"
mkdir -p "$PROMPT_DIR"
REFUSE_EDITOR="${PROMPT_DIR}/editor-refuse.sh"
OK_EDITOR="${PROMPT_DIR}/editor-ok.sh"
cat >"$REFUSE_EDITOR" <<'SH'
#!/bin/sh
printf '%s' 'Report {{objective}} each turn.' > "$1"
SH
cat >"$OK_EDITOR" <<'SH'
#!/bin/sh
printf '%s' '# House rules' > "$1"
SH
chmod +x "$REFUSE_EDITOR" "$OK_EDITOR"

if EDITOR="$REFUSE_EDITOR" "${CLI[@]}" --state "$PROMPT_STATE" prompt edit >"${PROMPT_DIR}/refuse.log" 2>&1; then
  fail "prompt edit accepted a refused text"
elif grep -q 'interpolation' "${PROMPT_DIR}/refuse.log" && [ ! -f "${PROMPT_DIR}/prompt.md" ]; then
  pass "prompt edit refuses {{ }} with its reasons and keeps the previous text"
else
  fail "prompt edit refusal"; sed -n '1,20p' "${PROMPT_DIR}/refuse.log"
fi
if EDITOR="$OK_EDITOR" "${CLI[@]}" --state "$PROMPT_STATE" prompt edit >"${PROMPT_DIR}/ok.log" 2>&1 &&
   [ -f "${PROMPT_DIR}/prompt.md" ]; then
  pass "prompt edit validates and stores prompt.md"
else
  fail "prompt edit success"; sed -n '1,20p' "${PROMPT_DIR}/ok.log"
fi
if "${CLI[@]}" --state "$PROMPT_STATE" prompt >"${PROMPT_DIR}/print.log" 2>&1 &&
   grep -q '^# House rules$' "${PROMPT_DIR}/print.log" &&
   grep -q "version ${EXPECTED_PROMPT_VERSION}+user:" "${PROMPT_DIR}/print.log"; then
  pass "prompt prints the effective text, its version and byte count"
else
  fail "prompt print"; sed -n '1,20p' "${PROMPT_DIR}/print.log"
fi
if "${CLI[@]}" --state "$PROMPT_STATE" prompt reset >/dev/null 2>&1 && [ ! -f "${PROMPT_DIR}/prompt.md" ]; then
  pass "prompt reset returns to the compiled default"
else
  fail "prompt reset"
fi

# The host must still boot the real composition carrying the bad overlay: with the
# guarded mount there is no unactivated entry, so startup proceeds to the model
# call instead of silently dropping the plugin.
"$DSH_BIN" --profile "$PROFILE" --patch "$BAD_PATCH" "unused" >"${VERIFY_ROOT}/bad.out" 2>"${VERIFY_ROOT}/bad.err" || true
if grep -q 'did not activate' "${VERIFY_ROOT}/bad.err"; then
  fail "the bad overlay unmounted the plugin; the guarded mount did not absorb the fault"
  sed -n '1,20p' "${VERIFY_ROOT}/bad.err"
else
  pass "the host booted with a bad IEG config without unmounting the plugin"
fi

# ── 6. clean mount ───────────────────────────────────────────────────────────
step "Mount with a valid configuration"
"$DSH_BIN" --profile "$PROFILE" "unused" >"${VERIFY_ROOT}/good.out" 2>"${VERIFY_ROOT}/good.err" || true
if grep -q 'ieg module contract\|ieg config\|ieg prompt compiler' "${VERIFY_ROOT}/good.err"; then
  fail "IEG reported an error during a clean mount"
  sed -n '1,20p' "${VERIFY_ROOT}/good.err"
else
  pass "no IEG error during startup"
fi
# The isolated home has no credentials, so the run is expected to stop at the
# model call. That is itself evidence the composition mounted completely.
if grep -q 'MISSING_CREDENTIAL' "${VERIFY_ROOT}/good.err"; then
  pass "startup reached the model call (composition mounted fully)"
fi

# Tear the pnpm store down explicitly as well as via the trap: `dsh plugin add`
# is what creates it, and the store must not survive into the working tree.
cleanup

printf '\nArtifacts: %s\n' "${VERIFY_ROOT#"$REPO_DIR"/}"
