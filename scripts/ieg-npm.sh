#!/bin/sh
#
# ieg-npm.sh — thin wrapper over the `dsh-ieg` terminal interface's lifecycle.
#
# This script used to implement install/update/uninstall itself. Since 0.6.0 the
# lifecycle has exactly **one** implementation: `dsh-ieg install|update|uninstall`
# (a POST-INSTALL management command: `dsh-ieg` ships with the package, so a
# first-time install must go through `dsh plugin --profile <p> add <source>`).
# (compiled from `src/kernel/lifecycle.ts`). This wrapper exists only so
# existing callers of `scripts/ieg-npm.sh` keep working, and so nothing has to
# remember two sets of semantics.
#
# It adds nothing: every argument and every environment variable is passed
# through unchanged. That means `--profile`, `--home`, `--from`, `--allow-live`,
# `--dry-run` and `--json` all work exactly as `dsh-ieg --help` documents, and the
# npm cache still defaults to a writable home-local directory rather than the
# read-only `~/.npm`.
#
# Usage
# -----
#   scripts/ieg-npm.sh install   --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/ieg-npm.sh update    --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/ieg-npm.sh uninstall --profile <name> [--home <DSH_HOME>] [--allow-live]
#   scripts/ieg-npm.sh status    --profile <name> [--home <DSH_HOME>]
#
# Exit codes are the CLI's: 0 success · 1 verification/lifecycle failure ·
# 2 usage/environment (including the refusal to touch the live $HOME/.dsh).

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
IEG_BIN="${IEG_BIN:-${REPO_DIR}/bin/ieg}"
NODE_BIN="${NODE_BIN:-node}"

die() { printf 'ieg-npm: error: %s\n' "$1" >&2; exit 2; }

[ -f "$IEG_BIN" ] || die "the ieg shim is missing: $IEG_BIN"
command -v "$NODE_BIN" >/dev/null 2>&1 || die "'$NODE_BIN' not found on PATH"

exec "$NODE_BIN" "$IEG_BIN" "$@"
