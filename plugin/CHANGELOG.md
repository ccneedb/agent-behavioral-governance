# Changelog

All notable changes to `dsh-agent-behavioral-governance` (ABG) are recorded
here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §31.2, a change to the compiled
prompt text or to the durable record shape forces at least a minor bump, and
**every prompt change is attributed to the problem or evaluation result that
motivated it**. ABG records a prompt revision in four places, and an entry below
names the one it changes: the package `version`, the enforced
`dsh.engines.dsh` range, `dsh.compatibility.dshReleases`, `PROMPT_VERSION`, and
the governance state `DOMAIN_VERSION` (§22.3).

> **Release status.** `package.json` declares `version: "0.3.0"` and keeps
> `"private": true`, and `dsh.engines.dsh` is narrowed to the verified range
> (`>=0.2.0-rc.2 <0.3.0`). The version records the capability set; the removal of
> `private` and the publish target (§34.2 Q5) remain open until the behavioural
> gates (C, D, E) are met. `0.3.0` is therefore published as a **GitHub release
> for volunteer testing** (a tag plus a packed tarball), not as an npm package:
> the `0.1.0`/`0.2.0` entries below stay staged under **Unreleased**.

## [0.4.0] — 2026-10-02

Adds the two capabilities a front end needs: a user-editable prompt and a
machine-readable diagnostics mirror. Neither is on by default in a way that
changes existing behaviour: `prompt.mode` defaults to `compiled` (the audited
generated section) and an empty `diagnosticsExport.file` means no file I/O.

### Added

- **User-editable prompt** (`lib/kernel/prompt-override.js`; `prompt{mode, append,
  file, allowOverBudget}`; `ARCHITECTURE-SPEC` §27.1). `append` adds guidance to
  the audited compiled section; `replace` substitutes a markdown file wholesale.
  Two hard requirements are enforced on any user text — no `{{ }}` interpolation
  syntax, and the §11 byte ceiling unless `allowOverBudget` is set deliberately —
  and a refused edit **falls back to the compiled default and reports why**
  (`abg.prompt_override_rejected` / `abg.prompt_override_missing`) rather than
  mounting inert or silently ignoring the text. An applied edit is attributed as
  `PROMPT_VERSION+user:<hash>`, and the soft invariants the conformance suite
  cannot check on user text (dedupe, no authority claim, no implementation
  leakage, no restating an enforced rule) are returned as `promptUnchecked` and
  reported, so a user-edited prompt is never presented as an audited one.
- **Opt-in diagnostics mirror** (`lib/kernel/export.js`;
  `diagnosticsExport{file, limit}`; `ARCHITECTURE-SPEC` §28.7). Writes a bounded
  JSON snapshot (mount record, status line, counts, newest `limit` diagnostics)
  for a front end that cannot read the in-process ring. Off unless a path is
  configured; throttled while diagnostics stream; written via a temporary file
  and rename; and fail-open with the failure reported once per window, with an
  explicit re-entrancy guard because the report itself records a diagnostic.
- Three new diagnostic codes for the above, and two more for the mirror.

- **Web GUI panel** (`lib/client.js`, `plugin/lib/` host route; `ARCHITECTURE-SPEC`
  §28.8). A sidebar entry opens a read-only panel showing the mount record,
  `degraded[]`, the compatibility verdict, `PROMPT_VERSION`, and the diagnostic
  ring, read from the new host route `/api/abg/status` (behind the deployment's
  `/api` browser-trust fence). The client bundle is **hand-authored**: a DSH
  client plugin normally ships a `lib/client.js` built by the monorepo, and there
  is no public out-of-tree build, so it is written directly against the lazy-CJS
  envelope and the slot registry. Verified end to end in an isolated web profile.
- The GUI route records its own outcome in-band (`abg.gui_route_registered`, or
  `abg.capability_missing` when no web server is mounted), because an `inject`
  that never fires otherwise looks exactly like a route that does not exist.

### Fixed

- **The diagnostics mirror showed an empty ring.** The setup flush happened before
  the mount records existed and the throttle then suppressed them, so the file was
  written once, empty, and never refreshed until the next diagnostic. A final
  forced flush at mount fixes it; caught by the web-profile verification, which is
  the first run where the mirror was read by something other than its own tests.
- **The web server service is `webServer`, not `webserver`.** The first GUI route
  attempt injected the wrong name, so the route was never registered — silently,
  because an unfired `inject` reports nothing. Caught by the same verification.

### Changed

- **Package version is now `0.4.0`.** For a default configuration the compiled
  section is byte-identical to `0.3.0`, so `PROMPT_VERSION` remains `0.2.0`
  unless a deployment applies an override, in which case it becomes
  `0.2.0+user:<hash>`.

## [0.3.0] — 2026-10-02

Adds the volunteer-facing surface: a way to obtain the plugin, and a one-step
channel for reporting a behavioural deviation from inside the session. No
model-facing prompt text changed, so `PROMPT_VERSION` stays `0.2.0` and the §11
byte budget is untouched.

### Added

- **Optional feedback channel** (`lib/kernel/feedback.js`, the read-only
  `abg_report_issue` tool, and the `feedback{enabled, mode, repository,
  tokenEnvVar, labels, includeDiagnostics}` configuration block;
  `ARCHITECTURE-SPEC` §28.6). Given a one-line summary it returns a prefilled
  GitHub issue link and the markdown body, composed from the mount record,
  `degraded[]`, the compatibility verdict, and diagnostic *codes*. Two properties
  are the point: it **never files anything by itself** in the default `url` mode
  (no network call, no credential; a human submits), and it is **redacted by
  construction** — diagnostic payloads, agent and session identifiers, file
  contents, prompts, and session logs are dropped before composition, which
  `test/unit/feedback.test.js` pins by planting a secret in a diagnostic payload.
  `mode: api` is strictly opt-in, reads a token from the environment variable
  named by `feedback.tokenEnvVar` (never from configuration), and fails open to
  the prefilled link on any error.
- **Volunteer testing guide** (`TESTING.md`): two installation methods (release
  tarball, or clone plus `file:` install), the first-trial configuration, the
  ABG-disabled A/B procedure that the missing evidence actually needs, the
  uninstall command, and the reporting workflow.
- **Runtime ambient declarations** in `lib/contract.d.ts` for the two globals the
  feedback channel touches (`process.env`, `fetch`), so the package keeps its
  no-dependency, no-`@types/node` property while that dependency stays auditable
  in one file.

### Changed

- **Package version is now `0.3.0`** (capability addition; `PROMPT_VERSION`
  remains `0.2.0` because no injected section text changed).
- **The installed-artifact proof and the wiring suite now expect five tools**
  (`abg_report_issue` in addition to the two capture tools and two read-only
  surfaces), and `cordis.patch.yml` documents the `feedback` block.
- **CI installs TypeScript explicitly** in both jobs. The package ships zero
  dependencies by design, so a clean runner has no compiler; the alternative —
  adding a `devDependency` — would have muddied that contract.

## [Unreleased] — target v0.2.0

### Removed

- **`child-agent-lifecycle` (failure class `FC-2.5`) — withdrawn by explicit
  user decision recorded in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §23.** The
  module, its `subagent/*` listeners, its ambient contract types, its prompt
  fragment, its unit test, its composition toggle, and the remaining
  product-level clauses that referred to it (`FC-2.5`, `G5`, `PR-06`, the
  lifecycle quality target and quality row, and the old success criterion 4)
  were removed. Rationale: Part A's reconnaissance established that a populated
  child list is expected on a healthy system and that automatic reclamation was
  unfounded, and the evaluation harness contains no delegation scenario, so the
  module could never have acquired behavioural evidence.
  - **Prompt impact (attributed to the withdrawal decision §23).** The compiled
    governance section drops from 3,905 bytes over five modules to 3,459 bytes
    over four. This is a change to injected model-facing text, so §31.2 requires
    at least a minor bump.
  - **Prompt version.** `PROMPT_VERSION` is `0.2.0` for the four-module text.
  - **Gate K (withdrawal integrity).** The plugin ships four modules, and no
    import, config key, prompt fragment, test, or documentation claim refers to
    the removed module.

### Added

- **Scope-isolated, per-agent governance state** (`lib/kernel/state.js`; used by
  `lib/index.js`, `lib/kernel/orientation.js`, `lib/kernel/questions.js`).
  Closes the `ARCHITECTURE-SPEC` §17.7 defect that two live agents in one
  composition shared one orientation record and one question ledger, and
  satisfies **Gate H** ("two live agents in one composition never share
  governance state"). It also sharpens **Gate F** (regression resilience) from
  per-composition to per-agent and per-session.
- **Diagnostics channel** (`lib/kernel/diagnostics.js`, the read-only
  `abg_status` tool, and the `abg:status` runtime-context line). Closes
  `MAINTENANCE-HANDOFF.md` §4 **blocker 1** ("diagnostics are invisible ... every
  `ctx.logger` diagnostic ABG emits is buffered and never displayed") and
  satisfies **Gate G**: mount, configuration, last denial, and the compatibility
  verdict are observable from the transcript alone, under the §28.5 fallback
  when channel A is unavailable.
- **Compatibility adapter** (`lib/kernel/compatibility.js`). Closes
  `MAINTENANCE-HANDOFF.md` §4 **blocker 2** ("no compatibility adapter; a host
  upgrade would go undetected") and satisfies **Gate I**: the adapter reports a
  verdict (`COMPATIBLE` / `COMPATIBLE_WITH_WARNINGS` / `UNSUPPORTED` / `PENDING`)
  and detects a simulated host section change. The enforced peer range remains
  the authoritative version gate (§34.1 B4).
- **Question consolidation at runtime** (`lib/kernel/questions.js` and the
  `record_question` ledger the `tools/pre-execute` gate consults). Closes
  `MAINTENANCE-HANDOFF.md` §4 **blocker 4** ("`user-attention` behavioural
  validation is structurally blocked in headless: there is no question answerer")
  at the runtime-wiring level and feeds **Gate D**: the gate refuses an
  `ask_user_question` batch that omits a registered blocker, and `PRODUCT-SPEC`
  success criterion #3's behavioural measurement ("batching reduces interactions
  without suppressing critical uncertainty") is delivered by the evaluation
  harness (§30.4, phase P5/P6), not by this change.
- **Gate-precision evaluation** (`test/integration/gate-precision.test.js`).
  Closes `MAINTENANCE-HANDOFF.md` §4 **blocker 3** ("false positives
  unmeasured") and satisfies `ARCHITECTURE-SPEC` §32.4: a corpus of at least 12
  legitimate operations plus the declared traps, with `false_block_rate`,
  `false_blocks`, and `true_blocks` measured and printed rather than assumed.
  The target is `false_block_rate = 0`.
- **Packaging and release policy** (`LICENSE`, this `CHANGELOG.md`, and the
  `files` allowlist). Closes `MAINTENANCE-HANDOFF.md` §4 **blocker 6** ("not a
  publishable package: no release policy, no changelog, no LICENSE inside
  `plugin/`") and satisfies **Gate J** (installability against a real profile is
  asserted by `scripts/verify.sh`). The package is licensed MIT; its peer range,
  compatibility entry, and zero runtime dependencies are unchanged.

### Changed

- **`apply()` no longer throws — the §26.2 mount contract is implemented.**
  Previously a configuration fault (unknown key, unknown module id, invalid
  enum, over-budget prompt) escaped `apply()`; the host reports a throwing entry
  as `warning: N entry did not activate` and continues, so a deployment was left
  without governance and without a transcript-visible reason. Now:
  - a configuration fault mounts an **inert but observable** surface —
    `mountConfigFaultSurface()` registers the read-only `abg_status` tool and the
    `abg:status` context line reporting `mounted: false` with the validator's
    message and an `abg.config_invalid` diagnostic, and registers **no** prompt
    section and **no** enforcement (fail-safe, never wrong enforcement);
  - every capability registers in its **own guarded step** (prompt section,
    status context, the three listeners, the tool definitions, the guard, the
    storage domain and its disposer), so one unavailable seam costs only that
    seam;
  - an **absent** seam is recorded as `abg.capability_missing` and listed in the
    new `degraded[]` field of the mount record, so a partial mount is
    distinguishable from a complete one (`mounted` alone could not express this);
  - a **durable-store construction failure** now falls back to a no-op store
    instead of propagating;
  - **logger narration is best-effort** everywhere, so a deployment whose logger
    throws (or that mounts no exporter, §28.1) still gets the ring, the status
    line, and the tools.
  Closes `ARCHITECTURE-SPEC` §26.2, which was specified but unimplemented, and
  sharpens **Gate G**. Covered by four tests in `wiring.test.js`. Not
  model-facing text, so `PROMPT_VERSION` is unchanged.
- **`preStep.requireBeforeMutation` now defaults to `false`** in
  `lib/kernel/config.js` and in the shipped `cordis.patch.yml` row, implementing
  the user decision recorded in `ARCHITECTURE-SPEC` §34.2 Q1 (non-intrusive
  defaults). The orientation requirement is unchanged as a mechanism and remains
  available as an explicit opt-in; before this change a default deployment
  denied the first persistent write of every session. Closes
  `MAINTENANCE-HANDOFF.md` §4 **blocker 7**. Not model-facing text, so
  `PROMPT_VERSION` is unchanged.
- **The prompt-byte ceiling is now the recorded footprint rule of
  `ARCHITECTURE-SPEC` §34.1 B6.** `lib/kernel/prompt-compiler.js` records
  `RECORDED_PROMPT_BYTES = 3459` and derives the ceiling as
  `min(PROMPT_BYTE_HARD_CAP, max(PROMPT_BYTE_FLOOR, recorded + 10 %))` —
  **3,805 bytes** from a 1,400-byte floor and a 4,096-byte hard cap — replacing
  a fixed `4,096` in the compiler and an independent, unreachable `4,200`
  ceiling in the conformance suite. Compiler and conformance tests now read the
  same constants, so they cannot disagree about the budget. Closes
  `ARCHITECTURE-SPEC` §34.1 assumption **B6**. Not model-facing text, so
  `PROMPT_VERSION` is unchanged.
- **`dsh.compatibility.dshReleases` records `0.2.0-rc.2` as `verified`** without
  narrowing `dsh.engines.dsh` in this change. Per §31.2, a new host release is
  added to that map only after the compatibility baseline test passes; the
  peer-range decision is the Lead's.

### Fixed

- **The shell-write classifier no longer mistakes quoted text for shell
  syntax.** `workspace.classifyShellCommands` is the mechanism that closes the
  redirection coverage hole left by excluding shell tools from `mutatingTools`,
  so its precision decides whether D13's requirement survives its own amendment.
  Quoted segments are now treated as data unless the command wraps another
  command, and a `>` is a redirection only when it is a standalone operator
  rather than an arrow or a comparison. `rg '=>' src`,
  `grep -rn 'a > b' src`, and `git commit -m 'rm stale files'` are read-only
  again, while `bash -c 'rm -rf build'` and `echo x > f` remain mutations. Both
  directions and the two residual limits are pinned by
  `test/unit/shell-classification.test.js`, and the newly found false-positive
  cases are counted in the §32.4 matrix, which now measures **21 legitimate
  calls with `false_block_rate = 0`** and 4/4 traps caught.
- **`lib/kernel/durability.js` attributed Gate F to Gate G** in its header
  comment; the durable-state gate is F (Gate G is diagnosability). The same
  correction was applied to both durability test files.
- **The suite's last permanently-red marker is gone.** `durability.test.js` still
  carried a `todo` test asserting "orientation survives a resume" in a
  composition that deliberately mounts **no** storage facility, so it executed and
  failed on every run while Node demoted it and the runner exited 0 — a green
  `verify.sh` that hid a red body. The assertion belongs to
  `durability-storage.test.js`, which mounts the real storage stack and verifies
  it; the redundant `todo` was deleted and the remaining test now documents the
  accepted no-storage degradation. The suite is **228 tests, all passing, no
  todo, no skip**, so `node --test` exiting 0 now means every body ran and passed.
- **`verify.sh` check 5 was redesigned for the non-throwing mount.** It proved
  execution by feeding ABG a config only it could reject and grepping the host's
  stderr for the resulting `ModuleContractError` — which the §26.2 hardening now
  absorbs by design, so the check began failing. It now proves execution
  positively against the profile's **own installed copy** of the package (a real
  directory, not a link to the source tree): the installed artifact must bind one
  section, three listeners, and four tools, and must degrade a bad configuration
  into the observable fault surface; the host must then boot the real composition
  with that overlay and report no unactivated entry. The chain grew from 10 to
  **11 checks**, all passing.

### Notes on attribution

- The **only prompt-text change** in this change set is the withdrawal above,
  and it is attributed to the §23 user decision. The added capabilities are
  runtime and diagnostic; they do not alter the compiled section, so no further
  prompt attribution is claimed here.
- The **reconciliation change of 2026-10-02** (`requireBeforeMutation` default,
  the B6 ceiling, and the shell-classifier precision fix) touches configuration,
  enforcement, and tests but **no injected model-facing text**, so
  `PROMPT_VERSION` remains `0.2.0` and no prompt revision is claimed. The
  recorded footprint `RECORDED_PROMPT_BYTES` describes exactly that revision.
- Every other entry is attributed to the numbered blocker or gate it closes.
  If a later change alters injected model-facing text, add it under **Changed**
  with the problem or evaluation result that motivated it.

## [0.1.0] — 2026-10-01

- Initial prototype: five governance modules (`project-governance`,
  `information-integrity`, `user-attention`, `workspace-governance`, and the
  later-withdrawn `child-agent-lifecycle`), one additive system-prompt section
  at order `8500`, `tools/pre-execute` and `ctx.tools.guard` enforcement, the
  `record_orientation` and `record_question` tools, and durable per-session
  orientation through `ctx.storageDomain`.
- The `0.1.0` evidence chain (test run, `verify.sh` result, prompt size, and
  prompt version) is recorded in `MAINTENANCE-HANDOFF.md` and
  `IMPLEMENTATION-VALIDATION-HANDOFF.md`.
