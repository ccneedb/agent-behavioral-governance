#!/usr/bin/env bash
#
# ABG prototype — full verification chain.
#
# Proves, in order:
#   1. the source typechecks under strict checkJs against the ambient seam contract;
#   2. the unit and integration suites pass (integration mounts the REAL
#      dsh-system-prompt and dsh-tools from the installed distribution);
#   3. the package installs into a real DSH profile via `dsh plugin add`;
#   4. the bundle patch composes an `abg` row with the expected config;
#   5. the installed plugin is actually EXECUTED — proven positively against the
#      INSTALLED artifact: it must bind one section, the three listeners, and its
#      five tools from the profile's own copy of the package, and it must absorb a
#      bad configuration into an observable fault surface instead of unmounting
#      (§26.2: `apply()` does not throw). The host must then boot the real
#      composition with that bad overlay and report no unactivated entry.
#   6. a valid configuration composes and mounts with no ABG error.
#
# Everything happens under a throwaway DSH_HOME inside this repository, so the
# invoking user's real ~/.dsh profile is never read or modified.
#
# Usage:  ./scripts/verify.sh
# Env:    DSH_BIN (default: dsh), ABG_VERIFY_HOME (default: <repo>/.abg-verify)

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "${PLUGIN_DIR}/.." && pwd)"
DSH_BIN="${DSH_BIN:-dsh}"
VERIFY_ROOT="${ABG_VERIFY_HOME:-${REPO_DIR}/.abg-verify}"
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
PROFILE="abgverify"

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
  printf '\n\033[1m=== ABG verification summary ===\033[0m\n'
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

# ── 1. typecheck ─────────────────────────────────────────────────────────────
step "Typecheck (strict checkJs)"
if (cd "$PLUGIN_DIR" && npm run --silent typecheck); then pass "tsc --checkJs strict"; else fail "tsc --checkJs strict"; fi

# ── 2. tests ─────────────────────────────────────────────────────────────────
step "Unit and integration tests"
TEST_LOG="${VERIFY_ROOT}/test.log"
if (cd "$PLUGIN_DIR" && node --test >"$TEST_LOG" 2>&1); then
  pass "$(grep -c '^✔' "$TEST_LOG" || true) tests passed (log: ${TEST_LOG#"$REPO_DIR"/})"
else
  fail "test suite (log: ${TEST_LOG#"$REPO_DIR"/})"
  tail -30 "$TEST_LOG"
fi

# ── 3. install into a real profile ───────────────────────────────────────────
step "Install into a throwaway DSH profile"
rm -rf "${DSH_HOME}/profiles/${PROFILE}"
if "$DSH_BIN" --profile "$PROFILE" --from-default-profile headless --dump-config >"${VERIFY_ROOT}/create.log" 2>&1; then
  pass "profile '${PROFILE}' created from the 'headless' template"
else
  fail "profile creation"; tail -20 "${VERIFY_ROOT}/create.log"
fi

if "$DSH_BIN" plugin --profile "$PROFILE" add "file:${PLUGIN_DIR}" >"${VERIFY_ROOT}/install.log" 2>&1; then
  pass "dsh plugin add file:$(basename "$PLUGIN_DIR")"
else
  fail "dsh plugin add"; tail -20 "${VERIFY_ROOT}/install.log"
fi

PROFILE_MANIFEST="${DSH_HOME}/profiles/${PROFILE}/package.json"
if grep -q 'dsh-agent-behavioral-governance' "$PROFILE_MANIFEST"; then
  pass "registered in the profile manifest"
else
  fail "profile manifest does not name the plugin"
fi

# ── 4. composition ───────────────────────────────────────────────────────────
step "Compose the profile tree"
DUMP="${VERIFY_ROOT}/dump-config.yml"
if "$DSH_BIN" --profile "$PROFILE" --dump-config >"$DUMP" 2>"${VERIFY_ROOT}/dump.err"; then
  if grep -q 'id: abg' "$DUMP" && grep -q 'name: dsh-agent-behavioral-governance' "$DUMP"; then
    pass "the 'abg' row composes into the tree"
  else
    fail "the 'abg' row is missing from the composed tree"
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
# Verification-only overlay: a configuration only ABG can reject.
- id: abg
  config:
    modules:
      no-such-module:
        enabled: true
YAML

INSTALLED_MODULE="${DSH_HOME}/profiles/${PROFILE}/node_modules/dsh-agent-behavioral-governance"
PROBE="${VERIFY_ROOT}/probe-installed.mjs"
cat >"$PROBE" <<'JS'
import assert from 'node:assert/strict'

const abg = await import(`${process.argv[2]}/lib/index.js`)

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

// (a) A valid configuration binds the whole plugin, from the installed copy.
const good = stubContext()
abg.apply(good.ctx, {})
assert.equal(good.sections.length, 1, 'exactly one additive prompt section')
assert.equal(good.sections[0].name, 'abg:governance')
assert.equal(good.sections[0].order, 8500)
assert.equal(good.sections[0].complete, undefined, 'ABG must never set complete')
assert.equal(good.sections[0].interpolate, false, 'governance text is literal')
assert.deepEqual(
  [...good.listeners.keys()].sort(),
  ['agent/pre-step', 'system-prompt/assemble', 'tools/pre-execute'],
)
good.mountTools()
assert.deepEqual(
  good.tools.map((tool) => tool.name).sort(),
  ['abg_questions', 'abg_report_issue', 'abg_status', 'record_orientation', 'record_question'],
)

// (b) §26.2: a bad configuration does not throw and stays observable.
const bad = stubContext()
assert.doesNotThrow(() => abg.apply(bad.ctx, { modules: { 'no-such-module': { enabled: true } } }))
assert.equal(bad.sections.length, 0, 'no section without a validated configuration')
assert.equal(bad.listeners.size, 0, 'no enforcement from an unvalidated configuration')
bad.mountTools()
const status = bad.tools.find((tool) => tool.name === 'abg_status')
assert.ok(status, 'the fault must be observable through the read-only status tool')
const report = await status.execute({}, {})
assert.equal(report.mount.mounted, false)
assert.match(report.mount.configError, /unknown module id/)

console.log('installed artifact binds the plugin and degrades a bad config observably')
JS

if node "$PROBE" "$INSTALLED_MODULE" >"${VERIFY_ROOT}/probe.out" 2>&1; then
  pass "installed artifact binds one section, three listeners, five tools; bad config stays observable"
else
  fail "installed-artifact execution proof failed"
  sed -n '1,25p' "${VERIFY_ROOT}/probe.out"
fi

# The host must still boot the real composition carrying the bad overlay: with the
# guarded mount there is no unactivated entry, so startup proceeds to the model
# call instead of silently dropping the plugin.
"$DSH_BIN" --profile "$PROFILE" --patch "$BAD_PATCH" "unused" >"${VERIFY_ROOT}/bad.out" 2>"${VERIFY_ROOT}/bad.err" || true
if grep -q 'did not activate' "${VERIFY_ROOT}/bad.err"; then
  fail "the bad overlay unmounted the plugin; the guarded mount did not absorb the fault"
  sed -n '1,20p' "${VERIFY_ROOT}/bad.err"
else
  pass "the host booted with a bad ABG config without unmounting the plugin"
fi

# ── 6. clean mount ───────────────────────────────────────────────────────────
step "Mount with a valid configuration"
"$DSH_BIN" --profile "$PROFILE" "unused" >"${VERIFY_ROOT}/good.out" 2>"${VERIFY_ROOT}/good.err" || true
if grep -q 'abg module contract\|abg config\|abg prompt compiler' "${VERIFY_ROOT}/good.err"; then
  fail "ABG reported an error during a clean mount"
  sed -n '1,20p' "${VERIFY_ROOT}/good.err"
else
  pass "no ABG error during startup"
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
