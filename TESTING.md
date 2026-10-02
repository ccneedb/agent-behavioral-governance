---
doc_type: testing-guide
project: agent-behavioral-governance
version: 0.1.0
status: active
owner: maintainers
last_reviewed: 2026-10-02
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
installed into `abg-test` while your GUI/app runs the `web` profile, ABG will
never appear in that list — correctly. Either run the profile you installed into
(`dsh --profile abg-test …`), or install into the profile you actually run:

```bash
dsh plugin --profile web add "<same package reference>"
```

**The Web GUI panel needs a Web-profile run.** A profile created from the
`headless` template mounts no web substrate, so the panel cannot appear there at
all. To see the panel, install ABG into the profile you actually run as a Web app
and start that profile — see §3.

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
    feedback:
      enabled: true            # on by default; set false to remove the tool
      mode: url                # composes a link; no network call, no token
```

If you *want* to test the gates themselves, set `policy: ask` or `deny` and
`requireBeforeMutation: true`, and record what happened — that is the behaviour
the project most needs evidence about.

### Seeing it in the Web GUI

In a **Web** profile, ABG adds a sidebar entry (the ◆ mark, labelled **ABG**).
The panel is read-only: mount state, enabled modules, the host-compatibility
verdict, `PROMPT_VERSION`, whether your prompt override is in force, and the
diagnostic ring. It reads `/api/abg/status`.

The panel exists **only in a Web-profile run**: a `headless`-template profile
mounts no web substrate, and DSH only lists the profile you are running, so
install into — and start — the profile you actually run as a Web app. If the
panel says the status is unavailable, the plugin's host half is not mounted in
this profile (a configuration fault records `abg.config_invalid`); check with
`./scripts/check-install.sh <profile>`.

The panel is the fastest way to answer "is ABG even doing anything?", which is
otherwise indistinguishable from silence. It also gives you the two controls:

- **Prompt** — edit the section text and press **Apply**; it takes effect on the
  next step. This is only enabled when the profile sets `prompt.mode: replace`
  and `prompt.file: <path>`; otherwise the textarea is read-only and the panel
  says why. Refused edits (an `{{ }}` in the text, or over the byte budget) are
  shown inline, and the panel lists which conformance invariants no longer apply
  to user-written text.
- **Report a deviation** — fill the three fields and press **Preview** to compose
  the redacted report, then **Copy report** or **Open prefilled issue**. In
  opt-in `api` mode a **File issue** button submits it directly.

Use **Revert** to restore the last applied text before re-applying, and prefer
editing the settings overlay when you want a change to be reproducible for the
next person — the editor writes exactly the file named by `prompt.file`.

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
4. **Capture state** by asking the agent to call `abg_status`, or read
   `abg_report_issue` for the composed report.

Metrics the project is trying to establish are listed in
[`eval/README.md`](eval/README.md): questions per batch, user interruptions,
false blocks, and whether known-invalid information stops being reused.

## 5. Uninstall

Use the uninstall command in [`README.md`](README.md) §Install. Nothing else is
required: governance state lives in the profile's `ctx.storageDomain`, and any
`prompt.file` or `diagnosticsExport.file` you configured stays where you put it.

## 6. Report a behavioural deviation

Every install ships a read-only tool, **`abg_report_issue`**. Ask the agent:

> Call `abg_report_issue` with a one-line summary of what deviated, plus what you
> expected and what happened.

It returns:

- `issue_url` — a **prefilled GitHub issue link**, ready to open and submit;
- `markdown` — the same body, for pasting into the issue or a chat;
- `filed` — `true` only if the deployment opted into API mode and the issue was
  actually created.

The report is **redacted by construction**. It contains the mount record,
degraded capabilities, the compatibility verdict, and diagnostic *codes* — and
deliberately excludes diagnostic payloads, agent and session identifiers, file
contents, prompts, session logs, and credentials. Read it before submitting; you
can edit it freely in the GitHub form.

If you prefer to write it yourself, use
[`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](docs/TASK-FAILURE-REPORT-TEMPLATE.md) —
it asks for the same fields, including the A/B check from §4.

### Optional: file issues directly

If you are comfortable giving the process a token, `api` mode posts the report
without leaving the session:

```bash
export ABG_GITHUB_TOKEN=<fine-grained token, Issues: read and write on this repository>
```

```yaml
- id: abg
  config:
    feedback:
      mode: api
```

The token is read from the environment only, never from configuration and never
persisted by ABG. Without it, `api` mode degrades to the prefilled link rather
than failing.

## 7. Before filing: things that are not bugs

The authoritative list of accepted limits — not vulnerabilities, and not bugs — is
maintained once in [`SECURITY.md`](SECURITY.md) §Known limitations. Read it before
filing: an accepted limit costs maintainer time. Gate C, D, or E evidence is not a
"not a bug" report — it is exactly what this project is missing.

## 8. Privacy

Reports are public once you submit them. The composed body is redacted, but the
free-text fields you write are yours: do not paste credentials, private file
contents, or session logs. See [`SECURITY.md`](SECURITY.md).
