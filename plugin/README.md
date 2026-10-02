# dsh-agent-behavioral-governance

**Agent Behavioral Governance (ABG)** — an additive project-work governance layer
for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This is a **verifiable prototype** of the design specified in
[`../PRODUCT-SPEC.md`](../PRODUCT-SPEC.md),
[`../ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](../ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
(notably the source-verified §17), and
[`../IMPLEMENTATION-VALIDATION-HANDOFF.md`](../IMPLEMENTATION-VALIDATION-HANDOFF.md).

It contributes **exactly one** additive system-prompt section and binds
deterministic enforcement to verified host seams. It has **zero runtime
dependencies** — no first-party import, no third-party import — so it mounts in
any composition and is immune to the profile's module-resolution layout.

## What it does

| Module | Problem | Runtime contribution |
|---|---|---|
| `project-governance` | the agent advances without a stable project model | orientation store + a `record_orientation` tool + a gate that refuses the first mutation until orientation is declared |
| `information-integrity` | known-invalid information stays reusable | status model; promotion to authoritative requires evidence or user confirmation; the prompt requires removing or superseding outdated content |
| `user-attention` | deterministic blockers are asked one at a time | per-agent question ledger (dedup, dependency order, defer, drop-if-unnecessary); a read-only `abg_questions` surface; a gate that refuses a batch which omits a registered blocker |
| `workspace-governance` | unauthorized persistent mutation | `tools/pre-execute` gate + monotonic `ctx.tools.guard` backstop + a document-overlap gate; shell writes are classified from command text (quoted text is data) |

## Seam map

```text
system prompt     -> ctx.systemPrompt.section()          advisory   (never `complete`)
step admission    -> agent/pre-step                      veto       ({kind:'reject'})
orientation tool  -> record_orientation (registered)     capture    (intent, scope, terms, plan)
orientation gate  -> tools/pre-execute                   deny       (until orientation recorded)
mutation gate     -> tools/pre-execute                   gate       ({kind:'ask'|'deny'})
overlap gate      -> ctx.fs scan + tools/pre-execute     gate       (duplicate new document)
mutation backstop -> ctx.tools.guard()                   deny only  (monotonic)
status line       -> ctx.systemPrompt.context()          advisory   (`abg:status`, runtime context)
diagnostics tool  -> abg_status (registered)             read-only  (mount, config, verdict, ring)
question surface  -> abg_questions (registered)          read-only  (the per-agent ledger)
compatibility     -> host section inventory + hashes     report     (COMPATIBLE | … | UNSUPPORTED)
```

## v0.2.0 additions

The `0.1.0` prototype proved the seams; the v0.2.0 change set makes the layer
diagnosable, host-aware, and per-agent correct. Each addition is attributed to
the problem it closes and is covered by the suite.

| Addition | What changed | Closes |
|---|---|---|
| Per-agent state | Orientation and the question ledger are keyed by the live agent object (`lib/kernel/state.js`), so one composition serves many agents without leaking state between them | the §17.7 sharing defect; **Gate H**, proven by `test/integration/agent-isolation.test.js` |
| Diagnostics | A bounded in-memory ring, a read-only `abg_status` tool, and the `abg:status` runtime-context line report mount, configuration, last denial, agent id, and the compatibility verdict without a logger exporter | `MAINTENANCE-HANDOFF` §4 blocker 1; **Gate G** |
| Compatibility adapter | The host section inventory and prompt hashes are observed at mount and classified `COMPATIBLE` / `COMPATIBLE_WITH_WARNINGS` / `UNSUPPORTED` / `PENDING` | `MAINTENANCE-HANDOFF` §4 blocker 2; **Gate I** |
| Question consolidation | The per-agent ledger is readable through `abg_questions`, and `tools/pre-execute` refuses an `ask_user_question` batch that omits a registered blocker | `MAINTENANCE-HANDOFF` §4 blocker 4; **Gate D** |
| Gate precision | A matrix of 21 legitimate calls plus the declared traps measures `false_block_rate`, `false_blocks`, and `true_blocks` | `MAINTENANCE-HANDOFF` §4 blocker 3; `ARCHITECTURE-SPEC` §32.4, in [`test/integration/gate-precision.test.js`](test/integration/gate-precision.test.js) |
| Packaging | `LICENSE` (MIT), `CHANGELOG.md`, and a `files` allowlist that ships both | `MAINTENANCE-HANDOFF` §4 blocker 6; **Gate J** |

The package is now `version: 0.2.0` and remains `"private": true`; the peer range
is narrowed to the verified one (`>=0.2.0-rc.2 <0.3.0`). Removing `private` and
choosing the publish target are the release decision
(`ARCHITECTURE-SPEC` §31.1, §34.2 Q5) and are withheld until the model-backed
behavioural gates pass.

## Acceptance objectives

Two behavioural objectives are tracked explicitly, because a governance plugin
can pass every structural test while still failing to change what the agent
does:

| Objective | Prompt guidance | Deterministic mechanism | Verified by |
|---|---|---|---|
| **OBJ-1** — align intent and terminology and plan the task flow, unprompted, before acting | `project-governance` principles + ordered-flow fragment | `record_orientation` tool; first mutation refused until orientation exists | unit, wiring, and a real-registry integration test |
| **OBJ-2** — maintain workspace hygiene: check for overlap before creating, and remove or supersede outdated content | `workspace-governance` overlap principle; `information-integrity` removal principle | document-overlap gate over `ctx.fs` (Jaccard + H1 comparison), fail-open | unit (stub fs) and integration against the real `dsh-fs-local` |

Behavioural effect is measured separately by the harness in [`../eval/`](../eval/harness.mjs),
which runs seeded sandboxes with and without the governance section and scores
the *filesystem outcome*. See "Behavioural evaluation" below.

## Prompt content: what the injected text does and does not guarantee

The section is the plugin's payload, so its content is audited by an executable
conformance suite (`test/unit/prompt-conformance.test.js`) rather than by
intent. It asserts:

- **Failure-class coverage.** Every PRODUCT-SPEC §2 failure class (`FC-2.1` …
  `FC-2.4`) is claimed by exactly one module, via the `addresses` field each
  module declares. This turns success criterion #2 into a test.
- **§5.2 no duplication.** No statement appears twice; each module's prose
  fragment must survive compilation, which fails if a fragment merely restates
  its own principles.
- **Handoff §10 DO.** Every module states at least one trigger condition.
- **Handoff §10 DO NOT.** No authority claim over the user or host; no implementation
  detail (`ctx.`, `Cordis`, `tools/pre-execute`) in model-facing text; no
  plan-mode or host-tool-manual duplication; and no instruction that restates a
  rule the plugin already enforces deterministically.
- **Architecture §11 budget.** A recorded byte ceiling, so prompt cost cannot drift silently.

The audit that produced this suite found three real defects, all fixed:

| Defect | Fix |
|---|---|
| A kernel principle (P7, "prefer deterministic enforcement over repeated prompting") was addressed to the plugin author, not the agent — implementation leakage | removed from `KERNEL_PRINCIPLES`; a test now guards against re-adding it |
| Every module's prose fragment restated its own principles (§5.2 violation, pure prompt cost) | fragments rewritten to add guidance the principles do not state; the compiler now deduplicates fragment sentences too |
| The `workspace-governance` fragment told the model to perform the check the gate already enforces, and implied "an existing project convention" authorizes a write — an authorization channel the host does not honour | replaced with the host's actual grant semantics: each approval covers one change only |

**Not guaranteed.** Content conformance is static and structural. It does *not*
show that the text changes model behaviour — handoff Gate C ("at least one target
failure mode shows measurable improvement against baseline") requires the
handoff §3 channel experiment and is **not** measured here.

## Configuration

All configuration lives on the single composition row inserted by
[`cordis.patch.yml`](cordis.patch.yml). See that file for the documented shape.
A patch replaces the whole `config` of a row, so an override restates the fields
it needs.

```yaml
- id: abg
  config:
    enabled: true
    sectionOrder: 8500            # no host-allocated slot exists; this is explicit
    workspace:
      policy: ask                 # allow | ask | deny
      protectedPaths: []          # always denied, even under `policy: allow`
      overlapCheck: ask           # off | ask | deny — new document duplicating an existing one
      classifyShellCommands: true # govern shell writes, which the tool list cannot see
    preStep:
      orientationGate: off        # off | warn | reject  (blocks the step itself)
      requireBeforeMutation: false # opt-in; true refuses the first write (§34.2 Q1)
```

Defaults are non-intrusive: `requireBeforeMutation` is `false` and the
orientation gate is `off`, so ABG does not deny the first write of a session
unless a deployment opts in. Strict mode is one configuration change.

### Shell-write classification

Shell tools are deliberately absent from `mutatingTools`, so `ls`, `grep`, and
`node --test` are never gated. The coverage hole that exclusion left — a document
created by a redirection, or removed with `rm`, without any file-effect tool call
— is closed by `workspace.classifyShellCommands`, which inspects the command text
and treats only a command that can write as a mutation. Quoted text is data
unless the command wraps another command, so `rg '=>' src` and
`git commit -m 'rm stale files'` stay read-only while `bash -c 'rm -rf build'`
does not. Two residual limits are pinned by tests rather than hidden: a wrapper
invoked indirectly (`env bash -c '…'`) and PowerShell `Remove-Item` are not
recognised as writes.

## Mount resilience

`apply()` never throws (`ARCHITECTURE-SPEC` §26.2). The host reports a throwing
entry as `warning: N entry did not activate` and carries on, so a fault must
degrade into something the transcript can show rather than into a silent absence:

- a **configuration fault** mounts an inert but observable surface — the
  read-only `abg_status` tool and the `abg:status` line report `mounted: false`
  with the validator's message and an `abg.config_invalid` diagnostic, and **no**
  prompt section or enforcement is registered (fail-safe, never wrong enforcement);
- each capability registers in its **own guarded step**, so one unavailable seam
  costs only that seam, and the failure is attributed in the diagnostic ring;
- an **absent** seam is recorded as `abg.capability_missing` and listed in the
  mount record's `degraded[]`, so "ABG is present but incomplete" is
  distinguishable from "ABG is complete" — read `degraded`, not `mounted` alone;
- **log narration is best-effort**: a logger that throws cannot unmount ABG,
  because the ring, the status line, and the tools carry the state.

## Verification

```bash
cd plugin
npm run typecheck     # tsc --checkJs, strict, against the ambient seam contract
npm test              # node --test (unit + integration) — 228 tests, no todo
./scripts/verify.sh   # the full evidence chain (11 checks), real profile install
```

`npm test` runs two layers:

- **Unit** — config validation, module contract and dependency resolution, prompt
  compilation and budget, and the pure logic of all four modules.
- **Conformance** — the injected prompt text audited against the handoff §10 content
  rules, the architecture §5.2 dedupe rule, PRODUCT-SPEC §2 coverage, and the
  architecture §11 budget ceiling.
- **Integration** — boots the **real** `@deepseek-ai/dsh-system-prompt`,
  `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-fs-local` from the installed
  distribution and asserts the section renders additively, the host prompt
  survives, the orientation tool registers and is refused-then-admitted, the
  mutation gate denies, the guard denies independently, `ask` fails closed,
  a real duplicate document is caught through the real filesystem, two live
  agents never share governance state, and the gate-precision matrix measures
  `false_block_rate = 0` over its legitimate corpus.
- **Mount resilience** — an invalid configuration does not throw and stays
  observable, one failing capability does not lose the others, `degraded[]`
  distinguishes a partial mount, an absent seam is recorded, a broken logger
  cannot break the mount, and the durable handle is disposed through `ctx.effect`.

Behavioural effect is measured separately by the sandbox harness in
[`../eval/`](../eval/README.md), which is not part of `npm test` because it runs
real agents rather than assertions.

`scripts/verify.sh` adds the packaging and load evidence chain against a
throwaway `DSH_HOME` inside the repository, so your real profile is never
touched. Its execution proof runs against the profile's **own installed copy** of
the package (a real directory, not a link back to the source tree): the installed
artifact must bind one section, three listeners, and four tools, must absorb a bad
configuration into that observable fault surface, and the host must then boot the
real composition carrying the bad overlay without reporting an unactivated entry.

## Not verified by this prototype

Honest boundaries, carried from the design's §20:

- **`agent/pre-step` live dispatch.** The handler's wiring, arity, and decision
  shape are tested; executing it against a live agent loop requires a full
  session/LLM composition and is left to the handoff's build phases.
- **Question consolidation, end to end.** ABG's part is wired: the per-agent
  ledger, the read-only `abg_questions` surface, and the incomplete-batch gate
  are enforced and tested. The *behavioural* measurement — a scripted answerer
  that proves batching reduces interactions in a real run (§30.4) — belongs to
  the evaluation harness, not to `npm test`.
- **Behavioural improvement (handoff Gate C).** **Unmeasured for the current
  prompt revision.** Every earlier trial — prompt-level and end-to-end — was run
  against the five-module prompt, which no longer exists; that evidence was
  deleted as superseded when the module was removed (`ARCHITECTURE-SPEC` §23)
  rather than kept beside results for different text. The next `eval/e2e.mjs`
  run against this plugin is what produces a valid number. See
  [`../eval/README.md`](../eval/README.md).
