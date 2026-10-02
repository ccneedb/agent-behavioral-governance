# Volunteer testing guide

ABG is a **prototype**: the model-backed behavioural gates (C, D, E) have no
valid measurement yet, the package is `"private": true`, and the publish target is
undecided. That is exactly why volunteer testing matters — the missing evidence is
behavioural, and it can only come from real sessions.

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

ABG is installed into a profile, not globally. Pick one of the two methods.

### Method A — from a release tarball (no git needed)

Download the package for the release you want and install it by URL:

```bash
dsh plugin --profile abg-test --from-default-profile headless --dump-config
dsh plugin --profile abg-test add \
  "https://github.com/ccneedb/agent-behavioral-governance/releases/download/v0.3.0/dsh-agent-behavioral-governance-0.3.0.tgz"
```

### Method B — from a clone (works even if the release asset is missing)

```bash
git clone --depth 1 https://github.com/ccneedb/agent-behavioral-governance.git abg
dsh plugin --profile abg-test --from-default-profile headless --dump-config
dsh plugin --profile abg-test add "file:$PWD/abg/plugin"
```

### Confirm it mounted

```bash
dsh --profile abg-test --dump-config | grep -A3 'id: abg'
```

`dsh plugin add` links the plugin at install time, so **re-install after any source
change** or you will keep exercising the old code.

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

## 4. What a useful trial looks like

1. **Run one real task** with ABG enabled, in a copy of a workspace you can lose.
2. **Note the interaction**: did ABG ask, deny, or stay silent? Was the outcome
   right?
3. **Run the same task with ABG disabled** (`- id: abg` removed from the overlay,
   or `enabled: false`). This A/B is the single most valuable thing you can
   contribute: it separates an ABG defect from a host or model defect.
4. **Capture state** by asking the agent to call `abg_status`, or read
   `abg_report_issue` for the composed report.

Metrics the project is trying to establish are listed in
[`eval/README.md`](eval/README.md): questions per batch, user interruptions,
false blocks, and whether known-invalid information stops being reused.

## 5. Uninstall

```bash
dsh plugin --profile abg-test remove dsh-agent-behavioral-governance
```

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

These are documented, accepted limits — filing them costs maintainer time:

1. `agent/pre-step` live dispatch is covered by wiring tests, not a full agent loop.
2. Question consolidation (Gate D) cannot be measured in a headless composition with no answerer.
3. Gates C, D, and E have **no valid measurement** for the current prompt revision — that is what your trial contributes to.
4. With no `ctx.storageDomain`, orientation does not survive a resume; ABG degrades to in-memory state and re-imposes the requirement.
5. Shell-write classification misses indirect wrappers (`env bash -c '…'`) and PowerShell `Remove-Item`.
6. `policy: ask` / `overlapCheck: ask` fail closed where no approval channel exists.
7. `degraded[]` non-empty can coexist with `mounted: true` — read `degraded`, not `mounted` alone.
8. `ctx.logger` narration is best-effort and invisible in stock compositions; use `abg_status`.

## 8. Privacy

Reports are public once you submit them. The composed body is redacted, but the
free-text fields you write are yours: do not paste credentials, private file
contents, or session logs. See [`SECURITY.md`](SECURITY.md).
