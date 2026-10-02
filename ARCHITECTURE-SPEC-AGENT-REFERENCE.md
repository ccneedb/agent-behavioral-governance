---
doc_type: architecture-spec
project: agent-behavioral-governance
version: 0.6.0
status: finalized-for-agent-handoff
revision: editable-prompt-and-diagnostics-mirror
part_a: verified-host-integration-and-prototype-0.1.0
part_b: target-design-abg-0.2.0
part_b_status: implemented-through-the-0.2.0-structural-round; model-backed-gates-c-d-e-pending
verified_against: dsh-v0.2.0-rc.2
verified_method: installed-distribution-source-inspection
audience: agents-only
language: en
host_target: deepseek-harness
host_baseline: dsh-v0.2.0-rc.2
format_note: conservative-machine-readable-markdown
---

# Agent Behavioral Governance — Architecture Specification

> **Audience:** agents implementing, reviewing, or extending this plugin inside DeepSeek Harness. This document is intentionally more implementation-oriented than the Product Specification.
>
> **Two parts.** Sections 1–21 ("Part A") are the verified record of host integration and of the `0.1.0` prototype. Sections 22–34 ("Part B", starting at §22) specify the **target design for ABG v0.2.0**. Part B states where it changes a Part A decision instead of rewriting Part A.

## 1. Architectural Objective

Build a modular governance plugin that supplements DSH's host system prompt while using runtime seams for deterministic enforcement.

The architecture must preserve this invariant:

```text
Host DSH semantics
        ↓
remain authoritative
        ↓
ABG adds project-work governance
        ↓
without replacing host semantics
```

## 2. Host Architecture Facts Relevant to ABG

The current DSH system-prompt service supports ordered prompt sections, runtime contexts, variables, and assembly hooks. Sections are centrally ordered, and the current source exposes named placements such as harness identity, deployment persona prefix, plan policy, team policy, tool sections, subagent tools, deliverable references, structured output, and deployment persona suffix.

Current relevant section order values in the observed `v0.2.0-rc.2` source include:

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

ABG must not assume that a numeric gap automatically has semantic authority. Version compatibility must be checked against the active host.

> **Verification status.** The reconnaissance that §2 and §5 describe as a prerequisite has been performed against the installed distribution. Its results are recorded in **§17 (Verified Host Integration)**, which **supersedes any contradicting statement in §§1–15**, and its consequences for this specification are listed in **§18 (Deltas)**. Unresolved points that must be confirmed before implementation are in **§20**.

The DSH base bundle includes `dsh-agent-instructions`, `dsh-plan-mode`, `dsh-user-questions`, `dsh-subagent`, authorization, filesystem/tool packages, and related first-party components. Therefore ABG should integrate with existing seams instead of rebuilding them.

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
                  │ Agent Behavioral Governance      │
                  │              (ABG)               │
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
                  │                                   │
                  │  user-attention                   │
                  └────────────┬──────────────────────┘
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
        system-prompt      pre-step /       runtime state
        contribution      lifecycle hooks    & diagnostics
```

## 4. Core Composition Pattern

Modules do not independently compete for arbitrary positions in DSH's system prompt.

Preferred composition:

```text
Module A ─┐
Module B ─┤
Module C ─┼──> Prompt Compiler ──> ONE ABG PromptSection
Module D ─┤
Module E ─┘

ONE ABG section + DSH first-party sections
                 ↓
          host prompt assembly
```

The plugin must not use `complete: true`.

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
one additive ABG system-prompt section
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

Questions
  deterministic_blockers[]
  deferred_unknowns[]
  submitted_batches[]

Workspace
  authorized_mutations[]
  observed_mutations[]
```

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

## 7. Module Specifications

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

**Boundary:** DSH plan mode remains the host's planning mechanism. ABG governs project orientation and continuity, not a replacement plan workflow.

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

### 7.4 `user-attention`

**Problem:** deterministic blockers are asked in fragmented interactions.

**Objective:** maximize task progress per user interruption.

**Question classification:**

```text
Candidate question
       │
       ├── autonomously resolvable → resolve
       ├── non-blocking uncertainty → defer
       ├── deterministic blocker → batch
       └── critical uncertainty → ask when necessary
```

Before asking:

```text
collect → deduplicate → dependency-sort → compress → ask once
```

**State duties:** maintain open questions and submitted batches.

**Integration:** use `dsh-user-questions`, whose request type already represents `questions` as an array suitable for related prompts in one flow.

**Important:** a larger batch is not automatically better. Questions that are independent should be grouped when they reduce interruption cost; questions whose answers unlock different future questions should be structured to preserve dependency clarity.

## 8. Runtime Interaction Model

### Request path

```text
User request
   ↓
DSH prepares next step
   ↓
ABG observes / evaluates pre-step
   │
   ├── safe → admit
   ├── state update only → admit with updated governance context
   ├── deterministic policy violation → reject or require remediation
   └── unresolved uncertainty → defer unless blocking
   ↓
DSH assembles model input
   ↓
ABG additive governance section participates in system prompt
   ↓
Model execution
```

### User-question path

```text
Agent discovers question
        ↓
Question Collector
        ↓
classify / deduplicate / defer / batch
        ↓
Need user input now?
    ├── no → continue
    └── yes
         ↓
 dsh-user-questions
         ↓
 one structured batch
         ↓
 answer stored
         ↓
 unblock dependent state
```

## 9. Prompt Compatibility Strategy

The active host system prompt is a moving implementation surface. ABG therefore requires a compatibility adapter.

The adapter should capture at minimum:

```text
host version
available prompt section names
resolved section orders
active ABG placement
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

ABG should request its own host-allocated or safely reserved section placement if DSH exposes one. If no semantic placement exists, the implementation should use a single stable order chosen after inspection and regression testing for the target host version.

The plugin must not claim that its section is inherently higher priority than user messages merely because it is a plugin section.

## 10. Conflict Rules

When ABG overlaps with host instructions:

```text
host instruction defines capability/semantics
        ↓
ABG supplements behavior around that capability
```

Examples:

```text
Host: plan mode explains planning behavior
ABG: preserve project intent and terminology while planning

Host: permission system controls approval
ABG: classify which project mutations should require approval

Host: user-question service handles interaction
ABG: consolidate the questions before using the service
```

If a module would need to contradict a host semantic to achieve its objective, the module must be changed or disabled; it must not silently override the host.

## 11. Prompt Budget

The ABG prompt should be short, stable, and high-signal.

Rules:

- avoid repeating DSH tool instructions;
- avoid copying host identity/persona text;
- avoid repeating plan-mode documentation;
- avoid embedding complete project state;
- avoid restating every enforcement implementation detail;
- prefer compact invariants and trigger conditions.

Detailed state belongs in runtime structures, and deterministic checks belong in hooks.

## 12. Diagnostics

Diagnostics should expose at least:

```text
module_enabled
module_conflict
host_compatibility
prompt_assembly
question_batch_created
question_deferred
question_submitted
workspace_mutation_allowed
workspace_mutation_blocked
information_invalidated
information_reintroduced
```

Diagnostics must make it possible to investigate failures without relying only on model-generated prose.

## 13. Security and Safety Boundaries

ABG is not a replacement for DSH authorization, sandbox, permission, credential, or safety controls.

A governance rule should become a hard block only when the host offers an appropriate deterministic mechanism and the plugin can establish the necessary authority context.

For uncertain authority, prefer a safe refusal to mutate over pretending the user has authorized the operation.

## 14. Versioning

ABG versioning should distinguish:

```text
ABG semantic version
host DSH compatibility range
module versions
prompt versions
state-schema versions
```

Any host release that changes relevant prompt sections, hooks, or question APIs should trigger compatibility review.

## 15. Implementation Sequence

```text
Phase 0 — host reconnaissance
    ↓
Phase 1 — kernel + prompt aggregation
    ↓
Phase 2 — project-governance + information-integrity
    ↓
Phase 3 — user-attention batching
    ↓
Phase 4 — workspace governance enforcement
    ↓
Phase 5 — regression/evaluation harness
```

## 16. Reference Basis

- DSH system prompt source: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/src/index.ts
- DSH system prompt subsystem: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md
- DSH user-question subsystem: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/user-questions.md
- DSH workspace instruction package: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/agent-instructions/README.md
- DSH plan mode: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/plan.md
- DSH base bundle package composition: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/package.json

## 17. Verified Host Integration

> **Status of this section.** It records host facts read from the installed distribution rather than from the planning assumptions in §§1–15. Where it contradicts an earlier section, **this section governs**. Every seam below is traceable to a type declaration or implementation site in the installed packages; nothing here is inferred from prose documentation alone. The reconnaissance task of `IMPLEMENTATION-VALIDATION-HANDOFF.md` §2 is hereby satisfied.

### 17.1 Verification basis

```text
distribution   @deepseek-ai/dsh              0.2.0-rc.2
install root   <dsh>/node_modules/@deepseek-ai/
method         direct inspection of lib/types/*.d.ts and lib/*.js
```

The declared baseline `dsh-v0.2.0-rc.2` **matches** the installed host, and every URL in §16 resolves. One citation-style correction is required: §16 cites monorepo source paths, but a runtime plugin imports **published package names**. `packages/core/system-prompt/src/index.ts` is published as `@deepseek-ai/dsh-system-prompt`; `packages/interaction/user-questions` as `@deepseek-ai/dsh-user-questions`. Plugin code must import package names and never repository paths.

A second correction: the host ships **no public plugin-authoring façade** for the seams ABG needs. ABG is an ordinary Cordis plugin that subscribes to first-party events and registers first-party services.

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
| Placement | `ctx.systemPrompt.getSectionOrder(name)` resolves only the enumerated `PromptSectionOrderName` values. **There is no plugin-allocatable placement.** ABG must pass an explicit finite numeric `order`. Non-finite orders throw. |
| `complete: true` | Exists and matches §4's prohibition: assembly restores a single effective complete section as the *sole* prompt section, and **more than one effective complete section makes assembly fail**. ABG must never set it. |
| Dynamic text | `text` may be a provider evaluated per assembly with `AssembleContext`, which is merge-extended by `@deepseek-ai/dsh-agent` to carry **`agent?: Agent`** and `scope?: ScopeKey`. ABG's governance section can therefore vary per agent — this is the correct seam for P3 (stable policy, dynamic state). |
| Rotation hazard | `renderPrompt` interpolates strict `{{variable}}` references and **throws** on malformed, unknown, or undefined ones. A lone `{{` without a later `}}` is literal. ABG prompt text must either escape brace pairs or set `interpolate: false`. Variable names must match `[a-z][a-z0-9_]*`. |
| Assembly waterfall | `system-prompt/assemble` is a scope-filtered expert waterfall over the assembled sections, contexts, tools, and variables. It is the correct place for ABG's **compatibility adapter** to observe real section names, resolved orders, and assembled-prompt hashes for §9 — a listener cannot replace a registered complete section. |
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

1. **`ToolExecution` carries no input-rewriting capability.** Its fields are `callId`, `rootCallId`, `name`, `schema?`, `arguments`, `agent?`, `parent?`, `signal`, `token`, and the host documents that input rewriting is excluded because arguments are already logged and presented. ABG can **allow, deny, cancel, ask, or annotate** a call — it cannot silently repair its arguments.
2. **System-prompt and runtime-context assembly happen *before* `agent/pre-step`.** §8's request path must therefore be read as: prompt contribution is a *registration-time* concern, and pre-step is an *admission* concern. ABG cannot inject governance prose into the current step through `agent/pre-step`; it returns `messages` instead.
3. **`ctx.approval` is the permission model; `ctx.authorization` is not.** `ctx.authorization` is a *credential-obtaining flow registry* whose verdict vocabulary is `'authorized' | 'cancelled'` about credential records. Policy decisions flow through `ctx.approval` (`ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`, where `'allowed-once'` is the only grant) and `approval/request` is a scope-filtered waterfall. Returning `PreToolDecision.ask` makes the tool registry resolve the human prompt through `ctx.approval` on ABG's behalf, preserving fail-closed behaviour, audit pairing, and session policy.

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
- The `fs/*` events are **dispatched unbound and are not scope-filtered**. ABG receives every session's events and must narrow itself via the actor's agent session.
- The intent slot is **first-wins by registration order**, and the shipped `dsh-fs-observation-policy` never calls `next()`. An ABG listener registered *after* it is unreachable. ABG must register ahead of it and must call `next()` to observe without stealing the slot.
- The intent events are dispatched by the **tools** (`dsh-tool-fs`, `dsh-tool-str-replace-editor`), not by the filesystem provider. A plugin calling `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses `tools/*` entirely.
- Containment is not ABG's concern. `ctx.sandboxPolicy.resolve({session})` returns the effective `{mode, workspaceRoot, sessionId}`; `dsh-fs-sandbox` re-canonicalizes and enforces writable roots. ABG must never compute containment itself.

Therefore §7.2's "Boundary: do not reimplement filesystem permission semantics" is strengthened: ABG's mutation governance is **tool-mediated mutation governance**. The direct-`ctx.fs` gap is recorded as assumption **A4** in §20.

### 17.5 User-question seam

§7.4's integration target is `ctx.userQuestions` (`@deepseek-ai/dsh-user-questions`): `ask(request)` and `askTimed(request, callId, timeoutMs)`.

Verified facts that materially narrow the `user-attention` module:

| Fact | Consequence for ABG |
|---|---|
| `questions: AskUserQuestionItem[]` is an array and each item carries a caller-supplied stable `id` echoed in the answer. | Batching is supported **within one `ask()` call** — PR-04 is achievable without inventing a transport. |
| There is **no** cross-request merging. The client renders **one pending request at a time**; later requests surface only after the earlier resolves. | Consolidation must happen **before** the call is made, not by merging pending requests. |
| `answer()` rejects a batch that does not name **each of that call's questions exactly once** (`BAD_ANSWER`). | ABG cannot partially answer or re-batch an already-open request. |
| No API exists for continuous deferral, deduplication, dependency/unlock, or abandoning a question. Timed questions (`askTimed`, `mode: 'timed'`) are the only host mechanism that releases the agent while a question stays answerable. | §7.4's "collect → deduplicate → dependency-sort → compress → ask once" must be **ABG-owned state**, and `askTimed` is the correct primitive for PR-05's deferred uncertainty. |
| Asking requires the exact live **runtime root** agent; a child raises `DELEGATED_CALLER`. | Question consolidation is a root-agent capability, so delegated questioning lies outside ABG's scope. |
| `user-questions/request` is an agent-scoped waterfall; an answerer returns an answer or delegates. | This is the observation/interception point for §12 diagnostics — not a merging point. |
| `AskUserQuestionItem` vocabulary is selectable options plus optional free text (`custom`), with `multiSelect`; skipped items are preserved as `{id, selected: []}`. | Richer interaction shapes have no seam vocabulary and are out of scope. |

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

Compaction does not delete anything: it appends a replacement `user/message` carrying a `surfaceOp` that shadows a range of surface nodes. Non-surface (log-only) events are never shadowed. There is **no pin/preserve seam**, so ABG must treat compaction as a derived-history event only.

Selection rule for ABG: **authoritative governance state belongs in `ctx.storageDomain`**; **model-visible or derivable per-session state belongs in a log-only event folded by a registered projection**. The decisive reason is that a plugin event cannot be marked `ignorable` — the envelope is built by `Session.append()` from `type`, `seq`, `time`, `data`, and surface metadata only, and no code path in the installed distribution writes the marker. An ABG event type is therefore *required*, so a log written with ABG loaded cannot be reconstructed by a composition without ABG. This makes log-based ABG state composition-coupled by construction; see assumption A3 and §20.2 item 1.

### 17.7 Scope and per-agent isolation

`ScopeKey = object` is an opaque, identity-compared token; `Scoped<T>` is a routing-only receiver; `scopeOf(ctx)`, `createScope`, `scopeTarget`, and `scopeChainOf` are the tools. Registration views inherit **down** the chain while event admission extends **up** it.

Two facts decide §5.3's state design:

1. **Per-agent scope key is the agent object itself**, and `AssembleContext` already carries `agent` and `scope`.
2. **Only scope-aware APIs isolate state.** A plain `Map` inside a plugin is process-global merely because it is reached through a scoped context. Per-agent state requires `ScopedLayers` filed by `scopeOf(ctx)`, with registrations made through the agent-scoped context.

The host's own precedent is `SystemPrompt`, whose section/context/variable layers are a `ScopedLayers` instance; ABG's kernel should mirror that shape for project state rather than inventing a keyed cache.

### 17.8 Diagnostics, invariants, and version compatibility

| Need | Verified seam |
|---|---|
| Structured diagnostics (§12) | Cordis events plus a plugin-owned session event folded by a projection; §12's event names are ABG's own vocabulary and are not reserved by the host. |
| Self-check | `ctx.invariants.register(packageName, installer)` from a `./invariant` companion (`name` / `inject` / `apply`). Invariants are **observer-only and cannot veto**; a violation throws an `InvariantError` attributed to the owning package. `dsh-base` does **not** mount the registry, so a companion runs only in compositions that opt in. |
| `dsh-hook-protocol` | A **library**, not a plugin lifecycle seam: it defines the Claude Code / Codex hook wire protocol and its bridges are ordinary plugins that listen on `tools/pre-execute`. ABG must use native Cordis events directly. |
| Version compatibility (§14, PR-06) | An npm plugin declares its DSH peer range; installation **and** profile startup enforce it, refusing with `incompatible-version` and the unsatisfied peers. Exemptions live in the profile's own `compatibility.json` (`package-name@version` → exact DSH runtime versions) and are granted through the `plugin_manager` tool or `dsh plugin … allow-version`. |
| Packaging | ABG ships as an npm package with a bundle patch (`dsh.bundle.patch` → `cordis.patch.yml`) selected from the profile's `dsh.profile.bundles`. Patch rows are addressed by `id` with last-write-wins per row. |

### 17.9 Seam responsibility matrix

```text
ABG need                     host seam                        enforcement
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
question consolidation       ctx.userQuestions.ask            advisory + gate
deferred uncertainty         ctx.userQuestions.askTimed       advisory
per-session governance state sessionProjections + own event   durable
authoritative state          storageDomain                    durable
self-check                   invariants companion             observe only
```

### 17.10 Confirmed empirically while building the prototype

The claims below were not read from a declaration file; they were observed by
installing a working plugin into a real profile and booting it. They are the
strongest evidence in this document, and two of them change the design.

1. **Section contracts behave exactly as documented.** Registering two effective
   `complete: true` sections makes `assemble()` reject. ABG's own section at
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

Two observed host behaviours materially affect ABG:

5. **A failing plugin entry is non-fatal.** When a plugin throws during
   composition, DSH reports `warning: N entry did not activate`, prints the
   attributed error, and **continues booting**. A governance layer that fails to
   mount therefore degrades silently rather than stopping the session. ABG must
   be observable from outside its own process (see D10), not assume that a mount
   failure aborts the run.

6. **No shipped composition exports Cordis logs.** `ctx.logger` buffers
   messages (`logger.buffer`) but the stock profiles mount **no exporter**, and
   no DSH package mounts the Cordis `Logger` plugin. `ctx.logger.info(...)` is
   therefore invisible by default. ABG's §12 diagnostics — currently emitted
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
| D5 | §7.4 Integration; PRODUCT-SPEC PR-04 | The `questions` array batches **within one call only**; there is no cross-request merge, deferral record, dedup, dependency, or abandonment API. Consolidation is ABG-owned state; `askTimed` implements deferred uncertainty; consolidation is root-agent-only. |
| D6 | §11, §13 | §13's "prefer a safe refusal to mutate" is concretely implementable as a monotonic `ToolGuard`. State it as the preferred mechanism rather than an aspiration. |
| D7 | §2, §16 | Package-name imports, not repository paths. `ctx.authorization` is credential flows, not the permission model; the permission path is `ctx.approval` + `tools/pre-execute`. |
| D8 | §12 Diagnostics | `dsh-invariants` is observer-only and not mounted by `dsh-base`; diagnostics must not depend on it, and §12's event names are ABG vocabulary rather than host-reserved names. |
| D9 | §12 Diagnostics, §5.1 | `ctx.logger` is buffered but **not displayed** in stock compositions, because no shipped profile mounts a Cordis logger exporter. Diagnostics must not rely on logging alone. Emit them through a channel the deployment can actually observe — a plugin-owned durable record, a session event, or an explicit exporter — and treat the log as best-effort narration. |
| D10 | §13, §15, §10 | A plugin that throws during composition is reported as `warning: N entry did not activate` and the session continues. Acceptance gates must therefore assert **positive** evidence that ABG mounted and enforced, not merely that the process started without a fatal error. |
| D11 | §7 module `principles` / `prompt`, §11 Prompt Budget | The §11 content rules must be **enforced by an executable conformance test**, not left to intent. Auditing the compiled prompt found three defects that structural tests could not catch: (a) one kernel principle (P7) was addressed to the plugin author rather than to the agent, i.e. implementation leakage; (b) **every** module's prose fragment restated its own principles, so §5.2's dedupe requirement was unmet and the fragment added only prompt cost; and (c) the `workspace-governance` fragment instructed the model to perform the check that `tools/pre-execute` and `ctx.tools.guard` already enforce, while additionally implying that "an existing project convention" authorizes a write — a channel the gate does not honour, so prompt and enforcement disagreed about what counted as authorization. Fragments must add guidance the principles do not, and must never restate an enforced rule. |
| D12 | §5.3, §7.1, §7.2, §8 | The two acceptance objectives the plugin is judged on — unprompted orientation (OBJ-1) and workspace-hygiene management (OBJ-2) — are not reachable by prompt text alone, and the design's existing mechanisms did not cover them. Three additions are required: (a) **an orientation-capture tool plus a gate**, because §5.3 defined project state with no way to populate it, making `orientationGate: 'reject'` permanently unsatisfiable; (b) **a document-overlap gate**, because "check for overlap before creating a file" is mechanically checkable and P7 prefers that over prose; and (c) **a subject-level overlap signal**, added after the behavioural evaluation showed a body-similarity check failing on the real failure mode. Two control runs each created an `AUTHENTICATION.md` that re-stated a topic `SPEC.md` already had a section for, while scoring only ~0.14 body similarity against it — under any Jaccard threshold the duplicate would have passed. Comparing the proposed **filename subject** against the existing document's headings catches it (both observed duplicates now flagged), and is what makes the gate worth having rather than decorative. |
| D13 | §7.2 Enforcement, §13 | **Shell tools must not be classified as ABG mutations.** Listing `bash`/`pwsh`/`*_persistent` in `mutatingTools` gates *every* shell command, because the gate sees only an opaque command string — so `ls`, `grep`, and `node --test` all become "persistent workspace mutation". Under `policy: 'ask'` in a composition with no approval channel (headless, CI) that denies the agent its entire shell. It also duplicates host semantics, since `dsh-bash-sandbox` plus the sandbox policy already confines shell writes, which P1 forbids. ABG governs **file-effect** tools, where `(name, arguments)` is unambiguous. This defect was only visible once the plugin was mounted in front of a real agent; it could not have surfaced in the prompt-only trials. **Amended 2026-10-02 — see the D13 amendment note below this table.** |
| D14 | §7.3, §7.2 | **Deletion is the required disposition, and ABG must not make it harder than creation.** The acceptance requirement is literal: information established as *wrong* must always be deleted rather than annotated as wrong (an annotation still leaves it pickable), and *outdated* content must also be deleted — except in an IT-development workspace, where version history matters and it must instead be marked explicitly as outdated. That contradicts an earlier ABG stance in which correcting or superseding in place was acceptable, and it compounds with D13: while shell tools were gated, `rm` required approval, so the plugin pushed *against* the objective it was meant to serve. The `information-integrity` prompt now states the distinction, and the narrowed shell classification (D13 amendment) is what lets removal proceed under the configured policy without gating every shell call. |
| D15 | §5.3, §7.1, §9 | **Gate F requires durable state, and it does not require a schema library.** All ABG ledgers were created inside `apply()`, so a resumed, forked, or restarted session began with no orientation and re-imposed the requirement on already-oriented work. Orientation is now persisted per session through `ctx.storageDomain`. The expected obstacle — `domainTable` taking a `ZodType`, forcing the plugin's first external import — does not exist: `domainTable` is a one-line wrapper and the host reads a record through exactly one call, `tableSpec.valueSchema.parse(raw)`. Supplying a small object with a real `parse` satisfies the contract, so the package keeps the property that **every import is relative**. Two constraints carry forward: domains have no migration facility, so `DOMAIN_VERSION` may only change with a deliberate migration decision; and persistence must fail open, because governance enforcement must never depend on storage being available. |

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

- **A1 — Delivery form.** ABG ships as an out-of-tree npm plugin with a bundle patch, mounted through a profile's `dsh.profile.bundles` / `cordis.patch.yml`, and declares a DSH peer range. It is not a first-party package.
- **A2 — Section order.** ABG occupies one explicit numeric `order` with no host-allocated slot, selected after regression testing per §10 and recorded in the compatibility adapter.
- **A3 — State store.** Authoritative governance state goes to `ctx.storageDomain`. Per-session derived state may use a log-only event plus a registered projection, but **only** as composition-coupled state: because the `ignorable` marker has no plugin-facing write path (§20.2 item 1), an ABG event type is required, and a session recorded with ABG loaded cannot be reconstructed without ABG. Nothing whose loss or non-portability would change reconstructed semantics is stored in the log.
- **A4 — Mutation coverage.** Mutation governance covers **tool-mediated** mutations only. A plugin calling `ctx.fs.writeText()` directly dispatches no `fs/*` events and bypasses `tools/*`; ABG does not claim process-wide write coverage.
- **A5 — Diagnostics availability.** An ABG invariant companion runs only where the composition mounts `dsh-invariants`, and `ctx.logger` output is only visible where the composition mounts a Cordis logger exporter; `dsh-base` does neither. Enforcement must not depend on either, and §12 diagnostics need an observable channel (D9).
- **A6 — Root-only questioning.** Question consolidation is available only to live runtime root agents; delegated questioning is therefore outside ABG's scope.
- **A7 — Fixed baseline.** All §17 facts are scoped to `@deepseek-ai/dsh` `0.2.0-rc.2`. The compatibility adapter must re-verify them on any host change per §14.

### 20.2 Items requiring confirmation or host clarification

1. **The `ignorable` marker has no plugin-facing write path (highest priority, now verified).** The persisted event envelope carries `ignorable?: true`, which lets a reader skip an unrecognized event type; **absent means required**, and a reader meeting an unrecognized required type must refuse to reconstruct the session. `Session.append(type, data, …)` constructs the envelope as `{type, seq, time, data, …surfaceMetadata}`, where the surface metadata is limited to `sourceEventSeqs` and `surfaceOp`. Its declared `opts` rest parameter accepts a `SurfaceIntent` only for surface events, so a non-surface plugin event cannot carry the marker. An exhaustive search of the installed distribution finds **no code path that writes `ignorable`** — every occurrence is a validator, format migration, or client schema that reads it.

   **Consequence.** A log-only event type authored by ABG is required by construction. A session recorded with ABG loaded can therefore not be reconstructed by a composition without ABG: the read path must refuse it. The host's own note that "downstream (out-of-repo) plugin events are outside this list by construction" makes the marker the intended mechanism, but the public append path does not expose it. Until the host provides a write path or an explicit exemption, **ABG must not treat its own session events as an authoritative, portable store**. This is the decisive argument for directing authoritative governance state to `ctx.storageDomain`, which is model-invisible, compaction-immune, and not coupled to session reconstructability.
2. **Section order value.** Confirm the chosen numeric `order` and the regression test that fixes it.
3. **Approval authorship.** Confirm that ABG gates mutations by returning `PreToolDecision.ask` and never registers its own `approval/request` answerer, since a deployment composes one terminal answerer and sibling listener order is not a policy-priority mechanism.
4. **Optional integration with `dsh-agent-instructions`.** DSH already loads the `AGENTS.md` / `CLAUDE.md` chain, enforces a byte budget, and emits removal notices for changed or deleted instruction files. Confirm that ABG references this as the workspace-instruction authority rather than restating it in its own prompt section.

## 21. Prototype Realization

A working prototype of this specification lives in [`plugin/`](plugin/README.md) as
`dsh-agent-behavioral-governance` `0.1.0`. It exists to make the §17 seam
bindings falsifiable rather than merely asserted.

> **v0.2.0 addendum.** The plugin is now `version: 0.2.0` (still `"private": true`).
> Per-agent state, the diagnostics channels, the compatibility adapter, the
> read-only status and question surfaces, the packaging artifacts, and the
> simulated gate-precision matrix have landed since this table was written, so the
> table below records the `0.1.0` state and §33 carries the current phase status.

| Aspect | Status |
|---|---|
| Kernel, module contract, dependency resolution, conflict detection (§5.1, §6) | implemented |
| Prompt compiler, dedup, budget, interpolation safety (§5.2, §11) | implemented |
| All four modules' logic (§7) | implemented |
| One additive prompt section (§4) | implemented; verified against the real `dsh-system-prompt` |
| `tools/pre-execute` gate + `ctx.tools.guard` backstop (§7.2) | implemented; verified against the real `dsh-tools` |
| `agent/pre-step` gate (§7.1) | wired and unit tested; live dispatch not exercised |
| Runtime question consolidation (§7.4) | collector implemented and unit tested; not yet wired in front of `ctx.userQuestions` |
| Per-agent state (§17.7) | not implemented; orientation is per-composition in the prototype |
| Prompt-content conformance (§2 and §10 of the handoff, D11) | implemented as an executable suite covering failure-class coverage, §5.2 dedupe, the §10 DO/DON'T rules, and the §11 budget ceiling |
| Packaging, bundle patch, install, composition, mount | verified end to end against `@deepseek-ai/dsh` `0.2.0-rc.2` |

The prototype has **zero runtime dependencies**, imports no first-party package,
and declares the slice of the host runtime it uses in a single ambient contract
file, so the seams it depends on are auditable in one place. It also carries a
deliberate constraint that follows from this specification: it never sets
`complete` on its section.

Reproduce the whole evidence chain with `plugin/scripts/verify.sh`, and the
behavioural suite with `npm test` in `plugin/`.

---

# Part B — Target Design: ABG v0.2.0

> **Status.** Part B is a design specification for review and subsequent
> implementation. It is grounded in Part A's verified seams and in the
> `0.1.0` prototype's evidence, and it records the open items it does not
> decide in §34. It does not implement itself, and it does not retroactively
> rewrite Part A.

## 22. Target Design v0.2.0 — Scope, Versioning, and Governing Decisions

### 22.1 Purpose

ABG v0.2.0 is the first release intended to be **operable and reviewable**
rather than merely **demonstrably mounted**. Part A proved the seams and the
prototype proved that one mechanism changes agent behaviour. Part B makes the
layer diagnosable, host-aware, per-agent correct, and releasable.

The §1 invariant is carried unchanged: host semantics remain authoritative,
ABG contributes exactly one additive section, and `complete` is never set.

### 22.2 Scope — release blockers

| # | `MAINTENANCE-HANDOFF.md` §4 blocker | v0.2.0 disposition | Section |
|---|---|---|---|
| 1 | Diagnostics are invisible | closed — four-channel diagnosability | §28 |
| 2 | No compatibility adapter (PR-06) | closed — observation-based adapter | §29 |
| 3 | False positives unmeasured | closed — gate-precision evaluation | §32.4 |
| 4 | Module 5 unverified; module 3 structurally blocked | module 5 **removed** (§23); module 3 wired at runtime, end-to-end measurement pending (**Gate D**, §30.4) | §23, §30 |
| 5 | Evidence is narrow | widened — more reps, blind judging, second model | §32.5 |
| 6 | Not a publishable package | closed — packaging and release policy | §31 |
| 7 | Intrusive defaults chosen unilaterally | **closed** — non-intrusive defaults implemented: `requireBeforeMutation` defaults to `false` in `lib/kernel/config.js` and `cordis.patch.yml`, and strict mode is an explicit opt-in (§34.2 Q1) | §34.2 |

`MAINTENANCE-HANDOFF.md` §8's ranked backlog is the input to this table; where
the backlog and this table differ, this table governs for v0.2.0.

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
- **Zero first-party imports.** `plugin/lib/contract.d.ts` remains the only
  record of host API shapes and grows to cover the new seams. The plugin stays
  immune to the profile's module-resolution layout.
- **Fail-open** for every optional capability: storage, filesystem, approval.
  Governance enforcement never depends on an optional service being present.
- **Deterministic enforcement over prompt text** (PRODUCT-SPEC P7). A rule that
  is mechanically checkable is enforced by a seam, and the prompt must not
  restate it (D11).
- **Diagnose before destructive remediation** (PRODUCT-SPEC P8). After the
  withdrawal in §23, the only destructive action ABG still governs is
  information deletion, and it is governed by the D14 distinction, not by a
  blanket rule.
- **Shell tools stay out of `mutatingTools`, but shell writes are classified**
  from command text (D13 amendment, 2026-10-02). ABG governs file-effect tools as
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
| `plugin/README.md`, `eval/README.md` | implementation and evaluation specifics | low |

Verdict: **substantial overlap** with the architecture specification.
Consequently the target design is merged here as Part B rather than created as
a new document, and the three partial overlaps are corrected in place
(`PRODUCT-SPEC.md` and `IMPLEMENTATION-VALIDATION-HANDOFF.md` amendments, and
supersession notes in `MAINTENANCE-HANDOFF.md`). One workspace artifact is
preserved, and no document restates another's primary content.

## 23. Withdrawn Scope — `child-agent-lifecycle`

ABG previously planned a fifth module, `child-agent-lifecycle`, addressing
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
quality row, and the old success criterion 4) are removed. Remaining identifiers
were renumbered, so no document carries a gap or a dangling reference. The
plugin now ships **four** modules and compiles a governance section of 3,459
bytes, down from 3,905.

**Accepted boundary.** Delegated questioning stays ungoverned: only a live
runtime root agent may call `ctx.userQuestions.ask` (a child raises
`DELEGATED_CALLER`), and ABG no longer harvests a child's unresolved question
through the child's final result. Re-opening that boundary is a design decision,
not an implementation detail; the `user-attention` module must not reintroduce it
implicitly.

## 24. Target Module Set and Module Contracts

### 24.1 Set

| Module | Version | Problem | Failure class | Risk | Enabled by default |
|---|---|---|---|---|---|
| `project-governance` | 0.2.0 | the agent advances without a stable project model | `FC-2.1` | low | yes |
| `information-integrity` | 0.2.0 | known-invalid information stays reusable | `FC-2.3` | medium | yes |
| `user-attention` | 0.2.0 | deterministic blockers are asked one at a time | `FC-2.4` | low | yes |
| `workspace-governance` | 0.2.0 | unauthorized persistent mutation | `FC-2.2` | high | yes |

The §6 module contract is unchanged, including the ABG `addresses` extension.
The conformance suite asserts that each failure class is claimed by **exactly
one** enabled module.

### 24.2 Per-module v0.2.0 contracts

**`project-governance` — 0.2.0**

```text
state        orientation {intent, objective, scope, terminology, constraints,
             assumptions, unknowns, currentPhase, recordedAt}
scope        per live agent, persisted per session (§25)
enforcement  tools/pre-execute orientation requirement
             agent/pre-step gate (off | warn | reject)
tools        record_orientation — accepts partial updates, records provenance
v0.2.0 delta state is per agent, not per composition; a partial update no longer
             erases fields the agent already recorded
tests        unit (state merge, gate evaluation), wiring, real-registry integration
```

**`information-integrity` — 0.2.0**

```text
state        information[] {ref, status, provenance, updatedAt, supersedes?}
statuses     AUTHORITATIVE | PROVISIONAL | SUSPECT | INVALID | DEPRECATED |
             SUPERSEDED | PENDING_CONFIRMATION
transitions  promotion to AUTHORITATIVE requires evidence or user confirmation;
             demotion is unrestricted
enforcement  gate a promotion attempt that carries no evidence and no user
             confirmation (new in v0.2.0); ABG itself never deletes information
prompt duty  wrong information is deleted; outdated information is deleted
             except in an IT-development workspace, where it is marked
             explicitly outdated (D14)
tests        transition table, promotion gate, resume/fork recovery
```

**`user-attention` — 0.2.0**

```text
state        questions[] {id, text, kind, dependsOn[], status, askedIn, answer},
             deferred[], batches[]
kinds        deterministic_blocker | critical_uncertainty |
             non_blocking_uncertainty
enforcement  batch-completeness gate on ask_user_question (existing);
             redundancy gate — a question already answered is refused;
             abg_questions read-only tool (new)
runtime      §30
tests        collector unit tests, gate tests, timed-defer path, answerer-backed
             end-to-end measurement
```

**`workspace-governance` — 0.2.0**

```text
state        authorized[], observed[], blocked[]
enforcement  tools/pre-execute classify + gate on file-effect tools;
             shell writes classified from command text, quoted text as data
             unless the command wraps another command (D13 amendment);
             ctx.tools.guard monotonic deny backstop;
             document-overlap gate (body similarity, identical H1, filename
             subject, prefix matching)
observation  fs/write-intent and fs/edit-intent record the concrete target when
             the composition dispatches them — config-gated, must call next(),
             and must be registered ahead of dsh-fs-observation-policy, whose
             first-wins slot never calls next() (§17.4)
boundary     tool-mediated mutations only (A4); direct ctx.fs writes are not
             covered and ABG does not claim process-wide coverage
tests        classification, guard ordering, overlap detector, real-fs
             integration, gate precision (§32.4)
```

## 25. Scope-Isolated Governance State

### 25.1 Problem

Part A D15 and §17.7: the `0.1.0` prototype holds orientation once per
composition. Two concurrent agents share one orientation, a second session can
satisfy the first session's gate, and question ledgers merge. That is a
correctness defect, not a cosmetic one.

### 25.2 Design

```text
live state      WeakMap<Agent, AgentGovernanceState>
                identity-keyed; released when the agent is collected
durable state   ctx.storageDomain tables, keyed by session id
```

- Every seam already carries the live subject: `AssembleContext.agent`
  (merge-extended by `@deepseek-ai/dsh-agent`, verified), `agent/pre-step`
  `payload.agent`, `tools/pre-execute` `exec.agent`, `tools/result`, and the
  `fs/*` actor.
- `AgentGovernanceState = {orientation, questions, workspace, information,
  diagnostics}`.
- Hydration: the first seam touch for an agent performs one `load(sessionId)`;
  a resumed session restores its orientation and is not asked to re-orient
  (Gate F).
- Isolation is a test, not a claim: two live agents in one composition must be
  unable to observe each other's orientation, questions, or workspace ledger
  (§32, Gate H).

### 25.3 Why a `WeakMap` and not `ScopedLayers`

§17.7 recommends mirroring `SystemPrompt`'s `ScopedLayers` shape. Doing so
requires importing `@deepseek-ai/dsh-scope`, which breaks ABG's zero
first-party-import property and its immunity to the profile's module-resolution
layout.

v0.2.0 keys live state by the **agent object identity**, because §17.7's own
verified finding is that the per-agent scope key *is* the agent object. Identity
keying therefore yields the same isolation and adds GC safety. The cost is that
ABG does not inherit scope-chain semantics, which it does not need: every piece
of ABG state is strictly per agent.

This is a deliberate deviation from §17.7 and is listed for confirmation in
§34.2. If ABG ever accepts a first-party import, the migration is
`ScopedLayers` filed by `scopeOf(ctx)`.

### 25.4 Durable schema

```ts
domain { name: 'abg_governance', version: 1, layout: 'per-record' }
table 'sessions'    key: sessionId    value: { payload: string }
record: {
  v: 1,
  orientation: object | null,
  questions: object[],
  deferred: object[],
  workspace: { authorized: object[], observed: object[] } | null,
  information: object[],
}
table 'diagnostics' key: sessionId    value: { payload: string }   // bounded ring, newest 200
```

`DOMAIN_VERSION` stays `1`. Adding a table to an existing domain version is
expected to be open-compatible, because the facility builds its record set from
the spec and a new table starts empty; this must be verified before shipping
(§34.1 B5).

Persistence fails open, exactly as in `0.1.0`: an absent facility, a failed
`open`, or a corrupt record degrades to no persistence, and enforcement is
unchanged.

## 26. Kernel Composition, Mount Record, and Teardown

Part A §5.1 is carried, with three additions.

### 26.1 Mount record

`apply()` emits one mount record carrying:

```text
pluginVersion  promptVersion  sectionName  sectionOrder
modules[]      configDigest   capabilities{tools,fs,storageDomain,userQuestions,approval,systemPromptContext}
degraded[]     compatibility  {verdict, hostPromptHash, sectionInventoryHash}
```

The record is emitted as **late as possible** in `apply()`, so a partially
registered plugin is visible as a partially registered plugin. It also carries a
`degraded[]` list — the capabilities whose registration failed or whose seam was
absent — because `mounted: true` alone cannot distinguish a complete mount from a
partial one, and a health check that reads only `mounted` would miss a dropped
enforcement seam.

### 26.2 `apply()` must not throw

Delta D10: a plugin that throws during composition is reported by the host as
`warning: N entry did not activate` and the session continues. ABG therefore
cannot report its own mount failure. Consequences:

- `apply()` validates configuration and registers each capability inside its own
  guarded step, so a configuration fault degrades to a diagnostic instead of an
  unmount.
- A configuration fault mounts an **inert but observable** surface instead: the
  read-only `abg_status` tool and the `abg:status` context line report
  `mounted: false` with the validator's message and an `abg.config_invalid`
  diagnostic, while **no** prompt section and **no** enforcement is registered —
  fail-safe, and visible from the transcript rather than only from boot stderr.
- An absent seam is recorded as `abg.capability_missing` and added to
  `degraded[]`, so a vanished host service is distinguishable from a capability
  ABG never required.
- Logger narration is best-effort everywhere: a deployment whose logger throws
  still gets the ring, the status line, and the tools.
- **Boundary of the guard.** The only statements outside a guarded step are the
  pure in-memory constructors (`createGovernanceState`, `createDiagnostics`) and
  the mount-record literal. They touch no host service and perform no I/O, so
  they cannot be made to fail by a deployment; every statement that does touch a
  seam is guarded.
- **Residual limit, recorded rather than papered over.** If the `tools` injection
  is itself what throws, the read-only `abg_status` surface is precisely the
  capability that failed, so the loss is visible only through channel A's warning
  count and the durable ring — never through a tool. ABG cannot fix this from
  inside: a plugin that cannot register tools cannot offer a tool to say so.
  Likewise, in a composition where **both** `systemPrompt` and `inject` are
  absent, neither observation channel exists; that composition is unreachable on
  a real host, because Cordis gates the plugin on `inject: ['systemPrompt']` and
  `inject` is a core context method. Both limits were measured
  (2026-10-02) and neither is a regression.

**Status: implemented 2026-10-02.** `lib/index.js` wraps the kernel build and
every registration (`systemPrompt.section`, `systemPrompt.context`,
`system-prompt/assemble`, `agent/pre-step`, `tools/pre-execute`, `tools`,
`storageDomain`, `dispose.storageDomain`, and each tool definition) in guarded
steps; the fault surface is `mountConfigFaultSurface()`. `verify.sh`'s check 5
proves the behaviour against the **installed** copy of the package, and
`test/integration/wiring.test.js` covers the same contract in-process.
- A genuine unmount is observable only from outside the plugin — the transcript
  either contains the ABG section, tools, and status line or it does not. The
  acceptance tests therefore assert **positive** evidence (§32, Gate A/G), never
  merely that the process started.

### 26.3 Teardown

Every registration is collected as a Cordis disposer and released when the row
unmounts. A unit test asserts that after disposal no gate decision, no
diagnostic, and no context contribution is produced.

## 27. Prompt Compilation and Content Rules (v0.2.0)

- One section, one aggregation point (§4). No module registers its own section.
- Section text may vary per agent through the `AssembleContext.agent`
  merge-extension, but only for **bounded** dynamic state — orientation
  presence, an open-question count, never transcript or document content. If
  per-agent variation is not enabled, the provider returns one compiled string
  and the section is byte-identical for every agent.
- `interpolate: false` (D3). `complete` is never set.
- `PROMPT_VERSION` is recorded in diagnostics, not injected into the text.
- **Budget — recorded footprint (§34.1 B6), implemented.** After the §23
  withdrawal the compiled section measures **3,459 bytes** over four modules.
  `lib/kernel/prompt-compiler.js` records that measurement as
  `RECORDED_PROMPT_BYTES` and derives the ceiling as
  `min(PROMPT_BYTE_HARD_CAP, max(PROMPT_BYTE_FLOOR, recorded + 10 %))` —
  **3,805 bytes** today, from a 1,400-byte floor and a 4,096-byte hard cap. The
  ceiling is derived from the **recorded** size, never recomputed from the text
  it bounds, so prompt growth cannot silently reset its own budget. `compilePrompt()`
  enforces it, and `test/unit/prompt-compiler.test.js` together with
  `test/unit/prompt-conformance.test.js` assert it from the same constants, so
  the compiler and the conformance suite cannot disagree about the budget.
- The §11 content rules stay **executable** (D11): the conformance suite keeps
  asserting failure-class coverage, §5.2 no-duplication, at least one trigger
  condition per module, no authority claim, no implementation leakage, no
  restatement of a deterministically enforced rule, and the byte budget. It is
  updated to the four-module set.

### 27.1 User-editable prompt (v0.4.0)

The compiled section is generated and **audited**: the conformance suite enforces
§5.2 deduplication, the §10 content rules (no authority claim, no implementation
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
reported as `abg.prompt_override_rejected`): `{{ }}` interpolation syntax, which
is a host-assembly hazard since the section is registered with
`interpolate: false`; and exceeding `DEFAULT_MAX_PROMPT_BYTES` unless
`prompt.allowOverBudget` is set deliberately, in which case the excess is still
reported. An unreadable `prompt.file` is not fatal: it degrades to the compiled
default with `abg.prompt_override_missing`.

**Attribution.** An applied edit yields `PROMPT_VERSION + "+user:" + hash`, so a
behavioural claim still names exactly one text (PR-07).

**Honesty about what is no longer checked.** The soft invariants cannot be
verified on arbitrary user text. They are returned as `promptUnchecked`
(`UNCHECKED_INVARIANTS`) and recorded with `abg.prompt_override_applied`, so no
front end may present a user-edited prompt as an audited one. This is the
mechanism by which the GUI can offer free editing without the project claiming a
guarantee it cannot make.

## 28. Diagnosability Specification

### 28.1 Problem

Delta D9 / blocker 1: `ctx.logger` is buffered but not displayed, because no
shipped profile mounts a Cordis logger exporter. An operator cannot see what ABG
did.

### 28.2 Diagnostic record

```ts
interface AbgDiagnostic {
  seq: number          // monotonic within the plugin instance
  time: string         // ISO 8601
  code: string         // 'abg.*' vocabulary, owned by ABG (§17.8, D8)
  module?: string      // module id when attributable
  sessionId?: string
  agentId?: string
  data?: Record<string, unknown>
}
```

Codes (`§12`'s vocabulary, made concrete):

```text
abg.mount  abg.config_invalid  abg.capability_missing
abg.module_enabled  abg.module_conflict
abg.host_compatibility  abg.prompt_assembly
abg.prompt_override_applied  abg.prompt_override_rejected  abg.prompt_override_missing
abg.diagnostics_export_failed
abg.orientation_recorded  abg.orientation_restored  abg.orientation_required
abg.question_registered  abg.question_batch_created  abg.question_deferred
abg.question_submitted  abg.question_batch_blocked  abg.question_redundant
abg.workspace_mutation_allowed  abg.workspace_mutation_blocked
abg.document_overlap_flagged
abg.information_invalidated  abg.information_reintroduced
abg.error
```

### 28.3 Four channels

| Channel | Mechanism | Visibility | Adopted |
|---|---|---|---|
| A — status line | `ctx.systemPrompt.context({name: 'abg:status', order: <finite>, text})` | operator: durable user-role snapshot in the transcript; model: aware of governance state | yes, if §34.1 B2 verifies |
| B — status tool | read-only model-facing tool `abg_status` | operator: tool call and result in the transcript; model: on demand | yes |
| C — durable ring | `storageDomain` table `diagnostics`, newest 200 per session | operator: after the fact, within the profile; model: via channel B | yes |
| D — log | `ctx.logger.info/warn/error` | only where a deployment mounts an exporter | best-effort narration only; never the primary channel |

Channel A rules: the line is emitted only when the status **materially
changes**, is capped at 200 UTF-8 bytes, never contains document or transcript
content, and is suppressed by the host's `suppressRuntimeContext()` when the
deployment suppresses runtime context — ABG must behave correctly when the
channel renders nothing.

### 28.4 Explicit non-decision

v0.2.0 does **not** add a diagnostics session event. §20.2 item 1 stands: a
plugin-authored event cannot carry `ignorable`, so an ABG event type is required
by construction and a session recorded with ABG loaded cannot be reconstructed
without ABG. Diagnostics are derived, not authoritative, so the ring buffer plus
channel B is the correct store. This is revisited only if the host adds a
plugin-facing `ignorable` write path or an explicit exemption.

### 28.5 Done criteria

- Gate G (§32.2): after a mount, an operator reading only the transcript can
  tell that ABG mounted, which modules are enabled, the compatibility verdict,
  and why the last mutation was blocked. This depends on channel A; if §34.1 B2
  proves that the runtime-context channel cannot be used, Gate G is met by the
  section's presence plus the registered `abg_status` tool, and the residual
  gap — a changed status with no agent-visible trigger — is recorded rather than
  papered over.
- The same channel must also distinguish **four** mount outcomes, not two:
  a complete mount (`mounted: true`, `degraded: []`), a partial mount
  (`mounted: true`, `degraded: [...]` naming each failed or absent capability), a
  configuration fault (`mounted: false` with `configError`), and no mount at all
  (no section, no tool — observable only from outside the plugin, per D10).
  Status: implemented 2026-10-02 (`degraded[]` in the mount record plus
  `abg.capability_missing` for an absent seam).

### 28.6 Optional feedback channel (v0.3.0)

The prototype's blocking evidence is behavioural, so it can only come from real
sessions run by volunteers. A tester who observes a deviation must be able to
report it **in one step**, from inside the session, without assembling environment
details by hand.

**Design.** One additional read-only tool, `abg_report_issue`, registered in the
same guarded step as the other tools. It is a *kernel capability*, not a fifth
governance module: feedback is not a failure class, and adding a module would
disturb the §24 failure-class coverage contract for no governance benefit.

Two properties are the whole design:

1. **It never files anything by itself.** `feedback.mode: url` (the default)
   composes a prefilled `github.com/<owner>/<repo>/issues/new` link and the
   markdown body; no network call is made and no credential is read. A human
   decides to submit. `mode: api` is strictly opt-in, reads its token from the
   environment variable named by `feedback.tokenEnvVar` (default
   `ABG_GITHUB_TOKEN`) — never from configuration, which is committed and shared —
   and **fails open**: an absent token, a refused request, or a network fault
   returns the prefilled link instead of an error.
2. **Redaction by construction.** Diagnostic entries are reduced to
   `code`/`time`/`module`; `data` (which can carry paths or free text), agent ids,
   and session ids are dropped *before* composition.
   `plugin/test/unit/feedback.test.js` plants a secret and a private path in a
   diagnostic payload and asserts neither appears in the body or the URL, so the
   channel cannot silently become a disclosure path.

**Why a tool and not prompt text.** Tool descriptions are already model-visible,
so discoverability does not need a sentence in the compiled section. That keeps
`PROMPT_VERSION` unchanged (no §22.3 prompt-revision claim) and leaves the §11
byte budget untouched — a deliberate application of P7 to the plugin's own feature.

**Configuration.** `feedback{enabled, mode, repository, tokenEnvVar, labels,
includeDiagnostics}`, strictly validated like every other key. `enabled` defaults
to `true` because `url` mode is inert; a deployment that does not want the tool
sets it to `false`.

**Evidence.** Unit tests cover redaction, URL composition and truncation (the URL
payload is bounded at 6,000 bytes and says so rather than emitting a mangled
link), `url` mode making zero network calls, `api` mode filing exactly once and
reporting the issue URL, and fail-open on a rejected or broken API. The
installed-artifact proof in `verify.sh` asserts the tool is registered.

### 28.7 Opt-in diagnostics mirror (v0.4.0)

The ring of §28.3 lives inside the running host process; a separate front end —
the Web GUI panel, a terminal, a bug report — cannot read it, which is why
`abg_status` exists as a tool. This section adds the machine-readable half for
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
  `abg.diagnostics_export_failed`, and re-entrancy is blocked explicitly because
  that report is itself a diagnostic;
- **atomic-ish** — written to `<file>.tmp` and renamed, so a reader never sees a
  half-written document.

The writer is injected into the kernel module, so throttling, bounding, and the
failure path are unit-tested without touching a filesystem.

### 28.8 Web GUI panel and its data route (v0.4.0)

ABG ships a browser half so an operator can see governance state without reading
a transcript or calling a tool. Verified end to end in a workspace-local web
profile (never the live profile): the sidebar entry registers, the panel opens,
and it renders the mount record, the status line, and the diagnostic ring.

**Data path.** The host registers one exact route on `ctx.webServer`
(`@deepseek-ai/dsh-host-webserver`), `STATUS_ROUTE_PATH = /api/abg/status`,
returning the same JSON contract as `abg_status` and the diagnostics mirror, so
all three front ends read one shape. The route sits under `/api`, i.e. behind the
deployment's browser-trust fence, is registered in its own guarded step through
`ctx.inject(['webServer'])`, and leaves no response open on failure. An absent
web server is an optional seam, not a degradation — but the *absence of the
route* is recorded in-band (`abg.gui_route_registered` when it registers,
`abg.capability_missing` when the service is missing), because an `inject` that
never fires is otherwise indistinguishable from a route that does.

**Client bundle — hand-authored, and why.** A DSH client plugin is a package
`dsh.client{platform:'web'}` declaration plus a `./client` export, and the host
fails activation loudly when the bundle is missing. First-party packages ship a
`lib/client.js` produced by the monorepo's `pnpm run build` (tsdown); there is no
public out-of-tree build. `plugin/lib/client.js` is therefore written directly
against the two documented contracts: the lazy-CJS envelope
`window.__ModuleLoader__.load({id, factory})` whose `require` resolves only the
frozen baseline, and the slot registry (`inject = ['slots']`,
`ctx.slots.inject('sidebar.panellist' | 'main', …)`, `ctx.slots.register({…}, C)`).
It registers one panel identity in two seats. It is excluded from `tsc` for the
same reason first-party built client artifacts are: it is a browser artifact, not
Node source.

**Write routes, and why they are safe to expose.** The prompt editor and the
feedback form are the first ABG surfaces that accept input from a browser, so
they are gated on three rules:

- `GET /api/abg/status` additionally reports the editor's view (`prompt.mode`,
  `prompt.file`, the effective text, bytes against the §11 budget, `issues`,
  `promptUnchecked`) and the feedback mode;
- `POST /api/abg/prompt` accepts `{ text }`, decides through the **same**
  `composePromptOverride` the file and the config use, writes the result through
  a temporary sibling and a rename, and only then adopts it in memory — so a
  panel that says "applied" is reporting a durable fact. Editing is **disabled**
  (409) unless `prompt.mode` is `replace` and `prompt.file` names a path: there is
  deliberately no default write target, so a deployment that never opted in gets a
  read-only editor rather than a surprise file. Refusals return 422 with the
  issues, and the refusal is recorded as `abg.prompt_override_rejected` with
  `source: gui`;
- `POST /api/abg/feedback` composes through `composeFeedback`, so the redaction
  tests cover the browser path; `file: true` is honoured only in `api` mode and
  otherwise explains that the link is the answer.

Both live under `/api`, i.e. behind the deployment's browser-trust fence, bound
the request body (`MAX_REQUEST_BYTES`), reject the wrong method (405), and never
let a write failure escape the handler.

**Live application.** The section's `text` is a function-valued provider, which
the host re-evaluates per assembly, so an editor write takes effect on the next
step without a restart; the live prompt facts (text, bytes, version, issues,
`unchecked`) are held in one mutable record that the status route, the section
provider and the feedback report all read.

**Consequence for this project's properties.** The Node half still imports
nothing first-party; `dsh.client.inject` names package *rows*, not Node imports.
The cost is real and recorded: the bundle is coupled to this host version and must
be re-verified against any new release, which the acceptance matrix covers by
running the web-profile check.

## 29. Compatibility Adapter Specification

### 29.1 Problem

Blocker 2 / PR-06: a DSH peer range is declared and enforced at install and
startup, but nothing observes whether the running host's prompt surface still
matches what ABG was verified against.

### 29.2 Verified constraint

There is **no plugin-facing host-version service** in the installed
`0.2.0-rc.2` distribution: the CLI resolves `context.version` for its own
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
ABG section presence + position  index of 'abg:governance'
host section text hash           hash of the non-ABG section texts
contexts / tools count           assembly.contexts.length, assembly.tools.length
capability inventory             ctx.get('tools'|'fs'|'storageDomain'|...)
```

`AssembledSection` carries `name`, `text`, and `interpolate` — **not** `order`.
The ordered name array is the resolved placement, which is exactly the drift
signal that matters.

### 29.4 Baseline and verdict

- `plugin/lib/compatibility-baseline.json` records the expected ordered section
  names, the expected host section hash, and the capability set for the declared
  host version. It is generated by `plugin/scripts/capture-baseline.mjs` against
  a real profile and committed.
- Verdicts:

```text
COMPATIBLE                 every expected fact matches
COMPATIBLE_WITH_WARNINGS   non-critical drift: new optional sections/contexts/
                           tools, or an optional capability absent
UNSUPPORTED                a required section is missing, the ABG section is
                           absent or displaced, or a required capability is absent
```

- The verdict is emitted once per mount as `abg.host_compatibility`, is carried
  in the mount record, and is reported by `abg_status`. Under
  `COMPATIBLE_WITH_WARNINGS` and `UNSUPPORTED` it also appears in channel A.
- **Fail-open.** The adapter never denies a step or a tool call.
- A baseline test fails when the installed host's section inventory or hash
  differs from the file, forcing a reviewed baseline update rather than silent
  drift. This is the concrete regression signal PR-06 asks for.

## 30. Question Consolidation at Runtime

### 30.1 Problem

Blocker 4 / criterion 3: the `0.1.0` collector is implemented and unit tested,
but ABG only *measures* the batch size the host was asked for. PRODUCT-SPEC
PR-04's consolidation is not wired.

### 30.2 Host constraints restated (so the design is not built against them)

```text
within one ask() call      questions[] is a batch                     supported
across calls               no merge, no deferral record, no dedup API  ABG-owned
partial answer             rejected (BAD_ANSWER)                       impossible
abandon a question         no API                                      impossible
asker                      exact live runtime root only                 root-only
release while answerable   askTimed(request, callId, timeoutMs)        the deferral primitive
```

### 30.3 Wiring

| Seam | Use |
|---|---|
| `tools/pre-execute` on `ask_user_question` | batch-completeness gate (existing) + redundancy gate (new): refuse a batch that omits a registered deterministic blocker, or that re-asks an answered question. Denial reason names the ids and the remediation. |
| `user-questions/request` (agent-scoped waterfall) | observation only — record the request and its question ids as `abg.question_submitted`; never merge or answer |
| `record_question` tool (existing) | register a candidate with kind and `dependsOn` |
| `abg_questions` tool (new, read-only) | return `{pending[], deferred[], recommendedBatch[]}`, dependency-ordered and deduplicated |
| prompt fragment | one ask per batch; defer non-blocking uncertainty; do not ask what the workspace already answers |

The model composes the batch; ABG supplies the state and the gate. ABG cannot
merge a call for the model because `ToolExecution` carries no input-rewriting
capability (§17.3, item 1).

### 30.4 Behavioural measurement

The headless harness has no question answerer, which is why every `0.1.0`
end-to-end run recorded `ask_calls = 0`. v0.2.0 therefore adds a **scripted
answerer** to the evaluation composition: a test-only plugin that answers
`user-questions/request` deterministically from the scenario script.

Metrics, all derived from session events and the answerer's log:

```text
questions_registered   questions_sent   batches_sent
redundant_questions    average_questions_per_batch
user_interruption_count   blocked_execution_time
```

Done criterion: a scenario with five independent deterministic blockers must
produce **one** `ask_user_question` call carrying five questions, with no
registered blocker omitted; and a scenario whose second question becomes
unnecessary after the first answer must produce no redundant question.

## 31. Packaging, Versioning, and Release Policy

### 31.1 Package

| Item | v0.2.0 |
|---|---|
| `private` | **retained** in the working tree until Gates C, D, and E pass; removal is the release action |
| `license` | `MIT`, with `plugin/LICENSE` |
| `CHANGELOG.md` | required; every prompt change attributed to a problem or an evaluation result |
| `files` | `lib`, `cordis.patch.yml`, `README.md`, `LICENSE`, `CHANGELOG.md` |
| `dsh.engines.dsh` | `>=0.2.0-rc.2 <0.3.0` |
| `dsh.compatibility.dshReleases` | `{ "0.2.0-rc.2": "verified" }` |
| runtime dependencies | none |
| publish target | **open** — see §34.2 Q5 |

### 31.2 Release policy

- Semver. A change to compiled prompt text or to the durable record shape
  forces at least a minor bump and a CHANGELOG entry.
- A new host release adds a `dsh.compatibility.dshReleases` entry only after the
  compatibility baseline test passes and the baseline file is reviewed.
- `plugin/scripts/verify.sh` is the release gate: strict typecheck, the full
  test suite, a real install, row composition, a positive execution proof against
  the **installed** artifact, and a real mount against the pinned host version. It
  is not wired to an `npm run` alias; `plugin/package.json` exposes only `test` and
  `typecheck` (2026-10-02).
- Reproducibility: `npm pack` must contain exactly the `files` allowlist and no
  build step.

## 32. Verification and Acceptance Matrix

### 32.1 Gates

| Gate | Statement | Status | Evidence |
|---|---|---|---|
| A — Host compatibility | ABG is additive and the host prompt survives | **met** | `test/integration/composition.test.js`; `verify.sh` composes the real row and proves the installed artifact binds one section, three listeners, and four tools |
| B — Semantic non-conflict | no module contradicts an identified host semantic | **met** | executable prompt-conformance suite; Part A's seam review |
| C — Behavioural improvement | at least one target failure mode improves measurably against baseline | **unmet** | the only measurements ever taken were against the five-module prompt; they were deleted as superseded, so no valid number exists for the current revision |
| D — User-attention efficiency | batching reduces interactions without suppressing critical uncertainty | **unmet** | the ledger, gate, and `abg_questions` surface are verified; the end-to-end measurement (§30.4) is not |
| E — Information integrity | known-invalid information is no longer authoritative by default, and the D14 deletion policy is applied | **unmet** | the pre-removal measurement was deleted as superseded; needs a fresh run |
| F — Regression resilience | compaction, resume, and fork preserve governance state | **met** | `durability-storage.test.js` (real storage stack); `agent-isolation.test.js` |
| G — Diagnosability | mount and gate decisions are observable outside the plugin without a logger exporter | **met** | `diagnostics.test.js`; `v2-integration.test.js` channels A and B; `wiring.test.js` for the config-fault surface, `degraded[]`, and best-effort logging; `verify.sh` check 5 for the installed artifact |
| H — Agent isolation | two live agents in one composition never share governance state | **met** | `agent-isolation.test.js`; `state.test.js` |
| I — Compatibility | the adapter reports a verdict and detects a simulated host section change | **met** | `compatibility.test.js`; `v2-integration.test.js` reports `COMPATIBLE` from a real assembly |
| J — Packaging | installable, licensed, changelogged, peer-range enforced | **partial** | LICENSE, CHANGELOG, `files` allowlist, and the narrowed peer range landed; publication withheld |
| K — Withdrawal integrity | the plugin ships four modules with no dangling reference to the removed one | **met** | full suite + repository-wide reference scan |

### 32.2 Positive evidence (D10)

Gates A, G, and I must be asserted by **positive** observation: the transcript
contains the ABG section, the registered tools, and — subject to §34.1 B2 — the
status line, and it carries the compatibility verdict. "The process booted" is
not evidence.

### 32.3 Test layers

```text
unit          config, registry, compiler, module logic, diagnostics sink,
              state merge, gates
conformance   prompt content rules, failure-class coverage (four), budget,
              interpolation safety
integration   real dsh-system-prompt, dsh-tools, dsh-fs-local, the
              storage stack, the real tool registry, the assembly waterfall
compatibility baseline vs. installed host section inventory and hash
end-to-end    real agent, ABG mounted, with and without the plugin
```

### 32.4 Gate-precision evaluation (blocker 3)

A governance layer that blocks legitimate work has negative value. The
evaluation must therefore measure, on a suite of at least 12 legitimate tasks:

```text
legitimate_mutation_calls      calls the task requires
false_blocks                   calls ABG refused although the task authorized them
false_block_rate               false_blocks / legitimate_mutation_calls
true_blocks                    the overlap and policy traps ABG is meant to catch
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

## 33. Implementation Plan

Phases are ordered by dependency. Each phase is a reviewable change set with its
own verification run. P1, the breaking change, **has landed**; the remaining
phases build on its result.

| Phase | Deliverable | Primary files | Depends on | Done when |
|---|---|---|---|---|
| P0 | Baseline freeze | `CHANGELOG.md` | — | the `0.1.0` evidence chain is recorded verbatim: `npm test` and `verify.sh` results, prompt size, prompt version |
| P1 (done) | Withdraw `child-agent-lifecycle` | executed: module, listeners, contract types, test, composition toggle, prompt fragment, and product clauses removed | P0 | **met** — four modules, no dangling reference, Gate K |
| P2 | Scope-isolated state | new `plugin/lib/kernel/state.js`, `plugin/lib/index.js`, `plugin/lib/kernel/orientation.js`, `plugin/lib/kernel/questions.js`, `plugin/lib/modules/workspace-governance.js`, `plugin/lib/kernel/durability.js` | P1 | **done** — Gates F and H met |
| P3 | Diagnostics | new `plugin/lib/kernel/diagnostics.js`, `plugin/lib/index.js`, `plugin/lib/contract.d.ts`, new `plugin/test/unit/diagnostics.test.js`, new `plugin/test/integration/diagnostics.test.js` | P2 | **done** — Gate G met |
| P4 | Compatibility adapter | new `plugin/lib/kernel/compatibility.js`, new `plugin/lib/compatibility-baseline.json`, new `plugin/scripts/capture-baseline.mjs`, new `plugin/test/integration/compatibility.test.js` | P3 | **done** — Gate I met |
| P5 | Question consolidation at runtime | `plugin/lib/kernel/questions.js`, `plugin/lib/index.js`, new `eval/answerer/`, `eval/scenarios.mjs`, `eval/README.md` | P2, P3 | **partial** — the ledger, the batch gate, the read-only `abg_questions` surface, and the scripted answerer (`eval/answerer/`) landed; the end-to-end measurement (§30.4) did not, and the one attempted run produced no usable control arm |
| P6 | Evaluation: precision and breadth | `eval/e2e.mjs`, `eval/e2e-analyze.mjs`, `eval/scenarios.mjs`, `eval/README.md` | P1–P5 | **partial** — the simulated gate-precision matrix landed (21 legitimate calls, 0 false blocks; 4 traps caught); the model-backed Gate C/E measurements and the wider evidence of §32.5 did not |
| P7 | Packaging | `plugin/package.json`, new `plugin/LICENSE`, new `plugin/CHANGELOG.md`, `plugin/README.md` | P1 | **partial** — LICENSE, CHANGELOG, and the `files` allowlist landed, and the peer range is narrowed to the verified one; publication stays withheld while Gates C, D, and E are unverified |

**Round status.** After the v0.2.0 structural round and the 2026-10-02 mount
hardening the plugin is at `version: 0.3.0`, still `"private": true`, with
**238 tests (all pass — no todo, no skip)**, a clean strict typecheck, and
`scripts/verify.sh` at **11/11** (typecheck, suite, real install, row composition,
installed-artifact execution proof, live mount). The unmet items
are exactly the ones that need a real model in the loop: behavioural
re-measurement (Gate C), information-integrity re-measurement (Gate E), and
end-to-end question-consolidation measurement (Gate D, §30.4). The superseded
five-module measurements were deleted, not annotated, so no stale number stands
as evidence for the current revision (§23).

### 33.1 Ordering constraints

- P1 first: it removes code that P2–P5 would otherwise have to carry.
- P2 before P3: the diagnostics sink is per agent.
- P3 before P4: the adapter reports through the diagnostics sink.
- P6 last: it measures the finished behaviour, not an intermediate one.

### 33.2 Parallelizable work and write scopes

Once P1 lands, P2 and P7 touch disjoint files and may proceed in parallel. P3
and P5 both touch `plugin/lib/index.js`, so they are **serialized**, not merged
concurrently. The evaluation harness (P6) is a separate directory and may be
prepared in parallel, but it must not be scored until P1–P5 have landed, because
a score against an intermediate build is not a result.

### 33.3 Definition of done for v0.2.0

```text
1. four modules, each claiming exactly one failure class                        [met]
2. no import, config key, prompt fragment, test, or documentation claim
   referring to child-agent-lifecycle                                          [met]
3. per-agent state isolation proven by test
4. mount, configuration, last denial, and compatibility verdict observable from
   the transcript alone, under the §28.5 fallback if channel A is unavailable
5. a compatibility regression test that fails on host drift
6. gate-precision suite with a measured false-block rate
7. prompt byte ceiling re-recorded and asserted
8. package installable from a clean profile, with a changelog and a license
9. every §34.2 item either confirmed or still explicitly open — none silently
   decided
```

## 34. Assumptions and Items Requiring Confirmation

### 34.1 Assumptions

| # | Assumption | Status |
|---|---|---|
| A1 | ABG ships out-of-tree as an npm plugin with a bundle patch, mounted through `dsh.profile.bundles` / `cordis.patch.yml`, declaring a DSH peer range | carried from §20.1 |
| A2 | ABG occupies one explicit finite numeric section `order`; there is no host-allocatable placement | carried, verified in Part A |
| A3 | Authoritative governance state lives in `ctx.storageDomain`; log-only state is composition-coupled because `ignorable` has no plugin-facing write path | carried and strengthened: v0.2.0 adds no session event |
| A4 | Mutation governance covers **tool-mediated** mutations only | carried |
| A5 | `ctx.logger` is not displayed in stock compositions and `dsh-base` does not mount an exporter | carried; Part B's channels do not depend on it |
| A6 | Question consolidation is available only to live runtime root agents | carried; with §23 it is also an accepted boundary |
| A7 | All Part A facts are scoped to `@deepseek-ai/dsh` `0.2.0-rc.2` | carried |
| B1 | The withdrawal of `child-agent-lifecycle` is a product-level breaking change; its removal has been executed (§23) and verified by the suite | done |
| B2 | `ctx.systemPrompt.context` accepts a `PromptContext {name, order, text}` whose `order` is any finite number, as sections do, and repeated snapshots do not accumulate unboundedly | **resolved positive**. Verified against the real `dsh-system-prompt` 0.2.0-rc.2: any finite order is accepted (`8500` resolves and renders; non-finite throws `TypeError`), the text renders through the runtime-context channel (`assembly.contexts`, `renderContextSnapshot`) and **not** through `renderPrompt`, and one registration yields exactly one entry per assembly. Channel A is implemented and covered by `test/integration/diagnostics.test.js` and `test/integration/v2-integration.test.js`. |
| B3 | Live state is keyed by the agent object identity (`WeakMap`) instead of §17.7's `ScopedLayers`, to preserve zero first-party imports | **shipped** as designed. `lib/kernel/state.js` keys by agent identity with an unscoped fallback; `test/integration/agent-isolation.test.js` proves two live agents share nothing. The deviation from §17.7 remains a deliberate, recorded choice. |
| B4 | No plugin-facing host-version service exists; the adapter observes seam facts, and the enforced peer range is the authoritative version gate | verified for `0.2.0-rc.2` |
| B5 | Adding a table to an existing `storageDomain` version is open-compatible | to verify before shipping |
| B6 | The prompt byte ceiling is re-recorded after the withdrawal as measured size + 10 %, floor 1400 bytes, hard cap 4096 bytes | **implemented 2026-10-02** — `RECORDED_PROMPT_BYTES = 3459`, ceiling `3805`, floor `1400`, hard cap `4096`; enforced by `compilePrompt()` and asserted from the same constants by the compiler and conformance suites |
| B7 | The publish target (registry, git, or local path) is undecided | new |

### 34.2 Items requiring confirmation

Q1, Q3, and Q4 were **decided by the user** (see the Decision column). Q2, Q5,
and Q6 remain open; nothing is adopted silently.

| # | Item | Decision / options |
|---|---|---|
| Q1 | Intrusive defaults | **Decided — adopt non-intrusive defaults.** `requireBeforeMutation` defaults to `false`, with `preStep.orientationGate: 'off'` remaining the default; a strict mode (`requireBeforeMutation: true`) stays available as an explicit opt-in, and the evaluation configures the gates explicitly either way. Rationale: a default that denies the first write of every session is friction a deployment has not asked for, and the requirement is a policy choice, not a correctness property. **Implemented 2026-10-02:** the code default and the shipped `cordis.patch.yml` row are `false`, and the requirement's tests state `true` explicitly. |
| Q2 | Section order value | **Open** — confirm `8500` and the regression test that fixes it. |
| Q3 | Approval authorship | **Decided — ask only.** ABG gates mutations by returning `PreToolDecision.ask` and never registers its own `approval/request` answerer, so a deployment keeps one terminal answerer and inherits the host's fail-closed path. This is what the code already does. |
| Q4 | `dsh-agent-instructions` integration | **Decided — defer to the host.** ABG references `AGENTS.md` / `CLAUDE.md` as the workspace-instruction authority and does not restate it in its own prompt section; the conformance suite already forbids restating host semantics. |
| Q5 | Publish target | **Open** — registry, git, or local `file:` distribution. |
| Q6 | Live-profile rollout | **Open** — whether ABG is ever installed into the live `web` profile (`MAINTENANCE-HANDOFF.md` §9, §10), and under what conditions. v0.2.0 assumes throwaway profiles only. |

### 34.3 Accepted boundaries (not open questions)

```text
tool-mediated mutation coverage only, not process-wide          (A4)
shell writes classified from command text; quoted text is data, and an
  indirectly invoked wrapper or PowerShell Remove-Item is not recognised (D13)
a failed `tools` injection is visible only through channel A and the ring, never
  through a tool — ABG cannot offer a tool to explain that its tools failed
root-only question consolidation                                (A6)
delegated questioning ungoverned after the §23 withdrawal       (§23)
no diagnostics session event while `ignorable` has no write path (§28.4)
ABG cannot report its own mount failure; evidence is external   (D10)
```


