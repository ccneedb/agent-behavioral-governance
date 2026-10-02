---
doc_type: product-spec
project: agent-behavioral-governance
version: 0.3.0
status: finalized-for-agent-handoff
revision: child-agent-lifecycle-removed
verified_against: dsh-v0.2.0-rc.2
language: en
host_target: deepseek-harness
host_baseline: dsh-v0.2.0-rc.2
format_note: conservative-machine-readable-markdown
---

# Agent Behavioral Governance — Product Specification

## 1. Product Positioning

**Agent Behavioral Governance (ABG)** is a DeepSeek Harness plugin that supplements the host system prompt and runtime with project-work governance.

It is not a replacement system prompt, a second agent identity, a generic prompt improver, or a universal safety layer.

Its purpose is to reduce recurring project-execution failures by turning project-work principles into:

1. stable behavioral guidance;
2. explicit project state;
3. deterministic runtime checks where DSH exposes an appropriate control seam; and
4. auditable lifecycle and information-management records.

The governing design principle is:

> **Use the weakest mechanism that can reliably enforce a rule, and use deterministic enforcement instead of repeated prompting whenever the harness can provide it.**

ABG treats project execution as an information-management problem. The plugin therefore manages not only instructions, but also project state, information validity, user-attention consumption, and workspace mutation.

## 2. Problem Statement

Observed DSH agent behavior includes four recurring failure classes:

### 2.1 Project ownership and semantic drift

Agents may begin execution before sufficiently establishing project background, intent, terminology, scope, and current objective. This can cause task drift and reinterpretation of project terms during later steps.

### 2.2 Unauthorized workspace mutation

Agents may create files or alter workspace structure without explicit authorization, producing workspace disorder and uncontrolled persistent state.

### 2.3 Reuse of known-invalid information

Agents may detect outdated, incorrect, or superseded information but only flag it instead of removing, replacing, or quarantining it. The invalid information then remains available for future reasoning.

### 2.4 Fragmented user questioning

Agents may discover several deterministic blockers but ask them one at a time. This increases task duration and consumes user attention unnecessarily.

ABG treats user attention as a **finite, non-renewable task resource**. Deterministic questions should therefore be consolidated into a batch, while genuinely uncertain or non-blocking issues may be deferred.

## 3. Product Goals

### G1 — Maintain project orientation

Keep the agent aligned with the current project intent, terminology, objective, constraints, and execution state.

### G2 — Protect workspace integrity

Prevent or gate unauthorized persistent workspace mutations where the runtime exposes a suitable enforcement seam.

### G3 — Maintain information integrity

Prevent known-invalid information from remaining indistinguishable from authoritative project information.

### G4 — Minimize user-attention cost

Resolve autonomously when safe, defer uncertainty when non-blocking, and consolidate currently deterministic questions into high-yield user interactions.

### G5 — Supplement, do not conflict with, DSH

ABG must not replace the host system prompt, redefine first-party semantics, or silently contradict DSH's built-in plan, tool, permission, sandbox, subagent, or interaction policies.

### G6 — Support agent-driven implementation

The documentation and module contract must be sufficiently explicit for agents operating inside DSH to implement and extend the plugin with minimal user intervention.

## 4. Non-Goals

ABG does not aim to:

- replace DSH's system prompt;
- replace DSH's plan mode;
- replace DSH's permission or approval system;
- create a new general-purpose project-management system;
- guarantee model obedience solely through natural-language instructions;
- treat all workspace instructions as higher-authority than direct user instructions;
- encode host-specific assumptions that cannot be verified against the active DSH version.

## 5. Core Product Principles

### P1 — Host-first semantics

The host system prompt and first-party runtime semantics remain authoritative. ABG only adds project-work governance within its declared scope.

### P2 — Additive system-prompt integration

ABG contributes one logical, additive governance section. It must never use the DSH `complete: true` mechanism to replace the assembled system prompt.

### P3 — Stable policy, dynamic state

Stable governance principles belong in the system-prompt contribution. Dynamic project state belongs in explicit plugin state rather than repeated full prompt expansion.

### P4 — Information has status

Project information should be distinguishable as authoritative, provisional, suspect, deprecated, invalid, superseded, or pending user confirmation.

### P5 — User attention is a scarce resource

Questions should be treated as an interaction budget. Maximize useful information gained per user interaction.

### P6 — Uncertainty is allowed to persist

An unresolved issue does not automatically require immediate user interruption. Non-blocking uncertainty may be deferred until it becomes necessary to progress safely.

### P7 — Deterministic enforcement over behavioral repetition

When a rule can be checked or enforced by hooks, permissions, lifecycle APIs, or state transitions, prefer that mechanism over adding more prompt text.

### P8 — Diagnose before destructive remediation

Before removing or reclaiming anything, distinguish genuinely obsolete material from content that is still authoritative, and establish what the removal affects.

## 6. Functional Scope

ABG consists of a small kernel and independently managed governance modules.

### Kernel responsibilities

The kernel owns:

- module registration and validation;
- module enablement and dependency handling;
- prompt aggregation;
- host-compatibility rules;
- module conflict detection;
- shared project-state services;
- shared diagnostics and audit events;
- version and capability detection.

The kernel does **not** own all behavioral policy text.

### Initial module set

| Module | Primary problem | Primary control surface |
|---|---|---|
| `project-governance` | orientation, scope, intent, terminology drift | prompt + project state + pre-step checks |
| `workspace-governance` | unauthorized persistent mutation | prompt + authorization/tool/runtime checks |
| `information-integrity` | stale/invalid information reuse | project state + prompt + lifecycle/state checks |
| `user-attention` | fragmented questioning | question-state aggregation + prompt + user-question integration |

## 7. Module Contract

Each module must declare at least:

```text
id
version
problem
objective
principles
prompt (optional)
scope
state schema (optional)
enforcement hooks (optional)
dependencies
risk level
feature flag / default enablement
```

The important semantic separation is:

```text
problem       = why the module exists
objective     = desired outcome
principles    = stable rules
prompt        = model-facing guidance
state         = durable runtime facts
 enforcement  = mechanically enforceable behavior
```

## 8. User Experience

ABG should be mostly invisible during normal successful work.

The user should experience:

- fewer avoidable interruptions;
- more consolidated questions;
- fewer unexplained workspace artifacts;
- less reuse of known-invalid project information;
- clearer project progress and blockers.

When intervention is required, ABG should explain the blocking condition in project terms rather than exposing internal implementation details.

## 9. Product Requirements

### PR-01 — Initialization

Before material project advancement, the system should maintain a compact project orientation state containing current objective, terminology, constraints, known blockers, and important assumptions.

### PR-02 — Mutation governance

The system should distinguish read-only inspection from persistent workspace mutation. New persistent artifacts and structural changes should be authorized according to the active policy.

### PR-03 — Information hygiene

When information is known to be invalid, obsolete, or superseded, it must be corrected, removed, or quarantined before it can be treated as authoritative project knowledge.

### PR-04 — Question batching

Before requesting user input, the system should aggregate currently deterministic blockers, deduplicate them, identify dependencies between them, and produce one coherent question batch where possible.

### PR-05 — Deferred uncertainty

Non-blocking uncertain issues may be recorded for later rather than immediately interrupting the user.

### PR-06 — Version awareness

The plugin must know the DSH version it targets and must detect or report when host behavior relevant to ABG has changed.

### PR-07 — Auditable policy changes

Changes to module prompts or enforcement rules should be versioned and attributable to a documented problem or evaluation result.

## 10. Quality Targets

The first production-quality target is behavioral improvement, not maximum feature count.

Required evaluation dimensions include:

| Dimension | Measure |
|---|---|
| Project alignment | rate of successful orientation before major execution |
| Workspace integrity | unauthorized persistent mutations per task |
| Information integrity | rate of reuse of known-invalid information |
| User attention | user-question turns per task; questions per batch; redundant-question rate |
| Compatibility | host-version regression failures |
| Prompt cost | governance prompt token footprint and stability |

## 11. Success Criteria for v0.1

ABG v0.1 is successful when:

1. its governance section can be added without replacing or semantically colliding with the host system prompt;
2. the four failure classes (`FC-2.1`…`FC-2.4`) are represented as distinct modules;
3. user-question batching is supported by explicit state rather than prompt prose alone;
4. at least one deterministic enforcement seam is used for a rule that can be mechanically checked;
5. the implementation can be maintained by agents operating within DSH using the provided architecture specification.

## 12. Reference Basis

The product design is aligned with DSH v0.2.0-rc.2 architecture as observed in the upstream repository on 2026-10-01:

- System prompt assembly and ordered `PromptSection` registration: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts
- System prompt subsystem documentation: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- User question service and batched question model: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/user-questions.md
- Workspace instruction package: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
- Plan mode and its soft-guidance boundary: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md
- v0.2.0-rc.2 release notes: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2

## 13. Host Verification Note

The requirements above were written before the host was inspected. That inspection has since been performed against the installed distribution, and it changes how several requirements can be satisfied without changing what they demand.

| Requirement | Effect of host verification |
|---|---|
| PR-04 question batching | Supported, but only **within a single `ask_user_question` call**. There is no host facility for merging independent pending requests, recording deferred unknowns, or detecting dependencies, so the aggregation state is ABG-owned. Consolidation is also available only to live runtime root agents. |
| PR-05 deferred uncertainty | The host primitive is a **timed question** that releases the agent while the question remains answerable, not a stored "deferred" record. |
| PR-06 version awareness | A concrete mechanism exists: declared DSH peer ranges are enforced at install and startup, with an audited exemption registry. |

Goals, non-goals, and success criteria were not changed by host verification. The architectural consequences are recorded in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §17 (verified seams), §18 (deltas D1–D15), §19 (resolved items), and §20 (assumptions and items requiring confirmation).

