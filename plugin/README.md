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
feedback tool     -> abg_report_issue (registered)       read-only  (redacted issue draft, opt-in)
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

The package is now `version: 0.5.0` and remains `"private": true`; the peer range
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
    feedback:
      enabled: true               # registers the read-only abg_report_issue tool
      mode: url                   # url (compose a link) | api (also POST the issue)
      repository: ccneedb/agent-behavioral-governance
      tokenEnvVar: ABG_GITHUB_TOKEN # read from the environment, only in `api` mode
      labels: [feedback]
      includeDiagnostics: true
    prompt:
      mode: compiled              # compiled | append | replace
      append: ""                  # extra guidance, appended to the compiled section
      file: ""                    # markdown file, used when mode is `replace`
      allowOverBudget: false      # accept text over the §11 ceiling, deliberately
    diagnosticsExport:
      file: ""                    # empty = off; no file I/O unless configured
      limit: 50
```

Defaults are non-intrusive: `requireBeforeMutation` is `false` and the
orientation gate is `off`, so ABG does not deny the first write of a session
unless a deployment opts in. Strict mode is one configuration change.

### Feedback (optional)

ABG is a prototype under volunteer testing, so every install registers one more
read-only tool, **`abg_report_issue`**. Given a one-line summary (plus optional
"expected"/"actual"), it returns a **prefilled GitHub issue link** and the
markdown body, composed from the mount record, `degraded[]`, the compatibility
verdict, and diagnostic *codes*.

- It **never files anything by itself** in the default `url` mode: no network
  call, no credential, and a human decides to submit.
- It is **redacted by construction**: diagnostic payloads (`data`), agent and
  session identifiers, file contents, prompts, and session logs are dropped
  before composition, so a careless caller cannot leak them through it. The unit
  suite plants a secret in a diagnostic payload and asserts it never appears in
  the body or the URL.
- `feedback.mode: api` is strictly opt-in; it POSTs the issue through the GitHub
  API using a token read from the environment variable named by
  `feedback.tokenEnvVar` (default `ABG_GITHUB_TOKEN`) — never from configuration,
  which is committed and shared. Any failure (no token, refused request, network
  down) degrades to the prefilled link rather than throwing.
- `feedback.enabled: false` removes the tool entirely.

The volunteer workflow it supports is documented in
[`../TESTING.md`](../TESTING.md).

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

### Editable prompt

The compiled governance section is generated **and audited** (dedupe, content
rules, byte ceiling). `prompt.mode` lets a deployment change that text on its own
terms:

| Mode | Effect |
|---|---|
| `compiled` (default) | the audited generated section, unchanged |
| `append` | the compiled section plus your guidance (`prompt.append`) |
| `replace` | `prompt.file` becomes the section verbatim |

Two requirements are still enforced, because they are mechanisms rather than
style: no `{{ }}` interpolation syntax, and the byte ceiling unless
`prompt.allowOverBudget: true` is set deliberately. A refused edit **keeps the
compiled default and says why** (`abg.prompt_override_rejected` /
`abg.prompt_override_missing` in the diagnostic ring) — it never mounts inert and
never silently ignores your text. An applied edit is versioned
`PROMPT_VERSION+user:<hash>` so a behavioural claim still names one text.

The conformance invariants that cannot be checked on arbitrary text (no duplicated
statements, no authority claim, no implementation leakage, no restating an
enforced rule) are reported as `promptUnchecked` with
`abg.prompt_override_applied`. A user-edited prompt is therefore never presented
as an audited one.

### Web GUI panel

Installed into a Web profile, ABG adds one sidebar entry whose panel shows the
mount record, `degraded[]`, the compatibility verdict, `PROMPT_VERSION`, and the
diagnostic ring. It reads the host route `/api/abg/status` — the same JSON
contract as `abg_status` and the diagnostics mirror — behind the deployment's
`/api` browser-trust fence, so there is no separate RPC surface to secure.

The panel is read-only except for two things:

- **Prompt editor.** The textarea holds the effective section text; **Apply**
  writes it and it takes effect on the next step (no restart). Editing is
  enabled only when `prompt.mode: replace` and `prompt.file` name a path —
  otherwise the editor is read-only and says so. The same validation as the file
  path applies (no `{{ }}`, byte ceiling unless `allowOverBudget`), a refusal is
  shown inline, and an applied edit is attributed `PROMPT_VERSION+user:<hash>`
  with the soft invariants listed as *not verified on user text*.
- **Feedback form.** Fill what happened / expected / actual, then **Preview**
  composes the redacted report through the host (`composeFeedback`), with
  **Copy report** and **Open prefilled issue**; **File issue** appears only in
  opt-in `api` mode.

Both post to routes on the same host (`/api/abg/prompt`, `/api/abg/feedback`)
behind the deployment's browser-trust fence.

The browser half is `lib/client.js` and is **hand-authored**: a DSH client plugin
normally ships a bundle produced by the host monorepo's build, and no public
out-of-tree build exists, so it is written directly against the lazy-CJS envelope
(`window.__ModuleLoader__.load({id, factory})`, baseline `require`) and the slot
registry (`inject = ['slots']`; `ctx.slots.inject` / `register`). It is excluded
from `tsc` for the same reason first-party built client artifacts are. Edit it and
re-install the plugin into the profile — there is no build step.

### Diagnostics mirror (opt-in)

`diagnosticsExport.file` writes a bounded JSON snapshot — mount record, status
line, counts, and the newest `limit` diagnostics — for a front end that cannot
read the in-process ring. It is **off by default** (an empty path means no file
I/O at all), throttled to one write per 500 ms, written via a temporary file and
rename, and fails open: an unwritable path is reported once per window as
`abg.diagnostics_export_failed` and never affects enforcement.

## Install, update, and uninstall

ABG is installed **into one DSH profile**, never globally, and never into a
profile you rely on while the behavioural gates are unmeasured. The canonical
artifact is the npm tarball that `npm pack` produces (the release workflow
attaches it to the GitHub release).

### The package-manager limitation, first

`dsh plugin --profile <p> add|remove ...` forwards **everything after `plugin`
verbatim to pnpm** — the host hard-codes the package manager. A real install
prints, for example:

```text
Done in 25ms using pnpm v12.8.1
```

Two consequences:

- a machine without pnpm cannot use `dsh plugin` at all (the error is
  `dsh: pnpm was not found; install pnpm and make it available on PATH.`);
- everything after `plugin` must be a pnpm argument, so launcher flags such as
  `--from-default-profile`, `--dump-config`, or `--patch` belong **before**
  `plugin` and never after it.

`dsh plugin add` also does a second thing outside the package manager: it
registers the new package name in the profile manifest's `dsh.profile.bundles`
list. That list — not `node_modules` — is what makes DSH compose the `abg` row.
Plain `npm install` does not know about it, so an npm-only install leaves the
package on disk but **not mounted**. The helper below performs both steps.

### npm-native path (no pnpm required)

From a clone, with `npm`, `node` (>= 20), and `dsh` on `PATH`:

```bash
# install (packs this repository's plugin/ with `npm pack`)
./scripts/abg-npm.sh install --profile abg-test

# or install a release tarball you downloaded
./scripts/abg-npm.sh install --profile abg-test \
  --from dsh-agent-behavioral-governance-0.5.0.tgz

# is it mounted?
./scripts/abg-npm.sh status --profile abg-test

# update to a newer tarball
./scripts/abg-npm.sh update --profile abg-test --from dsh-agent-behavioral-governance-0.6.0.tgz

# uninstall
./scripts/abg-npm.sh uninstall --profile abg-test
```

`scripts/abg-npm.sh` is POSIX `sh`, has no dependencies beyond `node`/`npm`/`dsh`,
fails loudly, and is safe to run twice. It refuses to write to the live
`$HOME/.dsh` unless `--allow-live` (or `ABG_NPM_ALLOW_LIVE=1`) is given;
`status` is read-only. Its `--home <dir>` flag points it at any DSH home, which
is how the lifecycle check and CI keep the live profile untouched.

Beyond `npm install` / `npm uninstall`, the helper does the three things npm
does not:

1. it copies a local tarball into `<profile>/.abg-artifacts/` and installs that
   copy, so the recorded dependency is a stable
   `file:.abg-artifacts/<name>.tgz` instead of a relative path back into the
   source tree or download directory;
2. after install it appends the package name to `dsh.profile.bundles`;
3. after uninstall it removes that entry — npm leaves it behind, and DSH then
   prints `dsh: skipping profile bundle "dsh-agent-behavioral-governance"` on
   every boot.

### Upgrading a pnpm-installed profile to npm

A pnpm-installed profile has `pnpm-lock.yaml`; npm writes `package-lock.json`.
Each manager ignores the other's lockfile, and mixing does not break composition:
after `npm install` into a pnpm profile, `dsh --dump-config` still composes the
`abg` row and `dsh plugin remove` still works (and cleans `dsh.profile.bundles`).
To move a profile to npm, either uninstall first or install over the top:

```bash
./scripts/abg-npm.sh uninstall --profile abg-test   # or:
./scripts/abg-npm.sh install --profile abg-test --from <tarball>
```

Both were verified against a pnpm-installed profile. Prefer one manager per
profile: the other manager's lockfile is left **stale** after the switch (it
still names the package until that manager next runs), so delete the lockfile
you no longer use. A stale `package-lock.json` is pruned by the next plain
`npm install`.

### npm registry publication

**Not authorised.** The package is `"private": true` and is not published to
the npm registry; `npm install <name>` from a registry therefore does not work
today. Distribution is the release tarball (or a clone). `npm pack` remains the
canonical artifact producer, and the release workflow builds and attaches that
tarball. Removing `private` and choosing a publish target are release decisions
withheld until the model-backed gates pass (`ARCHITECTURE-SPEC` §31.1, §34.2 Q5).

## Verification

```bash
cd plugin
npm run build         # src/**/*.ts -> lib/generated (build artifacts the host loads)
\1npm test              # node --test (unit + integration) — 265 tests, no todo
./scripts/verify.sh   # the full evidence chain (12 checks), real profile install
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
artifact must bind one section, three listeners, and five tools, must absorb a bad
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
