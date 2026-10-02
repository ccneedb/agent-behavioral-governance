---
doc_type: implementation-handoff
project: agent-behavioral-governance
version: 0.2.0
status: finalized-for-agent-handoff
revision: child-agent-lifecycle-removed
verified_against: dsh-v0.2.0-rc.2
audience: agents-implementing-in-dsh
language: en
host_target: deepseek-harness
host_baseline: dsh-v0.2.0-rc.2
format_note: conservative-machine-readable-markdown
---

# Agent Behavioral Governance — Implementation & Validation Handoff

## 1. Mission

Implement the Agent Behavioral Governance plugin in DeepSeek Harness as an additive, modular governance layer.

The implementation must preserve DSH's existing first-party semantics while strengthening project-work behavior through a combination of system-prompt guidance, explicit state, and deterministic runtime enforcement.

## 2. First Task: Host Reconnaissance

Before implementing non-trivial enforcement, inspect the **actual active v0.2.0-rc.2 composition**.

Record:

1. package and plugin entry points;
2. actual system-prompt sections registered in the target composition;
3. section order resolution;
4. whether a safe extension point exists for an ABG section;
5. `agent/pre-step` and related lifecycle hook signatures;
6. user-question service wiring;
7. filesystem/authorization seams relevant to mutation governance.

Do not infer these from stale documentation when source can answer the question.

> **Completed.** This reconnaissance has been performed against the installed `@deepseek-ai/dsh` `0.2.0-rc.2`. The verified results are recorded in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` **§17 (Verified Host Integration)**, with the consequences for the architecture in **§18 (Deltas)** and the remaining unknowns in **§20**. Implement against §17 rather than re-deriving these seams from documentation; treat §20 as the authoritative list of what is still unconfirmed.

## 3. Experimental Prompt-Priority Validation

The original hypothesis was:

> plugin built-in prompts have intrinsically higher execution priority than user prompts.

The source architecture does not establish that claim. Test the behavior empirically instead.

Use controlled variants with equivalent wording:

```text
A — direct user message
B — workspace instruction
C — plugin system-prompt section
D — plugin user-role injection
E — pre-step deterministic enforcement
```

Measure:

- instruction-following rate;
- contradiction rate;
- unauthorized mutation rate;
- context-placement effects;
- behavior under compaction/resume;
- effects of repeated versus stable instructions.

Do not summarize the result as “plugin prompts are stronger” unless the experiment actually supports that statement.

> **Reframed by host verification.** See `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §19.1. Plugin and user content occupy different roles in different channels: prompt prose is advisory, whereas `agent/pre-step` and `tools/pre-execute` are authoritative waterfalls that can veto. Prefer comparing channels (prompt section vs. pre-step enforcement vs. monotonic tool guard) over ranking prose sources, and expect the meaningful differences to come from mechanism rather than placement.

## 4. Kernel Implementation Contract

The kernel should expose conceptual services such as:

```ts
registerModule(module)
enableModule(id)
disableModule(id)
getEnabledModules()
compilePrompt(context)
getProjectState(agent)
updateProjectState(agent, event)
runGovernanceChecks(agent, step)
getCompatibilityReport()
```

Exact APIs should follow DSH conventions and existing package architecture.

## 5. Initial Module Delivery Order

### M1 — `project-governance`

Implement first because it establishes the common project-state vocabulary.

Minimum state:

```ts
interface ProjectState {
  intent?: string
  objective?: string
  scope?: string
  terminology: Record<string, string>
  constraints: string[]
  assumptions: string[]
  unknowns: string[]
  currentPhase?: string
}
```

### M2 — `information-integrity`

Implement second because it determines how later modules classify and trust state.

Minimum information status model:

```text
AUTHORITATIVE
PROVISIONAL
SUSPECT
INVALID
DEPRECATED
SUPERSEDED
PENDING_CONFIRMATION
```

### M3 — `user-attention`

Implement the question collector as a stateful subsystem.

Required operations:

```text
addQuestion
classifyQuestion
mergeQuestions
deduplicateQuestions
markDeferred
prepareBatch
submitBatch
recordAnswers
resolveDependents
```

Use DSH's existing user-question service for actual human interaction.

### M4 — `workspace-governance`

Integrate with the host's authorization/filesystem/tool mechanisms.

The module should not invent a second permission model.

## 6. Question-Batching Evaluation

Create test tasks with:

- 1 deterministic blocker;
- 3 independent deterministic blockers;
- 5 deterministic blockers with dependencies;
- mixed deterministic and uncertain questions;
- questions that become unnecessary after another answer;
- non-blocking uncertainty that should be deferred.

Measure:

```text
questions_generated
questions_sent
batches_sent
redundant_questions
average_questions_per_batch
user_interruption_count
blocked_execution_time
```

Primary objective:

> maximize useful information per user interaction without hiding material uncertainty.

## 7. Information-Integrity Evaluation

Test:

```text
valid information
invalidated information
superseded information
contradictory sources
corrected information
reintroduced stale content
```

The critical test is not whether the agent can **notice** an error. It is whether, after recognizing invalidity, the invalid information remains available and is subsequently reused as authoritative.

## 8. Workspace-Governance Evaluation

Test at least:

```text
read-only inspection
modify existing authorized artifact
create explicitly authorized artifact
create apparently useful but unauthorized artifact
delete authorized artifact
delete uncertain artifact
structural workspace change
```

Expected behavior should be measured separately for:

```text
model compliance
runtime enforcement
user approval behavior
actual filesystem outcome
```

## 9. Prompt Compatibility Regression Test

For every supported DSH version, capture:

```text
host version
active section names
section ordering
ABG compiled section
final assembled prompt hash
relevant context contributions
```

Fail compatibility tests if:

- ABG replaces the full system prompt;
- ABG section disappears;
- host section collisions occur;
- host semantics are duplicated in a conflicting form;
- a module depends on a missing seam;
- a new host version changes a critical first-party section without review.

## 10. Prompt Content Rules

All module prompts must follow these rules:

```text
DO:
- state observable behavior;
- define trigger conditions;
- distinguish policy from implementation;
- defer to host semantics;
- preserve uncertainty;
- use compact, testable language.

DO NOT:
- claim higher authority merely because the plugin is built-in;
- redefine DSH identity;
- restate complete tool manuals;
- duplicate plan-mode semantics;
- instruct the model to perform a runtime operation that the plugin can enforce deterministically.
```

## 11. Acceptance Gates

A milestone may be considered complete only when all applicable gates pass.

### Gate A — Host compatibility

ABG is additive and does not replace the host system prompt.

### Gate B — Semantic non-conflict

No module contradicts an identified first-party host semantic.

### Gate C — Behavioral improvement

At least one target failure mode shows measurable improvement against baseline.

### Gate D — User-attention efficiency

Question batching reduces interaction count without suppressing critical uncertainty.

### Gate E — Information integrity

Known-invalid information is no longer treated as authoritative by default.

### Gate F — Regression resilience

Compaction, resume, fork, and relevant lifecycle transitions preserve governance state correctly.

## 12. Suggested Repository Layout

```text
agent-behavioral-governance/
├── src/
│   ├── index.ts
│   ├── kernel/
│   │   ├── registry.ts
│   │   ├── compatibility.ts
│   │   ├── prompt-compiler.ts
│   │   ├── state.ts
│   │   ├── diagnostics.ts
│   │   └── enforcement.ts
│   ├── modules/
│   │   ├── project-governance/
│   │   ├── workspace-governance/
│   │   ├── information-integrity/
│   │   └── user-attention/
│   └── types/
├── tests/
│   ├── compatibility/
│   ├── prompt/
│   ├── project-governance/
│   ├── workspace-governance/
│   ├── information-integrity/
│   └── user-attention/
└── docs/
```

The repository structure is a recommendation, not permission to create files in an existing workspace. Follow the project's actual contribution and file-authorization rules.

## 13. Agent Operating Rule for This Project

An implementation agent working on ABG should treat these specifications as engineering inputs, not as permission to silently expand scope.

Before adding a new module:

```text
identify problem
→ confirm existing host seam
→ define smallest enforcement mechanism
→ define state
→ define prompt contribution
→ define tests
→ implement
```

Before changing existing policy text:

```text
identify failure / rationale
→ inspect host compatibility
→ update module version if semantics changed
→ add or update regression test
→ preserve baseline behavior unless evidence supports the change
```

## 14. Reference Basis

Current architecture evidence:

- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/user-questions.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/package.json
- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2

