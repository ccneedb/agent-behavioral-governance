---
doc_type: testing-guide
project: agent-behavioral-governance
version: 0.1.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
audience: volunteers
language: en
---

# Volunteer testing guide

ABG is a **prototype**: the model-backed behavioural gates (C, D, E) have no
valid measurement yet, the package is `"private": true`, and the publish target is
undecided. That is exactly why volunteer testing matters — the missing evidence is
behavioural, and it can only come from real sessions. Current status and numbers:
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4.

This guide covers how to **install**, how to **run a useful trial**, and how to
**report a behavioural deviation**. Read [`SECURITY.md`](SECURITY.md) first: ABG
is a governance layer, not a sandbox, and it is not a security control.

## 1. What you need

| Requirement | Notes |
|---|---|
| Node.js **>= 20** | the host and the tests both need it |
| DeepSeek Harness (`dsh`) | verified against `@deepseek-ai/dsh` `0.2.0-rc.2`; the declared peer range is `>=0.2.0-rc.2 <0.3.0` |
| A **throwaway** DSH profile | never test in a profile you rely on |

## 2. Install

ABG is installed into a profile, not globally. The canonical commands are in
[`README.md`](README.md) §Install — one local `file:` path and two download routes
(a release tarball, or a clone). Use that block; it is not restated here.

> **Command syntax gotcha.** Everything after `dsh plugin --profile <name>` is
> forwarded **verbatim to pnpm**, so launcher flags such as
> `--from-default-profile`, `--dump-config`, or `--patch` must never appear there
> — you will get `Usage: pnpm [OPTIONS] <COMMAND>`. Launcher flags go with the
> launcher: `dsh --profile <name> --from-default-profile headless --dump-config`.

`dsh plugin --profile <name> add` initializes the profile if it does not exist
yet, so an explicit creation step is optional — it only lets you choose the
template. A profile **links the plugin at install time**, so **re-install after
any source change** or you will keep exercising the old code.

### Did it actually load?

Installing is not the same as running. Check the composed tree first, then the
package on disk, then ask the plugin about itself:

```bash
# 1. Is the row in THIS profile's composed tree? (the decisive check)
dsh --profile abg-test --dump-config | grep -A4 'id: abg'

# 2. Is the package on disk, and which version?
cat "$DSH_HOME/profiles/abg-test/node_modules/dsh-agent-behavioral-governance/package.json" 2>/dev/null | grep '"version"'

# 3. Boot that profile and ask ABG about itself (in-session)
dsh --profile abg-test "<any task>"
#   then call the read-only `abg_status` tool, or read the `abg:status` line
```

Or let the checker do all of it — run it from a repository clone, since it does
not ship in the release tarball:

```bash
./scripts/check-install.sh abg-test
```

**Why the plugin list can still look empty.** DSH shows the bundles of the
profile you are **running**, not the ones you installed elsewhere. If you
installed into `abg-test` while your app runs the `web` profile, ABG will never
appear in that list — correctly. Either run the profile you installed into
(`dsh --profile abg-test …`), or install into the profile you actually run:

```bash
dsh plugin --profile web add "<same package reference>"
```

**Inspect it from the terminal.** ABG 0.6.0 has no Web panel. Run `abg status`
(see §3) to see the mount and control state, and `abg pause` / `abg start` to
switch governance for the profile without touching the installation.

Installing into the live `web` profile modifies it. The project does not
recommend it while the behavioural gates (C, D, E) are unmeasured — see
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §10.

## 3. Configure it for a first trial

ABG's defaults are deliberately non-intrusive, but two settings fail *closed*
where no approval channel exists (headless, CI). For a first trial, prefer:

```yaml
# overlay.yml — apply with: dsh --profile abg-test --patch overlay.yml "<task>"
- id: abg
  config:
    workspace:
      policy: allow            # do not ask for approval on every write
      overlapCheck: ask        # keep the duplicate-document check armed
      protectedPaths: []       # add paths you never want touched
    preStep:
      orientationGate: off     # observe only; use 'warn' to see the signal
      requireBeforeMutation: false
```

If you *want* to test the gates themselves, set `policy: ask` or `deny` and
`requireBeforeMutation: true`, and record what happened — that is the behaviour
the project most needs evidence about.

### Seeing it from the terminal: `abg`

The terminal interface is the fastest way to answer "is ABG even doing anything?",
which is otherwise indistinguishable from silence. Build it once and put it on
`PATH`:

```bash
cd plugin && npm run build
export PATH="$PWD/bin:$PATH"

abg status                 # control status, generation, prompt and install/compose state
abg pause                  # governance section suppressed, hooks pass through
abg start                  # back to normal
abg restart                # generation+1: reload config and prompt.md
abg exit                   # governance off for this profile; the install is untouched
```

- **`abg prompt`** prints the effective section, its version and its byte count;
  **`abg prompt edit`** opens `$EDITOR` on a temp copy and stores the result only
  after the same validation the plugin applies (`{{ }}` and the byte ceiling are
  refused, with reasons); **`abg prompt reset`** deletes `prompt.md` and returns
  to the compiled default.
- `prompt.md` lives beside the control-state file (`$ABG_STATE_FILE`, else
  `<state-dir>/abg/state.json` with `<state-dir>` = `$XDG_STATE_HOME` or
  `~/.local/state`). The plugin re-reads it on `restart`.
- Every command also works non-interactively with flags (`--state`, `--json`,
  …) because CI and scripts call it; run `abg` with no arguments for the ANSI
  menu, or `abg --help` for the full surface.
- Use `abg status --json` to capture machine-readable state for a report.

## 4. What a useful trial looks like

1. **Run one real task** with ABG enabled, in a copy of a workspace you can lose.
2. **Note the interaction**: did ABG ask, deny, or stay silent? Was the outcome
   right?
3. **Run the same task with ABG disabled.** Removing the `- id: abg` row from the
   overlay is **not** enough: the profile still mounts the plugin with defaults.
   Use `enabled: false` in the overlay, uninstall ABG ([`README.md`](README.md)
   §Install), or use a second profile with no ABG row. This A/B is the single most
   valuable thing you can contribute: it separates an ABG defect from a host or
   model defect.
4. **Capture state** by asking the agent to call `abg_status`, or by running
   `abg status --json`, or by reading the diagnostics mirror if the profile sets
   `diagnosticsExport.file`.

Metrics the project is trying to establish are listed in
[`eval/README.md`](eval/README.md): questions per batch, user interruptions,
false blocks, and whether known-invalid information stops being reused.

#### Method C — the `abg` lifecycle (npm only, no pnpm required)

If pnpm is unavailable, the same lifecycle runs through the `abg` terminal
interface, which uses npm and registers the profile bundle itself:

```bash
abg install   --profile abg-test                 # npm pack + npm install + bundle registration
abg status    --profile abg-test                 # package, manifest and composed-row state
abg uninstall --profile abg-test
```

`dsh plugin` forwards to pnpm and additionally registers the profile bundle; plain
`npm install` does not, which is why the command exists. It never touches `~/.dsh`
without `--allow-live`, and it defaults npm's cache to a writable home-local
directory rather than a read-only `~/.npm`. `scripts/abg-npm.sh` is a thin
wrapper over these commands for callers that already used it; see
[`plugin/README.md`](plugin/README.md) §Terminal interface.

## 5. Uninstall

Use `abg uninstall --profile <name>` (or the uninstall command in
[`README.md`](README.md) §Install). Note that governance state lives in the
profile's `ctx.storageDomain`, and any `prompt.file` or `diagnosticsExport.file`
you configured stays where you put it.

**`abg exit` is not uninstall.** It sets the profile's control status to
`stopped`: no governance prompt section is emitted and every hook passes through,
but the package stays installed and `abg start` resumes it. Only
`abg install | update | uninstall` touch the installation.

## 6. Report a behavioural deviation

A deviation report is an **ordinary GitHub issue**. Use the repository's issue
form:

- **Bug report** — [`.github/ISSUE_TEMPLATE/bug_report.yml`](.github/ISSUE_TEMPLATE/bug_report.yml)
- **Feature request** — [`.github/ISSUE_TEMPLATE/feature_request.yml`](.github/ISSUE_TEMPLATE/feature_request.yml)

Include, in the form's own fields:

1. the task you ran and the workspace shape (a copy you can share);
2. the A/B result from §4 — the same task with `abg exit` (or `enabled: false`);
3. `abg status --json`, which carries the plugin version, `PROMPT_VERSION`, the
   control state and generation, and the install/compose state;
4. what you expected and what happened, in project terms.

Read `abg status` (and any diagnostics you quote) before posting: it names paths
and versions, not file contents, but you are responsible for what you paste.
Do not include credentials, private file contents, or session logs; see
[`SECURITY.md`](SECURITY.md).

## 7. Before filing: things that are not bugs

The authoritative list of accepted limits — not vulnerabilities, and not bugs — is
maintained once in [`SECURITY.md`](SECURITY.md) §Known limitations. Read it before
filing: an accepted limit costs maintainer time. Gate C, D, or E evidence is not a
"not a bug" report — it is exactly what this project is missing.

## 8. Privacy

Reports are public once you submit them. The free-text fields you write are
yours: do not paste credentials, private file contents, or session logs. See
[`SECURITY.md`](SECURITY.md).
