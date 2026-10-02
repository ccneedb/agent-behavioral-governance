#!/bin/sh
#
# check-docs.sh — documentation health for the ABG repository.
#
# POSIX sh, zero dependencies beyond the base utilities. Rules enforced:
#   (a) no broken relative link in a governed document;
#   (b) every governed document has owner and last_reviewed front matter;
#   (c) every governed document is listed in docs/DOCUMENTATION-INDEX.md;
#   (d) every last_reviewed value parses as YYYY-MM-DD.
#
# Governed documents are the root *.md files and docs/*.md. The YAML issue
# forms and the pull-request template are exempt from front matter by design;
# see docs/DOCUMENTATION-INDEX.md.
#
# Usage:  ./scripts/check-docs.sh
# Exit:   0 all rules hold · 1 at least one failure.

set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INDEX_REL="docs/DOCUMENTATION-INDEX.md"
INDEX="$ROOT/$INDEX_REL"

ERRFILE="${TMPDIR:-/tmp}/abg-check-docs.$$.err"
INDEXED="${TMPDIR:-/tmp}/abg-check-docs.$$.idx"
cleanup() { rm -f "$ERRFILE" "$INDEXED" "${INDEXED}.links"; }
trap cleanup EXIT HUP INT TERM

report() {
  printf 'check-docs: FAIL: %s\n' "$1" >&2
  printf '%s\n' "$1" >>"$ERRFILE"
}

# relpath FILE -> path relative to the repository root
relpath() {
  printf '%s' "$1" | sed -e "s|^$ROOT/||"
}

# links_of FILE -> one raw Markdown link target per line
links_of() {
  grep -oE '\]\([^)]*\)' "$1" 2>/dev/null | sed -e 's/^](//' -e 's/)$//'
}

# resolve_link DIR TARGET -> repository-relative normalized path, or nothing
# for an external/anchor target.
resolve_link() {
  _dir=$1
  _t=$2
  case "$_t" in
    ''|'#'*|http://*|https://*|mailto:*) return 0 ;;
  esac
  _t=${_t%%#*}
  _t=$(printf '%s' "$_t" | sed -e 's/^<//' -e 's/>$//')
  [ -n "$_t" ] || return 0
  printf '%s/%s\n' "$_dir" "$_t" | awk -F/ '{
    abs = (substr($0, 1, 1) == "/") ? "/" : ""
    depth = 0
    for (i = 1; i <= NF; i++) {
      s = $i
      if (s == "" || s == ".") continue
      if (s == "..") { if (depth > 0) depth--; continue }
      st[++depth] = s
    }
    out = ""
    for (i = 1; i <= depth; i++) out = out (i > 1 ? "/" : "") st[i]
    print abs out
  }'
}

# --- 1. collect the governed documents --------------------------------------
set -- "$ROOT"/*.md "$ROOT"/docs/*.md
doc_count=0
for f in "$@"; do
  [ -f "$f" ] || continue
  doc_count=$((doc_count + 1))
done

# --- 2. index coverage: the set of documents the index links to --------------
: >"$INDEXED"
if [ ! -f "$INDEX" ]; then
  report "index is missing: $INDEX_REL"
else
  links_of "$INDEX" | while IFS= read -r target; do
    resolved=$(resolve_link "$ROOT/docs" "$target") || resolved=""
    [ -n "$resolved" ] || continue
    printf '%s\n' "$resolved" | sed -e "s|^$ROOT/||"
  done >"$INDEXED"
fi

# --- 3. per-document checks -------------------------------------------------
for f in "$@"; do
  [ -f "$f" ] || continue
  rel=$(relpath "$f")

  # (b) front matter present with owner and last_reviewed
  first_line=$(sed -n '1p' "$f")
  if [ "$first_line" != "---" ]; then
    report "$rel: missing front matter (first line must be ---)"
  else
    fm=$(awk 'NR == 1 { next } /^---[[:space:]]*$/ { exit } { print }' "$f")
    owner=$(printf '%s\n' "$fm" | sed -n 's/^owner:[[:space:]]*//p' | head -n 1 | tr -d '\r')
    reviewed=$(printf '%s\n' "$fm" | sed -n 's/^last_reviewed:[[:space:]]*//p' | head -n 1 | tr -d '\r')
    if [ -z "$owner" ]; then
      report "$rel: front matter has no owner"
    fi
    if [ -z "$reviewed" ]; then
      report "$rel: front matter has no last_reviewed"
    elif ! printf '%s\n' "$reviewed" | grep -Eq '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'; then
      # (d) unparsable date
      report "$rel: last_reviewed is not YYYY-MM-DD: $reviewed"
    fi
  fi

  # (c) listed in the index
  if ! grep -Fxq "$rel" "$INDEXED"; then
    report "$rel: not listed in $INDEX_REL"
  fi

  # (a) relative links resolve
  dir=$(dirname "$f")
  links_of "$f" >"${INDEXED}.links"
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    case "$target" in
      ''|'#'*|http://*|https://*|mailto:*) continue ;;
    esac
    path=${target%%#*}
    path=$(printf '%s' "$path" | sed -e 's/^<//' -e 's/>$//')
    [ -n "$path" ] || continue
    if [ ! -e "$dir/$path" ]; then
      report "$rel: broken relative link: $target"
    fi
  done <"${INDEXED}.links"
done

rm -f "${INDEXED}.links"

if [ -s "$ERRFILE" ]; then
  printf '\ncheck-docs: %s\n' "$(grep -c . "$ERRFILE") problem(s) in $doc_count governed document(s)." >&2
  exit 1
fi

printf 'check-docs: ok — %s governed documents, front matter, index coverage and links all valid.\n' "$doc_count"
exit 0
