#!/usr/bin/env bash
#
# check-install.sh — is ABG installed into a DSH profile, and will it load?
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
# It also answers the two follow-ups that decide whether a panel can appear at
# all: whether THIS profile is able to host the Web GUI (a headless profile has no
# web app, so no panel exists there by construction), and which other profiles
# already have ABG installed.
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
PACKAGE="dsh-agent-behavioral-governance"
PROFILE="${1:-${DSH_PROFILE:-web}}"
PROFILE_DIR="${DSH_HOME}/profiles/${PROFILE}"
INSTALLED_MANIFEST="${PROFILE_DIR}/node_modules/${PACKAGE}/package.json"
PROFILE_MANIFEST="${PROFILE_DIR}/package.json"

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  printf 'error: "%s" not found on PATH; set DSH_BIN\n' "$DSH_BIN" >&2
  exit 2
fi

printf 'ABG install check\n'
printf '  profile    %s\n' "$PROFILE"
printf '  DSH_HOME   %s\n' "$DSH_HOME"
printf '\n'

installed=no
referenced=no
composes=unknown
gui=unknown
version=''
PROFILES_DIR="${DSH_HOME}/profiles"

if [ ! -d "$PROFILE_DIR" ]; then
  printf '  [x] profile directory does not exist: %s\n' "$PROFILE_DIR"
  printf '\n  Profiles present:\n'
  ls -1 "${DSH_HOME}/profiles" 2>/dev/null | sed 's/^/    /' || printf '    (none)\n'
  printf '\nVERDICT: NOT INSTALLED — no such profile. Install into one, e.g.:\n'
  printf '  %s plugin --profile abg-test add "<package reference>"\n' "$DSH_BIN"
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

# 3. The decisive check: does the composed tree contain the abg row?
DUMP="$(mktemp)"
DUMP_ERR="$(mktemp)"
if "$DSH_BIN" --profile "$PROFILE" --dump-config >"$DUMP" 2>"$DUMP_ERR"; then
  if grep -q 'id: abg' "$DUMP" && grep -q "name: ${PACKAGE}" "$DUMP"; then
    composes=yes
    order="$(grep -A6 'id: abg' "$DUMP" | grep -m1 'sectionOrder' | sed 's/.*: *//')"
    printf '  [ok] the abg row composes into the profile tree (sectionOrder %s)\n' "${order:-?}"
  else
    composes=no
    printf '  [x]  no abg row in the composed tree\n'
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

# 4. Can this profile host the Web GUI at all? A headless profile has no web app,
#    so no panel can appear there however the plugin is installed.
if [ -f "$DUMP" ] && [ -s "$DUMP" ]; then
  if grep -qE 'dsh-web-app|dsh-host-webserver' "$DUMP"; then
    gui=yes
    printf '  [ok] this profile can host the Web GUI (a web app is composed)\n'
  else
    gui=no
    printf '  [x]  this profile has no web app: it cannot show a GUI panel\n'
  fi
fi
rm -f "$DUMP" "$DUMP_ERR"

# 5. Which other profiles already have ABG installed, and can they show a panel?
sibling_installed=''
sibling_gui=''
for dir in "${PROFILES_DIR}"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ "$name" = "$PROFILE" ] && continue
  [ -f "${dir}node_modules/${PACKAGE}/package.json" ] || continue
  sibling_installed="${sibling_installed}${name} "
  if grep -q 'dsh-web-app' "${dir}package.json" 2>/dev/null; then
    sibling_gui="${sibling_gui}${name} "
  fi
done
if [ -n "$sibling_installed" ]; then
  printf '  [i]  ABG is also installed in: %s\n' "$sibling_installed"
  [ -n "$sibling_gui" ] && printf '       of those, Web-capable: %s\n' "$sibling_gui"
fi

printf '\n'
if [ "$installed" = "yes" ] && [ "$composes" = "yes" ]; then
  if [ "$gui" = "yes" ]; then
    printf 'VERDICT: ABG WILL LOAD, and the Web GUI panel is available in profile "%s".\n' "$PROFILE"
    printf '  Start that profile as the Web app and open the ABG entry in the sidebar:\n'
    printf '    %s --profile %s\n' "$DSH_BIN" "$PROFILE"
    printf '  If the panel says "ABG status is unavailable", the plugin mounted nothing:\n'
    printf '  a config value it rejects disables it silently, so check the installed\n'
    printf '  version is 0.5.1 or later.\n'
  else
    printf 'VERDICT: ABG WILL LOAD in profile "%s", but that profile cannot show the panel.\n' "$PROFILE"
    printf '  It composes no web app, so\n'
    printf '    %s --profile %s "<task>"\n' "$DSH_BIN" "$PROFILE"
    printf '  is a headless run: there is no GUI in that process, so no panel can appear,\n'
    printf '  however the plugin is installed. Install it into a profile you run as the\n'
    printf '  Web app, then start that profile:\n'
    printf '    %s plugin --profile <web-profile> add "<package reference>"\n' "$DSH_BIN"
    printf '    %s --profile <web-profile>\n' "$DSH_BIN"
    [ -n "$sibling_gui" ] && printf '  Already Web-capable with ABG installed: %s\n' "$sibling_gui"
  fi
  printf '  DSH lists the bundles of the profile you RUN, so installing into one profile\n'
  printf '  while running another looks exactly like a failed install.\n'
  exit 0
fi

if [ "$installed" = "yes" ] && [ "$composes" = "unknown" ]; then
  printf 'VERDICT: INSTALLED AND REFERENCED in profile "%s"; composition UNVERIFIED.\n' "$PROFILE"
  printf '  The package is on disk and named by the profile manifest, so it should\n'
  printf '  mount. Re-run this script where that profile directory is writable to\n'
  printf '  confirm the composed tree, or boot the profile and call `abg_status`:\n'
  printf '    %s --profile %s "<task>"\n' "$DSH_BIN" "$PROFILE"
  exit 3
fi

if [ "$installed" = "no" ] && [ "$referenced" = "no" ]; then
  printf 'VERDICT: NOT INSTALLED in profile "%s".\n' "$PROFILE"
  printf '    %s plugin --profile %s add "<package reference>"\n' "$DSH_BIN" "$PROFILE"
  if [ -n "$sibling_gui" ]; then
    printf '  Note: it IS installed in %s — if you are running one of those, ABG is\n' "$sibling_gui"
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
