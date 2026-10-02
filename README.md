---
doc_type: documentation-index
project: agent-behavioral-governance
version: 0.5.0
status: finalized-for-agent-handoff
revision: d13-amendment-b6-budget-and-26.2-mount-hardening
verified_against: dsh-v0.2.0-rc.2
language: en
format_note: conservative-machine-readable-markdown
---

# Agent Behavioral Governance (ABG)

[![CI](https://github.com/ccneedb/agent-behavioral-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/ccneedb/agent-behavioral-governance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: prototype](https://img.shields.io/badge/status-prototype-orange.svg)](#status)

**ABG is an additive project-governance layer for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).** It manages
project orientation, information validity, workspace mutation, and user-attention
consumption — without replacing the host system prompt, plan mode, permissions,
or sandbox. The canonical statement of the integration model is in
[Canonical architectural statement](#canonical-architectural-statement).

> **Status: prototype, not production-ready.** The plugin is structurally
> complete and fully green (238 tests, 11/11 verification checks), but its
> model-backed behavioural gates **C, D, and E have no valid measurement** for
> the current prompt revision, the package is `"private": true`, and the publish
> target is undecided. It is not recommended for a working profile. See
> [Status](#status).

## Contents

This repository is the finalized handoff documentation **and** the working
prototype of the plugin.

| Document | Audience | Purpose |
|---|---|---|
| `PRODUCT-SPEC.md` | humans + agents | product positioning, scope, functionality, goals, constraints, success criteria |
| `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` | implementation agents | architecture, module contracts, diagrams, runtime integration, compatibility model. **Part A (§§1–21)** is the source-verified host integration, its deltas, residual assumptions, and the `0.1.0` prototype realization. **Part B (§§22–34)** is the target design for **ABG v0.2.0**: per-agent state, diagnosability, the compatibility adapter, runtime question consolidation, packaging, the acceptance matrix, and the implementation plan |
| `IMPLEMENTATION-VALIDATION-HANDOFF.md` | implementation/test agents | build order, investigation protocol, validation cases, acceptance gates |
| `MAINTENANCE-HANDOFF.md` | maintainers | the `0.1.0` point-in-time record: status, blockers, backlog, process gotchas, and workspace layout |
| `plugin/` | implementation agents | the working `dsh-agent-behavioral-governance` prototype: kernel, four modules, and the verification chain |
| `eval/` | evaluation agents | behavioural and end-to-end evaluation: the harness, the seeded scenarios, the scripted answerer, and the sandbox runs |
| `docs/TASK-FAILURE-REPORT-TEMPLATE.md` | users + maintainers | the template to fill in when reporting a task failure, with the A/B check that separates an ABG defect from a host defect |

## Install (prototype only)

ABG is delivered as an npm package with a bundle patch. Install it into a
**throwaway** profile, never into a profile you rely on:

```bash
PLUGIN=/path/to/this/repository/plugin
dsh plugin --profile <your-test-profile> add "file:$PLUGIN"
dsh --profile <your-test-profile> --dump-config | grep -A3 'id: abg'   # verify the row composes
dsh plugin --profile <your-test-profile> remove dsh-agent-behavioral-governance   # rollback
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
  "https://github.com/ccneedb/agent-behavioral-governance/releases/download/v0.3.0/dsh-agent-behavioral-governance-0.3.0.tgz"

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

### Feedback from inside the session

Every install ships a read-only tool, **`abg_report_issue`**. When a tester sees a
behavioural deviation, the agent calls it with a one-line summary; ABG composes a
prefilled GitHub issue link plus the markdown body, redacted by construction
(diagnostic payloads, agent/session ids, file contents, prompts, and logs are
dropped). Nothing is submitted without a human opening the link, and the optional
`api` mode that files issues directly is strictly opt-in and reads its token from
the environment.

## Repository layout

```text
README.md                             this file
PRODUCT-SPEC.md                       positioning, scope, goals, success criteria
ARCHITECTURE-SPEC-AGENT-REFERENCE.md  architecture; Part A verified host seams,
                                      Part B the v0.2.0 target design
IMPLEMENTATION-VALIDATION-HANDOFF.md  build order, validation cases, gates
MAINTENANCE-HANDOFF.md                point-in-time status and process gotchas
CONTRIBUTING.md                       prerequisites, checks, and the project rules
SECURITY.md                           what ABG is not, and how to report
CODE_OF_CONDUCT.md                    Contributor Covenant 2.1
TESTING.md                            volunteer install, first trial, and feedback
LICENSE                               MIT
docs/                                 the task-failure report template
.github/                              CI, issue forms, and the pull-request template
plugin/                               the implementation and its test suite
eval/                                 the behavioural evaluation harness
```

## Development

```bash
cd plugin
npm run typecheck     # tsc --checkJs, strict, against the ambient seam contract
npm test              # node --test — unit, conformance, and integration
./scripts/verify.sh   # the full evidence chain (11 checks), real profile install
```

Integration tests mount the **real** host services; they skip (rather than fail)
when no DSH installation is present. Point the loader at a non-default install
with `ABG_DSH_PACKAGES`. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the rules
that keep this project maintainable, and [`SECURITY.md`](SECURITY.md) before
reporting anything.

## Working prototype

`plugin/` contains an installable **`dsh-agent-behavioral-governance`** `0.3.0`
(`"private": true`, unpublished) that realizes the architecture above with zero
runtime dependencies. It contributes one additive prompt section and enforces
through `agent/pre-step`, `tools/pre-execute`, `ctx.tools.guard`, and
`ctx.storageDomain`, and it reports its own state through a bounded runtime-context
status line plus the read-only `abg_status` and `abg_questions` tools.

```bash
cd plugin && ./scripts/verify.sh    # typecheck, 238 tests, real install, real mount
```

The evidence chain covers strict typechecking, **238 tests** (all passing — no
todo, no skip; unit, prompt conformance, and integration mounting the **real**
`dsh-system-prompt`, `dsh-tools`, `dsh-fs-local`, and the
`dsh-storage`/`dsh-storage-json`/`dsh-storage-domain` stack), a real install into a
throwaway profile, composition of the `abg` row, and positive proof that the
**installed** plugin binds its section, listeners, and tools — and absorbs a bad
configuration observably instead of unmounting. See
[`plugin/README.md`](plugin/README.md) for the honest list of what it does not yet
verify.

Behavioural effect is measured separately by the sandbox harness in
[`eval/`](eval/README.md), which runs real agent trials with and without the
governance section. **No valid measurement exists for the current prompt
revision:** the earlier trials were run against the five-module prompt and were
deleted as superseded when that module was removed (`ARCHITECTURE-SPEC` §23), so
`eval/README.md` now records the method and the pending re-run rather than
superseded numbers.

## Target design (ABG v0.2.0)

The forward design is `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` **Part B** (§§22–34).
It closes the release blockers of `MAINTENANCE-HANDOFF.md`: observable
diagnostics, a compatibility adapter, per-agent state isolation, runtime question
consolidation, gate-precision and wider evaluation, and packaging. It also
records the removal of `child-agent-lifecycle` (§23), and consolidates everything
still awaiting a human decision in its §34.

## Status

**Prototype. Not production-ready.** Implemented and verified in the simulated
environment: per-agent state isolation, the diagnostics channels (runtime-context
status line, `abg_status`, bounded durable ring, best-effort logger), the
compatibility adapter with a committed baseline, the read-only `abg_questions`
surface, the §26.2 mount contract (a configuration fault degrades to an
observable, inert surface instead of a silent unmount), the packaging artifacts,
and a gate-precision matrix measuring **21 legitimate calls with 0 false blocks**
while catching all **4 traps**.

**Blocking a release**, in order:

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
   release action (§31.1). Current phase status is in §33.

## Reporting a task failure

Fastest path, from inside the session: ask the agent to call **`abg_report_issue`**
with a one-line summary of the deviation. It returns a prefilled, redacted GitHub
issue link and the markdown body — see [`TESTING.md`](TESTING.md) §6.

If you prefer to write it yourself, use
[`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](docs/TASK-FAILURE-REPORT-TEMPLATE.md).
Either way the most important step is the A/B check: capture `abg_status`, then run
the same task with ABG disabled. That separates an ABG defect from a host or model
defect — which is also exactly the measurement Gates C, D, and E need.

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


