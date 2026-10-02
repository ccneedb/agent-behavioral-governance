---
doc_type: documentation-index
project: agent-behavioral-governance
version: 0.1.0
status: active
owner: maintainers
last_reviewed: 2026-10-02
audience: everyone
language: en
---

# Documentation Index and Single Sources of Truth

This is the inventory of the project's documents and the map of which document
owns which kind of information. Read it before adding, moving, or rewriting a
document. `scripts/check-docs.sh` enforces the mechanical rules below.

## Front-matter rule (stated once, applies everywhere)

Every governed Markdown document — a root `*.md` or `docs/*.md` file — begins
with YAML front matter that carries at least:

```yaml
doc_type: <one of the doc_type values below>
status: <active | retired | draft>
owner: <who reviews and updates this file>
last_reviewed: <YYYY-MM-DD, the date it was last read against the tree>
```

`version` is that document's **own** revision, not the package version.
`plugin_version`, where present, names the package version the record describes.
`last_reviewed` must parse as `YYYY-MM-DD`.

Auxiliary templates are deliberately exempt from front matter: the YAML files
under `.github/ISSUE_TEMPLATE/` are schema-checked issue forms, and YAML front
matter in `.github/pull_request_template.md` would render as stray text in every
pull-request body. Their owner and review date are recorded in the tables below.

## Documents

| Document | doc_type | Position — the question it answers | Audience | Owner | last_reviewed | Status |
|---|---|---|---|---|---|---|
| [`README.md`](../README.md) | readme | What is this project, and where do I start? | everyone | maintainers | 2026-10-02 | active |
| [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) | product-spec | What is ABG for, what does it promise, and what is out of scope? | humans + agents | maintainers | 2026-10-02 | active |
| [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) | architecture-spec | How is it built: which verified host seams, which module contracts, and what is the target design? | implementing/reviewing agents | maintainers | 2026-10-02 | active |
| [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) | maintenance-handoff | What is the current status and what trips up a maintainer? | maintainers | maintainers | 2026-10-02 | active |
| [`TESTING.md`](../TESTING.md) | testing-guide | How does a volunteer install, configure, trial and report? | volunteers | maintainers | 2026-10-02 | active |
| [`SECURITY.md`](../SECURITY.md) | security-policy | What is ABG not, what are its accepted limits, and how is a vulnerability reported? | everyone | maintainers | 2026-10-02 | active |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | contributing | How do I contribute, and which checks gate a change? | contributors | maintainers | 2026-10-02 | active |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | code-of-conduct | How must participants behave? | everyone | maintainers | 2026-10-02 | active |
| [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md) | implementation-handoff | Where did the original build order and acceptance gates go? | agents | maintainers | 2026-10-02 | retired — thin pointer |
| [`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](TASK-FAILURE-REPORT-TEMPLATE.md) | template | How do I file a task failure so it can be triaged? | users + maintainers | maintainers | 2026-10-02 | active |
| [`docs/DOCUMENTATION-INDEX.md`](DOCUMENTATION-INDEX.md) | documentation-index | Which document owns which information? | everyone | maintainers | 2026-10-02 | active |

## Auxiliary files (no front matter, by design)

| File | Kind | Position | Owner | last_reviewed |
|---|---|---|---|---|
| [`.github/pull_request_template.md`](../.github/pull_request_template.md) | PR template | What must a pull request state and prove? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml) | issue form | How is a defect in ABG reported? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/feature_request.yml`](../.github/ISSUE_TEMPLATE/feature_request.yml) | issue form | How is a capability proposed? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/config.yml`](../.github/ISSUE_TEMPLATE/config.yml) | issue-form config | Which routes are offered instead of a blank issue? | maintainers | 2026-10-02 |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI config | Which checks must pass? | maintainers | 2026-10-02 |

Linked implementation documents, owned outside this documentation set and
therefore not front-matter-governed here:

| File | doc_type | Position | Owner |
|---|---|---|---|
| [`plugin/README.md`](../plugin/README.md) | implementation-readme | What does the package do, and how is it configured and verified? | plugin maintainer |
| [`plugin/TYPESCRIPT-MIGRATION.md`](../plugin/TYPESCRIPT-MIGRATION.md) | migration-record | Which plugin sources are TypeScript, how the build works, and what is exempt? | plugin maintainer |
| [`plugin/CHANGELOG.md`](../plugin/CHANGELOG.md) | changelog | What changed in each package release, and why? | plugin maintainer |
| [`eval/README.md`](../eval/README.md) | evaluation-readme | How is behavioural effect measured, and what are the metrics? | evaluation owner |

## Single sources of truth

For each kind of information there is exactly one authoritative home. Every other
page links to it; it does not restate it. If you find a restatement, delete it
and leave the link.

| Information kind | Single authoritative home | Pages that must link, not restate |
|---|---|---|
| Positioning — what ABG is and is not | [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §1, §4–§5 | [`README.md`](../README.md) intro, [`SECURITY.md`](../SECURITY.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`plugin/README.md`](../plugin/README.md) |
| Host integration seams | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part A (§§2, §17–§20) | [`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md), [`plugin/README.md`](../plugin/README.md) |
| Target design and module contracts | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B (§§22–§34) | [`README.md`](../README.md), [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §13, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`plugin/README.md`](../plugin/README.md) |
| Acceptance gates and evaluation method | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §30.4, §32 | [`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md), [`eval/README.md`](../eval/README.md) |
| Current status and numbers | [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §3–§4 | [`README.md`](../README.md) §Status, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §21, §33, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`TESTING.md`](../TESTING.md) intro, [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §11 |
| Install / update / uninstall — installing ABG into a profile | [`README.md`](../README.md) §Install | [`TESTING.md`](../TESTING.md) §2, §5, [`plugin/README.md`](../plugin/README.md) (package-level npm lifecycle) |
| Volunteer test procedure (first trial, A/B check, feedback) | [`TESTING.md`](../TESTING.md) | [`README.md`](../README.md) §Install, [`plugin/README.md`](../plugin/README.md) §Feedback |
| Known limitations — accepted limits, not bugs | [`SECURITY.md`](../SECURITY.md) §Known limitations | [`TESTING.md`](../TESTING.md) §7, [`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](TASK-FAILURE-REPORT-TEMPLATE.md) §12, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §34.3 |
| Security reporting | [`SECURITY.md`](../SECURITY.md) §Reporting a vulnerability | [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), [`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](TASK-FAILURE-REPORT-TEMPLATE.md) |
| Task-failure report template | [`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](TASK-FAILURE-REPORT-TEMPLATE.md) | [`README.md`](../README.md) §Reporting, [`TESTING.md`](../TESTING.md) §6, [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml) |
| Maintenance gotchas — environment and process traps | [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §7 | [`TESTING.md`](../TESTING.md) §2, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`eval/README.md`](../eval/README.md) |
| How to run the checks (build, typecheck, tests, `verify.sh`, `check-docs.sh`) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Running the checks | [`README.md`](../README.md) §Development, [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §2, [`plugin/README.md`](../plugin/README.md) §Verification |
| TypeScript migration policy, exceptions, and the build | [`plugin/TYPESCRIPT-MIGRATION.md`](../plugin/TYPESCRIPT-MIGRATION.md) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Running the checks, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §31.2 |

## Checking this file

From the repository root:

```bash
./scripts/check-docs.sh
```

It fails when a relative link is broken, a governed document is missing
`owner`/`last_reviewed`, a `last_reviewed` value is unparsable, or a governed
document is absent from this index. It has no dependencies beyond a POSIX shell
and the base utilities.
