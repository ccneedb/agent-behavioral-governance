#!/bin/sh
#
# abg-npm.sh — thin wrapper over the `abg` terminal interface's lifecycle.
#
# This script used to implement install/update/uninstall itself. Since 0.6.0 the
# lifecycle has exactly **one** implementation: `abg install|update|uninstall`
# (compiled from `plugin/src/kernel/lifecycle.ts`). This wrapper exists only so
# existing callers of `scripts/abg-npm.sh` keep working, and so nothing has to
# remember two sets of semantics.
#
# It adds nothing: every argument and every environment variable is passed
# through unchanged. That means `--profile`, `--home`, `--from`, `--allow-live`,
# `--dry-run` and `--json` all work exactly as `abg --help` documents, and the
# npm cache still defaults to a writable home-local directory rather than the
# read-only `~/.npm`.
#
# Usage
# -----
#   scripts/abg-npm.sh install   --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh update    --profile <name> [--from <tarball|url|dir>] [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh uninstall --profile <name> [--home <DSH_HOME>] [--allow-live]
#   scripts/abg-npm.sh status    --profile <name> [--home <DSH_HOME>]
#
# Exit codes are the CLI's: 0 success · 1 verification/lifecycle failure ·
# 2 usage/environment (including the refusal to touch the live $HOME/.dsh).

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
ABG_BIN="${ABG_BIN:-${REPO_DIR}/plugin/bin/abg}"
NODE_BIN="${NODE_BIN:-node}"

die() { printf 'abg-npm: error: %s\n' "$1" >&2; exit 2; }

[ -f "$ABG_BIN" ] || die "the abg shim is missing: $ABG_BIN"
command -v "$NODE_BIN" >/dev/null 2>&1 || die "'$NODE_BIN' not found on PATH"

exec "$NODE_BIN" "$ABG_BIN" "$@"
