---
doc_type: maintenance-handoff
project: information-environment-governance
plugin_version: 0.9.1
version: 0.8.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.9.1-batch-4
host_baseline_verified: dsh-0.2.1-alpha.1
supersedes: none
language: en
---

# IEG Maintenance Handoff

> **This is the maintained status record (package 0.8.0).** §3–§4 are the single
> source of truth for current status and numbers; other documents link here rather
> than restate them. §13 is **history** (the rename, the withdrawn capability, the
> old→new gate mapping, the `0.1.0`/v0.2.0 rounds, and the open-item closures).
> §13 content is labelled **HISTORICAL** or **RETIRED** and is not a current
> capability.

> **Read this first.** IEG — the sanctioned short form for
> `dsh-information-environment-governance` — is **not production-ready**; the open
> blockers are in §4. Everything in §3 is verified and reproducible; everything
> in §4 is not.

## 1. What this is

`dsh-information-environment-governance` (IEG) is an additive project-work
governance plugin for DeepSeek Harness. It governs the **information
environment** — the canonical definition is in
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1, not restated here. It has **two
governance entry points**: Project Constraint Governance, and Information /
Document Governance (workspace hygiene is an enforcement mechanism inside the
second). It contributes **one** system-prompt section and enforces through
`agent/pre-step`, `tools/pre-execute`, `ctx.tools.guard`, and
`ctx.storageDomain`.

The three enabled modules are `project-governance` (`FC-2.1`),
`information-integrity` (`FC-2.3`), and `workspace-governance` (`FC-2.2`).
`user-attention`/`FC-2.4` was removed in 0.7.0 — see §13.

Out of scope, and not to be drifted into: general AI safety/security,
sandboxing, authorization, user-attention optimization (**RETIRED** — the
capability was withdrawn in 0.7.0, §13.2), and unrelated agent behavior
management (authoritative statement: [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1.4).

| Path | What it is |
|---|---|
| [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) | positioning, scope, goals, requirements, success criteria |
| [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) | architecture; **Part A** verified host seams and deltas, **Part B** the target design and §32 gates |
| [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](IMPLEMENTATION-VALIDATION-HANDOFF.md) | retired — pointer to the §32 gates and the historical build order |
| repository root | the implementation: `package.json` + `cordis.patch.yml` (the DSH bundle), `src/**` (TypeScript source of truth), `lib/**` (committed build output), `bin/ieg`, `test/`, `test-support/`, and `scripts/verify.sh`. There is no `plugin/` subdirectory |
| [`eval/`](eval/README.md) | behavioural and end-to-end evaluation |

## 2. Run everything

The full check set and the commands that run it are maintained once, in
[`CONTRIBUTING.md`](CONTRIBUTING.md) §Running the checks. Behavioural evaluation
(costs model calls, uses an isolated `DSH_HOME`) is documented in
[`eval/README.md`](eval/README.md); its entry points are:

```bash
node eval/e2e.mjs 4 auth-doc-request   # real agent runs, re-installs first
node eval/e2e-analyze.mjs              # derives ordering from tool/call events
```

## 3. Verified state (single source of truth for status and numbers)

**Mechanisms — 3 modules, 2 model-facing tools.** The plugin ships
`project-governance` (`FC-2.1`), `information-integrity` (`FC-2.3`), and
`workspace-governance` (`FC-2.2`), all enabled by default, and registers exactly
two model-facing tools: `record_orientation` and `ieg_status`. It compiles
**one** prompt section, `ieg:governance` (`order: 8500`, `interpolate: false`,
`complete` never set), at **`PROMPT_VERSION` 0.4.0**. The compiled section is
**2,677 bytes**; the recorded ceiling is **2,945 bytes** (floor 1,400, hard cap
4,096). Integration tests mount the real `dsh-system-prompt`, `dsh-tools`,
`dsh-fs-local`, and the `dsh-storage`/`dsh-storage-json`/`dsh-storage-domain`
stack — not mocks. **272 tests (all pass, no todo, no skip) and 27/27
verification checks** were derived from the current tree on 2026-10-03, the 0.8.0
three-module packaging round. Counts move with each round; re-derive them with
`npm test` and `scripts/verify.sh`, and treat the numbers printed there —
not this sentence — as current. (The 0.7.0 round recorded 265 tests, and the
0.6.0 four-module round recorded 284 tests and 22/22 checks; both are
**HISTORICAL**.)

**Host baseline.** The single supported DSH baseline is **`0.2.1-alpha.1`**:
`dsh.engines.dsh` is `>=0.2.1-alpha.1 <0.3.0`, `dsh.compatibility.dshReleases`
records that one release as `verified`, and `lib/compatibility-baseline.json` was
re-captured against it in 0.8.0 (section order and host prompt hash `ceb63ee5`
identical to the previous baseline). The retired `0.2.0-rc.2` baseline is
**SUPERSEDED**: it is gone from the peer range and the release map. There is no
legacy compatibility layer; the adapter observes seam facts against the committed
baseline rather than branching on a version string.

**Durable state.** Governance state uses the `ctx.storageDomain` domain
`ieg_governance` at `DOMAIN_VERSION` 1. State written under the pre-0.7.0 domain
name is **not** migrated; only throwaway profiles are supported, so that is
accepted rather than handled.

**Behaviour — no current measurement.** The end-to-end results that used to stand
here were measured against earlier prompt revisions that no longer exist (a
five-module and then a four-module prompt). Those numbers and their sandboxes
were deleted as superseded rather than annotated, because a stale number still
reads as a standing result. **Gates C and D are therefore unmet for the current
revision**; a fresh `eval/` run with a rubric frozen beforehand and a judge that
does not see the arm is what produces a valid number.

**Acceptance gates (A–J).** Renumbered in 0.7.0 after the withdrawal of the
`user-attention` gate; the old→new mapping is in §13. The maintained table is
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
§32.1; the summary is:

| Gate | Statement | Status |
|---|---|---|
| A — Host compatibility | IEG is additive and the host prompt survives | met |
| B — Semantic non-conflict | no module contradicts an identified host semantic | met |
| C — Behavioural improvement | at least one target failure mode improves measurably against baseline | **unmet** |
| D — Information integrity | known-invalid information is no longer authoritative by default | **unmet** |
| E — Regression resilience | compaction, resume, and fork preserve governance state | met |
| F — Diagnosability | mount and gate decisions are observable without a logger exporter | met |
| G — Agent isolation | two live agents in one composition never share governance state | met |
| H — Compatibility baseline | the adapter reports a verdict and detects a simulated host change | met |
| I — Packaging | installable, licensed, changelogged, peer-range enforced | **partial** |
| J — Withdrawal integrity | the plugin ships three modules with no dangling reference to the removed one | met |

**Mount resilience (2026-10-02).** `apply()` does not throw: a configuration
fault mounts an inert but observable surface (`mounted: false`, `configError`,
`ieg.config_invalid`) instead of being reported by the host as an unactivated
entry, each capability is registered in its own guarded step, an absent seam is
recorded as `ieg.capability_missing` and listed in the mount record's
`degraded[]`, and logger narration is best-effort. Covered by
`test/integration/wiring.test.js` and proven against the **installed** artifact by
`verify.sh`'s installed-artifact check.

**Diagnosability and compatibility.** A bounded ring, the `ieg:status`
runtime-context line, and the read-only `ieg_status` tool report mount,
configuration, last denial, and the compatibility verdict without a logger
exporter. `lib/kernel/compatibility.js` observes the real
`system-prompt/assemble` waterfall and classifies `COMPATIBLE |
COMPATIBLE_WITH_WARNINGS | UNSUPPORTED | PENDING` against a committed baseline.

## 4. Not verified — the blockers

Status as of the 0.7.0 scope-reset round (2026-10-03). A blocker marked
**closed** keeps its entry so the record of what was wrong survives.

1. **Behavioural improvement (Gate C) has no valid measurement — open.** The only
   measurements ever taken were against superseded prompt revisions and were
   deleted. Gate C needs a fresh `eval/` run with a rubric frozen beforehand and
   a judge that does not see the arm.
2. **Information integrity (Gate D) has no valid measurement — open.** The same
   fresh-run requirement applies to whether known-invalid information stops being
   reused as authoritative.
3. **Not a publishable package (Gate I) — partial.** `LICENSE`, `CHANGELOG.md`,
   the `files` allowlist, and the narrowed peer range have landed; `"private":
   true` and the publish target remain until Gates C and D pass.
4. **The compatibility baseline for the installed host — closed in 0.8.0.** The
   declared peer range is now `>=0.2.1-alpha.1 <0.3.0`, and
   `dsh.compatibility.dshReleases` records `0.2.1-alpha.1` as `verified`.
   `lib/compatibility-baseline.json` was re-captured against the installed host
   and reviewed; the ordered section names, the host prompt hash (`ceb63ee5`) and
   the required capability set are identical to the previous baseline, so the
   prompt surface is semantically unchanged. The retired `0.2.0-rc.2` baseline is
   **SUPERSEDED** (closes §34.2 Q7 in the architecture spec).
5. **`user-attention` behavioural validation — withdrawn, no longer a blocker.**
   This entry previously recorded a headless measurement block for the
   `user-attention` module and its scripted answerer. The module, failure class
   `FC-2.4`, the question ledger/gate, and the evaluation-only answerer were
   removed in 0.7.0 (classification: Out of Scope / Externally Solved; §13). There
   is no residual blocker and no measurement owed.
6. **Diagnostics are invisible — closed.** The ring, the `ieg:status` line, and
   the read-only `ieg_status` tool report mount, configuration, last denial, and
   the compatibility verdict without a logger exporter, verified against the real
   `dsh-system-prompt` and `dsh-tools`.
7. **No compatibility adapter — closed.** `lib/kernel/compatibility.js` observes
   the real `system-prompt/assemble` waterfall and classifies a verdict against a
   committed baseline, so a host upgrade becomes visible.
8. **False positives unmeasured — closed in simulation.** A 21-call legitimate
   corpus plus the declared traps measures `false_block_rate = 0` and catches all
   traps (`test/integration/gate-precision.test.js`). Confirmation with real
   agents still requires a model run.
9. **Intrusive defaults chosen unilaterally — closed.** `requireBeforeMutation`
   defaults to `false` in `lib/kernel/config.js` and in the shipped
   `cordis.patch.yml` row, so the first write of a session is governed by the
   workspace policy alone; strict mode is an explicit opt-in. The residual is
   narrower and policy-level, not a default: `overlapCheck: 'ask'` still degrades
   to denial where no approval channel exists (the fail-closed path), which is why
   the evaluation arms its gates explicitly.

## 5. Architecture map

`src/**/*.ts` is the source of truth; `lib/**` below is the committed `tsc` build
output of it (see [`TYPESCRIPT-MIGRATION.md`](TYPESCRIPT-MIGRATION.md)). The tree
shown is the **built** runtime the host actually loads.

```text
lib/
├── index.js              Cordis entry: section, listeners, tool registration, wiring
├── contract.d.ts         ambient seam contract — the ONLY record of host API shapes
├── kernel/
│   ├── config.js         strict config validation (plain object, no schema lib)
│   ├── registry.js       module contract, enablement, dependency/conflict resolution
│   ├── prompt-compiler.js one section, dedupe, budget, interpolation safety
│   ├── orientation.js    orientation store + record_orientation tool
│   ├── overlap.js        document-overlap detector (body / H1 / filename subject)
│   ├── durability.js     ctx.storageDomain persistence, fails open
│   └── compatibility.js  host assembly observation + verdict
└── modules/              the three governance modules (pure logic + descriptor)
```

The corresponding sources are `src/index.ts`, `src/kernel/*.ts`, and
`src/modules/*.ts`; `bin/ieg` is the host-required executable shim and the CLI
source is `src/bin/ieg.ts`.

Seams actually bound:

```text
system prompt      ctx.systemPrompt.section()        advisory, never `complete`
status line        ctx.systemPrompt.context()        advisory (`ieg:status`)
step admission     agent/pre-step                    veto
orientation tool   record_orientation (registered)   capture
orientation gate   tools/pre-execute                 deny until recorded
mutation gate      tools/pre-execute                 ask / deny
overlap gate       ctx.fs scan + tools/pre-execute   ask / deny
mutation backstop  ctx.tools.guard()                 deny only, monotonic
durability         ctx.storageDomain                 per-session orientation
compatibility      system-prompt/assemble            observe only, must call next()
control plane      dsh-ieg start|pause|restart|exit   control (state file; absent = running)
```

There is **no question ledger and no `record_question` tool**: that seam was
removed with `user-attention` in 0.7.0.

## 6. Configuration surface

The authoritative key/value documentation is
[`docs/PACKAGE-REFERENCE.md`](docs/PACKAGE-REFERENCE.md) §Configuration; the validator in
`lib/kernel/config.js` is the executable truth. Top-level keys:

```text
enabled  sectionOrder  modules  workspace  preStep
prompt  diagnostics  diagnosticsExport
```

`userAttention` was **removed** in 0.7.0 and is now **rejected as an unknown
key**. Defaults a maintainer must not change silently: `workspace.policy: ask`,
`workspace.overlapCheck: ask`, `workspace.classifyShellCommands: true`,
`preStep.orientationGate: off`, `preStep.requireBeforeMutation: false`,
`diagnostics: true`, and `prompt.mode: compiled`. Non-intrusive defaults are the
documented decision; strict enforcement is an explicit opt-in.

The control plane (`dsh-ieg start|pause|restart|exit`) is a separate input, not
config: its record lives at `$IEG_STATE_FILE` (else
`<state-dir>/ieg/state.json`, `<state-dir>` = `$XDG_STATE_HOME` or
`~/.local/state`), with a sibling `prompt.md`. Prompt precedence:
control-plane `prompt.md` > config `prompt.file` (mode `replace`) > config
`prompt.append` (mode `append`) > the compiled default.

## 7. Environment and process gotchas

These each cost real time. Do not rediscover them.

- **A delegated agent has no approval channel, so the default policy denies its
  writes.** With `workspace.policy: ask` (the shipped default) the mutation gate
  returns `ask` and the host resolves it through `ctx.approval`. A Lead session in
  the Web GUI has an answerer; an Agent-Teams teammate or subagent session does
  not, so the gate fails closed and **every** `write`/`edit` it attempts is
  refused with `ieg.workspace_mutation_blocked` — while the run looks like a
  mysterious stall rather than a policy decision. Observed live on 2026-10-03: a
  delegated session recorded its orientation correctly, passed the overlap check,
  and was still denied on every write, and it correctly refused to route around
  the gate. Either perform delegated file work in a session with an approval
  channel, or give the delegated session `workspace: { policy: allow }` for the
  duration (`dsh-ieg pause` disables enforcement for every agent sharing the
  state file, not just one). This is the documented fail-closed path working as
  designed, not a defect — but it is the first thing to check when a teammate
  produces nothing.
- **`ieg_status` must render content or it is silently useless.** A tool whose
  `render` returns no blocks succeeds, records its call, and shows the caller
  nothing; and because tool registration is guarded, an invalid `output.schema`
  removes the tool without failing the mount. Both happened (`0.9.0` fixes them);
  a read-only tool needs a test that asserts its **rendered** content, not just
  its canonical value.
- **`dsh plugin --profile <name> <args…>` forwards every argument to pnpm.** Any
  launcher flag placed after `plugin` reaches pnpm and fails with
  `error: unexpected argument '--from-default-profile'` followed by
  `Usage: pnpm [OPTIONS] <COMMAND>`. Profile creation therefore reads
  `dsh --profile ieg-test --from-default-profile headless --dump-config` — with
  no `plugin` subcommand. This error was reported by the first volunteer because
  `TESTING.md` documented the wrong form; the docs were corrected, and
  `scripts/check-install.sh` now checks the install end to end.
- **A profile links the plugin at install time.** Re-running validation after a
  source change silently exercises the *old* code. This produced a misleading
  result once. `eval/e2e.mjs` re-installs before running; do the same for any
  manual re-validation.
- **`ctx.logger` prints nothing** in stock compositions. Debug through behaviour
  and session logs, not log output.
- **Session logs are multi-frame zstd.** `zstdDecompressSync` decodes only the
  first frame and yields a single header event. Split on the magic
  `0x28 0xB5 0x2F 0xFD` and decode each frame — `eval/e2e-analyze.mjs` does this.
- **`ctx.fs` throws when the service is absent**; `ctx.get('fs')` returns
  `undefined`. Always use `ctx.get`.
- **Ordering must come from `tool/call` events.** Text search matches tool
  schemas in each request header, which precede every call.
- **`node --test` rejects a directory argument** (`node --test test/` fails).
  Use auto-discovery or a glob.
- **pnpm hard-links change inode ctime**, so the file-edit guard may demand a
  re-read of a file you just edited. Re-read, do not fight it.
- **Every `dsh` command needs `DSH_HOME` exported** to target an isolated home.
  `IEG_DSH_PACKAGES` points the test loader at a non-default DSH install, and
  `IEG_VERIFY_HOME` relocates the verification chain's throwaway home.
- **The live `~/.dsh` was never used** by any IEG install or evaluation. Profiles
  `iegh`, `iegv`, `iegverify` (`.ieg-verify/`) and `iege2e` (`.ieg-e2e/`) are all
  throwaway. IEG does appear in this session's own session-cache files under
  `~/.dsh/storages/`, because evaluation subagents ran inside this session — that
  is session history, not an install.
- **The plugin list shows the profile you are *running*, not the one you installed
  into.** Installing into `ieg-test` while the harness runs `web` looks exactly
  like a failed install. The package, the manifest reference, and the composed
  `ieg` row are all per profile; `scripts/check-install.sh <profile>` reports
  which of the three states you are in. `dsh --profile <name> --dump-config`
  needs **write** access to that profile directory (it materialises a temporary
  `cordis.yml`), so a sandboxed or read-only `DSH_HOME` yields "unverified" rather
  than a false negative.
- **`ignorable`** — a plugin-owned session event cannot carry the envelope's
  `ignorable` marker, so a log written with IEG loaded cannot be reconstructed
  without IEG. This is why durable state uses `storageDomain` rather than
  `session.append`. See the architecture spec's Part A durable-state seams.

## 8. Ranked backlog

1. **Regenerate the behavioural evidence (Gate C)** — a fresh `eval/` run with a
   frozen rubric and a blind judge, against the current three-module prompt.
2. **Measure information integrity (Gate D)** — the invalidated-information
   scenario, scored on whether invalidated information stops being reused as
   authoritative.
3. **False-positive confirmation with real agents** — the simulated matrix shows
   `false_block_rate = 0`; only a model run can confirm it beyond the matrix.
4. **Packaging close-out (Gate I)** — remove `private` and choose the publish
   target once Gates C and D pass.
5. **Orientation Consistency direction** — named terminology only (declared
   constraints → observed actions → consistency/drift evaluation). **Not
   implemented in this batch**; do not build or promise it without a scope
   decision.
6. **Retrieval-eligibility semantics** — named terminology only (existence,
   status, authority, provenance, supersession, retrieval eligibility). **No
   retrieval system is built in this batch.**

## 9. Decisions waiting on the user

Consolidated in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` Part B (§34.2). **Decided:**
the non-intrusive defaults, the `ask`-only gate with no IEG-registered answerer,
and deferring to `dsh-agent-instructions`. **Closed in 0.8.0:** the compatibility
baseline re-capture (§4 item 4, Q7) and the module descriptor versions (Q9).
**Still open:**

- **Section order `8500`** — the code ships it and a regression test fixes it,
  but the value itself is still to be confirmed as final (§34.2 Q2).
- **Publish target** — registry, git, or local `file:` distribution for the
  package once Gates C and D pass (§34.2 Q5).
- **Live-profile rollout** — whether IEG is ever installed into the live `web`
  profile (§10), and under what conditions; it currently is not (§34.2 Q6).
- **Control state is per-user, not per-profile** — `$IEG_STATE_FILE` /
  `$XDG_STATE_HOME` resolves once for the whole user, so two profiles on one host
  share one governance switch. Decide whether that is intended or whether the
  control file must become profile-scoped (§34.2 Q8).

## 10. Why IEG does not appear in the plugin list

IEG is installed **only** into throwaway profiles under isolated `DSH_HOME`
directories. The plugin list in a live app reflects the **live `web` profile**
(`DSH_PROFILE=web`, `~/.dsh/profiles/web`), whose bundle list contains
`dsh-base`, `dsh-web-app`, and `dsh-experimental-agent-team-profile` — no IEG.
That absence is deliberate: it kept the evaluation from touching a working
environment.

Two further reasons it would not appear anywhere else:

- the package is publishable but not published, and installed from a local `file:` path, so it
  is not in any registry or marketplace inventory;
- it is discovered through a profile's own manifest and bundle patch, so it
  appears only after being added to that profile.

To install it into the live profile (**not recommended while §4 is open**):

```bash
dsh plugin --profile web add file:/home/hero/Deepseek-harness-0928/DSH-plugins/agent-behavioral-governance-pugin
```

## 11. Resolved: `dsh-free-search` removal

**Confirmed by the user as their own action.** The live `web` profile no longer
references `dsh-free-search` — absent from `dsh.profile.bundles`, from
`dependencies`, and from `node_modules`; manifest modified `2026-10-01 10:55:55`.

No IEG install or evaluation touched the live profile: every invocation exported
an isolated `DSH_HOME`. Recorded here so a future maintainer does not
re-investigate it as a side effect of this work.

## 12. Workspace layout and regeneration

The tree is trimmed to sources, documents, and regenerable scaffolding. Its size
is deliberately not recorded here: it is dominated by regenerable artifacts and
changes with each run — measure it with `du -sh .` instead of trusting a number.

```text
├── README.md                             entry point and evidence-chain summary
├── PRODUCT-SPEC.md                       positioning, scope, success criteria
├── ARCHITECTURE-SPEC-AGENT-REFERENCE.md  architecture; Part A seams, Part B design, §32 gates
├── IMPLEMENTATION-VALIDATION-HANDOFF.md  retired pointer to §32 and the build order
├── MAINTENANCE-HANDOFF.md                this file — current status and numbers
├── TESTING.md                            volunteer install, trial, and deviation reporting
├── SECURITY.md                           boundaries, known limitations, reporting
├── CONTRIBUTING.md                       process contract and the checks to run
├── CODE_OF_CONDUCT.md                    Contributor Covenant 2.1
├── CHANGELOG.md                          release history (pre-0.7.0 keeps the ABG name)
├── TYPESCRIPT-MIGRATION.md               build model, exceptions, migration history
├── scripts/                              check-install.sh, check-docs.sh, ieg-npm.sh, verify.sh
├── docs/                                 documentation index and package reference
├── package.json / cordis.patch.yml       the DSH bundle manifest and patch — the root is the package
├── src/                                  TypeScript source of truth (kernel, three modules, CLI)
├── lib/                                  compiled runtime emitted from src/ (committed; no lib/generated/)
├── bin/ieg                               host-required executable shim
├── test/                                 unit, conformance, and integration suites
├── test-support/dsh.js                   real-distribution test loader
├── eval/                                 behavioural and end-to-end evaluation
│   ├── README.md                         method, metrics, process lessons
│   ├── harness.mjs                       seed | prompt | measure | list
│   ├── scenarios.mjs                     seeded scenarios and task prompts (four scenarios)
│   ├── e2e.mjs                           real-agent runs, re-installs first
│   └── e2e-analyze.mjs                   ordering derived from tool/call events
├── .ieg-e2e/                             end-to-end overlays + throwaway DSH home
├── .ieg-verify/                          verify.sh's throwaway home and logs
└── .pnpm-store/                          pnpm content-addressable store (regenerable)
```

`eval/runs/` is created by a run rather than stored with the method:
[`eval/README.md`](eval/README.md) holds the method and the metric definitions,
not numbers. The JSON outputs of a run (`e2e-results.json`, `e2e-analysis.json`)
are transient for the same reason — a stale copy of a derived artifact reads as a
standing record.

**Regenerable artifacts — regenerate rather than keep:**

| Artifact | Recreate with | Cost |
|---|---|---|
| `.ieg-verify/` throwaway home + test logs | `scripts/verify.sh` (honours `IEG_VERIFY_HOME`) | free |
| `.ieg-e2e/dsh-home/` throwaway profile | [`eval/README.md`](eval/README.md) | free |
| Staged credentials inside that home | [`eval/README.md`](eval/README.md) | user-authorized only |
| A sandbox's **initial** state under `eval/runs/` | `node eval/harness.mjs seed <scenario> <arm> <rep>` | free |
| A sandbox's **recorded end state** | a real agent run | model calls |

**Removed in prior hygiene passes, and why:**

- A previous `.ieg-e2e/dsh-home/` held a **copy of the user's credentials** and a
  profile whose linked plugin copy was stale, i.e. exactly the trap in §7. Both
  are reasons to regenerate rather than keep.
- `.ieg-verify/` (952 KB) — throwaway; `verify.sh` recreates it.
- `.pnpm-store/` — created at the repository root by `dsh plugin add` inside
  `verify.sh`. **Fixed at the source**, not just deleted: the script tears the
  store down on exit, explicitly as well as via a trap, because `dsh` spawns pnpm
  with its own environment so an exported `store-dir` never reaches pnpm.
- Superseded evaluation sandboxes, verbatim agent answers, and behavioural result
  tables in `README.md`, `docs/PACKAGE-REFERENCE.md`, and `eval/README.md`. They were
  deleted rather than annotated, because an annotated stale number still reads as
  a standing result.

**Kept deliberately:** `.ieg-e2e/ieg-config.yml` and `ieg-off.yml` — the treatment
and control overlays. They are configuration, not results, and a re-run needs
them.

## 13. HISTORY

> **This section is history.** It records changes that readers of older material
> will still encounter. Nothing here is a current capability.

### 13.1 Rename — ABG to IEG (0.7.0)

Before 0.7.0 the project was `dsh-agent-behavioral-governance` ("ABG"), with the
`abg` terminal command. **0.7.0 renamed it** to
`dsh-information-environment-governance` ("IEG"), with the `dsh-ieg` terminal
command. Pre-0.7.0 [`CHANGELOG.md`](CHANGELOG.md) entries
deliberately keep the old name, because a changelog is immutable history; reading
"ABG" or `abg` in an old entry is expected, not a defect.

### 13.2 Withdrawn capability — `user-attention` / `FC-2.4` (0.7.0)

The `user-attention` module and failure class `FC-2.4` (fragmented user
questioning) were **removed in 0.7.0**. Classification: **Out of Scope /
Externally Solved**. Testing found a stable prompt-level solution, so runtime
governance is no longer justified. It was **not** a failed feature.

Removed with it: the per-agent question ledger, the question batcher/gate, the
read-only question tool, the runtime-context question surface, the
`userAttention` configuration key (now rejected as unknown), and the
evaluation-only scripted question answerer plus the question-consolidation
scenario. Pre-0.7.0 CHANGELOG entries keep the historical name.

### 13.3 Acceptance-gate renumbering (0.7.0)

The withdrawn user-attention gate (old **D**) was removed, the letters after it
shifted down, and the set now runs **A–J with no gap**. Old → new:

```text
old E -> D      old F -> E      old G -> F      old H -> G
old I -> H      old J -> I      old K -> J
old D (user-attention efficiency) -> withdrawn
```

### 13.4 Module history

- **`child-agent-lifecycle` / `FC-2.5`** was planned as a fifth module and
  **withdrawn** by explicit user decision in the v0.2.0 round: the benefit did
  not justify the workload, a populated child list is expected on a healthy
  system, and the evaluation harness contained no delegation scenario. Its
  module, listeners, contract types, prompt fragment, tests, and product clauses
  were removed, and remaining identifiers were renumbered. The plugin then
  shipped **four** modules.
- **0.7.0** removed `user-attention` (§13.2), leaving the current **three**.

### 13.5 The `0.1.0` and v0.2.0 rounds

- **`0.1.0` (2026-10-01)** — the initial prototype: kernel, prompt aggregation,
  module registry, and the first enforcement seams, with a 159-test evidence
  chain recorded verbatim in the CHANGELOG. Its build order and validation cases
  lived in [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](IMPLEMENTATION-VALIDATION-HANDOFF.md),
  which is now a retired pointer to the maintained homes.
- **v0.2.0** — the "operable and reviewable" round: scope-isolated per-agent
  state (Gates E/G here; F/H in the old letters), four-channel diagnosability
  (Gate F here; G old), the compatibility adapter (Gate H here; I old),
  gate-precision simulation, and the packaging groundwork. Its phases and gate
  matrix are in [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
  Part B. The earlier 265-test 0.5.x structural round and 238-test v0.2.0 round
  are recorded in CHANGELOG history.
- **0.6.0** — the control-plane round: the Web panel and in-harness issue
  reporting were removed and replaced by the terminal interface (then `abg`),
  the control record, and `prompt.md`. Its `PROMPT_VERSION` was unchanged because
  the compiled governance text was identical.
- **0.8.0 (2026-10-03)** — the **DSH migration and packaging round** (the
  repository root became the installable package; `plugin/` was removed; the host
  baseline moved to `0.2.1-alpha.1`; the runtime finished migrating to TypeScript;
  the retired `lib/generated/` output directory was removed). `PROMPT_VERSION` was
  **unchanged at 0.3.0** and the compiled text **byte-identical** in that round
  deliberately did **not** optimize the prompt. The structural regression
  `test/integration/packaging.test.js` was added, and `bounded-repair` (OBJ-3)
  completed the evaluation scenario set.

### 13.6 Open-item (Q) closures — no renumbering (0.8.0)

`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §34.2 keeps its Q numbering. Two items
closed in 0.8.0 and remain listed there as **decided** (the same convention as
Q1/Q3/Q4), so no number disappeared and none was renumbered:

```text
Q7  compatibility baseline re-capture      -> CLOSED (single baseline 0.2.1-alpha.1)   §34.2, §4 item 4
Q9  module descriptor version fields       -> CLOSED (descriptors now 0.2.0)           §34.2, §24
Q2  section order 8500                     -> still OPEN
Q5  publish target                         -> still OPEN
Q6  live-profile rollout                   -> still OPEN
Q8  control state per-user vs per-profile  -> still OPEN
```
