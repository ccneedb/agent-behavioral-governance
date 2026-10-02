---
doc_type: implementation-handoff
project: agent-behavioral-governance
version: 0.3.0
status: retired
owner: maintainers
last_reviewed: 2026-10-02
superseded_by: ARCHITECTURE-SPEC-AGENT-REFERENCE.md §32 (gates) and §32.6 (evaluation cases); MAINTENANCE-HANDOFF.md §3–§4 (status)
language: en
---

# Implementation & Validation Handoff — retired pointer

This file was the original build order, investigation protocol, validation cases,
and acceptance-gate list. The build order is complete and every part of it now
lives in the maintained documents below. It is kept only so that existing
references — notably [`plugin/README.md`](plugin/README.md) and the
conformance-suite comments — keep resolving. It must not grow again: add
maintained content to the documents named here, not to this file.

## Where each former section now lives

| Former section | Current home |
|---|---|
| §1 Mission | [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1–§3 |
| §2 Host reconnaissance | [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §17 (verified host integration) |
| §3 Prompt-priority experiment | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §19.1 |
| §4 Kernel contract | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §5.1, §6 |
| §5 Module delivery order | historical note below; the minimum state models are in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §24.2 |
| §6–§9 Evaluation designs and metrics | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §32.6; metrics in [`eval/README.md`](eval/README.md) |
| §10 Prompt content rules | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §27 (executable in the conformance suite) |
| §11 Acceptance gates | `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §32.1 — gates A–K, a superset of the original A–F |
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
are superseded by the P0–P7 plan in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §33.
The original Gate A–F statements are folded into §32.1.
