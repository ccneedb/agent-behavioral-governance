#!/usr/bin/env bash
#
# check-install.sh — is IEG installed into a DSH profile, and will it load?
#
# Answers the question a volunteer actually has after `dsh plugin add`: "the
# plugin list does not show it and I cannot tell whether it is running." DSH
# lists the bundles of the profile you are RUNNING, so installing into one
# profile and running another looks exactly like a failed install. This script
# checks the profile you name and says which situation you are in.
#
# Usage:  ./scripts/check-install.sh [profile]
#         ./scripts/check-install.sh            # uses $DSH_PROFILE, else 'web'
# Env:    DSH_BIN (default: dsh), DSH_HOME (default: ~/.dsh)
#
# It also reports which other profiles already have IEG installed, because DSH
# lists the bundles of the profile you RUN: installing into one profile and
# running another looks exactly like a failed install.
#
# Inspect the running profile from the terminal with `dsh-ieg status` (control
# state, generation, PROMPT_VERSION, and whether the row composes); `dsh-ieg pause`
# / `dsh-ieg start` / `dsh-ieg exit` switch governance without touching the
# installation.
#
# Read-only with one caveat: `dsh --dump-config` materialises a temporary
# `cordis.yml` inside the profile directory, so that directory must be writable
# by the user running this script. Where it is not (a sandboxed or read-only
# home), the composition check reports UNKNOWN rather than pretending the plugin
# is inactive.
#
# Exit codes: 0 composes · 1 not installed or not composed · 3 composition could
# not be verified here · 2 usage/environment error.

set -uo pipefail

DSH_BIN="${DSH_BIN:-dsh}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PACKAGE="dsh-information-environment-governance"
PROFILE="${1:-${DSH_PROFILE:-web}}"
PROFILE_DIR="${DSH_HOME}/profiles/${PROFILE}"
INSTALLED_MANIFEST="${PROFILE_DIR}/node_modules/${PACKAGE}/package.json"
PROFILE_MANIFEST="${PROFILE_DIR}/package.json"

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  printf 'error: "%s" not found on PATH; set DSH_BIN\n' "$DSH_BIN" >&2
  exit 2
fi

printf 'IEG install check\n'
printf '  profile    %s\n' "$PROFILE"
printf '  DSH_HOME   %s\n' "$DSH_HOME"
printf '\n'

installed=no
referenced=no
composes=unknown
version=''
PROFILES_DIR="${DSH_HOME}/profiles"

if [ ! -d "$PROFILE_DIR" ]; then
  printf '  [x] profile directory does not exist: %s\n' "$PROFILE_DIR"
  printf '\n  Profiles present:\n'
  ls -1 "${DSH_HOME}/profiles" 2>/dev/null | sed 's/^/    /' || printf '    (none)\n'
  printf '\nVERDICT: NOT INSTALLED — no such profile. Install into one, e.g.:\n'
  printf '  %s plugin --profile ieg-test add "<package reference>"\n' "$DSH_BIN"
  exit 1
fi
printf '  [ok] profile directory exists\n'

# 1. Is the package physically present, and at which version?
if [ -f "$INSTALLED_MANIFEST" ]; then
  installed=yes
  version="$(grep -m1 '"version"' "$INSTALLED_MANIFEST" | sed 's/.*: *"//; s/".*//')"
  printf '  [ok] package installed (version %s)\n' "${version:-unknown}"
else
  printf '  [x]  package not installed at %s\n' "$INSTALLED_MANIFEST"
fi

# 2. Does the profile manifest reference it (dependency and/or bundle)?
if grep -q "$PACKAGE" "$PROFILE_MANIFEST" 2>/dev/null; then
  referenced=yes
  printf '  [ok] referenced by the profile manifest\n'
else
  printf '  [x]  not referenced by the profile manifest\n'
fi

# 3. The decisive check: does the composed tree contain the ieg row?
DUMP="$(mktemp)"
DUMP_ERR="$(mktemp)"
if "$DSH_BIN" --profile "$PROFILE" --dump-config >"$DUMP" 2>"$DUMP_ERR"; then
  if grep -q 'id: ieg' "$DUMP" && grep -q "name: ${PACKAGE}" "$DUMP"; then
    composes=yes
    order="$(grep -A6 'id: ieg' "$DUMP" | grep -m1 'sectionOrder' | sed 's/.*: *//')"
    printf '  [ok] the ieg row composes into the profile tree (sectionOrder %s)\n' "${order:-?}"
  else
    composes=no
    printf '  [x]  no ieg row in the composed tree\n'
  fi
else
  if grep -qE 'EROFS|EACCES|read-only file system|permission denied' "$DUMP_ERR"; then
    composes=unknown
    printf '  [?]  composition not verifiable here: the profile directory is not writable\n'
    printf '       (%s)\n' "$(grep -m1 -oE '(EROFS|EACCES|read-only file system|permission denied)[^,]*' "$DUMP_ERR" || printf 'permission error')"
    printf '       `%s --dump-config` writes a temporary cordis.yml into the profile.\n' "$DSH_BIN"
  else
    composes=no
    printf '  [x]  `%s --profile %s --dump-config` failed:\n' "$DSH_BIN" "$PROFILE"
    sed -n '1,3p' "$DUMP_ERR" | sed 's/^/       /'
  fi
fi
rm -f "$DUMP" "$DUMP_ERR"

# 4. Which other profiles already have IEG installed?
sibling_installed=''
for dir in "${PROFILES_DIR}"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ "$name" = "$PROFILE" ] && continue
  [ -f "${dir}node_modules/${PACKAGE}/package.json" ] || continue
  sibling_installed="${sibling_installed}${name} "
done
if [ -n "$sibling_installed" ]; then
  printf '  [i]  IEG is also installed in: %s\n' "$sibling_installed"
fi

printf '\n'
if [ "$installed" = "yes" ] && [ "$composes" = "yes" ]; then
  printf 'VERDICT: IEG WILL LOAD in profile "%s".\n' "$PROFILE"
  printf '  Inspect it from a Debian shell:\n'
  printf '    dsh-ieg status --profile %s\n' "$PROFILE"
  printf '  `dsh-ieg pause` / `dsh-ieg start` switch governance for that profile without\n'
  printf '  touching the installation; `dsh-ieg exit` switches it off.\n'
  printf '  DSH lists the bundles of the profile you RUN, so installing into one profile\n'
  printf '  while running another looks exactly like a failed install.\n'
  exit 0
fi

if [ "$installed" = "yes" ] && [ "$composes" = "unknown" ]; then
  printf 'VERDICT: INSTALLED AND REFERENCED in profile "%s"; composition UNVERIFIED.\n' "$PROFILE"
  printf '  The package is on disk and named by the profile manifest, so it should\n'
  printf '  mount. Re-run this script where that profile directory is writable to\n'
  printf '  confirm the composed tree, or boot the profile and call `ieg_status`:\n'
  printf '    %s --profile %s "<task>"\n' "$DSH_BIN" "$PROFILE"
  exit 3
fi

if [ "$installed" = "no" ] && [ "$referenced" = "no" ]; then
  printf 'VERDICT: NOT INSTALLED in profile "%s".\n' "$PROFILE"
  printf '    %s plugin --profile %s add "<package reference>"\n' "$DSH_BIN" "$PROFILE"
  if [ -n "$sibling_installed" ]; then
    printf '  Note: it IS installed in %s — if you are running one of those, IEG is\n' "$sibling_installed"
    printf '  already active there and this profile is simply a different one.\n'
  fi
  exit 1
fi

printf 'VERDICT: INSTALLED BUT NOT ACTIVE in profile "%s".\n' "$PROFILE"
printf '  Re-run the install (the profile links the plugin at install time):\n'
printf '    %s plugin --profile %s add "<package reference>"\n' "$DSH_BIN" "$PROFILE"
printf '  Note: everything after `plugin --profile <name>` is forwarded to pnpm, so\n'
printf '  launcher flags such as --from-default-profile belong before `plugin`.\n'
exit 1
