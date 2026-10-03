#!/bin/sh
#
# ieg-npm-lifecycle-check.sh — prove the npm-native plugin lifecycle end to end.
#
# Runs the exact sequence a user performs, in a throwaway DSH_HOME under the
# repository, and fails loudly if any step does not hold:
#
#   1. `npm pack` the shipped plugin (the canonical artifact producer)
#   2. install that tarball into a profile with scripts/ieg-npm.sh (npm only)
#   3. assert the `ieg` row composes into the profile tree (`dsh --dump-config`)
#   4. run install again — it must be a no-op, not a duplicate
#   5. uninstall with scripts/ieg-npm.sh
#   6. assert no `ieg` row composes and the profile manifest is clean
#   7. uninstall again — it must be a no-op
#
# It needs `dsh` (the composition check) and is therefore run by the
# host-backed CI job. It never reads or writes the invoking user's `~/.dsh`.
#
# Usage:  scripts/ieg-npm-lifecycle-check.sh
# Env:    DSH_BIN (default: dsh), NPM_BIN (default: npm),
#         IEG_LIFECYCLE_HOME (default: <repo>/.ieg-verify/lifecycle)
#
# Exit codes: 0 all checks passed · 1 a check failed · 2 environment error.

set -eu

# A read-only or absent $HOME makes the default ~/.npm unwritable, and `npm pack`
# then fails with EROFS — an environment fault, not a lifecycle fault. Pin the
# cache under the script scratch root; an explicit npm_config_cache still wins.
npm_config_cache="${npm_config_cache:-${IEG_LIFECYCLE_HOME:-$PWD/.ieg-verify/lifecycle}/npm-cache}"
export npm_config_cache
mkdir -p "$npm_config_cache" 2>/dev/null || true

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
PLUGIN_DIR="$REPO_DIR/plugin"
HELPER="$SCRIPT_DIR/ieg-npm.sh"
PKG="dsh-information-environment-governance"

DSH_BIN="${DSH_BIN:-dsh}"
NPM_BIN="${NPM_BIN:-npm}"
ROOT="${IEG_LIFECYCLE_HOME:-$REPO_DIR/.ieg-verify/lifecycle}"
ARTIFACTS="$ROOT/artifacts"
DSH_HOME="$ROOT/dsh-home"
PROFILE="iegnpmlifecycle"
mkdir -p "$ROOT" "$ARTIFACTS" "$DSH_HOME"
ROOT=$(CDPATH= cd -- "$ROOT" && pwd)
DSH_HOME="$ROOT/dsh-home"
export DSH_HOME

# npm needs a writable cache; a sandboxed ~/.npm can be read-only (EROFS).
export npm_config_cache="${npm_config_cache:-$ROOT/npm-cache}"

# Safety: never operate on the live home.
LIVE_HOME=""
if [ -d "$HOME/.dsh" ]; then LIVE_HOME=$(CDPATH= cd -- "$HOME/.dsh" && pwd); fi
if [ -n "$LIVE_HOME" ] && [ "$DSH_HOME" = "$LIVE_HOME" ]; then
  printf 'ieg-npm-lifecycle: refusing to run against the live DSH_HOME (%s)\n' "$DSH_HOME" >&2
  exit 2
fi

command -v "$DSH_BIN" >/dev/null 2>&1 || { printf 'ieg-npm-lifecycle: error: "%s" not found on PATH\n' "$DSH_BIN" >&2; exit 2; }
command -v "$NPM_BIN" >/dev/null 2>&1 || { printf 'ieg-npm-lifecycle: error: "%s" not found on PATH\n' "$NPM_BIN" >&2; exit 2; }
[ -x "$HELPER" ] || { printf 'ieg-npm-lifecycle: error: %s is not executable\n' "$HELPER" >&2; exit 2; }

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; }
step() { printf '\n[%s] %s\n' "$1" "$2"; }

row() { "$DSH_BIN" --profile "$PROFILE" --dump-config 2>/dev/null | grep -A4 'id: ieg' || true; }

# 1 ── pack ────────────────────────────────────────────────────────────────────
step 1 "npm pack the shipped plugin"
rm -f "$ARTIFACTS/$PKG"-*.tgz
if ( cd "$PLUGIN_DIR" && "$NPM_BIN" pack --pack-destination "$ARTIFACTS" >/dev/null 2>&1 ); then
  TARBALL=""
  for candidate in "$ARTIFACTS/$PKG"-*.tgz; do [ -f "$candidate" ] && TARBALL="$candidate"; done
  if [ -n "$TARBALL" ]; then ok "tarball produced: $(basename -- "$TARBALL")"; else bad "npm pack produced no tarball"; fi
else
  bad "npm pack failed"
fi
[ -n "${TARBALL:-}" ] || { printf '\nieg-npm-lifecycle: cannot continue without a tarball\n' >&2; exit 1; }

# 2 ── npm-native install ─────────────────────────────────────────────────────
step 2 "npm-native install into profile \"$PROFILE\""
rm -rf "$DSH_HOME/profiles/$PROFILE"
if "$DSH_BIN" --profile "$PROFILE" --from-default-profile headless --dump-config >/dev/null 2>&1; then
  ok "throwaway profile created"
else
  bad "profile creation failed"; printf '\nieg-npm-lifecycle: aborting\n' >&2; exit 1
fi
if "$HELPER" install --profile "$PROFILE" --home "$DSH_HOME" --from "$TARBALL" >/dev/null 2>&1; then
  ok "ieg-npm.sh install"
else
  bad "ieg-npm.sh install"; "$HELPER" install --profile "$PROFILE" --home "$DSH_HOME" --from "$TARBALL"; exit 1
fi
MANIFEST="$DSH_HOME/profiles/$PROFILE/package.json"
if [ -f "$DSH_HOME/profiles/$PROFILE/node_modules/$PKG/package.json" ]; then ok "package present in the profile"; else bad "package missing from the profile"; fi
if grep -q "\"$PKG\"" "$MANIFEST" 2>/dev/null; then ok "registered in the profile manifest"; else bad "not registered in the profile manifest"; fi

# 3 ── the row composes ───────────────────────────────────────────────────────
step 3 "assert the ieg row composes"
COMPOSED=$(row)
if [ -n "$COMPOSED" ]; then ok "the ieg row composes into the tree"; else bad "the ieg row does not compose"; fi
if printf '%s\n' "$COMPOSED" | grep -q "name: $PKG"; then ok "the row names $PKG"; else bad "the row does not name $PKG"; fi

# 4 ── re-install is a no-op ──────────────────────────────────────────────────
step 4 "install again (idempotent)"
if "$HELPER" install --profile "$PROFILE" --home "$DSH_HOME" --from "$TARBALL" >/dev/null 2>&1; then
  ok "second install exits 0"
else
  bad "second install failed"
fi
if [ "$(row)" = "$COMPOSED" ]; then ok "the composed row is unchanged (no duplicate)"; else bad "the composed row changed on re-install"; fi

# 5 ── uninstall ──────────────────────────────────────────────────────────────
step 5 "npm-native uninstall"
if "$HELPER" uninstall --profile "$PROFILE" --home "$DSH_HOME" >/dev/null 2>&1; then
  ok "ieg-npm.sh uninstall"
else
  bad "ieg-npm.sh uninstall"
fi
if [ -f "$DSH_HOME/profiles/$PROFILE/node_modules/$PKG/package.json" ]; then bad "package still on disk after uninstall"; else ok "package removed from disk"; fi
if grep -q "\"$PKG\"" "$MANIFEST" 2>/dev/null; then bad "dependency still in the profile manifest"; else ok "dependency removed from the profile manifest"; fi

# 6 ── the row is gone ────────────────────────────────────────────────────────
step 6 "assert the ieg row is gone"
if [ -z "$(row)" ]; then ok "no ieg row composes after uninstall"; else bad "the ieg row still composes after uninstall"; fi
if [ -z "$("$DSH_BIN" --profile "$PROFILE" --dump-config 2>&1 >/dev/null | grep 'skipping profile bundle')" ]; then
  ok "no stale-bundle warning on a clean profile"
else
  bad "the profile still warns about a skipped bundle"
fi

# 7 ── uninstall again is a no-op ─────────────────────────────────────────────
step 7 "uninstall again (idempotent)"
if "$HELPER" uninstall --profile "$PROFILE" --home "$DSH_HOME" >/dev/null 2>&1; then
  ok "second uninstall exits 0"
else
  bad "second uninstall failed"
fi
if [ -z "$(row)" ]; then ok "still absent after the second uninstall"; else bad "row reappeared"; fi

printf '\n=== ieg npm lifecycle summary: %d passed, %d failed ===\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
