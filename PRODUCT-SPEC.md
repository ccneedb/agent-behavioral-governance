---
doc_type: product-spec
project: information-environment-governance
version: 0.5.0
plugin_version: 0.9.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.9.0-batch-3
verified_against: dsh-v0.2.1-alpha.1
language: en
host_target: deepseek-harness
host_baseline: dsh-v0.2.1-alpha.1
format_note: conservative-machine-readable-markdown
---

# Information Environment Governance — Product Specification

## 1. Product Positioning

This section is the **canonical positioning** for the project; every other
document links here rather than restating it
([`docs/DOCUMENTATION-INDEX.md`](docs/DOCUMENTATION-INDEX.md)).

**Information Environment Governance (IEG)** is an additive
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin. The
package is `dsh-information-environment-governance`, version **0.8.0**, MIT
licensed and `"private": true`. It supplements the host system prompt and
runtime with project-work governance.

It is not a replacement system prompt, a second agent identity, a generic prompt
improver, or a universal safety layer.

### 1.1 Canonical definition

> **Information Environment:** the persistent information and project
> constraints that an agent continuously encounters, relies on, modifies, or
> inherits while working on a project.

This is the project's canonical definition. Every other document links to this
section instead of restating it.

### 1.2 Primary areas

The information environment has three primary areas:

1. **Project Constraints** — objective, scope, terminology, constraints, and
   current phase.
2. **Information State** — authority, validity, provenance, supersession, and
   lifecycle status.
3. **Persistent Workspace** — documents, artifacts, source/configuration, and
   generated files.

IEG treats project execution as an information-management problem. Its purpose is
to reduce recurring project-execution failures by turning project-work principles
into:

1. stable behavioral guidance;
2. explicit project state;
3. deterministic runtime checks where DSH exposes an appropriate control seam;
   and
4. auditable lifecycle and information-management records.

The governing design principle is:

> **Use the weakest mechanism that can reliably enforce a rule, and use deterministic enforcement instead of repeated prompting whenever the harness can provide it.**

### 1.3 Two governance entry points

IEG has exactly two governance entry points:

1. **Project Constraint Governance** — keeps the project's objective, scope,
   terminology, constraints, and current phase explicit, and keeps the agent's
   declared understanding of them distinct from its actual behavior.
2. **Information / Document Governance** — keeps the state of project
   information and the documents that carry it explicit, and governs their
   lifecycle.

**Workspace hygiene is an enforcement mechanism inside the second entry point.**
It is **not** presented, and must not be built, as a general sandbox or security
system.

The three enabled modules of §6.2 map onto these entry points: `project-governance`
serves the first; `information-integrity` and `workspace-governance` serve the
second.

### 1.4 Explicitly out of scope

The following are outside IEG's scope:

- general AI safety or security;
- sandboxing;
- authorization;
- user-attention optimization (**RETIRED** — a withdrawn capability, not a
  current or planned feature; the withdrawal is recorded in
  [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §13.2);
- unrelated agent behavior management.

Any future feature must show a direct connection to Information Environment
Governance. The security consequences of this boundary are stated in
[`SECURITY.md`](SECURITY.md).

## 2. Problem Statement

Observed DSH agent behavior includes three recurring failure classes; each is
addressed by exactly one enabled module (§6.2).

### 2.1 Project ownership and semantic drift (`FC-2.1`)

Agents may begin execution before sufficiently establishing project background,
intent, terminology, scope, and current objective. This can cause task drift and
reinterpretation of project terms during later steps.

### 2.2 Unauthorized workspace mutation (`FC-2.2`)

Agents may create files or alter workspace structure without explicit
authorization, producing workspace disorder and uncontrolled persistent state.

### 2.3 Reuse of known-invalid information (`FC-2.3`)

Agents may detect outdated, incorrect, or superseded information but only flag it
instead of removing, replacing, or quarantining it. The invalid information then
remains available for future reasoning.

## 3. Product Goals

### G1 — Maintain project orientation

Keep the agent aligned with the current project intent, terminology, objective,
constraints, and execution state.

### G2 — Protect workspace integrity

Prevent or gate unauthorized persistent workspace mutations where the runtime
exposes a suitable enforcement seam.

### G3 — Maintain information integrity

Prevent known-invalid information from remaining indistinguishable from
authoritative project information.

### G4 — Supplement, do not conflict with, DSH

IEG must not replace the host system prompt, redefine first-party semantics, or
silently contradict DSH's built-in plan, tool, permission, sandbox, subagent, or
interaction policies.

### G5 — Support agent-driven implementation

The documentation and module contract must be sufficiently explicit for agents
operating inside DSH to implement and extend the plugin with minimal user
intervention.

## 4. Non-Goals

IEG does not aim to:

- replace DSH's system prompt;
- replace DSH's plan mode;
- replace DSH's permission or approval system;
- create a new general-purpose project-management system;
- guarantee model obedience solely through natural-language instructions;
- treat all workspace instructions as higher-authority than direct user
  instructions;
- encode host-specific assumptions that cannot be verified against the active
  DSH version;
- optimize, batch, or otherwise manage the user's attention or question flow.

## 5. Core Product Principles

### P1 — Host-first semantics

The host system prompt and first-party runtime semantics remain authoritative.
IEG only adds project-work governance within its declared scope.

### P2 — Additive system-prompt integration

IEG contributes one logical, additive governance section. It must never use the
DSH `complete: true` mechanism to replace the assembled system prompt.

### P3 — Stable policy, dynamic state

Stable governance principles belong in the system-prompt contribution. Dynamic
project state belongs in explicit plugin state rather than repeated full prompt
expansion.

### P4 — Information has status

Project information should be distinguishable as authoritative, provisional,
suspect, deprecated, invalid, superseded, or pending user confirmation.

### P5 — Uncertainty may persist

An unresolved issue does not by itself require blocking progress. Uncertainty is
recorded explicitly and resolved when it becomes material, rather than being
treated as a blocker by default.

### P6 — Deterministic enforcement over behavioral repetition

When a rule can be checked or enforced by hooks, permissions, lifecycle APIs, or
state transitions, prefer that mechanism over adding more prompt text.

### P7 — Diagnose before destructive remediation

Before removing or reclaiming anything, distinguish genuinely obsolete material
from content that is still authoritative, and establish what the removal affects.

## 6. Functional Scope

IEG consists of a small kernel and independently managed governance modules.

### 6.1 Kernel responsibilities

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

### 6.2 Module set (3, all enabled by default)

| Module | Primary problem | Failure class | Primary control surface |
|---|---|---|---|
| `project-governance` | orientation, scope, intent, terminology drift | `FC-2.1` | prompt + project state + pre-step checks |
| `information-integrity` | stale/invalid information reuse | `FC-2.3` | project state + prompt + lifecycle/state checks |
| `workspace-governance` | unauthorized persistent mutation | `FC-2.2` | prompt + authorization/tool/runtime checks |

The shipped plugin realizes exactly this set; the maintained per-module contracts
are in [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part B.

The `user-attention` module and failure class `FC-2.4` were removed in 0.7.0.
Their classification is **Out of Scope / Externally Solved**: testing found a
stable prompt-level solution, so runtime governance is no longer justified. The
withdrawal is recorded as history in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md), and pre-0.7.0
[`CHANGELOG.md`](CHANGELOG.md) entries keep the historical name.

### 6.3 Semantic boundaries

Two architectural directions are **preserved as terminology and boundaries**.
Neither is a subsystem built or promised in this batch.

**Declared understanding vs. actual behavioral consistency.** Project Constraint
Governance keeps project orientation and state, and distinguishes what the
project has *declared* (objective, scope, terminology, constraints, phase) from
whether the agent's *observed actions* are consistent with it. A future
**Orientation Consistency** direction is named here — declared constraints →
observed actions → consistency/drift evaluation — and is explicitly **not
implemented in this batch**.

**Lifecycle status vs. retrieval eligibility.** Information Integrity keeps its
lifecycle model and distinguishes **existence**, **status**, **authority**,
**provenance**, **supersession**, and **retrieval eligibility**. The key semantic
statement is:

> An obsolete or superseded item may remain stored without being eligible for
> normal/default retrieval.

No retrieval system is built in this batch; only the semantic boundary and its
terminology are recorded.

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
enforcement   = mechanically enforceable behavior
```

## 8. User Experience

IEG should be mostly invisible during normal successful work.

The user should experience:

- fewer unexplained workspace artifacts;
- less reuse of known-invalid project information;
- a workspace whose documents match the current project state;
- clearer project progress and blockers.

When intervention is required, IEG should explain the blocking condition in
project terms rather than exposing internal implementation details.

## 9. Product Requirements

### PR-01 — Initialization

Before material project advancement, the system should maintain a compact project
orientation state containing current objective, terminology, constraints, known
blockers, and important assumptions.

### PR-02 — Mutation governance

The system should distinguish read-only inspection from persistent workspace
mutation. New persistent artifacts and structural changes should be authorized
according to the active policy.

### PR-03 — Information hygiene

When information is known to be invalid, obsolete, or superseded, it must be
corrected, removed, or quarantined before it can be treated as authoritative
project knowledge.

### PR-04 — Version awareness and attributable change

The plugin must know the DSH version it targets and must detect or report when
host behavior relevant to IEG has changed. Changes to module prompts or
enforcement rules must be versioned and attributable to a documented problem or
evaluation result. These two obligations were formerly separate requirements
(`PR-06` version awareness and `PR-07` auditable policy changes) and are merged
here so the renumbered set has no gap.

The user-question requirements that formerly occupied this position — question
batching (`PR-04`) and deferred uncertainty (`PR-05`) — were removed with the
`user-attention` module and are **out of scope**.

## 10. Quality Targets

The first production-quality target is behavioral improvement, not maximum
feature count.

Required evaluation dimensions include:

| Dimension | Measure |
|---|---|
| Project alignment | rate of successful orientation before major execution |
| Workspace integrity | unauthorized persistent mutations per task |
| Information integrity | rate of reuse of known-invalid information |
| Compatibility | host-version regression failures |
| Prompt cost | governance prompt token footprint and stability |

## 11. Success Criteria (v0.1 target, met — historical)

The v0.1 target was met; the package has since moved to `0.8.0`. Current status
and numbers: [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4. The v0.1
criteria were:

1. its governance section can be added without replacing or semantically
   colliding with the host system prompt;
2. the failure classes (`FC-2.1`…`FC-2.3`) are represented as distinct modules;
3. at least one deterministic enforcement seam is used for a rule that can be
   mechanically checked;
4. the implementation can be maintained by agents operating within DSH using the
   provided architecture specification.

The former criterion 3 — "user-question batching is supported by explicit state
rather than prompt prose alone" — was removed with the `user-attention` module in
0.7.0 (classification: Out of Scope / Externally Solved) and is not a current
success criterion.

## 12. Reference Basis

**REFERENCE.** The product design is aligned with the DSH architecture as observed
in the upstream repository on 2026-10-01 and re-verified against the installed
`dsh 0.2.1-alpha.1` baseline in the 0.8.0 round:

- System prompt assembly and ordered `PromptSection` registration: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts
- System prompt subsystem documentation: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- Workspace instruction package: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
- Plan mode and its soft-guidance boundary: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md
- The retired `v0.2.0-rc.2` release notes are **SUPERSEDED** by the current
  `0.2.1-alpha.1` baseline; the host's own repository is the external authority.

The former reference to the host user-question subsystem was removed with the
`user-attention` capability; IEG no longer integrates with that seam.

## 13. Host Verification Note

The requirements above were written before the host was inspected. That
inspection has since been performed against the installed distribution, and it
changes how several requirements can be satisfied without changing what they
demand. The rows below are the ones that still apply; the former rows for
question batching and deferred uncertainty were removed with the user-question
seam.

| Requirement | Effect of host verification |
|---|---|
| PR-04 version awareness | A concrete mechanism exists: declared DSH peer ranges are enforced at install and startup, with an audited exemption registry. The compatibility adapter observes the real `system-prompt/assemble` waterfall and reports a verdict against a committed baseline. The single supported baseline is `>=0.2.1-alpha.1 <0.3.0`; `dsh.compatibility.dshReleases` records `0.2.1-alpha.1` as `verified`, and the committed baseline was re-captured against it in 0.8.0. The retired `0.2.0-rc.2` baseline is **SUPERSEDED**. |

The user-question seam (`ctx.userQuestions.ask`, batched question model) is
**removed from scope** in 0.7.0; IEG neither owns question state nor gates
question batches. Goals, non-goals, and success criteria were otherwise not
changed by host verification. The architectural consequences are recorded in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part A (verified seams, deltas, and assumptions) and Part B (target design,
acceptance matrix, and phase plan).
