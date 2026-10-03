---
doc_type: implementation-handoff
project: information-environment-governance
version: 0.5.0
plugin_version: 0.8.0
status: retired
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.8.0-batch-2
superseded_by: ARCHITECTURE-SPEC-AGENT-REFERENCE.md §32 (gates) and Part B (evaluation cases); MAINTENANCE-HANDOFF.md §3–§4 (status)
language: en
---

# Implementation & Validation Handoff — retired pointer

This file was the original build order, investigation protocol, validation cases,
and acceptance-gate list. The build order is complete and every part of it now
lives in the maintained documents below. It is kept only so that existing
references — notably [`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md) and the
conformance-suite comments — keep resolving. It must not grow again: add
maintained content to the documents named here, not to this file.

## Where each former section now lives

| Former section | Current home |
|---|---|
| §1 Mission | [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1–§3 |
| §2 Host reconnaissance | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) Part A (verified host integration) |
| §3 Prompt-priority experiment | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part A resolved items |
| §4 Kernel contract | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` kernel and component model |
| §5 Module delivery order | historical note below; the module contracts are in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part B |
| §6–§9 Evaluation designs and metrics | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §32 and Part B evaluation cases; metrics in [`eval/README.md`](eval/README.md) |
| §10 Prompt content rules | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part B (executable in the conformance suite) |
| §11 Acceptance gates | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §32.1 — the current gates are **A–J**, a superset of the original A–F |
| §12 Suggested repository layout | the repository tree; see [`CONTRIBUTING.md`](CONTRIBUTING.md) §Layout |
| §13 Agent operating rule | [`CONTRIBUTING.md`](CONTRIBUTING.md) §Adding a module |
| §14 Reference basis | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §16 |

## Historical note: the original build order

Modules were delivered in dependency order — M1 `project-governance` (the shared
project-state vocabulary), M2 `information-integrity` (how later modules classify
and trust state), M3 `user-attention` (question collection and batching), M4
`workspace-governance` (host authorization, filesystem, and tool seams). The
delivery phases that followed (kernel and prompt aggregation; project and
information; user-attention; workspace enforcement; evaluation) were executed and
are superseded by the later phase plan in
`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part B.

**Naming and scope history.** The project was `dsh-agent-behavioral-governance`
("ABG") before 0.7.0; it is now `dsh-information-environment-governance` ("IEG")
with the `dsh-ieg` terminal command. The `user-attention` module (M3) and failure
class `FC-2.4` were **removed in 0.7.0**, classified **Out of Scope / Externally
Solved**; the current module set is three. The original Gate A–F statements were
folded into `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §32.1, and the 0.7.0
withdrawal renumbered the gates to A–J. The full history is in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §13.
