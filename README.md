---
doc_type: readme
project: agent-behavioral-governance
version: 0.5.0
plugin_version: 0.5.0
status: active
owner: maintainers
last_reviewed: 2026-10-02
revision: docs-health-consolidation
verified_against: dsh-v0.2.0-rc.2
language: en
format_note: conservative-machine-readable-markdown
---

# Agent Behavioral Governance (ABG)

[![CI](https://github.com/ccneedb/agent-behavioral-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/ccneedb/agent-behavioral-governance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: prototype](https://img.shields.io/badge/status-prototype-orange.svg)](#status)

**ABG is an additive project-governance layer for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** The
canonical positioning — what it is, what it is not, and what it promises — is
[`PRODUCT-SPEC.md` §1](PRODUCT-SPEC.md#1-product-positioning); the integration
invariant is stated once in
[Canonical architectural statement](#canonical-architectural-statement).

> **Status: prototype, not production-ready.** The plugin is structurally
> complete and green, but its model-backed behavioural gates **C, D, and E have
> no valid measurement** for the current prompt revision, the package is
> `"private": true`, and the publish target is undecided. It is not recommended
> for a working profile. Current numbers are in
> [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4; see [Status](#status).

## Contents

This repository is the project documentation **and** the working prototype of the
plugin.

| Document | Audience | Purpose |
|---|---|---|
| `PRODUCT-SPEC.md` | humans + agents | positioning, scope, functionality, goals, constraints, success criteria — the single source of truth for what ABG is |
| `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` | implementation agents | architecture, module contracts, diagrams, runtime integration, compatibility model. **Part A (§§1–21)** is the source-verified host integration, its deltas, residual assumptions, and the `0.1.0` prototype realization. **Part B (§§22–34)** is the target design (baseline v0.2.0, extended through the v0.5.0 GUI round): per-agent state, diagnosability, the compatibility adapter, runtime question consolidation, packaging, the acceptance matrix (**§32**), and the phase plan (**§33**) |
| `MAINTENANCE-HANDOFF.md` | maintainers | the maintained status record: current status and numbers (**§3–§4**, the single source of truth), blockers, backlog, process gotchas, workspace layout, and the `0.1.0`/v0.2.0 history |
| `TESTING.md` | volunteers | the volunteer procedure: install, first trial, the A/B check, and the one-step feedback tool |
| `SECURITY.md` | everyone | what ABG is not, the accepted limits (single source of truth), and how to report a vulnerability |
| `CONTRIBUTING.md` | contributors | prerequisites, the checks to run (single source of truth), and the project rules |
| `IMPLEMENTATION-VALIDATION-HANDOFF.md` | agents | retired — a pointer to the §32 gates and the historical build order |
| `docs/DOCUMENTATION-INDEX.md` | everyone | the document inventory and the single-source-of-truth map |
| `docs/TASK-FAILURE-REPORT-TEMPLATE.md` | users + maintainers | the template to fill in when reporting a task failure, with the A/B check that separates an ABG defect from a host defect |
| `plugin/` | implementation agents | the working `dsh-agent-behavioral-governance` prototype: kernel, four modules, and the verification chain |
| `eval/` | evaluation agents | behavioural and end-to-end evaluation: the harness, the seeded scenarios, the scripted answerer, and the sandbox runs |

## Install (prototype only)

ABG is delivered as an npm package with a bundle patch. Install it into a
**throwaway** profile, never into a profile you rely on. Package-level detail —
configuration, the `files` allowlist, and package verification — is in
[`plugin/README.md`](plugin/README.md); this section is the user-facing install
flow.

```bash
PLUGIN=/path/to/this/repository/plugin
dsh plugin --profile <your-test-profile> add "file:$PLUGIN"
dsh --profile <your-test-profile> --dump-config | grep -A3 'id: abg'   # verify the row composes
dsh plugin --profile <your-test-profile> remove dsh-agent-behavioral-governance   # uninstall / rollback
```

Two caveats worth knowing before first use:

- a profile **links the plugin at install time**, so re-install after any source
  change or you will exercise the old code;
- ABG defaults to `workspace.policy: ask` and `overlapCheck: ask`, which **fail
  closed** in a composition with no approval channel. For a first trial prefer
  `workspace: { policy: allow, overlapCheck: ask, protectedPaths: [...] }` and
  keep the non-intrusive `requireBeforeMutation: false` default.

Requirements: Node.js >= 20 and a DeepSeek Harness installation
(verified against `@deepseek-ai/dsh` `0.2.0-rc.2`; the declared peer range is
`>=0.2.0-rc.2 <0.3.0`).

### Volunteer testing (download the plugin)

The behavioural gates cannot be measured without real sessions, so volunteers are
the bottleneck for this project. There are two supported ways to get the plugin —
a release tarball (no git) and a clone — plus a first-trial configuration, an
A/B procedure, and a redacted one-step reporting tool:

> **[`TESTING.md`](TESTING.md) — volunteer testing guide**

```bash
# release tarball — flags such as --from-default-profile belong to the launcher,
# not to `dsh plugin` (everything after `plugin` is forwarded to pnpm)
dsh --profile abg-test --from-default-profile headless --dump-config
dsh plugin --profile abg-test add \
  "https://github.com/ccneedb/agent-behavioral-governance/releases/download/v0.5.0/dsh-agent-behavioral-governance-0.5.0.tgz"

# or from a clone
git clone --depth 1 https://github.com/ccneedb/agent-behavioral-governance.git abg
dsh plugin --profile abg-test add "file:$PWD/abg/plugin"

# then confirm the row composes into THAT profile
./scripts/check-install.sh abg-test
```

The plugin list in a running app shows the bundles of the profile that app
**runs** — installing into `abg-test` while your GUI runs `web` looks exactly
like a failed install. [`scripts/check-install.sh`](scripts/check-install.sh)
checks the profile end to end and prints which situation you are in.

**To see the Web GUI panel**, install ABG into the profile you actually **run as a
Web app** and start that profile. A profile created from the `headless` template
mounts no web substrate, so no panel can appear there, and running a different
profile from the one you installed into looks the same as a failed install. If
ABG fails to configure it mounts nothing and the panel reports "ABG status is
unavailable" (cause: the `abg.config_invalid` diagnostic). See
[`TESTING.md`](TESTING.md) §3.

### Feedback from inside the session

Every install ships a read-only tool, **`abg_report_issue`**. When a tester sees a
behavioural deviation, the agent calls it with a one-line summary; ABG composes a
prefilled GitHub issue link plus the markdown body, redacted by construction
(diagnostic payloads, agent/session ids, file contents, prompts, and logs are
dropped). Nothing is submitted without a human opening the link, and the optional
`api` mode that files issues directly is strictly opt-in and reads its token from
the environment.

#### Without pnpm — npm only

`dsh plugin … add|remove` forwards its arguments to **pnpm** (a real install prints
`Done in 25ms using pnpm v12.8.1`), and it also registers the profile bundle. Plain
`npm install` does **not**, so a package installed that way sits on disk without
ever mounting. To run the whole lifecycle through npm instead:

```bash
./scripts/abg-npm.sh install   --profile abg-test [--from <tarball-or-dir>]
./scripts/abg-npm.sh status    --profile abg-test
./scripts/abg-npm.sh update    --profile abg-test
./scripts/abg-npm.sh uninstall --profile abg-test
```

The helper maintains `dsh.profile.bundles` (which is what mounts the plugin) and
refuses to touch `~/.dsh` without `--allow-live`. The package is `"private": true`,
so there is no registry install; every artifact comes from `npm pack` or a release
tarball.

## Repository layout

```text
README.md                             this file
PRODUCT-SPEC.md                       positioning, scope, goals, success criteria
ARCHITECTURE-SPEC-AGENT-REFERENCE.md  architecture; Part A verified host seams,
                                      Part B the target design and the §32 gates
IMPLEMENTATION-VALIDATION-HANDOFF.md  retired pointer to §32 and the build order
MAINTENANCE-HANDOFF.md                current status and numbers; maintenance gotchas
TESTING.md                            volunteer install, first trial, and feedback
SECURITY.md                           boundaries, accepted limits, and reporting
CONTRIBUTING.md                       prerequisites, checks, and the project rules
CODE_OF_CONDUCT.md                    Contributor Covenant 2.1
LICENSE                               MIT
scripts/                              repository tooling (check-install.sh, check-docs.sh)
docs/                                 documentation index and the report template
.github/                              CI, issue forms, and the pull-request template
plugin/                               the implementation and its test suite
eval/                                 the behavioural evaluation harness
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
`ABG_DSH_PACKAGES`. Read [`SECURITY.md`](SECURITY.md) before reporting anything.

## Working prototype

`plugin/` contains an installable **`dsh-agent-behavioral-governance`** `0.5.0`
(`"private": true`, unpublished) that realizes the architecture above with zero
runtime dependencies. It contributes one additive prompt section and enforces
through `agent/pre-step`, `tools/pre-execute`, `ctx.tools.guard`, and
`ctx.storageDomain`, and it reports its own state through a bounded
runtime-context status line plus the read-only `abg_status`, `abg_questions`, and
`abg_report_issue` tools.

The evidence chain — run per [`CONTRIBUTING.md`](CONTRIBUTING.md) §Running the
checks — covers strict typechecking, the full test suite (no todo, no skip; unit,
prompt conformance, and integration mounting the **real** `dsh-system-prompt`,
`dsh-tools`, `dsh-fs-local`, and the
`dsh-storage`/`dsh-storage-json`/`dsh-storage-domain` stack), a real install into
a throwaway profile, composition of the `abg` row, and positive proof that the
**installed** plugin binds its section, listeners, and tools — and absorbs a bad
configuration observably instead of unmounting. Current counts are in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3. See
[`plugin/README.md`](plugin/README.md) for the honest list of what it does not yet
verify.

Behavioural effect is measured separately by the sandbox harness in
[`eval/`](eval/README.md), which runs real agent trials with and without the
governance section. **No valid measurement exists for the current prompt
revision:** the earlier trials were run against the five-module prompt and were
deleted as superseded when that module was removed (`ARCHITECTURE-SPEC` §23), so
`eval/README.md` now records the method and the pending re-run rather than
superseded numbers.

## Target design

`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` **Part B** (§§22–34) is the design that was
implemented: observable diagnostics, a compatibility adapter, per-agent state
isolation, runtime question consolidation, gate precision and wider evaluation,
and packaging. It records the removal of `child-agent-lifecycle` (§23), states the
acceptance gates in **§32**, and consolidates everything still awaiting a human
decision in its §34. Current implementation status is in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4.

## Status

**Prototype. Not production-ready.**

1. **Gates C, D, and E are unmeasured** for the current four-module prompt. They
   need a model-backed run of [`eval/`](eval/README.md) with a rubric frozen
   beforehand and a judge that does not see the arm. The earlier trials measured
   the withdrawn five-module prompt and were deleted as superseded, not
   annotated, because a stale number still reads as a standing result.
2. **Three decisions are open**, consolidated in
   [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
   §34.2: confirm the section order `8500` (Q2), choose the publish target (Q5),
   and decide whether ABG is ever installed into a live profile (Q6).
3. **`private: true` is retained** until 1 and 2 are resolved; removing it is the
   release action (§31.1).

The current version, test count, verification result, and the per-gate status are
maintained once in [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4, with
the gate table in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
§32.1.

## Reporting a task failure

Fastest path, from inside the session: ask the agent to call **`abg_report_issue`**
with a one-line summary of the deviation. It returns a prefilled, redacted GitHub
issue link and the markdown body — see [`TESTING.md`](TESTING.md) §6.

If you prefer to write it yourself, use
[`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](docs/TASK-FAILURE-REPORT-TEMPLATE.md).
Either way the most important step is the A/B check: capture `abg_status`, then run
the same task with ABG disabled ([`TESTING.md`](TESTING.md) §4 shows the correct way
to disable it). That separates an ABG defect from a host or model defect — which is
also exactly the measurement Gates C, D, and E need.

## Canonical architectural statement

> **ABG is an additive project-governance layer for DSH. Its stable behavioral policy is contributed through one system-prompt section; stateful and deterministic controls use appropriate DSH runtime seams.**

## Initial modules

```text
project-governance
workspace-governance
information-integrity
user-attention
```

`child-agent-lifecycle` and failure class `FC-2.5` were **removed** by explicit
user decision; a concise record of what was withdrawn and why is in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §23,
and the identifier renumbering it caused is reflected in every document.

## Host verification status

The host reconnaissance that `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §2 requires has been performed against the installed distribution. Findings and their consequences for the specification are recorded in that document's **§17 (Verified Host Integration)**, **§18 (Deltas)**, **§19 (Resolved Items)**, and **§20 (Assumptions and Items Requiring Confirmation)**.

The declared baseline (`DSH v0.2.0-rc.2`) matches the installed host, and all §16 reference URLs resolve. The cited repository paths are monorepo source locations; runtime plugins must import the published package names instead.

## Verified constraint on log-based state

A plugin-authored session event **cannot** carry the envelope's `ignorable` compatibility marker: `Session.append()` builds the envelope from `type`, `seq`, `time`, `data`, and surface metadata only, and no code path in the installed distribution writes `ignorable`. The marker is read and validated, never produced.

Because an absent marker means *required*, a session recorded with ABG loaded could not be reconstructed by a composition without ABG. Authoritative governance state is therefore directed to `ctx.storageDomain`; log-only ABG events may carry derived session state, but they are composition-coupled by construction. See `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §17.6, §20.1 (A3), and §20.2 (item 1).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) for prerequisites, the checks to run,
and the eight rules that keep the project small — one additive prompt section,
deterministic enforcement over prompt text, zero runtime dependencies, no
duplicate documents, `apply()` never throws, and attributed prompt changes.
Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 ABG contributors. The plugin package carries the same
license at [`plugin/LICENSE`](plugin/LICENSE).


