#!/bin/sh
#
# abg-npm.sh — npm-native install / update / uninstall for the ABG DSH plugin.
#
# Why this exists
# ---------------
# `dsh plugin --profile <p> add|remove ...` forwards everything after `plugin`
# verbatim to **pnpm** (the host hard-codes the package manager; see
# `@deepseek-ai/dsh-plugin-manager/operations`). A host that only has npm cannot
# use that path. This script does the same job with npm and then performs the
# one step `dsh plugin` does *outside* the package manager: registering the
# package name in the profile manifest's `dsh.profile.bundles` list, which is
# what makes DSH compose the `abg` row at boot.
#
# Design rules
# ------------
#   * POSIX sh only, zero dependencies beyond `node`, `npm` and `dsh`.
#   * Fails loudly: every step checks its result and exits non-zero on error.
#   * Safe to run twice: `install` is idempotent (npm reports "up to date", the
#     bundle entry is de-duplicated); `uninstall` on a clean profile is a no-op
#     that still verifies absence.
#   * Never writes to the live profile (`$HOME/.dsh`) unless explicitly told
#     with `--allow-live` (or ABG_NPM_ALLOW_LIVE=1). `status` is read-only and
#     allowed anywhere.
#
# Usage
# -----
#   scripts/abg-npm.sh install   --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh update    --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh uninstall --profile <name> [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh status    --profile <name> [--home <DSH_HOME>]
#
# With no `--from`, `install`/`update` pack the repository's own `plugin/`
# directory with `npm pack` — the canonical artifact producer — and copy the
# resulting tarball into the profile before installing it. Installing the copy
# (not the original path) keeps the recorded dependency a stable
# `file:.abg-artifacts/<name>.tgz`, so the profile keeps working after the
# source tree or download directory moves.
#
# Exit codes: 0 success · 1 verification/lifecycle failure · 2 usage/environment.

set -eu

PKG="dsh-agent-behavioral-governance"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
PLUGIN_DIR="${REPO_DIR}/plugin"

DSH_BIN="${DSH_BIN:-dsh}"
NPM_BIN="${NPM_BIN:-npm}"
NODE_BIN="${NODE_BIN:-node}"
TEMPLATE="${ABG_PROFILE_TEMPLATE:-headless}"

die() { printf 'abg-npm: error: %s\n' "$1" >&2; exit "${2:-2}"; }
say() { printf 'abg-npm: %s\n' "$1"; }

usage() {
  sed -n 's/^# \{0,1\}//p' "$0" | sed -n '/^Usage$/,/^Exit codes/p'
}

ACTION=""
PROFILE=""
HOME_DIR=""
FROM=""
ALLOW_LIVE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    install|update|uninstall|status) ACTION="$1"; shift ;;
    --profile) [ "$#" -ge 2 ] || die "--profile needs a value"; PROFILE="$2"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --home) [ "$#" -ge 2 ] || die "--home needs a value"; HOME_DIR="$2"; shift 2 ;;
    --home=*) HOME_DIR="${1#*=}"; shift ;;
    --from) [ "$#" -ge 2 ] || die "--from needs a value"; FROM="$2"; shift 2 ;;
    --from=*) FROM="${1#*=}"; shift ;;
    --allow-live) ALLOW_LIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$ACTION" ] || { usage >&2; die "an action is required (install|update|uninstall|status)"; }
[ -n "$PROFILE" ] || { usage >&2; die "--profile is required"; }
case "$PROFILE" in
  ""|.|..|*/*|*\\*|node_modules) die "invalid profile name: $PROFILE" ;;
esac

[ -n "$HOME_DIR" ] || HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
# Normalize to an absolute, slash-trimmed path without requiring existence:
# the helper may create a throwaway home, but must never be fooled about which
# path is the live one.
case "$HOME_DIR" in /*) : ;; *) HOME_DIR="$(pwd)/$HOME_DIR" ;; esac
while [ "$HOME_DIR" != "/" ] && [ "${HOME_DIR%/}" != "$HOME_DIR" ]; do HOME_DIR="${HOME_DIR%/}"; done
LIVE_HOME="$HOME"
while [ "$LIVE_HOME" != "/" ] && [ "${LIVE_HOME%/}" != "$LIVE_HOME" ]; do LIVE_HOME="${LIVE_HOME%/}"; done
LIVE_HOME="$LIVE_HOME/.dsh"
if [ -d "$HOME_DIR" ]; then HOME_DIR=$(CDPATH= cd -- "$HOME_DIR" && pwd); fi
if [ -d "$LIVE_HOME" ]; then LIVE_HOME=$(CDPATH= cd -- "$LIVE_HOME" && pwd); fi
DSH_HOME="$HOME_DIR"
export DSH_HOME

# Keep npm's cache inside the DSH home we were pointed at unless the caller
# already chose one. A restricted environment can have a read-only ~/.npm, and
# then every npm operation fails with EROFS before it starts.
if [ -z "${npm_config_cache:-}" ]; then
  npm_config_cache="$HOME_DIR/.npm-cache"
  export npm_config_cache
fi

if [ "$ACTION" != "status" ] && [ "$HOME_DIR" = "$LIVE_HOME" ] && [ "$ALLOW_LIVE" -ne 1 ] && [ "${ABG_NPM_ALLOW_LIVE:-0}" != "1" ]; then
  die "refusing to modify the live profile home ($HOME_DIR); pass --allow-live (or set ABG_NPM_ALLOW_LIVE=1) if that is really intended"
fi

PROFILE_DIR="$HOME_DIR/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"

command -v "$NODE_BIN" >/dev/null 2>&1 || die "'$NODE_BIN' not found on PATH"
command -v "$NPM_BIN" >/dev/null 2>&1 || die "'$NPM_BIN' not found on PATH"
command -v "$DSH_BIN" >/dev/null 2>&1 || die "'$DSH_BIN' not found on PATH"

# JSON edit of dsh.profile.bundles. add = append if absent; remove = drop.
edit_bundles() {
  "$NODE_BIN" -e '
    const fs = require("fs");
    const file = process.argv[1];
    const pkg = process.argv[2];
    const mode = process.argv[3];
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    m.dsh = m.dsh || {};
    m.dsh.profile = m.dsh.profile || {};
    const list = Array.isArray(m.dsh.profile.bundles) ? m.dsh.profile.bundles : [];
    m.dsh.profile.bundles = mode === "add"
      ? (list.includes(pkg) ? list : list.concat([pkg]))
      : list.filter((name) => name !== pkg);
    fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  ' "$MANIFEST" "$PKG" "$1"
}

ensure_profile() {
  if [ ! -f "$MANIFEST" ]; then
    say "initializing profile \"$PROFILE\" from the \"$TEMPLATE\" template"
    "$DSH_BIN" --profile "$PROFILE" --from-default-profile "$TEMPLATE" --dump-config >/dev/null 2>&1 \
      || die "could not initialize profile \"$PROFILE\" (template: $TEMPLATE)"
  fi
  [ -f "$MANIFEST" ] || die "profile manifest missing after init: $MANIFEST"
}

# Print the resolved abg row (empty when it does not compose).
composed_row() {
  "$DSH_BIN" --profile "$PROFILE" --dump-config 2>/dev/null | grep -A4 'id: abg' || true
}

verify_present() {
  row=$(composed_row)
  [ -n "$row" ] || die "the abg row does not compose into profile \"$PROFILE\"; the npm install did not take effect"
  case "$row" in
    *"name: $PKG"*) : ;;
    *) die "the abg row does not name $PKG; got: $row" ;;
  esac
}

verify_absent() {
  if [ -n "$(composed_row)" ]; then
    die "the abg row still composes into profile \"$PROFILE\" after uninstall"
  fi
}

# Resolve --from (or pack the repo plugin) into a local tarball path or URL.
resolve_source() {
  if [ -n "$FROM" ]; then
    SOURCE="$FROM"
    return 0
  fi
  [ -f "$PLUGIN_DIR/package.json" ] || die "no --from given and $PLUGIN_DIR/package.json is missing"
  SCRATCH="$HOME_DIR/.abg-npm-cache"
  mkdir -p "$SCRATCH"
  rm -f "$SCRATCH/$PKG"-*.tgz
  say "packing $PLUGIN_DIR (npm pack)"
  ( cd "$PLUGIN_DIR" && "$NPM_BIN" pack --pack-destination "$SCRATCH" >/dev/null ) \
    || die "npm pack failed"
  SOURCE=""
  for candidate in "$SCRATCH/$PKG"-*.tgz; do
    [ -f "$candidate" ] && SOURCE="$candidate"
  done
  [ -n "$SOURCE" ] || die "npm pack produced no $PKG-*.tgz in $SCRATCH"
}

# Install (or update to) the artifact, then register the bundle. Idempotent.
do_install() {
  [ -d "$HOME_DIR" ] || mkdir -p "$HOME_DIR" || die "cannot create DSH_HOME: $HOME_DIR"
  ensure_profile
  resolve_source
  mkdir -p "$PROFILE_DIR/.abg-artifacts"
  if [ -f "$SOURCE" ]; then
    # A local tarball is copied into the profile first so the manifest records a
    # stable relative path (file:.abg-artifacts/...) instead of a path back into
    # the source tree or download directory.
    base=$(basename -- "$SOURCE")
    rm -f "$PROFILE_DIR/.abg-artifacts/$PKG"-*.tgz
    cp -- "$SOURCE" "$PROFILE_DIR/.abg-artifacts/$base"
    SPEC="./.abg-artifacts/$base"
    say "npm install $SPEC (into profile \"$PROFILE\")"
  else
    SPEC="$SOURCE"
    say "npm install $SPEC (into profile \"$PROFILE\")"
  fi
  ( cd "$PROFILE_DIR" && "$NPM_BIN" install --no-audit --no-fund "$SPEC" ) \
    || die "npm install failed for $SPEC"
  edit_bundles add
  verify_present
  version=$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' \
    "$PROFILE_DIR/node_modules/$PKG/package.json" 2>/dev/null || printf 'unknown')
  say "installed $PKG@$version into profile \"$PROFILE\""
  say "verify: $DSH_BIN --profile $PROFILE --dump-config | grep -A4 'id: abg'"
}

do_uninstall() {
  [ -d "$PROFILE_DIR" ] || die "profile directory does not exist: $PROFILE_DIR"
  if [ -f "$PROFILE_DIR/node_modules/$PKG/package.json" ] || grep -q "\"$PKG\"" "$MANIFEST" 2>/dev/null; then
    say "npm uninstall $PKG (from profile \"$PROFILE\")"
    ( cd "$PROFILE_DIR" && "$NPM_BIN" uninstall --no-audit --no-fund "$PKG" ) \
      || die "npm uninstall failed"
  else
    say "$PKG is not installed in profile \"$PROFILE\"; cleaning any stale bundle entry"
  fi
  if [ -f "$MANIFEST" ]; then edit_bundles remove; fi
  rm -rf "$PROFILE_DIR/.abg-artifacts"
  grep -q "\"$PKG\"" "$MANIFEST" 2>/dev/null && die "$PKG is still a dependency in $MANIFEST"
  verify_absent
  say "uninstalled; profile \"$PROFILE\" no longer composes an abg row"
}

do_status() {
  printf 'profile    %s\n' "$PROFILE"
  printf 'DSH_HOME   %s\n' "$HOME_DIR"
  # Read-only: never let `dsh --dump-config` initialize a profile that is not there.
  if [ ! -d "$PROFILE_DIR" ]; then
    printf 'package    NOT installed (no such profile)\n'
    printf 'composes   no\n'
    exit 1
  fi
  if [ -f "$PROFILE_DIR/node_modules/$PKG/package.json" ]; then
    ver=$("$NODE_BIN" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' \
      "$PROFILE_DIR/node_modules/$PKG/package.json" 2>/dev/null || printf '?')
    printf 'package    installed (version %s)\n' "$ver"
  else
    printf 'package    NOT installed\n'
  fi
  if grep -q "\"$PKG\"" "$MANIFEST" 2>/dev/null; then
    printf 'manifest   referenced in dsh.profile.bundles\n'
  else
    printf 'manifest   not referenced\n'
  fi
  row=$(composed_row)
  if [ -n "$row" ]; then
    printf 'composes   yes\n%s\n' "$row"
    exit 0
  fi
  printf 'composes   no\n'
  exit 1
}

case "$ACTION" in
  install|update) do_install ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
esac
