---
doc_type: readme
project: information-environment-governance
version: 0.4.0
plugin_version: 0.8.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.8.0-batch-2
verified_against: dsh-v0.2.1-alpha.1
language: en
format_note: conservative-machine-readable-markdown
---

# Information Environment Governance (IEG)

[![CI](https://github.com/ccneedb/information-environment-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/ccneedb/information-environment-governance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: prototype](https://img.shields.io/badge/status-prototype-orange.svg)](#status)

**IEG is an additive project-governance layer for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** It
governs the *information environment* an agent works in. The canonical
definition of that term, the full positioning, and the authoritative scope live
in [`PRODUCT-SPEC.md` §1](PRODUCT-SPEC.md#1-product-positioning); this README
links there rather than restating them.

> **Status: prototype, not production-ready.** The package is
> `dsh-information-environment-governance` **0.8.0**, `"private": true`, and the
> publish target is undecided. Behavioural improvement (Gate C) and information
> integrity (Gate D) have no valid measurement for the current prompt revision,
> and packaging (Gate I) is partial. It is not recommended for a working
> profile. Current numbers are in
> [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4; see [Status](#status).

## Contents

This repository is the project documentation **and** the working prototype of the
plugin.

| Document | Audience | Purpose |
|---|---|---|
| `PRODUCT-SPEC.md` | humans + agents | positioning, the canonical definition and scope, the two governance entry points, goals, requirements, success criteria — the single source of truth for what IEG is |
| `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` | implementation agents | architecture, module contracts, diagrams, runtime integration, compatibility model. **Part A** is the source-verified host integration, its deltas, and residual assumptions. **Part B** is the target design, the acceptance matrix (**§32**), and the phase plan |
| `MAINTENANCE-HANDOFF.md` | maintainers | the maintained status record: current status and numbers (**§3–§4**, the single source of truth), blockers, backlog, process gotchas, workspace layout, and the naming/withdrawal history |
| `TESTING.md` | volunteers | the volunteer procedure: install, first trial, the A/B check, and deviation reporting |
| `SECURITY.md` | everyone | what IEG is not, the accepted limits (single source of truth), the out-of-scope list, and how to report a vulnerability |
| `CONTRIBUTING.md` | contributors | prerequisites, the checks to run (single source of truth), and the project rules |
| `IMPLEMENTATION-VALIDATION-HANDOFF.md` | agents | retired — a pointer to the §32 gates and the historical build order |
| `docs/DOCUMENTATION-INDEX.md` | everyone | the document inventory and the single-source-of-truth map |
| `.github/ISSUE_TEMPLATE/` | users + maintainers | the bug-report and feature-request forms a deviation report uses |
| repository root (`package.json`, `cordis.patch.yml`, `src/`, `lib/`, `bin/ieg`) | implementation agents | the working `dsh-information-environment-governance` package: manifest, kernel, three modules, the `dsh-ieg` terminal interface, and the verification chain. **The root *is* the package** — there is no `plugin/` subdirectory |
| `eval/` | evaluation agents | behavioural and end-to-end evaluation: the harness, the seeded scenarios, and the sandbox runs |

## What IEG governs

IEG has **two governance entry points**:

1. **Project Constraint Governance** — keeps the project's objective, scope,
   terminology, constraints, and current phase explicit, and distinguishes
   *declared understanding* from *actual behavioral consistency*.
2. **Information / Document Governance** — keeps the state of project
   information explicit (existence, status, authority, provenance,
   supersession, retrieval eligibility) and governs the documents that carry
   it. Workspace hygiene is an **enforcement mechanism inside this entry
   point**, not a separate system.

Three primary areas are in scope:

1. **Project Constraints** — objective, scope, terminology, constraints,
   current phase.
2. **Information State** — authority, validity, provenance, supersession,
   lifecycle status.
3. **Persistent Workspace** — documents, artifacts, source/configuration, and
   generated files.

### Explicitly out of scope

The following are **not** IEG's concern, and no future feature may drift into
them:

- general AI safety or security;
- sandboxing;
- authorization;
- user-attention optimization (**RETIRED** — the capability was withdrawn in 0.7.0;
  see the history in [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §13.2);
- unrelated agent behavior management.

Any future feature must show a direct connection to Information Environment
Governance. The authoritative statement of this boundary is
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1 and §4; the security consequences are in
[`SECURITY.md`](SECURITY.md).

### Modules (3, all enabled by default)

| Module | Failure class | Concern |
|---|---|---|
| `project-governance` | `FC-2.1` | project orientation, scope, terminology, and constraint drift |
| `information-integrity` | `FC-2.3` | reuse of known-invalid or superseded information |
| `workspace-governance` | `FC-2.2` | unauthorized persistent workspace mutation |

The former `user-attention` module and failure class `FC-2.4` were **removed in
0.7.0** and are classified **"Out of Scope / Externally Solved"**. They are not
a current capability; the withdrawal is recorded as history in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) and
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part B.

## Interface: the `dsh-ieg` terminal command

The supported interface is a terminal command, `dsh-ieg`, run from a Debian
shell. Running it with no arguments opens an ANSI numbered menu; every command
also works non-interactively with flags, because CI and scripts call it. The
entry file is [`bin/ieg`](bin/ieg).

```text
dsh-ieg                      # ANSI numbered menu (also: dsh-ieg menu)
dsh-ieg start                # status=running
dsh-ieg pause                # status=paused -> section not emitted, hooks pass through
dsh-ieg restart              # status=running, generation+1: reload config and prompt.md
dsh-ieg exit                 # status=stopped (governance off for this profile; install untouched)
dsh-ieg install   [--profile P] [--from <tarball|dir>]   # npm lifecycle
dsh-ieg update    [--profile P] [--from <tarball|dir>]
dsh-ieg uninstall [--profile P]
dsh-ieg prompt               # print the effective prompt, its version and byte count
dsh-ieg prompt edit          # $EDITOR on a temp copy of the effective text; validate; store
dsh-ieg prompt reset         # delete prompt.md -> back to the compiled default
dsh-ieg status               # control state, generation, timestamps, install/compose state, PROMPT_VERSION
dsh-ieg --help / --version
```

`start`/`pause`/`exit` take effect while the harness is running: the plugin
re-reads the control state each step. `exit` stops governance for the profile and
**never uninstalls** — only `install | update | uninstall` touch the installation.

Control state lives in `$IEG_STATE_FILE`, else
`<state-dir>/ieg/state.json` where `<state-dir>` is `$XDG_STATE_HOME` else
`~/.local/state`. Prompt text is **not** stored inside that JSON: it lives in a
sibling `prompt.md`, validated through the same kernel the plugin uses for a
config-supplied override (no `{{ }}`, byte ceiling unless `allowOverBudget`; a
refusal keeps the previous text and prints its reasons). Precedence is
control-plane `prompt.md` > config `prompt.file` (when `prompt.mode: replace`) >
config `prompt.append` > the compiled default.

The plugin contributes **one** additive prompt section, `ieg:governance`
(`order: 8500`, `interpolate: false`, `complete` never set) and **two**
model-facing tools, `record_orientation` and `ieg_status`. It reports its own
state through the `ieg:status` runtime-context line and the `ieg.*` diagnostic
codes. Full runtime detail is in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part B.

## Install (prototype only)

IEG is delivered as an npm package with a bundle patch. Install it into a
**throwaway** profile, never into a profile you rely on. Package-level detail —
configuration, the `files` allowlist, and package verification — is in
[`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md); this section is the user-facing install
flow.

```bash
PLUGIN=/path/to/this/repository
dsh-ieg install   --profile <your-test-profile>          # npm lifecycle + bundle registration
dsh-ieg install   --profile <your-test-profile> --from <tarball-or-dir>
dsh-ieg status    --profile <your-test-profile>          # package, control and composed-row state
dsh-ieg uninstall --profile <your-test-profile>          # uninstall / rollback
```

`dsh-ieg install` uses npm and registers the profile bundle itself, so it works
without pnpm. If you prefer the host's own path (which forwards to pnpm), the
equivalent is:

```bash
dsh plugin --profile <your-test-profile> add "file:$PLUGIN"
dsh --profile <your-test-profile> --dump-config | grep -A3 'id: ieg'   # verify the row composes
dsh plugin --profile <your-test-profile> remove dsh-information-environment-governance
```

Two caveats worth knowing before first use:

- a profile **links the plugin at install time**, so re-install after any source
  change or you will exercise the old code;
- IEG defaults to `workspace.policy: ask` and `overlapCheck: ask`, which **fail
  closed** in a composition with no approval channel. For a first trial prefer
  `workspace: { policy: allow, overlapCheck: ask, protectedPaths: [...] }` and
  keep the non-intrusive `requireBeforeMutation: false` default.

Requirements: Node.js >= 20 and a DeepSeek Harness installation. The declared
peer range is `>=0.2.1-alpha.1 <0.3.0`, and `dsh.compatibility.dshReleases`
records that single baseline as `verified`; the committed baseline was
re-captured against the installed `0.2.1-alpha.1` host in 0.8.0 (identical section
order and host prompt hash). The retired `0.2.0-rc.2` baseline is **SUPERSEDED**
and is no longer in the range or the release map. See
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4.

### Volunteer testing

The behavioural gates cannot be measured without real sessions, so volunteers are
the bottleneck for this project. The volunteer procedure — a throwaway profile, a
first-trial configuration, an A/B check, and what to capture in a deviation
report — is maintained once in [`TESTING.md`](TESTING.md). The plugin list in a
running app shows the bundles of the profile that app **runs**, so installing
into `ieg-test` while your app runs `web` looks exactly like a failed install;
[`scripts/check-install.sh`](scripts/check-install.sh) checks the profile end to
end and prints which situation you are in.

## Repository layout

```text
README.md                             this file
PRODUCT-SPEC.md                       positioning, scope, goals, success criteria
ARCHITECTURE-SPEC-AGENT-REFERENCE.md  architecture; Part A verified host seams,
                                      Part B the target design and the §32 gates
IMPLEMENTATION-VALIDATION-HANDOFF.md  retired pointer to §32 and the build order
MAINTENANCE-HANDOFF.md                current status and numbers; maintenance gotchas
TESTING.md                            volunteer install, first trial, and deviation reporting
SECURITY.md                           boundaries, accepted limits, and reporting
CONTRIBUTING.md                       prerequisites, checks, and the project rules
CODE_OF_CONDUCT.md                    Contributor Covenant 2.1
LICENSE                               MIT
docs/                                 the documentation index and single-source-of-truth map
scripts/                              repository tooling (check-install.sh, check-docs.sh, ieg-npm.sh)
package.json / cordis.patch.yml       the DSH bundle manifest and patch (the root is the package)
src/                                  the TypeScript source of truth for the runtime
lib/                                  the compiled runtime `tsc` emits from src/ (committed)
bin/ieg                               the `dsh-ieg` executable shim
test/ test-support/                   unit, conformance, and integration suites
eval/                                 the behavioural evaluation harness
.github/                              CI, issue forms, and the pull-request template
```

Document front matter carries `doc_type`, `owner`, `last_reviewed`, and `status`.
`version` is that document's **own** revision — it tracks the document, not the
package — and `plugin_version`, where present, names the package version the
record describes. The rule is stated once, with the full inventory and the
single-source-of-truth map, in
[`docs/DOCUMENTATION-INDEX.md`](docs/DOCUMENTATION-INDEX.md).

## Development

Prerequisites, the checks to run (`typecheck`, `npm test`, `verify.sh`,
`check-docs.sh`), and the rules that keep the project maintainable are maintained
once in [`CONTRIBUTING.md`](CONTRIBUTING.md) §Running the checks. Integration
tests mount the **real** host services; they skip (rather than fail) when no DSH
installation is present. Point the loader at a non-default install with
`IEG_DSH_PACKAGES`; the verification chain honours `IEG_VERIFY_HOME`. Read
[`SECURITY.md`](SECURITY.md) before reporting anything.

## Working prototype

The repository root **is** an installable **`dsh-information-environment-governance`**
`0.8.0` (`"private": true`, unpublished) that realizes the architecture above
with zero runtime dependencies. It contributes one additive prompt section and
enforces through `agent/pre-step`, `tools/pre-execute`, `ctx.tools.guard`, and
`ctx.storageDomain`; it reports its own state through a bounded runtime-context
status line plus the `record_orientation` and read-only `ieg_status` tools; and
it ships the `dsh-ieg` terminal interface for control
(`start`/`pause`/`restart`/`exit`), `prompt.md` editing, and the npm lifecycle.
The runtime is authored in TypeScript under `src/**`; `lib/**` is its committed
`tsc` build output (see
[`TYPESCRIPT-MIGRATION.md`](TYPESCRIPT-MIGRATION.md)).

The evidence chain — run per [`CONTRIBUTING.md`](CONTRIBUTING.md) §Running the
checks — covers strict typechecking, the full test suite (no todo, no skip; unit,
prompt conformance, and integration mounting the **real** `dsh-system-prompt`,
`dsh-tools`, `dsh-fs-local`, and the
`dsh-storage`/`dsh-storage-json`/`dsh-storage-domain` stack), a real install into
a throwaway profile, composition of the `ieg` row, and positive proof that the
**installed** plugin binds its section, listeners, and tools — and absorbs a bad
configuration observably instead of unmounting. Current counts are in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3. See
[`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md) for the honest list of what it does not yet
verify.

Behavioural effect is measured separately by the sandbox harness in
[`eval/`](eval/README.md), which runs real agent trials with and without the
governance section. **No valid measurement exists for the current prompt
revision:** earlier trials were run against withdrawn prompt revisions and were
deleted as superseded, so `eval/README.md` records the method and the pending
re-run rather than superseded numbers.

## Status

**Prototype. Not production-ready.**

1. **Gates C and D are unmet** for the current three-module prompt, and **Gate I
   (packaging) is partial**. Gate C needs a model-backed run of
   [`eval/`](eval/README.md) with a rubric frozen beforehand and a judge that
   does not see the arm. Gate D needs the same kind of run for information
   integrity. Superseded measurements were deleted, not annotated, because a
   stale number still reads as a standing result.
2. **Decisions are open**, consolidated in
   [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §9: the publish target, any
   live-profile rollout, and the control state file being per-user rather than
   per-profile (Q8). The compatibility-baseline re-capture (Q7) closed in 0.8.0:
   the single supported baseline is `dsh 0.2.1-alpha.1`.
3. **`private: true` is retained** until 1 and 2 are resolved; removing it is the
   release action.

The current version, test count, verification result, and the per-gate status are
maintained once in [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4, with
the gate table in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
§32.1.

## Reporting a task failure

A deviation report is an **ordinary GitHub issue**. Use the repository's
[`.github/ISSUE_TEMPLATE/bug_report.yml`](.github/ISSUE_TEMPLATE/bug_report.yml)
form (or [`feature_request.yml`](.github/ISSUE_TEMPLATE/feature_request.yml) for a
capability request) — see [`TESTING.md`](TESTING.md) §6 for what to put in it.

The most important step is the A/B check: capture `dsh-ieg status --json`, then
run the same task with IEG disabled (`dsh-ieg exit`, or `enabled: false`;
[`TESTING.md`](TESTING.md) §4 shows the correct way). That separates an IEG
defect from a host or model defect — which is also exactly the measurement Gates
C and D need.

## Canonical architectural statement

> **IEG is an additive project-governance layer for DSH. Its stable behavioral policy is contributed through one system-prompt section; stateful and deterministic controls use appropriate DSH runtime seams.**

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for prerequisites, the checks to run,
and the rules that keep the project small — one additive prompt section,
deterministic enforcement over prompt text, zero runtime dependencies, no
duplicate documents, `apply()` never throws, and attributed prompt changes.
Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 IEG contributors. The plugin package carries the same
license at [`LICENSE`](LICENSE).
