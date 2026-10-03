---
doc_type: architecture-spec
project: information-environment-governance
version: 0.8.0
plugin_version: 0.8.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.8.0-batch-2
part_a: verified-host-integration-and-prototype-0.1.0
part_b: target-design-baseline-0.2.0-extended-through-0.8.0
part_b_status: implemented-through-the-0.8.0-packaging-round; model-backed-gates-C-and-D-pending
verified_against: dsh-v0.2.1-alpha.1
verified_method: installed-distribution-source-inspection
audience: agents-only
language: en
host_target: deepseek-harness
host_baseline: dsh-v0.2.1-alpha.1
part_a_scope: Part A host facts are scoped to @deepseek-ai/dsh 0.2.1-alpha.1 (re-captured in 0.8.0; the retired 0.2.0-rc.2 verification is SUPERSEDED); the shipped package is 0.8.0
format_note: conservative-machine-readable-markdown
---

# Information Environment Governance — Architecture Specification

> **Audience:** agents implementing, reviewing, or extending this plugin inside DeepSeek Harness. This document is intentionally more implementation-oriented than the Product Specification.
>
> **Two parts.** Sections 1–21 ("Part A") are the verified record of host integration and of the `0.1.0` prototype. Part A's host facts are scoped to `@deepseek-ai/dsh` `0.2.1-alpha.1` (the baseline re-captured in `0.8.0`; the earlier `0.2.0-rc.2` verification is **SUPERSEDED**), and the shipped package is `0.8.0`. Sections 22–34 ("Part B") carry the **target design**, whose baseline is IEG v0.2.0 and which was extended through the `0.7.0` scope-reset round (the `user-attention` capability was withdrawn, §23.2, and the module set became three) and the `0.8.0` packaging round. Part B states where it changes a Part A decision instead of rewriting Part A. Current implementation status and numbers live in [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4.

> **Classification.** Text labelled **HISTORICAL**, **SUPERSEDED**, **RETIRED**, or
> **REFERENCE** carries the meaning defined in
> [`docs/DOCUMENTATION-INDEX.md`](docs/DOCUMENTATION-INDEX.md). In particular, the
> `0.2.0-rc.2` host baseline, the `plugin/` layout, and the `lib/generated/` output
> directory are **RETIRED/SUPERSEDED**, and `user-attention` / `FC-2.4` appears
> only as clearly marked history.

## 1. Architectural Objective

Govern the **Information Environment** an agent works inside, while supplementing
the DSH host system prompt and using runtime seams for deterministic enforcement.

**Information Environment** — the persistent information and project constraints
that an agent continuously encounters, relies on, modifies, or inherits while
working on a project. IEG governs three primary areas:

```text
1. Project Constraints      objective, scope, terminology, constraints, current phase
2. Information State        authority, validity, provenance, supersession, lifecycle status
3. Persistent Workspace     documents, artifacts, source/configuration, generated files
```

The architecture must preserve this invariant:

```text
Host DSH semantics
        ↓
remain authoritative
        ↓
IEG adds Information Environment governance
        ↓
without replacing host semantics
```

IEG contributes exactly **one** additive system-prompt section and never claims
higher priority than a direct user instruction. It has two governance entry
points:

```text
1. Project Constraint Governance        §7.1 project-governance
2. Information / Document Governance    §7.3 information-integrity
                                        └─ §7.2 workspace-governance is the
                                           enforcement mechanism inside it
```

Workspace hygiene is an enforcement mechanism inside Information / Document
Governance, not a general sandbox or security system.

**Explicitly out of scope.** General AI safety and security; sandboxing;
authorization and approval semantics (owned by the host); user-attention
optimization; and unrelated agent behavior management. IEG references these host
domains rather than rebuilding them.

## 2. Host Architecture Facts Relevant to IEG

The current DSH system-prompt service supports ordered prompt sections, runtime contexts, variables, and assembly hooks. Sections are centrally ordered, and the current source exposes named placements such as harness identity, deployment persona prefix, plan policy, team policy, tool sections, subagent tools, deliverable references, structured output, and deployment persona suffix.

Current relevant section order values in the observed `0.2.1-alpha.1` source (identical in the **SUPERSEDED** `v0.2.0-rc.2` observation) include:

```text
HARNESS_IDENTITY          -1000
DEPLOYMENT_PERSONA_PREFIX     0
PLAN_POLICY                500
TEAM_POLICY                600
PTC_ONLY                   800
FILE_REFERENCE             900
TOOL_*                    1000–5000+
DELIVERABLE_FILE_REFERENCES 9000
STRUCTURED_OUTPUT          9900
HARNESS_SOURCE            10000
WEB_SURFACE               10100
DEPLOYMENT_PERSONA_SUFFIX 10200
```

IEG must not assume that a numeric gap automatically has semantic authority. Version compatibility must be checked against the active host.

> **Verification status.** The reconnaissance that §2 and §5 describe as a prerequisite has been performed against the installed distribution. Its results are recorded in **§17 (Verified Host Integration)**, which **supersedes any contradicting statement in §§1–15**, and its consequences for this specification are listed in **§18 (Deltas)**. Unresolved points that must be confirmed before implementation are in **§20**.

The DSH base bundle includes `dsh-agent-instructions`, `dsh-plan-mode`, `dsh-user-questions`, `dsh-subagent`, authorization, filesystem/tool packages, and related first-party components. Therefore IEG should integrate with existing seams instead of rebuilding them. The `dsh-user-questions` package remains a host fact, but IEG **no longer binds** that seam: the `user-attention` capability was withdrawn in `0.7.0` (§17.5, §23.2).

## 3. Top-Level Architecture

```text
                         ┌───────────────────────────┐
                         │       DSH Host Runtime     │
                         │  system prompt / agent /   │
                         │  tools / questions /       │
                         │  subagents / permissions   │
                         └─────────────┬─────────────┘
                                       │
                    host capabilities │ observations
                                       ▼
                  ┌─────────────────────────────────┐
                  │ Information Environment Governance      │
                  │              (IEG)               │
                  │                                   │
                  │  ┌─────────────────────────────┐  │
                  │  │ Kernel                      │  │
                  │  │                             │  │
                  │  │ registry / composition      │  │
                  │  │ compatibility / conflicts   │  │
                  │  │ state / audit / dispatch    │  │
                  │  └────────────┬────────────────┘  │
                  │               │                   │
                  │     ┌─────────┼─────────┐         │
                  │     ▼         ▼         ▼         │
                  │  project   workspace  information │
                  │  governance governance integrity  │
                  └────────────┬──────────────────────┘
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
        system-prompt      pre-step /       runtime state
        contribution      lifecycle hooks    & diagnostics
```

`questions` remains a host runtime capability, but IEG does **not** bind that
seam as of `0.7.0`: the `user-attention` module was withdrawn (§23.2). IEG's two
governance entry points are Project Constraint Governance (§7.1) and
Information / Document Governance (§7.3), with workspace hygiene (§7.2) enforced
inside the second.

## 4. Core Composition Pattern

Modules do not independently compete for arbitrary positions in DSH's system prompt.

Preferred composition:

```text
project-governance ─┐
workspace-governance ┼──> Prompt Compiler ──> ONE IEG PromptSection
information-integrity┘

ONE IEG section + DSH first-party sections
                 ↓
          host prompt assembly
```

The three shipped modules (§24) aggregate into one section; the composition row stays
**one** (`id: ieg`). The plugin must not use `complete: true`.

## 5. Component Model

### 5.1 Kernel

Responsibilities:

- discover/validate enabled modules;
- check host compatibility;
- resolve module dependencies;
- aggregate module prompts;
- expose shared state interfaces;
- dispatch pre-step and lifecycle observations;
- emit structured diagnostics;
- prevent conflicting module configurations.

The kernel should be deliberately small.

### 5.2 Prompt Compiler

Input:

```text
stable kernel principles
+ enabled module principles
+ enabled module prompt fragments
+ host-compatibility facts needed for safe wording
```

Output:

```text
one additive IEG system-prompt section
```

The compiler must remove duplicated statements between modules and must not repeat DSH first-party instructions unless needed to define a precise boundary.

### 5.3 Project State Store

The state store maintains compact, structured facts rather than free-form transcript copies.

Suggested state groups:

```text
Project
  intent
  objective
  scope
  terminology
  constraints
  assumptions
  current_phase

Information
  authoritative
  provisional
  suspect
  invalid
  deprecated
  superseded
  pending_confirmation

Workspace
  authorized_mutations[]
  observed_mutations[]
```

There is no `Questions` group and no question ledger: the `user-attention`
capability that would have owned one was withdrawn in `0.7.0` (§23.2). The live
per-agent state is `AgentGovernanceState = {orientation}` (§25.2); the groups
above are the vocabulary the orientation record draws on.

## 6. Module Contract

Recommended TypeScript shape:

```ts
export interface GovernanceModule {
  readonly id: string
  readonly version: string
  readonly problem: string
  readonly objective: string
  readonly principles: readonly string[]
  readonly prompt?: string
  readonly scope?: ModuleScope
  readonly dependencies?: readonly string[]
  readonly risk: 'low' | 'medium' | 'high'
  readonly enabledByDefault: boolean
  readonly state?: StateDescriptor
  readonly enforcement?: EnforcementDescriptor
}
```

Do not let the module contract imply that every rule is prompt-enforceable.

Each of the three failure classes `FC-2.1`–`FC-2.3` is claimed by exactly one
enabled module, and each enabled module claims exactly one class; the
prompt-conformance suite asserts both directions. Failure class `FC-2.4` and its
module were withdrawn in `0.7.0` (§23.2).

## 7. Module Specifications

> **Note.** The current package ships three module specifications, §7.1–§7.3.
> Section 7.4 (`user-attention`) was withdrawn in `0.7.0`; the withdrawal record
> is §23.2.

### 7.1 `project-governance`

**Problem:** the agent advances without a sufficiently stable project model.

**Objective:** maintain semantic alignment across the task lifetime.

**Prompt duties:**

- establish project intent before major execution;
- distinguish explicit user requirements from assumptions and unknowns;
- preserve important terminology;
- re-check scope when project direction changes;
- avoid silently redefining the task.

**State duties:** maintain current project orientation.

**Enforcement:** pre-step warning/block only when the absence of orientation makes safe execution impossible.

**Boundary:** DSH plan mode remains the host's planning mechanism. IEG governs project orientation and continuity, not a replacement plan workflow.

### 7.2 `workspace-governance`

**Problem:** unauthorized persistent workspace mutation.

**Objective:** make workspace structure an explicitly governed part of project state.

**Prompt duties:** distinguish inspection from persistent mutation; avoid creating artifacts merely because they seem convenient.

**State duties:** track authorization decisions and observed persistent mutations.

**Enforcement:** integrate with DSH authorization, approval, filesystem/tool hooks where available.

**Boundary:** do not reimplement filesystem permission semantics.

### 7.3 `information-integrity`

**Problem:** known-invalid information remains reusable.

**Objective:** prevent invalid information from being treated as authoritative.

**Information lifecycle:**

```text
DISCOVERED
    ↓
VALIDATED
    ↓
AUTHORITATIVE

or

AUTHORITATIVE
    ↓
SUSPECT
    ↓
INVALID / DEPRECATED / SUPERSEDED
    ↓
CORRECTED / REPLACED / QUARANTINED / REMOVED
```

**Prompt duties:** when invalidity is known, do not merely note it; update its status and stop treating it as authoritative.

**State duties:** preserve validity status and provenance.

**Enforcement:** reject or warn on operations that explicitly attempt to promote invalid state back to authoritative state without evidence or user confirmation.

## 8. Runtime Interaction Model

### Request path

```text
User request
   ↓
DSH prepares next step
   ↓
IEG observes / evaluates pre-step
   │
   ├── safe → admit
   ├── state update only → admit with updated governance context
   ├── deterministic policy violation → reject or require remediation
   └── unresolved uncertainty → admit when proceeding is safe (P6)
   ↓
DSH assembles model input
   ↓
IEG additive governance section participates in system prompt
   ↓
Model execution
```

There is no user-question path and no batch gate: the `user-attention` capability
was withdrawn in `0.7.0` (§23.2), so `agent/pre-step` returns no question-batch
decision.

## 9. Prompt Compatibility Strategy

The active host system prompt is a moving implementation surface. IEG therefore requires a compatibility adapter.

The adapter should capture at minimum:

```text
host version
available prompt section names
resolved section orders
active IEG placement
relevant first-party prompt fragments or hashes
available runtime seams
feature flags
```

The adapter must produce a compatibility result:

```text
COMPATIBLE
COMPATIBLE_WITH_WARNINGS
UNSUPPORTED
```

### Placement strategy

IEG should request its own host-allocated or safely reserved section placement if DSH exposes one. If no semantic placement exists, the implementation should use a single stable order chosen after inspection and regression testing for the target host version.

The plugin must not claim that its section is inherently higher priority than user messages merely because it is a plugin section.

## 10. Conflict Rules

When IEG overlaps with host instructions:

```text
host instruction defines capability/semantics
        ↓
IEG supplements behavior around that capability
```

Examples:

```text
Host: plan mode explains planning behavior
IEG: preserve project intent and terminology while planning

Host: permission system controls approval
IEG: classify which project mutations should require approval

Host: filesystem/sandbox policy owns containment
IEG: classify the document effect and refuse a near-duplicate artifact
```

If a module would need to contradict a host semantic to achieve its objective, the module must be changed or disabled; it must not silently override the host.

## 11. Prompt Budget

The IEG prompt should be short, stable, and high-signal.

Rules:

- avoid repeating DSH tool instructions;
- avoid copying host identity/persona text;
- avoid repeating plan-mode documentation;
- avoid embedding complete project state;
- avoid restating every enforcement implementation detail;
- prefer compact invariants and trigger conditions.

Detailed state belongs in runtime structures, and deterministic checks belong in hooks.

> **Recorded footprint (`0.8.0`; unchanged from `0.7.0`).** The folded
> three-module section measures **2,922 bytes**; the derived ceiling is
> **3,215 bytes** (floor 1,400, hard cap 4,096). The rule that derives and
> enforces that budget is §27; current status and numbers are maintained once in
> [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3.

## 12. Diagnostics

Diagnostics should expose at least:

```text
module_enabled
module_conflict
host_compatibility
prompt_assembly
orientation_recorded
orientation_restored
orientation_required
workspace_mutation_allowed
workspace_mutation_blocked
document_overlap_flagged
information_invalidated
information_reintroduced
```

Diagnostics must make it possible to investigate failures without relying only on model-generated prose.

## 13. Security and Safety Boundaries

IEG governs the **Information Environment** — project constraints, information
state, and the persistent workspace — and nothing wider. It is not a replacement
for DSH authorization, sandbox, permission, credential, or safety controls.

**Explicitly out of scope** (and, where the host owns it, delegated to the host):

```text
general AI safety / security        host safety controls
sandboxing                          ctx.sandboxPolicy + dsh-fs-sandbox
authorization / approval            ctx.approval + tools/pre-execute
user-attention optimization         withdrawn in 0.7.0 (§23.2); solved at prompt level
unrelated agent behavior management outside the Information Environment
```

Accepted limits:

- A governance rule becomes a hard block only when the host offers an appropriate
  deterministic mechanism and the plugin can establish the necessary authority
  context. IEG never fabricates authorization; `ask` delegates to `ctx.approval`
  and inherits its fail-closed path.
- Mutation coverage is **tool-mediated** only: a plugin calling
  `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses
  `tools/*`, and IEG does not claim process-wide write coverage (A4).
- Any change to the persisted **information or project constraints** is IEG's
  concern; containment, credentials, and safety classification are not.

For uncertain authority, prefer a safe refusal to mutate over pretending the user has authorized the operation.

## 14. Versioning

IEG versioning should distinguish:

```text
IEG semantic version
host DSH compatibility range
module versions
prompt versions
state-schema versions
```

The shipped `0.8.0` artifact versions are:

```text
artifact                      field                    0.8.0 value
──────────────────────────────────────────────────────────────────────
package                       package.json `version`   0.8.0 (`private: true`)
compiled prompt               PROMPT_VERSION           0.3.0
governance state              DOMAIN_VERSION           1
module semantics              `module.version`         0.2.0 in the three shipped
                                                        descriptors, matching the
                                                        §24 module contracts
host compatibility range      dsh.engines.dsh          >=0.2.1-alpha.1 <0.3.0
```

Any host release that changes relevant prompt sections, hooks, or tool/approval seams should trigger compatibility review.

## 15. Implementation Sequence

```text
Phase 0 — host reconnaissance
    ↓
Phase 1 — kernel + prompt aggregation
    ↓
Phase 2 — project-governance + information-integrity
    ↓
Phase 3 — workspace-governance enforcement (orientation gate + overlap gate)
    ↓
Phase 4 — regression/evaluation harness
```

The `0.7.0` scope reset withdrew the former Phase 3 (`user-attention` batching) and renumbered the remaining work; the current phase plan is §33.

## 16. Reference Basis

- DSH system prompt source: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts
- DSH system prompt subsystem: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- DSH workspace instruction package: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
- DSH plan mode: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md
- DSH base bundle package composition: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/package.json

The DSH user-question subsystem link was dropped in `0.7.0`: IEG no longer binds that seam (§17.5), so the reference is no longer part of this design's basis.

## 17. Verified Host Integration

> **Status of this section.** It records host facts read from the installed distribution rather than from the planning assumptions in §§1–15. Where it contradicts an earlier section, **this section governs**. Every seam below is traceable to a type declaration or implementation site in the installed packages; nothing here is inferred from prose documentation alone. The reconnaissance task of `IMPLEMENTATION-VALIDATION-HANDOFF.md` §2 is hereby satisfied.

### 17.1 Verification basis

```text
distribution   @deepseek-ai/dsh              0.2.1-alpha.1
install root   <dsh>/node_modules/@deepseek-ai/
method         direct inspection of lib/types/*.d.ts and lib/*.js
```

The declared baseline `dsh-v0.2.1-alpha.1` **matches** the installed host, and every URL in §16 resolves. The earlier `0.2.0-rc.2` verification is **SUPERSEDED**: the committed baseline was re-captured against `0.2.1-alpha.1` in `0.8.0`, and the ordered section names, the host prompt hash (`ceb63ee5`) and the required capability set are identical, so the seam facts below are unchanged. One citation-style correction is required: §16 cites monorepo source paths, but a runtime plugin imports **published package names**. `packages/core/system-prompt/src/index.ts` is published as `@deepseek-ai/dsh-system-prompt`; `packages/interaction/user-questions` as `@deepseek-ai/dsh-user-questions`. Plugin code must import package names and never repository paths.

A second correction: the host ships **no public plugin-authoring façade** for the seams IEG needs. IEG is an ordinary Cordis plugin that subscribes to first-party events and registers first-party services.

### 17.2 System-prompt seam

The registry service is `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`). The contribution type is:

```ts
interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: AssembleContext) => string)
  readonly interpolate?: boolean
  readonly complete?: boolean
}
```

Verified consequences for §4 and §5.2 (the Prompt Compiler):

| Concern | Verified behaviour |
|---|---|
| Registration | `ctx.systemPrompt.section(section)` registers into **the calling context's scope**; a scoped section shadows a global section with the same name; duplicate names within one layer throw. |
| Placement | `ctx.systemPrompt.getSectionOrder(name)` resolves only the enumerated `PromptSectionOrderName` values. **There is no plugin-allocatable placement.** IEG must pass an explicit finite numeric `order`. Non-finite orders throw. |
| `complete: true` | Exists and matches §4's prohibition: assembly restores a single effective complete section as the *sole* prompt section, and **more than one effective complete section makes assembly fail**. IEG must never set it. |
| Dynamic text | `text` may be a provider evaluated per assembly with `AssembleContext`, which is merge-extended by `@deepseek-ai/dsh-agent` to carry **`agent?: Agent`** and `scope?: ScopeKey`. IEG's governance section can therefore vary per agent — this is the correct seam for P3 (stable policy, dynamic state). |
| Rotation hazard | `renderPrompt` interpolates strict `{{variable}}` references and **throws** on malformed, unknown, or undefined ones. A lone `{{` without a later `}}` is literal. IEG prompt text must either escape brace pairs or set `interpolate: false`. Variable names must match `[a-z][a-z0-9_]*`. |
| Assembly waterfall | `system-prompt/assemble` is a scope-filtered expert waterfall over the assembled sections, contexts, tools, and variables. It is the correct place for IEG's **compatibility adapter** to observe real section names, resolved orders, and assembled-prompt hashes for §9 — a listener cannot replace a registered complete section. |
| Runtime context | `ctx.systemPrompt.context({name, order, text})` registers dynamic model-visible context materialized as a durable user-role snapshot; `suppressRuntimeContext()` suppresses all of it for a scope. |

The §2 order table is confirmed and can be extended with the full enumerated sets: `CONTEXT_ORDERS` = `SANDBOX_POLICY 110`, `APPROVAL_POLICY 115`, `SUBAGENT_DELEGATION 120`.

### 17.3 Per-step and per-tool enforcement seams

These are the deterministic seams P7 and §6 require. All are Cordis **waterfall** events; a listener that returns without calling `next()` short-circuits the rest of the chain **and** the built-in behaviour, so a waterfall listener can veto.

| Seam | Mode / scope | Contract |
|---|---|---|
| `agent/pre-step` | waterfall, `Scoped<Agent>` | `(payload: {agent, messages, turn, step, signal}, next) => Promise<PreStepDecision>`; `PreStepDecision = {kind:'reject'} \| {kind:'enter', messages, startsRequestSeries?}`. Returning `reject` ends the turn with the durable reason **`blocked`**. |
| `tools/pre-execute` | waterfall, `Scoped<ToolRuntime>` | `(exec: ToolExecution, next) => Promise<PreToolDecision>`; `PreToolDecision = allow \| deny{reason, info?} \| cancel \| ask{reason?, displayReason?}`. Missing approval support turns `ask` into denial. |
| `ctx.tools.guard(fn)` | monotonic, sync | `ToolGuard = (exec) => string \| undefined`; evaluated **after** every `tools/pre-execute` listener. Deny-only: no guard can force-allow a call another guard denied. This is the literal host expression of §13's "prefer a safe refusal to mutate". |
| `tools/post-execute` | waterfall, `Scoped<ToolRuntime>` | `PostToolDecision = accept{content?\|value?, additionalContexts?} \| block{feedback, additionalContexts?}` — converts corrective feedback into an error result. |
| `tools/result` | emit, `Scoped<ToolRuntime>` | Deep-frozen observation of a settled call; the reliable audit tap for §12. |
| `ctx.tools.restrict(filter)` | per-scope | `ToolRestriction = {allow?, deny?}` filters **visibility**, not authorization. |

Three verified constraints change the design:

1. **`ToolExecution` carries no input-rewriting capability.** Its fields are `callId`, `rootCallId`, `name`, `schema?`, `arguments`, `agent?`, `parent?`, `signal`, `token`, and the host documents that input rewriting is excluded because arguments are already logged and presented. IEG can **allow, deny, cancel, ask, or annotate** a call — it cannot silently repair its arguments.
2. **System-prompt and runtime-context assembly happen *before* `agent/pre-step`.** §8's request path must therefore be read as: prompt contribution is a *registration-time* concern, and pre-step is an *admission* concern. IEG cannot inject governance prose into the current step through `agent/pre-step`; it returns `messages` instead.
3. **`ctx.approval` is the permission model; `ctx.authorization` is not.** `ctx.authorization` is a *credential-obtaining flow registry* whose verdict vocabulary is `'authorized' | 'cancelled'` about credential records. Policy decisions flow through `ctx.approval` (`ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`, where `'allowed-once'` is the only grant) and `approval/request` is a scope-filtered waterfall. Returning `PreToolDecision.ask` makes the tool registry resolve the human prompt through `ctx.approval` on IEG's behalf, preserving fail-closed behaviour, audit pairing, and session policy.

### 17.4 Workspace-mutation seams

§7.2's instruction to "integrate with DSH authorization, approval, filesystem/tool hooks where available" resolves to a two-layer arrangement:

```text
tools/pre-execute   → classify the call by (name, arguments); gate with deny/ask
ctx.tools.guard     → deny-only backstop that listener ordering cannot defeat
fs/write-intent     → observe the concrete target about to be written
fs/edit-intent      → observe the concrete target about to be edited
fs/observed         → learn which targets the session has actually observed
```

Verified properties, all of which constrain the module:

- The `fs/*` events carry **no deny vocabulary**. `FsWriteIntent = {kind:'createIfAbsent'} | {kind:'replaceIfVersion', version}`, and `fs/observed` carries `{kind:'present', version} | {kind:'absent'}`. A listener narrows intent or throws; it does not deny by vocabulary.
- The `fs/*` events are **dispatched unbound and are not scope-filtered**. IEG receives every session's events and must narrow itself via the actor's agent session.
- The intent slot is **first-wins by registration order**, and the shipped `dsh-fs-observation-policy` never calls `next()`. An IEG listener registered *after* it is unreachable. IEG must register ahead of it and must call `next()` to observe without stealing the slot.
- The intent events are dispatched by the **tools** (`dsh-tool-fs`, `dsh-tool-str-replace-editor`), not by the filesystem provider. A plugin calling `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses `tools/*` entirely.
- Containment is not IEG's concern. `ctx.sandboxPolicy.resolve({session})` returns the effective `{mode, workspaceRoot, sessionId}`; `dsh-fs-sandbox` re-canonicalizes and enforces writable roots. IEG must never compute containment itself.

Therefore §7.2's "Boundary: do not reimplement filesystem permission semantics" is strengthened: IEG's mutation governance is **tool-mediated mutation governance**. The direct-`ctx.fs` gap is recorded as assumption **A4** in §20.

### 17.5 User-question seam (verified, **not bound** as of `0.7.0`)

> **Status.** This subsection is reconnaissance, not a binding. `0.7.0` withdrew the `user-attention` capability (§23.2) and IEG registers nothing on this seam. The host facts remain true and are kept because Part A is the record of what was verified; the consequence column describes the design as it stood before the withdrawal, and setting it out as current would be false.

The service is `ctx.userQuestions` (`@deepseek-ai/dsh-user-questions`): `ask(request)` and `askTimed(request, callId, timeoutMs)`.

Verified facts that once narrowed the withdrawn `user-attention` module:

| Fact | Consequence (design of record; module withdrawn) |
|---|---|
| `questions: AskUserQuestionItem[]` is an array and each item carries a caller-supplied stable `id` echoed in the answer. | Batching is supported **within one `ask()` call** — PR-04 is achievable without inventing a transport. |
| There is **no** cross-request merging. The client renders **one pending request at a time**; later requests surface only after the earlier resolves. | Consolidation would have to happen **before** the call is made, not by merging pending requests. |
| `answer()` rejects a batch that does not name **each of that call's questions exactly once** (`BAD_ANSWER`). | IEG cannot partially answer or re-batch an already-open request. |
| No API exists for continuous deferral, deduplication, dependency/unlock, or abandoning a question. Timed questions (`askTimed`, `mode: 'timed'`) are the only host mechanism that releases the agent while a question stays answerable. | A "collect → deduplicate → dependency-sort → compress → ask once" flow would have been **IEG-owned state**, and `askTimed` the primitive for deferred uncertainty. |
| Asking requires the exact live **runtime root** agent; a child raises `DELEGATED_CALLER`. | The capability was root-agent-only; delegated questioning was always outside IEG's scope. |
| `user-questions/request` is an agent-scoped waterfall; an answerer returns an answer or delegates. | This is the observation/interception point a question module would have used — not a merging point. |
| `AskUserQuestionItem` vocabulary is selectable options plus optional free text (`custom`), with `multiSelect`; skipped items are preserved as `{id, selected: []}`. | Richer interaction shapes have no seam vocabulary and were out of scope. |

### 17.6 Durable state seams

§5.3's "Project State Store" does **not** exist as a host concept and must not be built as a bespoke store. DSH provides two sanctioned durable mechanisms with different visibility and lifetimes.

**Session-projection state** — derived from the append-only session log, rebuilt on resume and fork:

```ts
ctx.sessionProjections.register({ key, stateSchema, stateVersion, init, apply, wire? })
ctx.sessionProjections.stateOf(session, key)
```

A plugin declares its own event by merge-extending `SessionEventMap` and appends it with `session.append(type, data)`. The whole-value rule is load-bearing: a state-carrying event carries the **complete post-change state**, never a delta. Changing fold semantics requires a `stateVersion` bump so persisted caches refold. The in-repo templates are `dsh-plan-mode` (a `plan` projection gating a `plan:policy` section) and `dsh-tool-todo` (a `todos` projection written via `exec.agent.session.append('todo/write', …)`), and both are the patterns §5.3 and §7.1 should follow.

**Host-side domain state** — authoritative, durable, and invisible to the model:

```ts
const domain = await ctx.storageDomain.open({ name, version, compatibleVersions?, tables, global? })
domain.table(key).get / put / delete / update
```

`ctx.storageDomain` reads synchronously from memory; writes await backend durability before mutating memory and then emit `domain/changed`. Records are borrowed, not copied. A stored version mismatch rejects at open and there is **no migration facility**, so `version` and `compatibleVersions` must be planned up front.

Compaction does not delete anything: it appends a replacement `user/message` carrying a `surfaceOp` that shadows a range of surface nodes. Non-surface (log-only) events are never shadowed. There is **no pin/preserve seam**, so IEG must treat compaction as a derived-history event only.

Selection rule for IEG: **authoritative governance state belongs in `ctx.storageDomain`**; **model-visible or derivable per-session state belongs in a log-only event folded by a registered projection**. The decisive reason is that a plugin event cannot be marked `ignorable` — the envelope is built by `Session.append()` from `type`, `seq`, `time`, `data`, and surface metadata only, and no code path in the installed distribution writes the marker. An IEG event type is therefore *required*, so a log written with IEG loaded cannot be reconstructed by a composition without IEG. This makes log-based IEG state composition-coupled by construction; see assumption A3 and §20.2 item 1.

### 17.7 Scope and per-agent isolation

`ScopeKey = object` is an opaque, identity-compared token; `Scoped<T>` is a routing-only receiver; `scopeOf(ctx)`, `createScope`, `scopeTarget`, and `scopeChainOf` are the tools. Registration views inherit **down** the chain while event admission extends **up** it.

Two facts decide §5.3's state design:

1. **Per-agent scope key is the agent object itself**, and `AssembleContext` already carries `agent` and `scope`.
2. **Only scope-aware APIs isolate state.** A plain `Map` inside a plugin is process-global merely because it is reached through a scoped context. Per-agent state requires `ScopedLayers` filed by `scopeOf(ctx)`, with registrations made through the agent-scoped context.

The host's own precedent is `SystemPrompt`, whose section/context/variable layers are a `ScopedLayers` instance; IEG's kernel should mirror that shape for project state rather than inventing a keyed cache.

### 17.8 Diagnostics, invariants, and version compatibility

| Need | Verified seam |
|---|---|
| Structured diagnostics (§12) | Cordis events plus a plugin-owned session event folded by a projection; §12's event names are IEG's own vocabulary and are not reserved by the host. |
| Self-check | `ctx.invariants.register(packageName, installer)` from a `./invariant` companion (`name` / `inject` / `apply`). Invariants are **observer-only and cannot veto**; a violation throws an `InvariantError` attributed to the owning package. `dsh-base` does **not** mount the registry, so a companion runs only in compositions that opt in. |
| `dsh-hook-protocol` | A **library**, not a plugin lifecycle seam: it defines the Claude Code / Codex hook wire protocol and its bridges are ordinary plugins that listen on `tools/pre-execute`. IEG must use native Cordis events directly. |
| Version compatibility (§14, PR-06) | An npm plugin declares its DSH peer range; installation **and** profile startup enforce it, refusing with `incompatible-version` and the unsatisfied peers. Exemptions live in the profile's own `compatibility.json` (`package-name@version` → exact DSH runtime versions) and are granted through the `plugin_manager` tool or `dsh plugin … allow-version`. |
| Packaging | IEG ships as an npm package with a bundle patch (`dsh.bundle.patch` → `cordis.patch.yml`) selected from the profile's `dsh.profile.bundles`. Patch rows are addressed by `id` with last-write-wins per row. |

### 17.9 Seam responsibility matrix

```text
IEG need                     host seam                        enforcement
─────────────────────────────────────────────────────────────────────────────
governance prose             systemPrompt.section             advisory
per-agent governance prose   section text provider (agent)    advisory
compatibility observation    system-prompt/assemble           observe only
step admission               agent/pre-step                   veto (reject)
mutation classification      tools/pre-execute                gate (deny/ask)
mutation backstop            tools.guard                      deny only
mutation correction          tools/post-execute               block
mutation audit               tools/result, fs/observed        observe only
concrete write target        fs/write-intent, fs/edit-intent  observe/narrow
human approval               ctx.approval via ask             gate
question consolidation       ctx.userQuestions.ask            withdrawn 0.7.0 (§23.2)
deferred uncertainty         ctx.userQuestions.askTimed       withdrawn 0.7.0 (§23.2)
per-session governance state sessionProjections + own event   durable
authoritative state          storageDomain                    durable
self-check                   invariants companion             observe only
```

### 17.10 Confirmed empirically while building the prototype

The claims below were not read from a declaration file; they were observed by
installing a working plugin into a real profile and booting it. They are the
strongest evidence in this document, and two of them change the design.

1. **Section contracts behave exactly as documented.** Registering two effective
   `complete: true` sections makes `assemble()` reject. IEG's own section at
   order `8500` lands between `deployment:persona-prefix` and
   `deployment:persona-suffix`, and the host's `harness:identity` section
   survives alongside it.
2. **`ctx.tools.guard()` denies, and `ask` fails closed.** A guard denial
   surfaces to the model as an error result; a `tools/pre-execute` decision of
   `{ kind: 'ask' }` becomes a denial when no approval channel is mounted.
3. **Installation is fully declarative.** `dsh plugin --profile <name> add
   file:<dir>` adds the package to the profile's `dependencies` *and* to
   `dsh.profile.bundles`; the package's `dsh.bundle.patch` is applied
   automatically; the declared `dsh.engines.dsh` range is accepted.
4. **`dsh --patch <file>` is the supported way to override one row's config.**
   Overlays apply after the profile layer, which makes row-level policy testable
   without editing the plugin or the profile.

Two observed host behaviours materially affect IEG:

5. **A failing plugin entry is non-fatal.** When a plugin throws during
   composition, DSH reports `warning: N entry did not activate`, prints the
   attributed error, and **continues booting**. A governance layer that fails to
   mount therefore degrades silently rather than stopping the session. IEG must
   be observable from outside its own process (see D10), not assume that a mount
   failure aborts the run.

6. **No shipped composition exports Cordis logs.** `ctx.logger` buffers
   messages (`logger.buffer`) but the stock profiles mount **no exporter**, and
   no DSH package mounts the Cordis `Logger` plugin. `ctx.logger.info(...)` is
   therefore invisible by default. IEG's §12 diagnostics — currently emitted
   through `ctx.logger` — are only visible where a deployment mounts an exporter
   (see D9).

Also relevant to the §9 compatibility adapter: the DeepSeek provider adapter
POSTs to `${baseURL}/messages` (a Messages-style endpoint), not
`/chat/completions`. Any prompt-level regression harness must speak that
protocol.

## 18. Deltas Against This Specification and the Product Specification

Changes required in the earlier sections, attributable to the §17 verification.

| # | Location | Delta |
|---|---|---|
| D1 | §5.3, §5.1 "shared project-state services" | Replace the bespoke "Project State Store" with a `ScopedLayers`-filed **session projection** for derived per-session state plus a `ctx.storageDomain` domain for authoritative state. Do not invent a third store. |
| D2 | §9 "Placement strategy" | DSH exposes **no** plugin-allocatable section placement. Remove the conditional "if DSH exposes one" and commit to one explicit finite numeric `order`, chosen and regression-tested per §10. |
| D3 | §4, §5.2 Prompt Compiler | Add two hard rules: never set `complete: true`; either set `interpolate: false` or escape `{{ }}` in compiled governance text, because unknown references throw at assembly. |
| D4 | §7.2 Enforcement | Restate as **tool-mediated** mutation governance: `tools/pre-execute` classify + gate, `ctx.tools.guard` backstop, `fs/*` observe. Record the direct-`ctx.fs` gap (A4). |
| D5 | §7.4 Integration; PRODUCT-SPEC PR-04 | **Withdrawn in `0.7.0` — superseded by the withdrawal record in §23.2 and §30.** The design this delta described (IEG-owned question consolidation) was removed with the `user-attention` capability: testing found a stable prompt-level solution, so runtime governance of question batching is not justified. The verified host facts it recorded remain true: the `questions` array batches **within one call only**; there is no cross-request merge, deferral record, dedup, dependency, or abandonment API; `askTimed` is the only deferral primitive; consolidation was root-agent-only. |
| D6 | §11, §13 | §13's "prefer a safe refusal to mutate" is concretely implementable as a monotonic `ToolGuard`. State it as the preferred mechanism rather than an aspiration. |
| D7 | §2, §16 | Package-name imports, not repository paths. `ctx.authorization` is credential flows, not the permission model; the permission path is `ctx.approval` + `tools/pre-execute`. |
| D8 | §12 Diagnostics | `dsh-invariants` is observer-only and not mounted by `dsh-base`; diagnostics must not depend on it, and §12's event names are IEG vocabulary rather than host-reserved names. |
| D9 | §12 Diagnostics, §5.1 | `ctx.logger` is buffered but **not displayed** in stock compositions, because no shipped profile mounts a Cordis logger exporter. Diagnostics must not rely on logging alone. Emit them through a channel the deployment can actually observe — a plugin-owned durable record, a session event, or an explicit exporter — and treat the log as best-effort narration. |
| D10 | §13, §15, §10 | A plugin that throws during composition is reported as `warning: N entry did not activate` and the session continues. Acceptance gates must therefore assert **positive** evidence that IEG mounted and enforced, not merely that the process started without a fatal error. |
| D11 | §7 module `principles` / `prompt`, §11 Prompt Budget | The §11 content rules must be **enforced by an executable conformance test**, not left to intent. Auditing the compiled prompt found three defects that structural tests could not catch: (a) one kernel principle (P7) was addressed to the plugin author rather than to the agent, i.e. implementation leakage; (b) **every** module's prose fragment restated its own principles, so §5.2's dedupe requirement was unmet and the fragment added only prompt cost; and (c) the `workspace-governance` fragment instructed the model to perform the check that `tools/pre-execute` and `ctx.tools.guard` already enforce, while additionally implying that "an existing project convention" authorizes a write — a channel the gate does not honour, so prompt and enforcement disagreed about what counted as authorization. Fragments must add guidance the principles do not, and must never restate an enforced rule. |
| D12 | §5.3, §7.1, §7.2, §8 | The two acceptance objectives the plugin is judged on — unprompted orientation (OBJ-1) and workspace-hygiene management (OBJ-2) — are not reachable by prompt text alone, and the design's existing mechanisms did not cover them. Three additions are required: (a) **an orientation-capture tool plus a gate**, because §5.3 defined project state with no way to populate it, making `orientationGate: 'reject'` permanently unsatisfiable; (b) **a document-overlap gate**, because "check for overlap before creating a file" is mechanically checkable and P7 prefers that over prose; and (c) **a subject-level overlap signal**, added after the behavioural evaluation showed a body-similarity check failing on the real failure mode. Two control runs each created an `AUTHENTICATION.md` that re-stated a topic `SPEC.md` already had a section for, while scoring only ~0.14 body similarity against it — under any Jaccard threshold the duplicate would have passed. Comparing the proposed **filename subject** against the existing document's headings catches it (both observed duplicates now flagged), and is what makes the gate worth having rather than decorative. |
| D13 | §7.2 Enforcement, §13 | **Shell tools must not be classified as IEG mutations.** Listing `bash`/`pwsh`/`*_persistent` in `mutatingTools` gates *every* shell command, because the gate sees only an opaque command string — so `ls`, `grep`, and `node --test` all become "persistent workspace mutation". Under `policy: 'ask'` in a composition with no approval channel (headless, CI) that denies the agent its entire shell. It also duplicates host semantics, since `dsh-bash-sandbox` plus the sandbox policy already confines shell writes, which P1 forbids. IEG governs **file-effect** tools, where `(name, arguments)` is unambiguous. This defect was only visible once the plugin was mounted in front of a real agent; it could not have surfaced in the prompt-only trials. **Amended 2026-10-02 — see the D13 amendment note below this table.** |
| D14 | §7.3, §7.2 | **Deletion is the required disposition, and IEG must not make it harder than creation.** The acceptance requirement is literal: information established as *wrong* must always be deleted rather than annotated as wrong (an annotation still leaves it pickable), and *outdated* content must also be deleted — except in an IT-development workspace, where version history matters and it must instead be marked explicitly as outdated. That contradicts an earlier IEG stance in which correcting or superseding in place was acceptable, and it compounds with D13: while shell tools were gated, `rm` required approval, so the plugin pushed *against* the objective it was meant to serve. The `information-integrity` prompt now states the distinction, and the narrowed shell classification (D13 amendment) is what lets removal proceed under the configured policy without gating every shell call. |
| D15 | §5.3, §7.1, §9 | **Gate E requires durable state, and it does not require a schema library.** Orientation was created inside `apply()`, so a resumed, forked, or restarted session began with no orientation and re-imposed the requirement on already-oriented work. Orientation is now persisted per session through `ctx.storageDomain`, and it is the only thing persisted (§25.4). The expected obstacle — `domainTable` taking a `ZodType`, forcing the plugin's first external import — does not exist: `domainTable` is a one-line wrapper and the host reads a record through exactly one call, `tableSpec.valueSchema.parse(raw)`. Supplying a small object with a real `parse` satisfies the contract, so the package keeps the property that **every import is relative**. Two constraints carry forward: domains have no migration facility, so `DOMAIN_VERSION` may only change with a deliberate migration decision; and persistence must fail open, because governance enforcement must never depend on storage being available. |

### D13 amendment (2026-10-02) — shell writes are classified from command text

The D13 exclusion removes the *tool-list* channel only, and that left a coverage
hole: a document can be created by redirection, or removed with `rm`, without any
file-effect tool call, so the overlap gate never sees it.
`workspace.classifyShellCommands` therefore inspects the command text of
`bash` / `pwsh` / `*_persistent` and treats as a mutation only a command that can
write.

D13's precision requirement is preserved rather than waived. Quoted text is data
unless the command is a shell wrapper (`bash -c …`), and a `>` counts as a
redirection only when it is a standalone operator rather than an arrow or a
comparison. So `rg '=>' src`, `grep -rn 'a > b' src`, and
`git commit -m 'rm stale files'` stay read-only, while `bash -c 'rm -rf build'`
and `echo x > f` do not. Both directions, plus the two residual limits — an
indirectly invoked wrapper (`env bash -c '…'`) and PowerShell `Remove-Item` — are
measured by `test/unit/shell-classification.test.js` and counted in the §32.4
matrix.

Documentation-level correction, confirmed with the author: the README's "GLM Markdown" is a typo for **GitHub Flavored Markdown (GFM)**. These documents use conservative GFM with YAML front matter, and should continue to.

## 19. Resolved Items

One item the handoff carried forward as open is now resolved.

### 19.1 Prompt priority is a mechanism question, not an authority question

The handoff's §3 hypothesis — that plugin built-in prompts have intrinsically higher execution priority than user prompts — remains unsupported by the source. The verified picture is that plugin and user content occupy **different roles in different channels**: prose is advisory, while `agent/pre-step` and `tools/pre-execute` are genuinely authoritative waterfalls. Any evaluation should compare *channels* (prompt section vs. pre-step enforcement vs. tool guard) rather than claiming that one prose source outranks another.

## 20. Assumptions and Items Requiring Confirmation

### 20.1 Assumptions

- **A1 — Delivery form.** IEG ships as an out-of-tree npm plugin with a bundle patch, mounted through a profile's `dsh.profile.bundles` / `cordis.patch.yml`, and declares a DSH peer range. It is not a first-party package.
- **A2 — Section order.** IEG occupies one explicit numeric `order` with no host-allocated slot, selected after regression testing per §10 and recorded in the compatibility adapter.
- **A3 — State store.** Authoritative governance state goes to `ctx.storageDomain`. Per-session derived state may use a log-only event plus a registered projection, but **only** as composition-coupled state: because the `ignorable` marker has no plugin-facing write path (§20.2 item 1), an IEG event type is required, and a session recorded with IEG loaded cannot be reconstructed without IEG. Nothing whose loss or non-portability would change reconstructed semantics is stored in the log.
- **A4 — Mutation coverage.** Mutation governance covers **tool-mediated** mutations only. A plugin calling `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses `tools/*`; IEG does not claim process-wide write coverage.
- **A5 — Diagnostics availability.** An IEG invariant companion runs only where the composition mounts `dsh-invariants`, and `ctx.logger` output is only visible where the composition mounts a Cordis logger exporter; `dsh-base` does neither. Enforcement must not depend on either, and §12 diagnostics need an observable channel (D9).
- **A6 — Root-only questioning. Withdrawn in `0.7.0`.** This assumption belonged to the `user-attention` capability: question consolidation was available only to live runtime root agents, and delegated questioning was therefore outside IEG's scope. The capability was withdrawn (§23.2); the entry is kept as history, and delegated questioning remains an accepted boundary.
- **A7 — Fixed baseline.** All §17 facts are scoped to `@deepseek-ai/dsh` `0.2.1-alpha.1` (re-captured in `0.8.0`; the earlier `0.2.0-rc.2` scope is **SUPERSEDED**). The compatibility adapter must re-verify them on any host change per §14.

### 20.2 Items requiring confirmation or host clarification

1. **The `ignorable` marker has no plugin-facing write path (highest priority, now verified).** The persisted event envelope carries `ignorable?: true`, which lets a reader skip an unrecognized event type; **absent means required**, and a reader meeting an unrecognized required type must refuse to reconstruct the session. `Session.append(type, data, …)` constructs the envelope as `{type, seq, time, data, …surfaceMetadata}`, where the surface metadata is limited to `sourceEventSeqs` and `surfaceOp`. Its declared `opts` rest parameter accepts a `SurfaceIntent` only for surface events, so a non-surface plugin event cannot carry the marker. An exhaustive search of the installed distribution finds **no code path that writes `ignorable`** — every occurrence is a validator, format migration, or client schema that reads it.

   **Consequence.** A log-only event type authored by IEG is required by construction. A session recorded with IEG loaded can therefore not be reconstructed by a composition without IEG: the read path must refuse it. The host's own note that "downstream (out-of-repo) plugin events are outside this list by construction" makes the marker the intended mechanism, but the public append path does not expose it. Until the host provides a write path or an explicit exemption, **IEG must not treat its own session events as an authoritative, portable store**. This is the decisive argument for directing authoritative governance state to `ctx.storageDomain`, which is model-invisible, compaction-immune, and not coupled to session reconstructability.
2. **Section order value.** Confirm the chosen numeric `order` and the regression test that fixes it.
3. **Approval authorship.** Confirm that IEG gates mutations by returning `PreToolDecision.ask` and never registers its own `approval/request` answerer, since a deployment composes one terminal answerer and sibling listener order is not a policy-priority mechanism.
4. **Optional integration with `dsh-agent-instructions`.** DSH already loads the `AGENTS.md` / `CLAUDE.md` chain, enforces a byte budget, and emits removal notices for changed or deleted instruction files. Confirm that IEG references this as the workspace-instruction authority rather than restating it in its own prompt section.

## 21. Prototype Realization

A working prototype of this specification lives at the repository root (see
[`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md)) as the package
`dsh-information-environment-governance`, now `0.8.0`. It exists to make the §17
seam bindings falsifiable rather than merely asserted.

> **v0.2.0 addendum (HISTORICAL — the package has since moved to `0.8.0`; the
> contract recorded here is unchanged).** At that revision the plugin was
> `version: 0.2.0` (still `"private": true`).
> Per-agent state, the diagnostics channels, the compatibility adapter, the
> read-only status surface, the packaging artifacts, and the simulated
> gate-precision matrix landed after this table was written, so the table below
> records the `0.1.0` state. The `user-attention` capability — the question
> surface this table names — was **withdrawn in `0.7.0`** (§23.2), leaving three
> modules. Current status and numbers are in
> [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4; §33 is the phase plan.

| Aspect | Status |
|---|---|
| Kernel, module contract, dependency resolution, conflict detection (§5.1, §6) | implemented |
| Prompt compiler, dedup, budget, interpolation safety (§5.2, §11) | implemented |
| All four modules' logic of the `0.1.0`/`0.2.0` set (§7) | implemented (the `user-attention` module was withdrawn in `0.7.0` — §23.2) |
| One additive prompt section (§4) | implemented; verified against the real `dsh-system-prompt` |
| `tools/pre-execute` gate + `ctx.tools.guard` backstop (§7.2) | implemented; verified against the real `dsh-tools` |
| `agent/pre-step` gate (§7.1) | wired and unit tested; live dispatch not exercised |
| Runtime question consolidation (§7.4) | historical only: collector was implemented and unit tested, never wired in front of `ctx.userQuestions`, and the capability was withdrawn in `0.7.0` |
| Per-agent state (§17.7) | not implemented in the `0.1.0` prototype; orientation was per-composition |
| Prompt-content conformance (D11) | implemented as an executable suite covering failure-class coverage, §5.2 dedupe, the prompt content DO/DON'T rules (§27), and the §11 budget ceiling |
| Packaging, bundle patch, install, composition, mount | verified end to end against the current `@deepseek-ai/dsh` `0.2.1-alpha.1` baseline (and, historically, `0.2.0-rc.2`) |

The prototype has **zero runtime dependencies**, imports no first-party package,
and declares the slice of the host runtime it uses in a single ambient contract
file, so the seams it depends on are auditable in one place. It also carries a
deliberate constraint that follows from this specification: it never sets
`complete` on its section.

Reproduce the whole evidence chain with `scripts/verify.sh`, and the
behavioural suite with `npm test`, from the repository root.

---

# Part B — Target Design (baseline IEG v0.2.0)

> **Status.** Part B began as the v0.2.0 design and now also carries the later
> rounds: the v0.3.0/v0.4.0 front-end work (editable prompt §27.1, diagnostics
> mirror §28.7), which the v0.6.0 control-plane round (§28.6) re-homed onto the
> `dsh-ieg` terminal interface, and the `0.7.0` **scope reset and re-baseline**
> (Batch 1), which withdrew the `user-attention` capability (§23.2), reduced the
> module set to three, and renamed the project, package, CLI, section, tools and
> storage domain to the IEG identifiers; and the `0.8.0` **DSH migration and
> packaging round** (repository root becomes the package, baseline
> `0.2.1-alpha.1`, runtime finished migrating to TypeScript). It is grounded in
> Part A's verified seams and does not retroactively rewrite Part A: Part A's
> host facts are scoped to `@deepseek-ai/dsh` `0.2.1-alpha.1` (the re-captured
> baseline; the earlier `0.2.0-rc.2` scope is **SUPERSEDED**), while the shipped
> package is `0.8.0`. Current
> implementation status and numbers are maintained once, in
> [`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4; the phase plan is §33
> and the acceptance gates are §32.

## 22. Target Design v0.2.0 — Scope, Versioning, and Governing Decisions

### 22.1 Purpose

IEG v0.2.0 is the first release intended to be **operable and reviewable**
rather than merely **demonstrably mounted**. Part A proved the seams and the
prototype proved that one mechanism changes agent behaviour. Part B makes the
layer diagnosable, host-aware, per-agent correct, and releasable.

The §1 invariant is carried unchanged: host semantics remain authoritative,
IEG contributes exactly one additive section, and `complete` is never set.

### 22.2 Scope — release blockers

| # | `MAINTENANCE-HANDOFF.md` §4 blocker | 0.7.0 disposition | Section |
|---|---|---|---|
| 1 | Diagnostics are invisible | closed — four-channel diagnosability | §28 |
| 2 | No compatibility adapter (PR-06) | closed — observation-based adapter | §29 |
| 3 | False positives unmeasured | closed in simulation — gate-precision evaluation | §32.4 |
| 4 | Module 5 unverified; module 3 structurally blocked | module 5 **removed** (§23.1); the `user-attention` capability, its module-3 runtime wiring, and its measurement are **withdrawn in 0.7.0 — closed by withdrawal** (§23.2, §30) | §23, §30 |
| 5 | Evidence is narrow | widened — more reps, blind judging, second model | §32.5 |
| 6 | Not a publishable package | closed — packaging and release policy; publication withheld on Gates C and D | §31 |
| 7 | Intrusive defaults chosen unilaterally | **closed** — non-intrusive defaults implemented: `requireBeforeMutation` defaults to `false` in `lib/kernel/config.js` and `cordis.patch.yml`, and strict mode is an explicit opt-in (§34.2 Q1) | §34.2 |

`MAINTENANCE-HANDOFF.md` §8's ranked backlog is the input to this table; where
the backlog and this table differ, this table governs for the design baseline.
`MAINTENANCE-HANDOFF.md` §4 was re-based in `0.7.0` (its items are now numbered
by the current round's blockers), so this table deliberately keeps the
identifiers used when the v0.2.0 design was written.

### 22.3 Versioning model

```text
artifact                      version field                   bump rule
────────────────────────────────────────────────────────────────────────────────
plugin package                package.json `version`          semver; a prompt or state change forces at least minor
host compatibility range      `dsh.engines.dsh`               narrowing is breaking
verified host releases        `dsh.compatibility.dshReleases` additive, one entry per verified release
compiled prompt               `PROMPT_VERSION`                any change to injected model-facing text
governance state              `DOMAIN_VERSION`                any change to the stored record shape
module semantics              `module.version`                any change to a module contract
```

At the `0.8.0` packaging round the values are: package `0.8.0` (`private: true`),
`PROMPT_VERSION` `0.3.0` (unchanged — the compiled text is byte-identical),
`DOMAIN_VERSION` `1`, and the three shipped module descriptors `0.2.0`, matching
§24 (§34.2 Q9, closed). The earlier `0.7.0` values (package `0.7.0`, descriptors
`0.1.0`) are **HISTORICAL**.

Rules:

- `PROMPT_VERSION` is emitted in the mount record and in diagnostics, never in
  model-facing text, so a behavioural regression is attributable to one prompt
  revision (PRODUCT-SPEC PR-07).
- `DOMAIN_VERSION` may change only with a deliberate migration decision,
  because `storageDomain.open()` rejects a mismatch and the host offers no
  migration facility (§17.6).
- Every release records its `PROMPT_VERSION`, module versions, and
  `DOMAIN_VERSION` in `CHANGELOG.md`, each attributed to a problem or an
  evaluation result.

### 22.4 Governing decisions carried into v0.2.0

- One additive section, an explicit finite `order`, `interpolate: false`, and
  `complete` never set (§4, D2, D3).
- **Three modules, two governance entry points.** `0.7.0` withdrew the
  `user-attention` capability and failure class `FC-2.4` (§23.2), so the shipped
  set is `project-governance`, `information-integrity`, and
  `workspace-governance`, each claiming exactly one of `FC-2.1`–`FC-2.3`.
  Project Constraint Governance and Information / Document Governance are the
  entry points (§1); workspace hygiene is an enforcement mechanism inside the
  second.
- **Zero first-party imports.** `lib/contract.d.ts` remains the only
  record of host API shapes and grows to cover the new seams. The plugin stays
  immune to the profile's module-resolution layout.
- **Fail-open** for every optional capability: storage, filesystem, approval.
  Governance enforcement never depends on an optional service being present.
- **Deterministic enforcement over prompt text** (PRODUCT-SPEC P7). A rule that
  is mechanically checkable is enforced by a seam, and the prompt must not
  restate it (D11).
- **Diagnose before destructive remediation** (PRODUCT-SPEC P8). After the
  `child-agent-lifecycle` withdrawal in §23.1, the only destructive action IEG
  still governs is information deletion, and it is governed by the D14
  distinction, not by a blanket rule.
- **Shell tools stay out of `mutatingTools`, but shell writes are classified**
  from command text (D13 amendment, 2026-10-02). IEG governs file-effect tools as
  the unambiguous primary class, plus the conservative shell-write heuristic,
  whose quoted text is data unless the command wraps another command. Read-only
  shell work is never gated; the §32.4 matrix measures that.

### 22.5 Documentation integration — why Part B lives here

This design was assessed against the workspace's existing documents before it
was written, under the rule that a new file may not be created when its
functional positioning or primary content substantially overlaps an existing
document.

| Existing document | Functional positioning | Overlap with a standalone target-design file |
|---|---|---|
| `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` | architecture, module contracts, runtime integration, compatibility model; audience = implementing and reviewing agents | **substantial** — same positioning and the same primary content |
| `PRODUCT-SPEC.md` | product scope, goals, requirements, success criteria | partial — scope and module set |
| `IMPLEMENTATION-VALIDATION-HANDOFF.md` | build order, validation cases, acceptance gates | partial — implementation plan and gates |
| `MAINTENANCE-HANDOFF.md` | point-in-time status, blockers, backlog | input only |
| `docs/PACKAGE-REFERENCE.md`, `eval/README.md` | implementation and evaluation specifics | low |

Verdict: **substantial overlap** with the architecture specification.
Consequently the target design is merged here as Part B rather than created as
a new document, and the three partial overlaps are corrected in place
(`PRODUCT-SPEC.md` and `IMPLEMENTATION-VALIDATION-HANDOFF.md` amendments, and
supersession notes in `MAINTENANCE-HANDOFF.md`). One workspace artifact is
preserved, and no document restates another's primary content.

## 23. Withdrawn Scope

Two designed capabilities have been withdrawn. Neither is a failed feature: each was a deliberate scope decision, and each removal renumbered the identifiers around it so that no document carries a gap or a dangling reference.

### 23.1 Withdrawn — `child-agent-lifecycle` (v0.2.0 round)

IEG previously planned a fifth module, `child-agent-lifecycle`, addressing
failure class `FC-2.5` (residual child-agent state). It is **withdrawn** by
explicit user decision: the benefit did not justify the workload.

**Why.** Part A's reconnaissance had already established that a populated child
list is expected on a healthy system and that automatic reclamation was
unfounded. What remained was accounting for a symptom the host explains by
design, and the evaluation harness contains no delegation scenario, so the
module could never have acquired behavioural evidence.

**What changed.** The module, its `subagent/*` listeners, its ambient contract
types, its prompt fragment, its unit test, its composition toggle, and its
product-level clauses (`FC-2.5`, `G5`, `PR-06`, the lifecycle quality target and
quality row, and the old success criterion 4) were removed. Remaining identifiers
were renumbered, so no document carries a gap or a dangling reference. At that
revision the plugin shipped **four** modules and compiled a governance section of
3,459 bytes, down from 3,905.

**Accepted boundary.** Delegated questioning stays ungoverned: only a live
runtime root agent may call `ctx.userQuestions.ask` (a child raises
`DELEGATED_CALLER`), and IEG does not harvest a child's unresolved question
through the child's final result. Re-opening that boundary is a design decision,
not an implementation detail. (The `user-attention` module that once sat beside
it was itself withdrawn in `0.7.0` — §23.2.)

### 23.2 Withdrawn — `user-attention` / `FC-2.4` (`0.7.0`)

**Capability.** The `user-attention` module optimised task progress per user
interruption by consolidating deterministic blockers into one interaction, and
claimed failure class `FC-2.4` ("fragmented user questioning").

**Why it is withdrawn — classification: Out of Scope / Externally Solved.**
Testing found a stable prompt-level solution for the failure mode, so runtime
governance of question batching is **not justified**. This is a scope correction,
not a failed feature: the capability worked as designed, and the design is simply
no longer worth its runtime surface.

**Exactly what was deleted.**

```text
the `user-attention` module and failure class FC-2.4
the question ledger (questions[], deferred[], batches[])
the question tools `record_question` and `ieg_questions`
the batch-completeness gate and the redundancy gate
the question diagnostic codes (ieg.question_registered,
  ieg.question_batch_created, ieg.question_deferred, ieg.question_submitted,
  ieg.question_batch_blocked, ieg.question_redundant)
the `userAttention` configuration key — now rejected as an unknown key
the `question-consolidation` evaluation scenario and the evaluation-only
  `eval/answerer/` plugin
its unit, integration, and evaluation tests
```

The runtime question path, its wiring, and its metrics are recorded as withdrawn
in §30; the delta that proposed them is marked withdrawn in §18 (D5); the seam
reconnaissance that once supported them is kept, marked not bound, in §17.5.

**Accepted boundary.** Delegated questioning was already outside IEG's scope
(only a live runtime root agent may ask; a child raises `DELEGATED_CALLER`), so
the withdrawal removes no coverage that was ever claimed. No residual blocker and
no measurement is owed.

## 24. Target Module Set and Module Contracts

### 24.1 Set

| Module | Version | Problem | Failure class | Risk | Enabled by default |
|---|---|---|---|---|---|
| `project-governance` | 0.2.0 | the agent advances without a stable project model | `FC-2.1` | low | yes |
| `information-integrity` | 0.2.0 | known-invalid information stays reusable | `FC-2.3` | medium | yes |
| `workspace-governance` | 0.2.0 | unauthorized persistent mutation | `FC-2.2` | high | yes |

The `user-attention` row (`FC-2.4`) was removed in `0.7.0` (§23.2); the shipped
set is these **three** modules, all default-on. The §6 module contract is
unchanged, including the IEG `addresses` extension.
The conformance suite asserts that each failure class is claimed by **exactly
one** enabled module.

> **Version-field note.** The `version` column states the module **contracts** as
> designed, and the three shipped descriptors (`src/modules/*.ts`, compiled to
> `lib/modules/*.js`) declare the same `version: '0.2.0'`. The earlier mismatch
> (shipped `0.1.0`) was closed in `0.8.0`; one version is authoritative
> (§34.2 Q9, closed).

### 24.2 Per-module v0.2.0 contracts

**`project-governance` — 0.2.0**

```text
state        ProjectState {intent, objective, scope, terminology, constraints,
             assumptions, unknowns, plan, currentPhase}
             (src/modules/project-governance.ts). The durable orientation snapshot
             (src/kernel/orientation.ts) carries this state object plus the ordered
             plan; there is no recordedAt/timestamp field in either.
scope        per live agent, persisted per session (§25)
enforcement  tools/pre-execute orientation requirement
             agent/pre-step gate (off | warn | reject)
tools        record_orientation — records intent, objective, scope, terminology
             and ordered plan; a partial update does not erase prior fields
v0.2.0 delta state is per agent, not per composition; a partial update no longer
             erases fields the agent already recorded
tests        unit (state merge, gate evaluation), wiring, real-registry integration
```

**`information-integrity` — 0.2.0**

```text
state        InformationRecord {id, status, value, provenance, disposition,
             revision} (src/modules/information-integrity.ts). The durable record
             set is a list of these; there is no ref/updatedAt/supersedes field.
statuses     AUTHORITATIVE | PROVISIONAL | SUSPECT | INVALID | DEPRECATED |
             SUPERSEDED | PENDING_CONFIRMATION
dispositions CORRECTED | REPLACED | QUARANTINED | REMOVED
transitions  promotion to AUTHORITATIVE requires evidence or user confirmation;
             demotion is unrestricted
enforcement  gate a promotion attempt that carries no evidence and no user
             confirmation (new in v0.2.0); IEG itself never deletes information
prompt duty  wrong information is deleted; outdated information is deleted
             except in an IT-development workspace, where it is marked
             explicitly outdated (D14)
tests        transition table, promotion gate, resume/fork recovery
```

**`workspace-governance` — 0.2.0**

```text
state        stateless — pure classify/decide/guard functions over the call and
             the `workspace` config (src/modules/workspace-governance.ts). The
             earlier authorized[]/observed[]/blocked[] ledger is SUPERSEDED and
             is not shipped.
enforcement  tools/pre-execute classify + gate on file-effect tools;
             shell writes classified from command text, quoted text as data
             unless the command wraps another command (D13 amendment);
             ctx.tools.guard monotonic deny backstop;
             document-overlap gate (body similarity, identical H1, filename
             subject, prefix matching)
observation  the fs/write-intent, fs/edit-intent and fs/observed seams are
             verified host facts (§17.4), but the shipped plugin registers no
             listener on them: the concrete target is taken from the tool
             arguments instead. The intent-observation design described here in
             earlier revisions is RETIRED, not a current binding.
boundary     tool-mediated mutations only (A4); direct ctx.fs writes are not
             covered and IEG does not claim process-wide coverage
tests        classification, guard ordering, overlap detector, real-fs
             integration, gate precision (§32.4)
```

## 25. Scope-Isolated Governance State

### 25.1 Problem

Part A D15 and §17.7: the `0.1.0` prototype held orientation once per
composition. Two concurrent agents shared one orientation, and a second session
could satisfy the first session's gate. That is a correctness defect, not a
cosmetic one.

### 25.2 Design

```text
live state      WeakMap<Agent, AgentGovernanceState>
                identity-keyed; released when the agent is collected
durable state   ctx.storageDomain table 'sessions', keyed by session id
```

- Every seam already carries the live subject: `AssembleContext.agent`
  (merge-extended by `@deepseek-ai/dsh-agent`, verified), `agent/pre-step`
  `payload.agent`, `tools/pre-execute` `exec.agent`, `tools/result`, and the
  `fs/*` actor.
- `AgentGovernanceState = {orientation}` — verified against
  `src/kernel/state.ts` (compiled to `lib/kernel/state.js`), whose
  `createAgentState()` returns exactly that.
  There is no question ledger, workspace ledger, or information ledger in live
  state; those rows were removed in `0.7.0` (§23.2).
- Hydration: the first seam touch for an agent performs one `load(sessionId)`;
  a resumed session restores its orientation and is not asked to re-orient
  (Gate E).
- Isolation is a test, not a claim: two live agents in one composition must be
  unable to observe each other's orientation (§32, Gate G).

### 25.3 Why a `WeakMap` and not `ScopedLayers`

§17.7 recommends mirroring `SystemPrompt`'s `ScopedLayers` shape. Doing so
requires importing `@deepseek-ai/dsh-scope`, which breaks IEG's zero
first-party-import property and its immunity to the profile's module-resolution
layout.

v0.2.0 keys live state by the **agent object identity**, because §17.7's own
verified finding is that the per-agent scope key *is* the agent object. Identity
keying therefore yields the same isolation and adds GC safety. The cost is that
IEG does not inherit scope-chain semantics, which it does not need: every piece
of IEG state is strictly per agent.

This is a deliberate deviation from §17.7 and is listed for confirmation in
§34.2. If IEG ever accepts a first-party import, the migration is
`ScopedLayers` filed by `scopeOf(ctx)`.

### 25.4 Durable schema

Verified against `src/kernel/durability.ts` and
`src/kernel/orientation.ts` (compiled to `lib/kernel/`):

```text
domain { name: 'ieg_governance', version: 1, layout: 'per-record' }
table 'sessions'    key: sessionId    value: { payload: string }
payload (JSON): {
  state: {
    intent, objective, scope,
    terminology: {term: definition},
    constraints: string[], assumptions: string[], unknowns: string[],
    plan: string[], currentPhase
  },
  plan: string[]
}
```

There is **no** separate diagnostics table and no `v`, `questions`, `deferred`,
`workspace`, or `information` field: the store opens exactly one table, and the
payload is the orientation snapshot the `record_orientation` tool hands to
`durable.save()`. Diagnostics live only in the in-process, bounded ring of §28.3
unless a deployment opts into the §28.7 mirror.

`DOMAIN_VERSION` stays `1`. Domains have no migration facility, so a
pre-`0.7.0` record (or one from the old domain name) is not migrated; only
throwaway profiles are supported, and that is accepted rather than handled.
Adding a table to an existing domain version is expected to be open-compatible,
because the facility builds its record set from the spec and a new table starts
empty; this must be verified before shipping (§34.1 B5).

Persistence fails open, exactly as in `0.1.0`: an absent facility, a failed
`open`, or a corrupt record degrades to no persistence, and enforcement is
unchanged.

## 26. Kernel Composition, Mount Record, and Teardown

Part A §5.1 is carried, with three additions.

### 26.1 Mount record

`apply()` emits one mount record. The **shipped** field set is the mount literal in
`src/index.ts` (compiled to `lib/index.js`); this is the authoritative shape:

```text
mounted            boolean
degraded[]         capabilities whose registration failed or whose seam is absent
promptVersion      string (PROMPT_VERSION, suffixed when a user edit is in force)
promptOverridden   boolean
promptIssues[]     why a user prompt edit was refused or ignored
compiledPromptBytes number (the audited compiled default)
sectionName        string
sectionOrder       number
promptBytes        number (the effective section)
modules[]          enabled module ids
moduleCount        number
compatibility      {verdict, reasons[], sectionNames?, iegIndex?, hostPromptHash?,
                    assemblyCount?, observedAt?}
```

The earlier design enumeration (`pluginVersion`, `configDigest`,
`capabilities{tools,fs,storageDomain,approval,systemPromptContext}`, and a
`compatibility` object holding `hostPromptHash`/`sectionInventoryHash`) is
**SUPERSEDED** and is not what ships. The separate `configError` field exists
only on the configuration-fault surface (`mounted: false`), not on a successful
mount. `userQuestions` was removed from the capability enumeration in `0.7.0`,
with the `user-attention` capability itself (§23.2); the capability inventory is
what the §29 adapter observes (`systemPrompt`, `tools`, `fs`, `storageDomain`,
`approval`).

The record is emitted as **late as possible** in `apply()`, so a partially
registered plugin is visible as a partially registered plugin. It also carries a
`degraded[]` list — the capabilities whose registration failed or whose seam was
absent — because `mounted: true` alone cannot distinguish a complete mount from a
partial one, and a health check that reads only `mounted` would miss a dropped
enforcement seam.

### 26.2 `apply()` must not throw

Delta D10: a plugin that throws during composition is reported by the host as
`warning: N entry did not activate` and the session continues. IEG therefore
cannot report its own mount failure. Consequences:

- `apply()` validates configuration and registers each capability inside its own
  guarded step, so a configuration fault degrades to a diagnostic instead of an
  unmount.
- A configuration fault mounts an **inert but observable** surface instead: the
  read-only `ieg_status` tool and the `ieg:status` context line report
  `mounted: false` with the validator's message and an `ieg.config_invalid`
  diagnostic, while **no** prompt section and **no** enforcement is registered —
  fail-safe, and visible from the transcript rather than only from boot stderr.
- An absent seam is recorded as `ieg.capability_missing` and added to
  `degraded[]`, so a vanished host service is distinguishable from a capability
  IEG never required.
- Logger narration is best-effort everywhere: a deployment whose logger throws
  still gets the ring, the status line, and the tools.
- **Boundary of the guard.** The only statements outside a guarded step are the
  pure in-memory constructors (`createGovernanceState`, `createDiagnostics`) and
  the mount-record literal. They touch no host service and perform no I/O, so
  they cannot be made to fail by a deployment; every statement that does touch a
  seam is guarded.
- **Residual limit, recorded rather than papered over.** If the `tools` injection
  is itself what throws, the read-only `ieg_status` surface is precisely the
  capability that failed, so the loss is visible only through channel A's warning
  count and the durable ring — never through a tool. IEG cannot fix this from
  inside: a plugin that cannot register tools cannot offer a tool to say so.
  Likewise, in a composition where **both** `systemPrompt` and `inject` are
  absent, neither observation channel exists; that composition is unreachable on
  a real host, because Cordis gates the plugin on `inject: ['systemPrompt']` and
  `inject` is a core context method. Both limits were measured
  (2026-10-02) and neither is a regression.

**Status: implemented 2026-10-02.** `src/index.ts` (compiled to `lib/index.js`) wraps the kernel build and
every registration (`systemPrompt.section`, `systemPrompt.context`,
`system-prompt/assemble`, `agent/pre-step`, `tools/pre-execute`, `tools`,
`storageDomain`, `dispose.storageDomain`, and each tool definition) in guarded
steps; the fault surface is `mountConfigFaultSurface()`. `verify.sh`'s
installed-artifact check
proves the behaviour against the **installed** copy of the package, and
`test/integration/wiring.test.js` covers the same contract in-process.
- A genuine unmount is observable only from outside the plugin — the transcript
  either contains the IEG section, tools, and status line or it does not. The
  acceptance tests therefore assert **positive** evidence (§32, Gates A and F), never
  merely that the process started.

### 26.3 Teardown

Every registration is collected as a Cordis disposer and released when the row
unmounts. A unit test asserts that after disposal no gate decision, no
diagnostic, and no context contribution is produced.

## 27. Prompt Compilation and Content Rules (v0.2.0)

- One section, one aggregation point (§4). No module registers its own section.
- Section text may vary per agent through the `AssembleContext.agent`
  merge-extension, but only for **bounded** dynamic state — orientation
  presence, never transcript or document content. If per-agent variation is not
  enabled, the provider returns one compiled string and the section is
  byte-identical for every agent.
- `interpolate: false` (D3). `complete` is never set.
- `PROMPT_VERSION` is recorded in diagnostics, not injected into the text.
  `0.7.0` moved it to `0.3.0`.
- **Budget — recorded footprint (§34.1 B6), implemented.** After the `0.7.0`
  scope reset the compiled section measures **2,922 bytes** over the three
  shipped modules. `src/kernel/prompt-compiler.ts` records that measurement as
  `RECORDED_PROMPT_BYTES` (compiled to `lib/kernel/prompt-compiler.js`,
  which is what the plugin loads) and derives the ceiling as
  `min(PROMPT_BYTE_HARD_CAP, max(PROMPT_BYTE_FLOOR, recorded + 10 %))` —
  **3,215 bytes** today, from a 1,400-byte floor and a 4,096-byte hard cap. The
  ceiling is derived from the **recorded** size, never recomputed from the text
  it bounds, so prompt growth cannot silently reset its own budget. `compilePrompt()`
  enforces it, and `test/unit/prompt-compiler.test.js` together with
  `test/unit/prompt-conformance.test.js` assert it from the same constants, so
  the compiler and the conformance suite cannot disagree about the budget.
- The prompt content rules stay **executable** (D11): the conformance suite keeps
  asserting failure-class coverage, §5.2 no-duplication, at least one trigger
  condition per module, no authority claim, no implementation leakage, no
  restatement of a deterministically enforced rule, and the byte budget. It is
  updated to the three-module set, and it no longer asserts anything about the
  withdrawn `user-attention` module.

### 27.1 User-editable prompt (v0.4.0)

The compiled section is generated and **audited**: the conformance suite enforces
§5.2 deduplication, the content rules in §27 (no authority claim, no implementation
leakage, no restatement of an enforced rule), and the §11 byte budget. A user who
wants different wording is asking to trade some of that for flexibility, which is
a legitimate request — provided the trade is explicit and attributable.

Three modes, strictly validated (`prompt{mode, append, file, allowOverBudget}`):

| Mode | Effect | Guarantees |
|---|---|---|
| `compiled` (default) | the audited generated section | all of them |
| `append` | the compiled section plus guidance | hard requirements + dedupe risk reported |
| `replace` | a markdown file becomes the section | hard requirements only |

**Hard requirements** (refused, with the compiled default kept and the reason
reported as `ieg.prompt_override_rejected`): `{{ }}` interpolation syntax, which
is a host-assembly hazard since the section is registered with
`interpolate: false`; and exceeding `DEFAULT_MAX_PROMPT_BYTES` unless
`prompt.allowOverBudget` is set deliberately, in which case the excess is still
reported. An unreadable `prompt.file` is not fatal: it degrades to the compiled
default with `ieg.prompt_override_missing`.

**Attribution.** An applied edit yields `PROMPT_VERSION + "+user:" + hash`, so a
behavioural claim still names exactly one text (PR-07).

**Honesty about what is no longer checked.** The soft invariants cannot be
verified on arbitrary user text. They are returned as `promptUnchecked`
(`UNCHECKED_INVARIANTS`) and recorded with `ieg.prompt_override_applied`, so no
front end may present a user-edited prompt as an audited one. This is the
mechanism by which the `dsh-ieg` terminal interface can offer free editing
without the project claiming a guarantee it cannot make.

## 28. Diagnosability Specification

### 28.1 Problem

Delta D9 / blocker 1: `ctx.logger` is buffered but not displayed, because no
shipped profile mounts a Cordis logger exporter. An operator cannot see what IEG
did.

### 28.2 Diagnostic record

```ts
interface IegDiagnostic {
  seq: number          // monotonic within the plugin instance
  time: string         // ISO 8601
  code: string         // 'ieg.*' vocabulary, owned by IEG (§17.8, D8)
  module?: string      // module id when attributable
  sessionId?: string
  agentId?: string
  data?: Record<string, unknown>
}
```

Codes (`§12`'s vocabulary, made concrete):

```text
ieg.mount  ieg.config_invalid  ieg.capability_missing
ieg.module_enabled  ieg.module_conflict
ieg.host_compatibility  ieg.prompt_assembly
ieg.prompt_override_applied  ieg.prompt_override_rejected  ieg.prompt_override_missing
ieg.control_paused  ieg.control_resumed  ieg.control_stopped
ieg.control_generation_changed  ieg.control_state_unreadable
ieg.diagnostics_export_failed
ieg.orientation_recorded  ieg.orientation_restored  ieg.orientation_required
ieg.workspace_mutation_allowed  ieg.workspace_mutation_blocked
ieg.document_overlap_flagged
ieg.information_invalidated  ieg.information_reintroduced
ieg.error
```

### 28.3 Four channels

| Channel | Mechanism | Visibility | Adopted |
|---|---|---|---|
| A — status line | `ctx.systemPrompt.context({name: 'ieg:status', order: <finite>, text})` | operator: durable user-role snapshot in the transcript; model: aware of governance state | yes, if §34.1 B2 verifies |
| B — status tool | read-only model-facing tool `ieg_status` | operator: tool call and result in the transcript; model: on demand | yes |
| C — durable ring | `storageDomain` table `diagnostics`, newest 200 per session | operator: after the fact, within the profile; model: via channel B | yes |
| D — log | `ctx.logger.info/warn/error` | only where a deployment mounts an exporter | best-effort narration only; never the primary channel |

Channel A rules: the line is emitted only when the status **materially
changes**, is capped at 200 UTF-8 bytes, never contains document or transcript
content, and is suppressed by the host's `suppressRuntimeContext()` when the
deployment suppresses runtime context — IEG must behave correctly when the
channel renders nothing.

### 28.4 Explicit non-decision

v0.2.0 does **not** add a diagnostics session event. §20.2 item 1 stands: a
plugin-authored event cannot carry `ignorable`, so an IEG event type is required
by construction and a session recorded with IEG loaded cannot be reconstructed
without IEG. Diagnostics are derived, not authoritative, so the ring buffer plus
channel B is the correct store. This is revisited only if the host adds a
plugin-facing `ignorable` write path or an explicit exemption.

### 28.5 Done criteria

- Gate F (§32.2): after a mount, an operator reading only the transcript can
  tell that IEG mounted, which modules are enabled, the compatibility verdict,
  and why the last mutation was blocked. This depends on channel A; if §34.1 B2
  proves that the runtime-context channel cannot be used, Gate F is met by the
  section's presence plus the registered `ieg_status` tool, and the residual
  gap — a changed status with no agent-visible trigger — is recorded rather than
  papered over.
- The same channel must also distinguish **four** mount outcomes, not two:
  a complete mount (`mounted: true`, `degraded: []`), a partial mount
  (`mounted: true`, `degraded: [...]` naming each failed or absent capability), a
  configuration fault (`mounted: false` with `configError`), and no mount at all
  (no section, no tool — observable only from outside the plugin, per D10).
  Status: implemented 2026-10-02 (`degraded[]` in the mount record plus
  `ieg.capability_missing` for an absent seam).

### 28.6 Control plane and terminal interface (v0.6.0)

IEG is turned on and off for a profile from a Debian shell, through one command,
`dsh-ieg`. This round **replaces** the removed browser route and in-harness
issue-reporting feature with that interface; the diagnostics ring and its opt-in
mirror (§28.7) are
unchanged, and the CLI is now the mirror's reader.

**Two modes, one implementation.** Bare `dsh-ieg` renders a numbered ANSI menu (plain
escape codes; no ncurses, no dependency, usable over SSH). Every command is also
available non-interactively with flags, because CI and scripts call it. The menu
dispatches to the same handlers the flags do, so the two cannot drift. Parsing,
rendering, and the `$EDITOR` invocation are hand-rolled over Node builtins: the
package keeps its zero-runtime-dependency property.

**The control record.** `dsh-ieg start | pause | restart | exit` writes one small
JSON record, `{schema, status, generation, updatedAt, editor?}`, where `status` is
`running` | `paused` | `stopped`. It resolves to `$IEG_STATE_FILE`, else
`<state-dir>/ieg/state.json` with `<state-dir>` = `$XDG_STATE_HOME` or
`~/.local/state`. Writes are atomic (sibling temporary file, then rename). An
**absent** file means `running`, so every pre-0.6.0 install behaves exactly as
before; an unparsable file also means `running`, with the reason recorded as
`ieg.control_state_unreadable` — corruption never switches governance off and never
crashes the host.

**Gating in the plugin.** `src/index.ts` (compiled to `lib/index.js`) re-reads the record, cached by mtime (and
size, to close a same-millisecond write window); a re-stat per assembly and per
step is allowed. `paused` emits no prompt section and passes every hook through;
`stopped` mounts nothing active, exactly like `enabled: false`; `running` is
normal. Each transition is recorded once — `ieg.control_paused`,
`ieg.control_resumed`, `ieg.control_stopped`. `restart` bumps `generation`, and a
changed generation is the signal to invalidate the cached configuration and prompt
so the next step re-reads on-disk truth, recorded as
`ieg.control_generation_changed`.

**Prompt text in `prompt.md`.** Prompt text is deliberately **not** stored inside
the control JSON: it lives in a sibling `prompt.md`, so the record stays a small
stable control object and the text stays something a human edits as text.
`dsh-ieg prompt` prints the effective text with its version and byte count;
`dsh-ieg prompt edit` opens `$EDITOR` on a temporary copy and stores the result only
after validation; `dsh-ieg prompt reset` deletes the file and returns to the compiled
default. Precedence is

```text
control-plane prompt.md                                 (highest)
  > config prompt.file   (only when prompt.mode: replace)
  > config prompt.append (only when prompt.mode: append)
  > the compiled default                                (lowest)
```

and `prompt.mode: compiled` forces the compiled default whenever no `prompt.md`
exists. Every candidate is validated through the existing `composePromptOverride`
kernel, so the CLI, a config-supplied file, and the compiled default obey the same
two hard rules — no `{{ }}` interpolation syntax, and the byte ceiling unless
`allowOverBudget` — and an accepted override is attributed
`PROMPT_VERSION+user:<hash>`. A refusal changes nothing, keeps the previous text,
and prints its reasons; it is never a silent no-op.

**`exit` is not uninstall.** `exit` sets `status: stopped` for the profile. Only
`dsh-ieg install | update | uninstall` touch the installation. The lifecycle is
npm-native (the host's `dsh plugin` path hard-codes pnpm): it packs the repository
root with `npm pack`, installs the artifact into `<DSH_HOME>/profiles/<p>`, and
maintains `dsh.profile.bundles` itself, so the `ieg` row composes without pnpm.
It refuses to write the live `$HOME/.dsh` without `--allow-live` (exit 2) and
defaults npm's cache to a writable home-local directory, because a read-only
`~/.npm` fails every npm operation before it starts. `scripts/ieg-npm.sh` is a
thin wrapper over these commands, so the lifecycle has one implementation, not
two.

**Evidence.** The kernel modules (`control`, `prompt-store`, `lifecycle`) have
unit suites; `scripts/verify.sh` adds a CLI smoke check (status plus
pause/start transitions on an isolated `--state`), a `prompt.md` round-trip
including a refused `{{ }}` edit, and a gating check that a `paused` control state
suppresses the section. The installed-artifact proof still applies the shipped
`cordis.patch.yml` verbatim.

### 28.7 Opt-in diagnostics mirror (v0.4.0)

The ring of §28.3 lives inside the running host process; a separate front end —
the `dsh-ieg` terminal interface, a bug report — cannot read it, which is why
`ieg_status` exists as a tool. This section adds the machine-readable half for
front ends: `diagnosticsExport{file, limit}` mirrors a bounded snapshot (mount
record, status line, counts, and the newest `limit` diagnostics) to a JSON file
the deployment names.

Constraints, in the order they matter:

- **off by default** — an empty `file` means no file I/O at all, so the plugin's
  side-effect-free property holds unless a deployment asks for the mirror;
- **bounded** — at most `limit` entries (1..200), newest first, plus a `schema`
  version and a timestamp so a reader can refuse a stale file;
- **throttled** — at most one write per 500 ms while diagnostics stream, with an
  explicit forced flush at mount and on disposal;
- **fail open, no recursion** — a write failure is reported once per window as
  `ieg.diagnostics_export_failed`, and re-entrancy is blocked explicitly because
  that report is itself a diagnostic;
- **atomic-ish** — written to `<file>.tmp` and renamed, so a reader never sees a
  half-written document.

The writer is injected into the kernel module, so throttling, bounding, and the
failure path are unit-tested without touching a filesystem.

## 29. Compatibility Adapter Specification

### 29.1 Problem

Blocker 2 / PR-06: a DSH peer range is declared and enforced at install and
startup, but nothing observes whether the running host's prompt surface still
matches what IEG was verified against.

### 29.2 Verified constraint

There is **no plugin-facing host-version service** in the installed
`0.2.1-alpha.1` distribution (verified there; the `0.2.0-rc.2` observation is
**SUPERSEDED**): the CLI resolves `context.version` for its own
startup diagnostics only, and no mounted service exposes it. The authoritative
version gate is therefore the host's own peer-range enforcement at install and
profile startup, with exemptions in the profile's `compatibility.json` (§17.8).

The adapter consequently does not depend on a version string. It observes the
seam facts that would actually change a decision.

### 29.3 Design

Listen on `system-prompt/assemble` (an expert waterfall; **must call `next()`**,
observe only, never block), debounced to the first assembly per scope and to any
change in the assembly's shape. Capture:

```text
ordered section names            assembly.sections.map(s => s.name)
IEG section presence + position  index of 'ieg:governance'
host section text hash           hash of the non-IEG section texts
contexts / tools count           assembly.contexts.length, assembly.tools.length
capability inventory             ctx.get('systemPrompt'|'tools'|'fs'|
                                 'storageDomain'|'approval')
```

The observed inventory no longer includes `userQuestions` (§23.2); the plugin's
provider in `src/index.ts` (compiled to `lib/index.js`) filters exactly the five names above.
`AssembledSection` carries `name`, `text`, and `interpolate` — **not** `order`.
The ordered name array is the resolved placement, which is exactly the drift
signal that matters.

### 29.4 Baseline and verdict

- `lib/compatibility-baseline.json` records the expected ordered section
  names, the expected host section hash, and the capability set for the declared
  host version. It is generated by `scripts/capture-baseline.mjs` against
  a real profile and committed. The committed baseline requires exactly one
  capability, `systemPrompt` (IEG's `inject` dependency); every other seam is
  optional and its absence is a warning, not an unsupported verdict.
- Verdicts:

```text
COMPATIBLE                 every expected fact matches
COMPATIBLE_WITH_WARNINGS   non-critical drift: new optional sections/contexts/
                           tools, or an optional capability absent
UNSUPPORTED                a required section is missing, the IEG section is
                           absent or displaced, or a required capability is absent
```

- The verdict is emitted once per mount as `ieg.host_compatibility`, is carried
  in the mount record, and is reported by `ieg_status`. Under
  `COMPATIBLE_WITH_WARNINGS` and `UNSUPPORTED` it also appears in channel A.
- **Fail-open.** The adapter never denies a step or a tool call.
- A baseline test fails when the installed host's section inventory or hash
  differs from the file, forcing a reviewed baseline update rather than silent
  drift. This is the concrete regression signal PR-06 asks for.

## 30. Withdrawn in 0.7.0 — Runtime Question Consolidation

> **This section is a withdrawal record, not a current design.** Nothing in it is
> wired at runtime, and no part of it should be read as a live mechanism.

### 30.1 What it specified

The withdrawn design consolidated deterministic blockers into one host
interaction. It specified:

```text
a question ledger                questions[], deferred[], batches[]
a record_question tool           register a candidate with kind and dependsOn
an ieg_questions read-only tool  return {pending[], deferred[], recommendedBatch[]}
a batch-completeness gate        refuse a batch that omits a registered blocker
a redundancy gate                refuse a question already answered
a prompt fragment                one ask per batch; defer non-blocking uncertainty
an eval/answerer plugin          a scripted answerer for behavioural measurement
```

It was built on the host facts in §17.5 (batching within one `ask()` call only;
no cross-request merge, dedup, or abandonment API; `askTimed` as the only
deferral primitive; root-agent-only asking). The model composed the batch; IEG
supplied the state and the gate, because `ToolExecution` carries no
input-rewriting capability (§17.3, item 1).

### 30.2 Why it was removed

Same classification as §23.2: **Out of Scope / Externally Solved.** Testing
found a stable prompt-level solution to the fragmented-questioning failure mode,
so runtime governance of question batching is not justified. The capability was
not defective; the runtime surface is simply no longer warranted. Failure class
`FC-2.4` went with it.

### 30.3 What remains

Nothing at runtime. There is no question ledger, no `record_question` or
`ieg_questions` tool, no batch-completeness or redundancy gate, and no
question-related diagnostic code; the `userAttention` configuration key is
rejected as unknown, and the `question-consolidation` evaluation scenario and
the evaluation-only `eval/answerer/` plugin were deleted. The complete deletion
list and the accepted boundary are in §23.2. The Task/tool seam is therefore
`tools/pre-execute` for mutations and orientation only, and `agent/pre-step`
returns no question-batch decision (§8).

## 31. Packaging, Versioning, and Release Policy

### 31.1 Package

| Item | 0.8.0 |
|---|---|
| package | `dsh-information-environment-governance`, `version: 0.8.0`, `private: true`; `bin: { "dsh-ieg": "bin/ieg" }` |
| repository | the repository root **is** the package; there is no `plugin/` subdirectory (removed in 0.8.0) |
| `private` | **retained** in the working tree until Gates C and D pass; removal is the release action |
| `license` | `MIT`, with `LICENSE` |
| `CHANGELOG.md` | required; every prompt change attributed to a problem or an evaluation result |
| `files` | `lib`, `bin`, `cordis.patch.yml`, `README.md`, `LICENSE`, `CHANGELOG.md` |
| `dsh.engines.dsh` | `>=0.2.1-alpha.1 <0.3.0` (the single supported baseline) |
| `dsh.compatibility.dshReleases` | `{ "0.2.1-alpha.1": "verified" }` — the committed baseline was re-captured against it in 0.8.0 (closes §34.2 Q7); the retired `0.2.0-rc.2` baseline is **SUPERSEDED** |
| runtime dependencies | none |
| publish target | **open** — see §34.2 Q5 |

### 31.2 Release policy

- Semver. A change to compiled prompt text or to the durable record shape
  forces at least a minor bump and a CHANGELOG entry.
- A new host release adds a `dsh.compatibility.dshReleases` entry only after the
  compatibility baseline test passes and the baseline file is reviewed.
- `scripts/verify.sh` is the release gate: it builds the TypeScript
  sources, runs the strict typecheck and the full test suite, performs a real
  install, row composition, a positive execution proof against the **installed**
  artifact, and a real mount against the pinned host version. The checks are wired
  through `package.json` npm scripts (`build`, `pretest`, `test`,
  `typecheck`, `prepack`); [`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md) is the
  package-level record.
- Reproducibility: `npm pack` must contain exactly the `files` allowlist, with no
  consumer-side build step. The package ships the compiled `lib/`; `prepack`
  asserts the required artifacts are present.
- **No behavioural gate for question consolidation exists.** That capability,
  its measurement, and its evaluation case list were withdrawn in `0.7.0`
  (§23.2, §30); the only behavioural claim still owed is Gate C, and information
  integrity is Gate D (§32.1).

## 32. Verification and Acceptance Matrix

### 32.1 Gates

| Gate | Statement | Status | Evidence |
|---|---|---|---|
| A — Host compatibility | IEG is additive and the host prompt survives | **met** | `test/integration/composition.test.js`; `verify.sh` composes the real row and proves the installed artifact binds one section, three listeners, and two tools (`record_orientation`, `ieg_status`) |
| B — Semantic non-conflict | no module contradicts an identified host semantic | **met** | executable prompt-conformance suite; Part A's seam review |
| C — Behavioural improvement | at least one target failure mode improves measurably against baseline | **unmet** | the only measurements ever taken were against superseded multi-module prompts and were deleted, so no valid number exists for the current three-module revision; a fresh `eval/` run is required |
| D — Information integrity | known-invalid information is no longer authoritative by default, and the D14 deletion policy is applied | **unmet** | the pre-removal measurement was deleted as superseded; needs a fresh run |
| E — Regression resilience | compaction, resume, and fork preserve governance state | **met** | `durability-storage.test.js` (real storage stack); `agent-isolation.test.js` |
| F — Diagnosability | mount and gate decisions are observable outside the plugin without a logger exporter | **met** | `diagnostics.test.js`; `v2-integration.test.js` channels A and B; `wiring.test.js` for the config-fault surface, `degraded[]`, and best-effort logging; `verify.sh`'s installed-artifact check |
| G — Agent isolation | two live agents in one composition never share governance state | **met** | `agent-isolation.test.js`; `state.test.js` |
| H — Compatibility baseline | the adapter reports a verdict and detects a simulated host section change | **met** | `compatibility.test.js`; `v2-integration.test.js` reports `COMPATIBLE` from a real assembly |
| I — Packaging | installable, licensed, changelogged, peer-range enforced | **partial** | LICENSE, CHANGELOG, `files` allowlist, and the narrowed peer range landed; `private: true` and publication remain until Gates C and D pass |
| J — Withdrawal integrity | the plugin ships three modules with no dangling reference to the removed `user-attention` capability | **met** | full suite + repository-wide reference scan |

Gates were renumbered **A–J with no gap** in `0.7.0`, because the user-attention
efficiency gate was withdrawn: old `E → D`, `F → E`, `G → F`, `H → G`, `I → H`,
`J → I`, `K → J`; old `D` (user-attention efficiency) was withdrawn. The mapping
is also recorded in `MAINTENANCE-HANDOFF.md` §13.3.

### 32.2 Positive evidence (D10)

Gates A, F, and H must be asserted by **positive** observation: the transcript
contains the IEG section, the registered tools, and — subject to §34.1 B2 — the
status line, and it carries the compatibility verdict. "The process booted" is
not evidence.

### 32.3 Test layers

```text
unit          config, registry, compiler, module logic, diagnostics sink,
              state merge, gates
conformance   prompt content rules, failure-class coverage (three), budget,
              interpolation safety
integration   real dsh-system-prompt, dsh-tools, dsh-fs-local, the
              storage stack, the real tool registry, the assembly waterfall
compatibility baseline vs. installed host section inventory and hash
end-to-end    real agent, IEG mounted, with and without the plugin
```

### 32.4 Gate-precision evaluation (blocker 3)

A governance layer that blocks legitimate work has negative value. The
evaluation must therefore measure, on a suite of at least 12 legitimate tasks:

```text
legitimate_mutation_calls      calls the task requires
false_blocks                   calls IEG refused although the task authorized them
false_block_rate               false_blocks / legitimate_mutation_calls
true_blocks                    the overlap and policy traps IEG is meant to catch
```

Target: `false_block_rate = 0` on the suite, with every block attributable to a
declared precondition. Because `ask` fails closed where no approval channel
exists, the harness must mount an approval answerer (or configure a policy that
does not ask) — otherwise the metric cannot distinguish a false positive from a
missing approval channel. This distinction is the point of the evaluation.

### 32.5 Evidence widening (blocker 5)

- At least 8 repetitions per arm per scenario, up from 2–4.
- Blind judging: the scoring rubric is frozen before the runs and applied by a
  judge that does not see the arm.
- At least two models.
- One non-English scenario, to test whether the prompt's effect is
  language-conditional.
- Every claim in `eval/README.md` re-derived from the new runs; stale claims
  removed rather than kept alongside new ones.

### 32.6 Evaluation cases carried from the retired implementation handoff

The task and test designs of `IMPLEMENTATION-VALIDATION-HANDOFF.md` §6–§9 remain
the case list for gates C and D, together with the workspace-governance cases.
They are recorded here so the handoff can stay a pointer. The former
"Question consolidation" case list and its metrics were removed in `0.7.0` with
the `user-attention` capability (§23.2, §30) and are not replaced.

**Information integrity (Gate D).** Cases: valid information; invalidated
information; superseded information; contradictory sources; corrected
information; reintroduced stale content. The decisive test is not whether the
agent notices invalidity, but whether the invalidated information stops being
reused as authoritative.

**Workspace governance.** Cases: read-only inspection; modify an authorized
artifact; create an explicitly authorized artifact; create an apparently useful
but unauthorized artifact; delete an authorized artifact; delete an uncertain
artifact; structural workspace change. Measure model compliance, runtime
enforcement, user-approval behaviour, and the actual filesystem outcome
separately.

**Compatibility regression.** Capture per host version: host version, active
section names, resolved ordering, the compiled IEG section, the assembled prompt
hash, and relevant context contributions. Fail on a replaced full prompt, a
missing IEG section, a host section collision, duplicated host semantics, a
missing seam, or unreviewed drift; §29.4 is the implemented form.

## 33. Implementation Plan

Phases are ordered by dependency. Each phase is a reviewable change set with its
own verification run. P1, Batch 1 (`0.7.0`), and Batch 2 (`0.8.0`) — the breaking
changes — **have landed**; the remaining phases build on their result. Rows
marked **done**/**landed** are **HISTORICAL** (the plan of record that was
executed); P6 and P7 carry the still-open work.

| Phase | Deliverable | Primary files | Depends on | Done when |
|---|---|---|---|---|
| P0 | Baseline freeze | `CHANGELOG.md` | — | the `0.1.0` evidence chain is recorded verbatim: `npm test` and `verify.sh` results, prompt size, prompt version |
| P1 (done) | Withdraw `child-agent-lifecycle` | executed: module, listeners, contract types, test, composition toggle, prompt fragment, and product clauses removed | P0 | **met** — four modules at that revision (three after Batch 1), no dangling reference, Gate J |
| B1 (done) — Batch 1, `0.7.0` scope reset | Withdraw `user-attention`/`FC-2.4`; rename project, package, CLI (`dsh-ieg`), prompt section (`ieg:governance`@8500), status line (`ieg:status`), tools, diagnostics (`ieg.*`), storage domain (`ieg_governance`), env vars, and throwaway dirs; re-baseline the prompt (`PROMPT_VERSION` 0.3.0, `RECORDED_PROMPT_BYTES` 2922); renumber gates A–J | `package.json`, `src/index.ts`, `src/kernel/*`, `src/modules/*`, `cordis.patch.yml`, `CHANGELOG.md`, this document, `MAINTENANCE-HANDOFF.md` | P1 | **landed 2026-10-03** — three modules, no dangling reference to the withdrawn capability; Gates C and D remain unverified |
| B2 (done) — Batch 2, `0.8.0` migration and packaging round | Make the repository root the installable DSH bundle (remove `plugin/`); move the baseline to `0.2.1-alpha.1` (single-baseline policy, no legacy layer); finish the TypeScript migration (`src/**/*.ts` → committed `lib/**`; retire `lib/generated/`); set module descriptors to `0.2.0`; add the packaging structural regression and the `bounded-repair` scenario | `package.json`, `cordis.patch.yml`, `src/**`, `lib/**`, `bin/ieg`, `tsconfig*.json`, `test/integration/packaging.test.js`, `eval/scenarios.mjs`, the documents | B1 | **landed 2026-10-03** — `PROMPT_VERSION` unchanged (compiled text byte-identical), structural suite green, Gates C and D still unmeasured |
| P2 | Scope-isolated state | `src/kernel/state.ts`, `src/index.ts`, `src/kernel/orientation.ts`, `src/modules/workspace-governance.ts`, `src/kernel/durability.ts` | P1 | **done** — Gates E and G met |
| P3 | Diagnostics | `src/kernel/diagnostics.ts`, `src/index.ts`, `lib/contract.d.ts`, `test/unit/diagnostics.test.js`, `test/integration/diagnostics.test.js` | P2 | **done** — Gate F met |
| P4 | Compatibility adapter | `src/kernel/compatibility.ts`, `lib/compatibility-baseline.json`, `scripts/capture-baseline.mjs`, `test/integration/compatibility.test.js` | P3 | **done** — Gate H met; baseline re-captured for `0.2.1-alpha.1` in B2 |
| P5 | ~~Question consolidation at runtime~~ | **WITHDRAWN/RETIRED** — the module, ledger, tools, gates, answerer, and evaluation scenario were removed in `0.7.0` (§23.2, §30) | — | **WITHDRAWN in `0.7.0`** — nothing remains and no measurement is owed |
| P6 | Evaluation: precision and breadth | `eval/e2e.mjs`, `eval/e2e-analyze.mjs`, `eval/scenarios.mjs`, `eval/README.md` | P1–P4 | **partial** — the simulated gate-precision matrix landed (21 legitimate calls, 0 false blocks; 4 traps caught) and `bounded-repair` (OBJ-3) was added in B2; the model-backed Gate C and D measurements and the wider evidence of §32.5 did not |
| P7 | Packaging | `package.json`, `LICENSE`, `CHANGELOG.md`, `docs/PACKAGE-REFERENCE.md` | P1 | **partial** — LICENSE, CHANGELOG, the `dsh-ieg` bin, the `files` allowlist, and the narrowed peer range (`>=0.2.1-alpha.1 <0.3.0`) landed; publication stays withheld while Gates C and D are unverified |

**Round status is not restated here.** The current package version, test count,
and verification result are maintained once, in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §3–§4.

### 33.1 Ordering constraints

- P1 first: it removes code that P2–P4 would otherwise have to carry. Batch 1
  (`0.7.0`) then removes the `user-attention` code and renames the rest, so
  P2–P4 carry three modules, not four.
- P2 before P3: the diagnostics sink is per agent.
- P3 before P4: the adapter reports through the diagnostics sink.
- P6 last: it measures the finished behaviour, not an intermediate one.

### 33.2 Parallelizable work and write scopes

Once P1 lands, P2 and P7 touch disjoint files and may proceed in parallel. P3
and P4 both touch `src/index.ts`, so they are **serialized**, not merged
concurrently. The evaluation harness (P6) is a separate directory and may be
prepared in parallel, but it must not be scored until P1–P4 and Batch 1 have
landed, because a score against an intermediate build is not a result. P5 is
withdrawn, so it serializes nothing.

### 33.3 Definition of done for the 0.7.0 three-module revision

```text
1. three modules, each claiming exactly one failure class                       [met]
2. no import, config key, prompt fragment, test, or documentation claim
   referring to child-agent-lifecycle or presenting user-attention as current   [met]
3. per-agent state isolation proven by test
4. mount, configuration, last denial, and compatibility verdict observable from
   the transcript alone, under the §28.5 fallback if channel A is unavailable
5. a compatibility regression test that fails on host drift
6. gate-precision suite with a measured false-block rate
7. prompt byte ceiling re-recorded (2,922 / 3,215) and asserted
8. package installable from a clean profile, with a changelog and a license
9. every §34.2 item either confirmed or still explicitly open — none silently
   decided
```

## 34. Assumptions and Items Requiring Confirmation

### 34.1 Assumptions

| # | Assumption | Status |
|---|---|---|
| A1 | IEG ships out-of-tree as an npm plugin with a bundle patch, mounted through `dsh.profile.bundles` / `cordis.patch.yml`, declaring a DSH peer range | carried from §20.1 |
| A2 | IEG occupies one explicit finite numeric section `order`; there is no host-allocatable placement | carried, verified in Part A |
| A3 | Authoritative governance state lives in `ctx.storageDomain`; log-only state is composition-coupled because `ignorable` has no plugin-facing write path | carried and strengthened: v0.2.0 adds no session event |
| A4 | Mutation governance covers **tool-mediated** mutations only | carried |
| A5 | `ctx.logger` is not displayed in stock compositions and `dsh-base` does not mount an exporter | carried; Part B's channels do not depend on it |
| A6 | Question consolidation is available only to live runtime root agents | **withdrawn in `0.7.0`** — this assumption belonged to the removed `user-attention` capability (§23.2); kept as history, and delegated questioning remains an accepted boundary (§34.3) |
| A7 | All Part A facts are scoped to `@deepseek-ai/dsh` `0.2.1-alpha.1` | carried; the baseline was re-captured in `0.8.0` (the `0.2.0-rc.2` scope is **SUPERSEDED**), and the shipped package is `0.8.0` |
| B1 | The withdrawal of `child-agent-lifecycle` is a product-level breaking change; its removal has been executed (§23.1) and verified by the suite | done |
| B2 | `ctx.systemPrompt.context` accepts a `PromptContext {name, order, text}` whose `order` is any finite number, as sections do, and repeated snapshots do not accumulate unboundedly | **resolved positive**. Verified against the real `dsh-system-prompt` (originally `0.2.0-rc.2`; re-captured unchanged for `0.2.1-alpha.1` in `0.8.0`): any finite order is accepted (`8500` resolves and renders; non-finite throws `TypeError`), the text renders through the runtime-context channel (`assembly.contexts`, `renderContextSnapshot`) and **not** through `renderPrompt`, and one registration yields exactly one entry per assembly. Channel A is implemented and covered by `test/integration/diagnostics.test.js` and `test/integration/v2-integration.test.js`. |
| B3 | Live state is keyed by the agent object identity (`WeakMap`) instead of §17.7's `ScopedLayers`, to preserve zero first-party imports | **shipped** as designed. `lib/kernel/state.js` keys by agent identity with an unscoped fallback; `test/integration/agent-isolation.test.js` proves two live agents share nothing. The deviation from §17.7 remains a deliberate, recorded choice. |
| B4 | No plugin-facing host-version service exists; the adapter observes seam facts, and the enforced peer range is the authoritative version gate | verified for `0.2.1-alpha.1` (originally `0.2.0-rc.2`, **SUPERSEDED**) |
| B5 | Adding a table to an existing `storageDomain` version is open-compatible | to verify before shipping |
| B6 | The prompt byte ceiling is re-recorded after a withdrawal as measured size + 10 %, floor 1400 bytes, hard cap 4096 bytes | **implemented** — after the `0.7.0` scope reset, `RECORDED_PROMPT_BYTES = 2922`, ceiling `3215` (= `min(4096, max(1400, ceil(2922 × 1.1)))`), floor `1400`, hard cap `4096`; enforced by `compilePrompt()` and asserted from the same constants by the compiler and conformance suites |
| B7 | The publish target (registry, git, or local path) is undecided | new |
| B8 | The withdrawal of `user-attention` / `FC-2.4` is a product-level breaking change; its removal has been executed (§23.2) | done — three modules, no dangling reference to the removed capability |

### 34.2 Items requiring confirmation

Q1, Q3, Q4, Q7, and Q9 were **decided** (see the Decision column), with Q7 and
Q9 closed in the `0.8.0` round. Q2, Q5, Q6, and Q8 remain open; nothing is
adopted silently. The Q numbering is unchanged, so no number is missing and none
was renumbered; the closure mapping is also recorded in
[`MAINTENANCE-HANDOFF.md`](MAINTENANCE-HANDOFF.md) §13.6.

| # | Item | Decision / options |
|---|---|---|
| Q1 | Intrusive defaults | **Decided — adopt non-intrusive defaults.** `requireBeforeMutation` defaults to `false`, with `preStep.orientationGate: 'off'` remaining the default; a strict mode (`requireBeforeMutation: true`) stays available as an explicit opt-in, and the evaluation configures the gates explicitly either way. Rationale: a default that denies the first write of every session is friction a deployment has not asked for, and the requirement is a policy choice, not a correctness property. **Implemented 2026-10-02:** the code default and the shipped `cordis.patch.yml` row are `false`, and the requirement's tests state `true` explicitly. |
| Q2 | Section order value | **Open** — confirm `8500` and the regression test that fixes it. |
| Q3 | Approval authorship | **Decided — ask only.** IEG gates mutations by returning `PreToolDecision.ask` and never registers its own `approval/request` answerer, so a deployment keeps one terminal answerer and inherits the host's fail-closed path. This is what the code already does. |
| Q4 | `dsh-agent-instructions` integration | **Decided — defer to the host.** IEG references `AGENTS.md` / `CLAUDE.md` as the workspace-instruction authority and does not restate it in its own prompt section; the conformance suite already forbids restating host semantics. |
| Q5 | Publish target | **Open** — registry, git, or local `file:` distribution. |
| Q6 | Live-profile rollout | **Open** — whether IEG is ever installed into the live `web` profile (`MAINTENANCE-HANDOFF.md` §9, §10), and under what conditions. Throwaway profiles only, so far. |
| Q7 | Compatibility baseline for the installed host | **Decided/closed in 0.8.0 — single baseline `0.2.1-alpha.1`.** `dsh.engines.dsh` is `>=0.2.1-alpha.1 <0.3.0`, `dsh.compatibility.dshReleases` records that one release as `verified`, and `lib/compatibility-baseline.json` was re-captured against the installed host and reviewed: the ordered section names, the host prompt hash (`ceb63ee5`) and the required capability set are identical to the previous baseline. The retired `0.2.0-rc.2` baseline is **SUPERSEDED**. Tracked in `MAINTENANCE-HANDOFF.md` §4 item 4. |
| Q8 | Profile scoping of the control state | **Open** — the default control-state path is `$IEG_STATE_FILE`, else `<XDG_STATE_HOME or ~/.local/state>/ieg/state.json`, with no profile component. Governance is therefore switched per **DSH home/user**, not per profile, although §28.6 and the surrounding prose describe switching "for a profile". Decide whether the default path should include a profile component (and how `dsh-ieg` discovers it). |
| Q9 | Module descriptor `version` fields | **Decided/closed in 0.8.0 — descriptors now `0.2.0`.** `src/modules/*.ts` (compiled to `lib/modules/*.js`) declare `version: '0.2.0'`, matching this specification's §24 module contracts, so one version is authoritative. The structural regression asserts the shipped descriptor set. |

### 34.3 Accepted boundaries (not open questions)

```text
tool-mediated mutation coverage only, not process-wide          (A4)
shell writes classified from command text; quoted text is data, and an
  indirectly invoked wrapper or PowerShell Remove-Item is not recognised (D13)
a failed `tools` injection is visible only through channel A and the ring, never
  through a tool — IEG cannot offer a tool to explain that its tools failed
delegated questioning is out of scope; the user-attention capability was
  withdrawn in 0.7.0 and nothing replaced it at runtime            (§23.2, §30)
no diagnostics session event while `ignorable` has no write path (§28.4)
IEG cannot report its own mount failure; evidence is external   (D10)
the shipped set is three modules, each claiming one failure class (§24)
```


