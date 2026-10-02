---
doc_type: maintenance-handoff
project: agent-behavioral-governance
# The round this record was opened for; the body below is maintained forward, so
# treat this as a starting point rather than the current package version (0.5.0).
plugin_version: 0.1.0
status: in-progress-not-production-ready
host_baseline_verified: dsh-0.2.0-rc.2
supersedes: none
superseded_in_part_by: architecture-spec-part-b-target-design
language: en
---

# ABG Maintenance Handoff

> **Superseded in part (v0.2.0).** This handoff remains the honest record of the
> `0.1.0` prototype. The forward design is
> `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` **Part B** (§§22–34), which closes the
> blockers below. The remaining blockers are carried into Part B, and the open
> design decisions are consolidated in its §34.2.

> **Read this first.** Testing was suspended for context reasons, not because the
> work is finished. ABG — the sanctioned short form for
> `dsh-agent-behavioral-governance` — is **not production-ready**; the blockers
> are listed in §4 and are the reason a release handoff was withheld. Everything
> in §3 is verified and reproducible; everything in §4 is not.

## 1. What this is

`dsh-agent-behavioral-governance` (ABG) is an additive project-work governance
plugin for DeepSeek Harness. It contributes **one** system-prompt section and
enforces through `agent/pre-step`, `tools/pre-execute`, `ctx.tools.guard`, and
`ctx.storageDomain`.

| Path | What it is |
|---|---|
| [`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) | positioning, scope, goals, success criteria |
| [`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) | architecture; **§17 source-verified host seams**, **§18 deltas D1–D15**, §20 assumptions |
| [`IMPLEMENTATION-VALIDATION-HANDOFF.md`](IMPLEMENTATION-VALIDATION-HANDOFF.md) | original build order and acceptance gates |
| [`plugin/`](plugin/README.md) | the implementation |
| [`eval/`](eval/README.md) | behavioural and end-to-end evaluation |

## 2. Run everything

```bash
cd plugin
npm run typecheck      # tsc --checkJs, strict, via the ambient contract in lib/contract.d.ts
npm test               # node --test — 259 tests (all pass; no todo, no skip)
./scripts/verify.sh    # 11 checks: typecheck, tests, install, composition, execution proof, mount
```

Behavioural evaluation (costs model calls, uses an isolated `DSH_HOME`):

```bash
node eval/e2e.mjs 4 auth-doc-request   # 8 real agent runs, re-installs first
node eval/e2e-analyze.mjs              # derives ordering from tool/call events
```

## 3. Verified state

**Mechanisms — 259 tests (all pass, no todo, no skip) and 11/11 verification checks at
the current round (v0.5.0, the front-end and GUI rounds); 238 tests at the v0.2.0
structural round; 159 tests at the `0.1.0` record below.** Integration tests
mount the real `dsh-system-prompt`, `dsh-tools`, `dsh-fs-local`, and the
`dsh-storage`/`dsh-storage-json`/`dsh-storage-domain` stack — not mocks.

**Behaviour — no current measurement.** The end-to-end results that used to stand
here were measured against the **five-module** governance prompt, which contained
the module removed by explicit user decision (`ARCHITECTURE-SPEC` §23). The plugin
now compiles a **four-module** prompt, so those numbers described a prompt
revision that no longer exists; they and their sandboxes were deleted as
superseded rather than annotated. **Gates C, D, and E are unmeasured for the
current revision**; a fresh `eval/` run is what produces a valid number.

**Gate F now passes.** Orientation is persisted per session through
`ctx.storageDomain`, so a resumed session is not asked to re-orient. Verified by
`test/integration/durability-storage.test.js` against the real storage stack,
including per-session scoping and corruption tolerance. With **no** storage
facility the layer degrades to in-memory state and correct (if less convenient)
enforcement rather than failing — `durability.test.js`.

**Mount resilience (2026-10-02).** `apply()` no longer throws: a configuration
fault mounts an inert but observable surface (`mounted: false`, `configError`,
`abg.config_invalid`) instead of being reported by the host as an unactivated
entry, each capability is registered in its own guarded step, an absent seam is
recorded as `abg.capability_missing` and listed in the mount record's `degraded[]`,
and logger narration is best-effort. Covered by four tests in
`test/integration/wiring.test.js` and proven against the **installed** artifact by
`verify.sh` check 5.

## 4. Not verified — the blockers

Status as of the v0.2.0 structural round. A blocker marked **closed** keeps its
entry so the record of what was wrong survives; the mechanism and its test are
named.

1. **Diagnostics are invisible — closed.** A bounded ring, the `abg:status`
   runtime-context line, and the read-only `abg_status` tool now report mount,
   configuration, last denial, and the compatibility verdict without a logger
   exporter, verified against the real `dsh-system-prompt` and `dsh-tools`.
2. **No compatibility adapter — closed.** `lib/kernel/compatibility.js` observes
   the real `system-prompt/assemble` waterfall and classifies `COMPATIBLE |
   COMPATIBLE_WITH_WARNINGS | UNSUPPORTED | PENDING` against a committed
   baseline, so a host upgrade becomes visible.
3. **False positives unmeasured — closed in simulation.** A 21-call legitimate
   corpus plus the declared traps measures `false_block_rate = 0` and catches all
   four traps (`test/integration/gate-precision.test.js`). Confirmation with real
   agents still requires a model run.
4. **Module 3 (`user-attention`) behavioural validation is structurally blocked in
   headless — open.** A headless composition has no question answerer, so
   `ask_user_question` is never reached and batching cannot be measured there.
   Part B §30.4 specifies the scripted answerer that unblocks it.
5. **Behavioural evidence does not exist for the current revision — open.** The
   only measurements ever taken were against the five-module prompt and were
   deleted as superseded. Gates C, D, and E therefore need a fresh `eval/` run,
   with a rubric frozen beforehand and a judge that does not see the arm.
6. **Not a publishable package — partially closed.** `LICENSE`, `CHANGELOG.md`,
   the `files` allowlist, and the narrowed peer range have landed; `"private":
   true` and the publish target remain until gates C, D, and E pass.
7. **Intrusive defaults chosen unilaterally — closed.** `ARCHITECTURE-SPEC`
   §34.2 Q1 records the user decision to adopt non-intrusive defaults, and the
   code now implements it: `requireBeforeMutation` defaults to `false` in
   `lib/kernel/config.js` and in the shipped `cordis.patch.yml` row, so the first
   write of a session is governed by the workspace policy alone. Strict mode
   remains an explicit opt-in, and the requirement's tests state it explicitly.
   The residual is narrower and policy-level, not a default: `overlapCheck: 'ask'`
   still degrades to denial where no approval channel exists (Q3's fail-closed
   path), which is why the evaluation arms its gates explicitly.

## 5. Architecture map

```text
plugin/lib/
├── index.js              Cordis entry: section, listeners, tool registration, wiring
├── contract.d.ts         ambient seam contract — the ONLY record of host API shapes
├── kernel/
│   ├── config.js         strict config validation (plain object, no schema lib)
│   ├── registry.js       module contract, enablement, dependency/conflict resolution
│   ├── prompt-compiler.js one section, §5.2 dedupe, budget, interpolation safety
│   ├── orientation.js    orientation store + record_orientation tool
│   ├── questions.js      question ledger + record_question tool + batch gate
│   ├── overlap.js        document-overlap detector (body / H1 / filename subject)
│   └── durability.js     ctx.storageDomain persistence, fails open
└── modules/              the four governance modules (pure logic + descriptor)
```

Seams actually bound:

```text
system prompt      ctx.systemPrompt.section()        advisory, never `complete`
step admission     agent/pre-step                    veto
orientation tool   record_orientation (registered)   capture
orientation gate   tools/pre-execute                 deny until recorded
mutation gate      tools/pre-execute                 ask / deny
overlap gate       ctx.fs scan + tools/pre-execute   ask / deny
mutation backstop  ctx.tools.guard()                 deny only, monotonic
question ledger    ask_user_question + record_question  deny incomplete batches
durability         ctx.storageDomain                 per-session orientation
```

## 6. Configuration surface

```yaml
- id: abg
  config:
    enabled: true
    sectionOrder: 8500
    workspace:
      policy: ask                    # allow | ask | deny
      mutatingTools: [write, edit, str_replace_editor]
      protectedPaths: []
      overlapCheck: ask              # off | ask | deny
      classifyShellCommands: true    # classify shell writes from command text
    preStep:
      orientationGate: off           # off | warn | reject
      requireBeforeMutation: false   # opt-in; true refuses the first write (§34.2 Q1)
    userAttention:
      enforceBatchCompleteness: true
    diagnostics: true
```

## 7. Environment and process gotchas

These each cost real time. Do not rediscover them.

- **`dsh plugin --profile <name> <args…>` forwards every argument to pnpm.** Any
  launcher flag placed after `plugin` reaches pnpm and fails with
  `error: unexpected argument '--from-default-profile'` followed by
  `Usage: pnpm [OPTIONS] <COMMAND>`. Profile creation therefore reads
  `dsh --profile abg-test --from-default-profile headless --dump-config` — with
  no `plugin` subcommand. This error was reported by the first volunteer because
  `TESTING.md` documented the wrong form; §28.6-era docs were corrected, and
  `scripts/check-install.sh` now checks the install end to end.
- **The plugin list shows the profile you are *running*, not the one you installed
  into.** Installing into `abg-test` while the GUI runs `web` looks exactly like a
  failed install and is the second defect the first volunteer reported. The
  package, the manifest reference, and the composed `abg` row are all per profile;
  `scripts/check-install.sh <profile>` reports which of the three states you are
  in, and `dsh --profile <name> --dump-config` needs **write** access to that
  profile directory (it materialises a temporary `cordis.yml`), so a sandboxed or
  read-only `DSH_HOME` yields "unverified" rather than a false negative.
- **An installed profile links the plugin at install time.** Re-running validation
  after a source change silently exercises the *old* code. This produced a
  misleading result once. `eval/e2e.mjs` now re-installs before running; do the
  same for any manual re-validation.
- **`ctx.logger` prints nothing** in stock compositions (see §4, blocker 1). Debug through
  behaviour and session logs, not log output.
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
- **The live `~/.dsh` was not used** by any ABG install or evaluation. Profiles
  `abgh`, `abgv`, `abgverify` (`.abg-verify/`) and `abge2e` (`.abg-e2e/`) are all
  throwaway. ABG does appear in this session's own session-cache files under
  `~/.dsh/storages/`, because evaluation subagents ran inside this session — that
  is session history, not an install.
- **`ignorable`** — a plugin-owned session event cannot carry the
  envelope's `ignorable` marker, so a log written with ABG loaded cannot be
  reconstructed without ABG. This is why durable state uses `storageDomain`
  rather than `session.append`. See §20.2 item 1 of the architecture spec.

## 8. Ranked backlog

1. ~~**Diagnostics channel**~~ — done: bounded ring, `abg:status`, `abg_status`.
2. ~~**Compatibility adapter**~~ — done: `lib/kernel/compatibility.js` plus a
   committed baseline.
3. **False-positive confirmation with real agents** — the simulated matrix shows
   `false_block_rate = 0`; only a model run can confirm it beyond the matrix.
4. **Behavioural coverage for module 3** in a composition where questions can
   actually be answered (the part B §30.4 scripted answerer).
5. **Regenerate the behavioural evidence** for the four-module prompt — a fresh
   `eval/` run with a frozen rubric and a blind judge, which is what moves Gates
   C, D, and E.
6. **Packaging close-out** — remove `private` and choose the publish target once
   Gates C, D, and E pass.

## 9. Decisions waiting on the user

Consolidated in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §34.2. **Decided:** Q1
(non-intrusive defaults), Q3 (gate with `ask`, register no answerer), Q4 (defer to
`dsh-agent-instructions`). **Still open, and each blocks release:**

- **Q2** — confirm the numeric section order (`8500`) and the regression test that
  fixes it.
- **Q5** — choose the publish target (registry, git, or local `file:`).
- **Q6** — decide whether ABG is ever installed into the live `web` profile (§10);
  it currently is not.

## 10. Why ABG does not appear in the plugin list

ABG is installed **only** into throwaway profiles under isolated `DSH_HOME`
directories. The plugin list you are looking at reflects the **live `web`
profile** (`DSH_PROFILE=web`, `~/.dsh/profiles/web`), whose bundle list contains
`dsh-base`, `dsh-web-app`, and `dsh-experimental-agent-team-profile` — no ABG.
That absence is deliberate: it kept the evaluation from touching a working
environment.

Two further reasons it would not appear anywhere else:

- the package is `"private": true` and installed from a local `file:` path, so it
  is not in any registry or marketplace inventory;
- it is discovered through a profile's own manifest and bundle patch, so it
  appears only after being added to that profile.

To install it into the live profile (**not recommended while §4 is open**):

```bash
dsh plugin --profile web add file:/home/hero/Deepseek-harness-0928/DSH-plugins/agent-behavioral-governance-pugin/plugin
```

## 11. Resolved: `dsh-free-search` removal

**Confirmed by the user as their own action.** The live `web` profile no longer
references `dsh-free-search` — absent from `dsh.profile.bundles`, from
`dependencies`, and from `node_modules`; manifest modified `2026-10-01 10:50:55`.

No ABG install or evaluation touched the live profile: every invocation exported
an isolated `DSH_HOME`. Recorded here so a future maintainer does not
re-investigate it as a side effect of this work.

## 12. Workspace layout and regeneration

The tree is trimmed to sources, documents, and regenerable scaffolding. It
currently measures **≈ 3.2 MB**.

> **Currency note (2026-10-02).** The size, tree, and "deliberately absent"
> table below were written during the `0.1.0` hygiene pass and several of their
> statements no longer hold: the tree is 3.2 MB rather than 0.7 MB;
> `.abg-e2e/dsh-home/` is present again, although its staged `.credentials.yaml`
> has since been deleted; `.pnpm-store/` is present again at the repository root;
> and `eval/runs/` exists again with partial `question-consolidation` runs. The
> `.pnpm-store/` teardown described below is implemented in
> `plugin/scripts/verify.sh` only — `eval/e2e.mjs` performs the installs that
> create the store and has no teardown.

```text
├── README.md                             index and evidence-chain summary
├── PRODUCT-SPEC.md                       positioning and success criteria
├── ARCHITECTURE-SPEC-AGENT-REFERENCE.md  architecture; §18 holds deltas D1–D15
├── IMPLEMENTATION-VALIDATION-HANDOFF.md  original build order and gates
├── MAINTENANCE-HANDOFF.md                this file
├── plugin/                               the implementation (source, tests, config)
│   ├── lib/                              kernel and the four governance modules
│   ├── test/                             unit, conformance, and integration suites
│   ├── scripts/verify.sh                 the full evidence chain
│   └── test-support/dsh.js               real-distribution test loader
├── eval/                                 behavioural and end-to-end evaluation
│   ├── README.md                         method, metrics, process lessons
│   ├── harness.mjs                       seed | prompt | measure | list
│   ├── scenarios.mjs                     seeded scenarios and task prompts
│   ├── e2e.mjs                           real-agent runs, both arms, re-installs first
│   ├── e2e-analyze.mjs                   ordering derived from tool/call events
│   ├── answerer/                         evaluation-only scripted question answerer
│   └── runs/                             sandboxes created by a run (see below)
├── .abg-e2e/                             end-to-end overlays + throwaway DSH home
└── .pnpm-store/                          pnpm content-addressable store (regenerable)
```

`eval/runs/` is created by a run rather than stored with the method:
[`eval/README.md`](eval/README.md) holds the method and the metric definitions,
not numbers. The JSON outputs of a run (`e2e-results.json`, `e2e-analysis.json`)
are transient for the same reason — a stale copy of a derived artifact reads as
a standing record. As of 2026-10-02 it holds seven partial
`question-consolidation` runs whose control arm never produced a model response,
so they are not usable as Gate D evidence.

**Regenerable artifacts — regenerate rather than keep:**

| Artifact | Recreate with | Cost |
|---|---|---|
| `.abg-verify/` throwaway home + test logs | `plugin/scripts/verify.sh` | free |
| `.abg-e2e/dsh-home/` throwaway profile | [`eval/README.md`](eval/README.md) | free |
| Staged credentials inside that home | [`eval/README.md`](eval/README.md) | user-authorized only |
| A sandbox's **initial** state under `eval/runs/` | `node eval/harness.mjs seed <scenario> <arm> <rep>` | free |
| A sandbox's **recorded end state** | a real agent run | model calls |

**Removed in the hygiene pass, and why:**

- `.abg-e2e/dsh-home/` (3.3 MB) — held a **copy of the user's credentials** and a
  profile whose linked plugin copy was stale, i.e. exactly the trap in §7. Both
  are reasons to regenerate rather than keep.
- `.abg-verify/` (952 KB) — throwaway; `verify.sh` recreates it.
- `.pnpm-store/` (1.1 MB) — created at the repository root by `dsh plugin add`
  inside `verify.sh`. **Fixed at the source**, not just deleted: the script now
  tears the store down on exit, explicitly as well as via a trap. It must remove
  it explicitly because `dsh` spawns pnpm with its own environment, so an
  exported `store-dir` never reaches pnpm — verified by experiment.
- `.abg-e2e/inspect{4,5}.mjs` — superseded by `eval/e2e-analyze.mjs`.
- `.abg-e2e/*.err`, `create.log`, `install.log` — raw stderr and boot noise; the
  findings they carried live in `eval/README.md`.
- `eval/e2e-results-prev.json` — a superseded pre-fix result kept as a backup.
- `eval/runs/README.md` and `.abg-e2e/README.md` — created without approval, then
  assessed against `eval/README.md` and found to overlap it in functional
  positioning and main content. Their content was merged into
  [`eval/README.md`](eval/README.md) under "Reproducing the evaluation" and the
  redundant files removed. No other document references them.

**Kept deliberately:** `.abg-e2e/abg-config.yml` and `abg-off.yml` — the treatment
and control overlays. They are configuration, not results, and a re-run needs
them.

**Removed in the five-module cleanup pass, and why:**

- `eval/runs/` (**1.3 MB, 220 files**) — the recorded sandboxes, their
  `prompt.md`, `meta.json`, and `result.json`. Every treatment prompt in them
  embedded the **five-module** governance section, including the
  `child-agent-lifecycle` fragment. The plugin no longer compiles that prompt, so
  the sandboxes described a revision that does not exist, and pooling them with
  future runs would measure two different prompts as one. Initial states are free
  to regenerate with `node eval/harness.mjs seed`.
- `.abg-e2e/run-auth.out`, `.abg-e2e/run-vague.out` — the agents' verbatim final
  answers from those same superseded runs, and the source of the quotes and
  numbers formerly in `eval/README.md`.
- The behavioural results tables and quotes in `eval/README.md`, `README.md`, and
  `plugin/README.md` — superseded measurements. They were deleted rather than
  annotated, because an annotated stale number still reads as a standing result.

