---
doc_type: documentation-index
project: information-environment-governance
version: 0.3.0
plugin_version: 0.9.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.9.0-batch-3
audience: everyone
language: en
---

# Documentation Index and Single Sources of Truth

This is the inventory of the project's documents and the map of which document
owns which kind of information. Read it before adding, moving, or rewriting a
document. `scripts/check-docs.sh` enforces the mechanical rules below.

The project is **`dsh-information-environment-governance`** ("IEG") as of 0.7.0;
it was previously `dsh-agent-behavioral-governance` ("ABG"). Pre-0.7.0
[`CHANGELOG.md`](../CHANGELOG.md) entries keep the old name because
a changelog is immutable history; the rename and the withdrawal of the
`user-attention` capability are recorded in
[`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §13.

## Deciding what to keep (classification)

A maintenance pass must decide *what a piece of text is*, not merely whether it
sounds old. These labels are used across the documents when a reader could
otherwise mistake history for the current design:

| Label | Meaning | What to do |
|---|---|---|
| **CURRENT** | Authoritative statement of the shipped design. | No marking needed. |
| **HISTORICAL** | True of an earlier round; kept so older references still make sense. | Mark it clearly as history. |
| **SUPERSEDED** | Replaced by a named newer thing. | State what replaced it. |
| **RETIRED** | Deliberately no longer a design; not a current or planned capability. | Make the retirement unmistakable. |
| **REFERENCE** | A pointer to an external authority (a host document, a spec, a URL). | Link; do not restate. |
| **REMOVE** | No remaining value. | Delete it. |

"Outdated" is not a synonym for "must delete": a superseded number that still
reads as a standing result is removed, while a superseded decision that explains
why the current one exists stays and is labelled.

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
| [`README.md`](../README.md) | readme | What is this project, and where do I start? | everyone | maintainers | 2026-10-03 | active |
| [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) | product-spec | What is IEG for, what does it promise, and what is out of scope? | humans + agents | maintainers | 2026-10-03 | active |
| [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) | architecture-spec | How is it built: which verified host seams, which module contracts, and what is the target design? | implementing/reviewing agents | maintainers | 2026-10-03 | active |
| [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) | maintenance-handoff | What is the current status, and what trips up a maintainer? | maintainers | maintainers | 2026-10-03 | active |
| [`TESTING.md`](../TESTING.md) | testing-guide | How does a volunteer install, configure, trial and report? | volunteers | maintainers | 2026-10-03 | active |
| [`SECURITY.md`](../SECURITY.md) | security-policy | What is IEG not, what are its accepted limits, and how is a vulnerability reported? | everyone | maintainers | 2026-10-03 | active |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | contributing | How do I contribute, and which checks gate a change? | contributors | maintainers | 2026-10-03 | active |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | code-of-conduct | How must participants behave? | everyone | maintainers | 2026-10-02 | active |
| [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md) | implementation-handoff | Where did the original build order and acceptance gates go? | agents | maintainers | 2026-10-03 | retired — thin pointer |
| [`docs/DOCUMENTATION-INDEX.md`](DOCUMENTATION-INDEX.md) | documentation-index | Which document owns which information? | everyone | maintainers | 2026-10-03 | active |
| [`docs/PACKAGE-REFERENCE.md`](PACKAGE-REFERENCE.md) | implementation-readme | What does the package do, and how is it configured and installed? | implementers + operators | maintainers | 2026-10-03 | active |
| [`TYPESCRIPT-MIGRATION.md`](../TYPESCRIPT-MIGRATION.md) | migration-record | Which sources are TypeScript, how the build works, and what is exempt? | contributors | maintainers | 2026-10-03 | active |
| [`CHANGELOG.md`](../CHANGELOG.md) | changelog | What changed in each package release, and why? Pre-0.7.0 entries keep the historical name `dsh-agent-behavioral-governance` (ABG). | everyone | maintainers | 2026-10-03 | active |

## Auxiliary files (no front matter, by design)

| File | Kind | Position | Owner | last_reviewed |
|---|---|---|---|---|
| [`.github/pull_request_template.md`](../.github/pull_request_template.md) | PR template | What must a pull request state and prove? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml) | issue form | How is a defect in IEG reported? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/feature_request.yml`](../.github/ISSUE_TEMPLATE/feature_request.yml) | issue form | How is a capability proposed? | maintainers | 2026-10-02 |
| [`.github/ISSUE_TEMPLATE/config.yml`](../.github/ISSUE_TEMPLATE/config.yml) | issue-form config | Which routes are offered instead of a blank issue? | maintainers | 2026-10-02 |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI config | Which checks must pass? | maintainers | 2026-10-02 |

Linked implementation documents that are deliberately **not** governed here (no
front matter, no index-coverage rule):

| File | doc_type | Position | Owner |
|---|---|---|---|
| [`eval/README.md`](../eval/README.md) | evaluation-readme | How is behavioural effect measured, and what are the metrics? | evaluation owner |

## Single sources of truth

For each kind of information there is exactly one authoritative home. Every other
page links to it; it does not restate it. If you find a restatement, delete it
and leave the link. **A row must not point at a capability that no longer
exists** — in particular, nothing here names the removed `user-attention` module
or failure class as current.

| Information kind | Single authoritative home | Pages that must link, not restate |
|---|---|---|
| Positioning, the canonical definition of "Information Environment", and the out-of-scope list | [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §1 | [`README.md`](../README.md) intro, [`SECURITY.md`](../SECURITY.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) |
| Host integration seams | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part A | [`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md), [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) |
| Target design and module contracts (three modules) | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B | [`README.md`](../README.md), [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §13, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) |
| Acceptance gates and evaluation method (gates A–J) | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §32 | [`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md), [`eval/README.md`](../eval/README.md) |
| Current status and numbers | [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §3–§4 | [`README.md`](../README.md) §Status, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`TESTING.md`](../TESTING.md) intro, [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §11 |
| Naming change, withdrawn capability, gate renumbering, and earlier rounds | [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §13 | [`README.md`](../README.md), [`PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §6.2, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B, [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md) |
| Install / update / uninstall — installing IEG into a profile | [`README.md`](../README.md) §Install | [`TESTING.md`](../TESTING.md) §2, §5, [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) (package-level npm lifecycle) |
| The `dsh-ieg` terminal interface — control, prompt.md and the menu | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B (control plane and terminal interface) | [`README.md`](../README.md) §Interface, [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) §Terminal interface, [`TESTING.md`](../TESTING.md) §3 |
| Volunteer test procedure (first trial, A/B check, deviation report) | [`TESTING.md`](../TESTING.md) | [`README.md`](../README.md) §Install, [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) §Verification |
| Known limitations — accepted limits, not bugs | [`SECURITY.md`](../SECURITY.md) §Known limitations | [`TESTING.md`](../TESTING.md) §7, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B |
| Security reporting | [`SECURITY.md`](../SECURITY.md) §Reporting a vulnerability | [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) |
| Deviation reports — an ordinary GitHub issue, not a bespoke template | [`.github/ISSUE_TEMPLATE/bug_report.yml`](../.github/ISSUE_TEMPLATE/bug_report.yml) | [`README.md`](../README.md) §Reporting, [`TESTING.md`](../TESTING.md) §6, [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Maintenance gotchas — environment and process traps | [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §7 | [`TESTING.md`](../TESTING.md) §2, [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`eval/README.md`](../eval/README.md) |
| How to run the checks (build, typecheck, tests, `verify.sh`, `check-docs.sh`) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Running the checks | [`README.md`](../README.md) §Development, [`MAINTENANCE-HANDOFF.md`](../MAINTENANCE-HANDOFF.md) §2, [`docs/PACKAGE-REFERENCE.md`](../docs/PACKAGE-REFERENCE.md) §Verification |
| TypeScript migration policy, exceptions, and the build | [`TYPESCRIPT-MIGRATION.md`](../TYPESCRIPT-MIGRATION.md) | [`CONTRIBUTING.md`](../CONTRIBUTING.md) §Running the checks, [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part B (release policy) |

## Checking this file

From the repository root:

```bash
./scripts/check-docs.sh
```

It fails when a relative link is broken, a governed document is missing
`owner`/`last_reviewed`, a `last_reviewed` value is unparsable, or a governed
document is absent from this index. It has no dependencies beyond a POSIX shell
and the base utilities.
