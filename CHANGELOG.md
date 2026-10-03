---
doc_type: changelog
project: information-environment-governance
version: 0.9.1
plugin_version: 0.9.1
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.9.1-batch-4
audience: everyone
language: en
---

# Changelog

> **Naming history.** This project was previously `dsh-agent-behavioral-governance`
> ("ABG"); `0.7.0` renames it to `dsh-information-environment-governance` (IEG).
> Pre-0.7.0 entries below deliberately keep the historical name — a changelog is
> immutable history, so old entries are not rewritten to the new name.

All notable changes to `dsh-information-environment-governance` (IEG) are
recorded here; entries before 0.7.0 were written under the historical package
name and keep it.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §31.2, a change to the compiled
prompt text or to the durable record shape forces at least a minor bump, and
**every prompt change is attributed to the problem or evaluation result that
motivated it**. IEG records a prompt revision in four places, and an entry below
names the one it changes: the package `version`, the enforced
`dsh.engines.dsh` range, `dsh.compatibility.dshReleases`, `PROMPT_VERSION`, and
the governance state `DOMAIN_VERSION` (§22.3).

## [0.9.1] — 2026-10-03

**Distribution and installation-path repair.**

### Fixed

- **The installation instructions contradicted themselves.** They told a user to
  run `dsh-ieg install …` as the first step, but `dsh-ieg` is supplied *by* the
  package — on a clean machine that command is `bash: dsh-ieg: command not found`,
  which is exactly what a user hit. Every documented first-install flow now uses
  the host's own installer, and `dsh-ieg` is documented strictly as a
  **post-install** management interface.
- **The CLI's real invocation is now documented.** pnpm installs `dsh-ieg` into
  the profile rather than onto `PATH`, so the dependable command is
  `"$DSH_HOME/profiles/<profile>/node_modules/.bin/dsh-ieg"`; a global npm install
  or `npx dsh-ieg` are the alternatives.

### Changed

- **The package is publishable.** `private` is removed and
  `publishConfig.access` is `public`; keywords now carry `dsh-plugin`,
  `information-environment` and `dsh-bundle`. Publication itself remains a
  maintainer release action, withheld pending Gates C and D and the publish-target
  decision (§34.2 Q5) — the registry name `dsh-information-environment-governance`
  is currently unclaimed, and this changelog does not claim npm availability.
- **Discovery uses the ecosystem's existing mechanism** rather than an invented
  one: npm keywords plus the repository's GitHub topics (`dsh-plugin`, `dsh`,
  `deepseek-harness`, `information-environment`). The installed DSH exposes no
  marketplace protocol to implement; its plugin manager accepts a registry name,
  an absolute path, a git address or a tarball.
- **Version information consolidated.** `package.json` and `PLUGIN_VERSION` both
  read `0.9.1`; the declared peer range is documented as a compatibility
  statement, not a tested-versions list (exactly one release, `0.2.1-alpha.1`, is
  verified). Front matter across the documents was realigned.

### Added

- **The release gate now verifies the distribution path**: `scripts/verify.sh`
  packs the artifact with `npm pack`, installs **that tarball** into a fresh
  throwaway profile through the DSH-native command, asserts the `ieg` row
  composes, and asserts the shipped runtime, bundle patch and profile-local
  `dsh-ieg` command are present. 27 checks in total, up from 22.
- **A verified installation procedure for agents and operators** in
  `CONTRIBUTING.md`, stating the install order, forbidding wrappers that bootstrap
  through `dsh-ieg`, and recording the discovery and claim rules.

### Notes

- No runtime governance behaviour changed: the compiled prompt and
  `PROMPT_VERSION` `0.4.0` are untouched, and no new scope was introduced.

## [0.9.0] — 2026-10-03

**Prompt optimization, README positioning, and a read-only tool fix.** The
governance text is now **2,677 bytes**, down from 2,922, and `PROMPT_VERSION`
moves from `0.3.0` to `0.4.0`. The three governed areas, every pinned
obligation and the prompt-content rules are unchanged; what left the prompt was
redundancy, enforcement narration, and a rationale the module already states.

### Changed — the prompt, change by change

The division of responsibility applied here is: **runtime** enforces
mechanically, **state** records current information status, and the **prompt**
carries only semantic interpretation, priorities and judgment rules that runtime
cannot reliably express. Each change below is recorded as change → reason →
expected effect → regression check (ARCHITECTURE-SPEC §22.3, PRODUCT-SPEC
PR-07).

1. **The section header now names the Information Environment and absorbs the
   duplicated invariant.** *Reason:* the "supplements the host instructions /
   never replaces them" rule appeared twice — once in the header and once as the
   first kernel invariant — and the compiler's §5.2 dedupe cannot see the header,
   so the duplication was invisible to every check. *Expected effect:* the scope
   is stated where the model first reads it, with one fewer bullet and no net
   growth. *Regression check:* the pinned `never outranks a direct user
   instruction` and `the host instruction governs` phrases now live in the header
   and still match the conformance suite; the kernel-principle presence check
   passes because the invariant is no longer a kernel principle.
2. **`information-integrity`: dropped the rationale clause** "because a later
   reader can still pick it up and the annotation does not stop them".
   *Reason:* the module's own fragment already says the claim must not be
   encounterable on its own, so the principle stated it twice. *Expected effect:*
   −85 bytes, identical obligation. *Regression check:* the conformance suite
   still pins `Delete information you have established is wrong`, `Never leave it
   in place annotated as wrong` and `remove it at the source`, and the §5.2
   dedupe still keeps the fragment.
3. **`workspace-governance`: removed the principle** "Treat new persistent
   artifacts and structural changes as requiring authorization under the active
   policy." *Reason:* it restates what `tools/pre-execute` and `ctx.tools.guard`
   already enforce, which the prompt-content rules forbid; the prompt's job is
   the judgment that an approval is not standing authorization, not narration of
   the enforcement. *Expected effect:* −115 bytes. *Regression check:* the
   `no instruction restates a deterministically enforced rule` test and the OBJ-2
   overlap assertions still pass.
4. **`workspace-governance`: the fragment no longer narrates how approval is
   routed** ("A persistent mutation may be routed to the user for approval,
   and …"). *Reason:* routing is runtime/state behaviour the model cannot act on;
   the semantic part is the grant's scope. *Expected effect:* −45 bytes, same
   judgment. *Regression check:* the conformance suite still pins `each approval
   covers only that one change`.

No `user-attention` guidance was present to remove — that capability left in
`0.7.0` (see that entry); this round confirms its absence rather than repeating
it. **No behavioural improvement is claimed:** Gates C and D remain unmeasured,
and the prompt change was validated by the prompt-conformance suite and the
structural simulation only (Batch 3 §2 was executed at that level by explicit
decision).

### Fixed

- **`ieg_status` now renders content to the model.** The tool declared
  `render: () => []`, so every call succeeded, returned nothing to the caller,
  and left an operator unable to see the mount record, the compatibility verdict
  or the diagnostic ring — observed live while diagnosing a mutation block.
  `render` now projects the canonical value as JSON text, and the wiring suite
  asserts that the rendered content is non-empty and carries the mount record.
  The tool's JSON schema stays `{ type: "object" }`: the host rejects a
  non-standard `{ type: "json" }` schema, and because registration is guarded a
  bad schema silently removes the tool instead of failing loudly (caught by the
  real-tool-runtime integration test).

### Documentation

- README positioning now answers directly what it is, what it governs, what it
  does **not** govern and who it is for, states the product message (keep the
  project environment clearer and more consistent over time — not a smarter
  agent) as an intended benefit rather than a guarantee, and adds a concise
  Chinese section that preserves the anchor term 信息环境 / Information
  Environment. English remains the project's working language and its
  authoritative documentation.
- The package version, `PROMPT_VERSION` and the prompt byte figures were swept
  across the documents so no page describes the previous prompt revision.

> **Release status.** `package.json` declares `version: "0.9.1"`, is **publishable**
> (no `private` flag, `publishConfig.access: "public"`) and is **not published** to
> npm; `dsh.engines.dsh` is narrowed to the current verified range
> (`>=0.2.1-alpha.1 <0.3.0`). The publish target (§34.2 Q5) stays open until the
> behavioural and information-integrity gates (C, D) are met. Each release is
> published as a **GitHub release for volunteer testing** (a tag plus a packed
> tarball) — that is the developer/recovery source, not the normal user install
> path; the older entries stay staged under **Unreleased** below.

## [0.8.0] — 2026-10-03

**Breaking.** The DSH migration and packaging round. The repository root is now the
installable DSH component, the supported host baseline moves to `0.2.1-alpha.1`, and
the runtime is authored in TypeScript. `PROMPT_VERSION` is **unchanged** (`0.3.0`):
the compiled governance text is byte-identical, because this round deliberately does
not optimize the prompt.

### Fixed

- **The package can be installed as a DSH component from a Git URL.** The repository
  root now declares `dsh.bundle.patch`, so DSH accepts it as a profile bundle. Before
  this release the package lived in a `plugin/` subdirectory and the repository root
  carried **no manifest at all**; DSH's plugin installer therefore read a
  manifest-less dependency and refused it with `not-a-bundle` — "*declares no
  dsh.bundle*" — which is what the Web UI reported when adding the repository.

### Changed

- **The repository root is the package (breaking).** `package.json`,
  `cordis.patch.yml`, `bin/`, `lib/`, `src/`, `test/`, `test-support/`, `tsconfig*.json`
  and `CHANGELOG.md` moved from `plugin/` to the repository root, and `plugin/` no
  longer exists. Every path reference in the documents, scripts, workflows and tests
  was updated.
- **Host baseline migrated to `dsh 0.2.1-alpha.1` (breaking).** `dsh.engines.dsh`
  narrows to `>=0.2.1-alpha.1 <0.3.0` and `dsh.compatibility.dshReleases` is replaced
  by the single current entry; the retired `0.2.0-rc.2` baseline is gone from the peer
  range and the release map. `lib/compatibility-baseline.json` was re-captured against
  the installed host: the ordered section names, the host prompt hash (`ceb63ee5`) and
  the required capability set are identical to the previous baseline, so the prompt
  surface is semantically unchanged.
- **Single-baseline compatibility policy.** The plugin supports the current declared
  DSH baseline only. No version-conditional runtime path existed to remove — the
  adapter observes seam facts against the committed baseline rather than branching on
  a version string — and none is added.
- **Runtime authored in TypeScript.** `src/**/*.ts` is the source of truth and
  `lib/**` is its build output (`tsconfig.build.json` now emits to `lib/`, not the
  retired `lib/generated/`). Every runtime module migrated: the kernel, the four→three
  governance modules, the control plane, the prompt store and lifecycle, the CLI entry,
  and the aggregator `src/index.ts`. `lib/contract.d.ts` remains the one hand-authored
  ambient declaration file. No hand-maintained JavaScript remains in the runtime, and
  the compiled output is committed so a Git install is self-contained (pnpm does not
  run a build for a git dependency).
- **Module descriptors now declare `version: '0.2.0'`.** The shipped
  `project-governance`, `information-integrity`, and `workspace-governance`
  descriptors had still carried `0.1.0`, contradicting the `0.2.0` module contracts
  in `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §24. The descriptors were brought to the
  contract version, so one version is authoritative (closes §34.2 Q9).
- **Repository metadata** names the renamed upstream repository
  (`ccneedb/dsh-information-environment-governance`) in `repository`, `homepage` and
  `bugs`.

### Added

- **`test/integration/packaging.test.js`** — the structural regression this defect
  demanded: it asserts that the root is a valid DSH bundle, that the declared baseline
  is the only supported one, that the `files` allowlist ships the manifest and the
  compiled entry, that the retired layout and withdrawn capability are absent, and that
  every built module has a TypeScript source.
- **`bounded-repair` (OBJ-3)** — the missing workspace-hygiene evaluation scenario, so
  all three governed areas (project constraint, information/document integrity,
  workspace hygiene) now have one. `eval/README.md` states explicitly that a green
  structural suite is not evidence of behavioural improvement.

### Notes

- Gates C and D remain **unmeasured**; no behavioural claim is made by this release.
- The durable state domain is unchanged (`ieg_governance`, `DOMAIN_VERSION` 1).

## [0.7.0] — 2026-10-03

**Breaking.** The Information Environment Governance re-baseline. The
`user-attention` capability is **removed**, not disabled; the project, package, CLI,
environment variables, prompt section, tools, diagnostic namespace, and durable-state
domain are renamed from the historical ABG identifiers to the IEG identifiers; and the
injected governance text changes, so `PROMPT_VERSION` moves from `0.2.0` to `0.3.0`.

### Removed

- **The `user-attention` module, failure class `FC-2.4`, the question ledger, and the
  batch-completeness/redundancy gates.** Classification: **"Out of Scope / Externally
  Solved"** — testing found a stable prompt-level solution, so runtime governance of
  question batching is no longer justified. This is **not** a failed feature, and it
  must not appear as a current capability anywhere. `FC-2.4` is gone: the remaining
  classes `FC-2.1`–`FC-2.3` are each claimed by exactly one module.
- The `record_question` and `ieg_questions` tools (the question-ledger surface), and the
  question-related diagnostic codes (`ieg.question_registered`, `ieg.question_submitted`,
  `ieg.question_batch_created`, `ieg.question_batch_blocked`, `ieg.question_redundant`,
  `ieg.question_deferred`).
- The `question-consolidation` evaluation scenario and the evaluation-only
  `eval/answerer/` plugin. The behavioural and information-integrity gates (C, D) have
  **no current measurement** for this revision.
- The `userAttention` configuration key (see Changed).

### Changed

- **Scope re-baseline: Information Environment Governance.** IEG governs the
  Information Environment — the persistent information and project constraints that an
  agent continuously encounters, relies on, modifies, or inherits while working on a
  project (the canonical definition lives in `PRODUCT-SPEC.md` §1.1). Two governance entry
  points: **Project Constraint Governance** and **Information / Document Governance**.
  Workspace hygiene is an enforcement mechanism within the second, not a sandbox or
  security system. General AI safety/security, sandboxing, authorization,
  user-attention optimization, and unrelated agent behavior management are explicitly
  out of scope.
- **Repository, package, CLI, and identifiers renamed.** Package
  `dsh-agent-behavioral-governance` → **`dsh-information-environment-governance`**; CLI
  and `bin` `abg` → **`dsh-ieg`** (`bin/ieg`, source `src/bin/ieg.ts` → compiled
  `lib/bin/ieg.js`); environment variables `ABG_*` → **`IEG_STATE_FILE`,
  `IEG_DSH_PACKAGES`, `IEG_VERIFY_HOME`**; prompt section `abg:governance` →
  **`ieg:governance`**; runtime-context line `abg:status` → **`ieg:status`**; tools
  `abg_status` / `abg_questions` / `record_question` → **`ieg_status`** and
  `record_orientation`; diagnostic namespace `abg.*` → **`ieg.*`**; durable-state domain
  `abg_governance` → **`ieg_governance`** (`DOMAIN_VERSION` 1); throwaway
  profiles/directories `.abg-e2e/`, `.abg-verify/` → **`.ieg-e2e/`, `.ieg-verify/`**.
- **`PROMPT_VERSION` `0.2.0` → `0.3.0`.** The compiled governance section is now
  **2922 bytes** against a recorded ceiling of **3215 bytes** (floor 1400, hard cap
  4096). The section is registered at order 8500 with `interpolate: false`; `complete`
  is never set.
- **The `userAttention` config key is removed and is now rejected.** Supplying it is an
  unknown-key configuration error: IEG refuses the whole configuration and mounts its
  observable fault surface rather than silently ignoring the field. Top-level keys are
  `enabled`, `sectionOrder`, `modules`, `workspace`, `preStep`, `prompt`, `diagnostics`,
  and `diagnosticsExport`. All three remaining modules — `project-governance` (FC-2.1),
  `information-integrity` (FC-2.3), `workspace-governance` (FC-2.2) — ship default-on.
- **Two model-facing tools remain:** `record_orientation` and `ieg_status`.

### Documentation

- Package-level documentation, the behavioural evaluation harness, and the repository
  scripts/CI were updated to the IEG names, the three-module capability set, and the
  renumbered acceptance gates A–J.

## [0.6.0] — 2026-10-03

**Breaking.** The Web GUI route and the in-harness feedback feature are **removed**,
not disabled, and replaced by a terminal interface, `abg`, run from a Debian shell.
`PROMPT_VERSION` is unchanged (`0.2.0`): the compiled governance text is identical.

### Added

- **`abg`, the terminal interface** (`src/bin/abg.ts`, shipped as `bin/abg`).
  Running it with no arguments opens an ANSI numbered menu — no dependencies, no
  ncurses, usable over SSH — and every command also works non-interactively with
  flags, because CI and scripts call it.
- **The control plane** (`src/kernel/control.ts`): a small, stable JSON record at
  `$ABG_STATE_FILE`, else `<state-dir>/abg/state.json` (`<state-dir>` =
  `$XDG_STATE_HOME` or `~/.local/state`), written atomically (temp + rename).
  `abg start|pause|restart|exit` change `status`; an **absent file means
  `running`**, so every pre-0.6.0 install behaves exactly as before; a corrupt file
  means `running` plus a recorded diagnostic, never a crash. `restart` bumps
  `generation`, which is the plugin's signal to invalidate cached configuration
  and prompt.
- **The prompt store** (`src/kernel/prompt-store.ts`): prompt text now lives in a
  sibling `prompt.md`, not inside the control JSON. It is validated through the
  existing `composePromptOverride` kernel (no `{{ }}`, byte ceiling unless
  `allowOverBudget`), attributed as `0.2.0+user:<hash>`, and refused with its
  reasons — a refusal keeps the previous effective text. `abg prompt edit` opens
  `$EDITOR` on a temporary copy; `abg prompt reset` deletes the file and returns to
  the compiled default.
- **The npm-native lifecycle** (`src/kernel/lifecycle.ts`): `abg install|update|
  uninstall` is now the single implementation. `scripts/abg-npm.sh` is a thin
  wrapper over it. It refuses to write the live `$HOME/.dsh` without `--allow-live`
  (exit 2) and defaults npm's cache to a writable home-local directory rather than
  a read-only `~/.npm`.
- **Plugin-side gating** in `lib/index.js`: the control state is re-read (cached by
  mtime; a re-stat per assembly/step is allowed). `paused` emits no prompt section
  and lets every hook pass through; `stopped` mounts nothing active, like
  `enabled: false`; `running` is normal. New diagnostic codes:
  `abg.control_paused`, `abg.control_resumed`, `abg.control_stopped`,
  `abg.control_generation_changed`, `abg.control_state_unreadable`.
- A CLI smoke check, a `prompt.md` round-trip check and a **gating** check in
  `scripts/verify.sh` (a `paused` state suppresses the section; a generation bump
  re-reads `prompt.md`). The installed-patch proof that applies the shipped
  `cordis.patch.yml` verbatim is preserved.

### Removed

- `lib/client.js`; the `dsh.client` manifest; the `./client` export.
- The Web routes in `lib/index.js` (`/api/abg/status`, `/api/abg/prompt`,
  `/api/abg/feedback`), the `ctx.webServer` injection, and the `gui` configuration
  block with its contract types.
- `lib/kernel/gui-actions.js` and `lib/kernel/feedback.js`; the
  `abg_report_issue` tool; the `feedback` configuration block with its contract
  types.
- The GUI-route and feedback test cases; `docs/TASK-FAILURE-REPORT-TEMPLATE.md`
  (deviation reports are now ordinary GitHub issues via `.github/ISSUE_TEMPLATE/`).
- `abg.gui_route_registered` from the diagnostic vocabulary.

### Kept

- The diagnostics ring **and** the opt-in diagnostics mirror
  (`src/kernel/export.ts` → `lib/kernel/export.js`); the
  CLI is now the mirror's reader.
- All four governance modules; `abg_status`, `abg_questions`, `record_orientation`,
  `record_question`; `apply()` still never throws (§26.2).

### Documentation

- `README.md`, `TESTING.md`, `docs/PACKAGE-REFERENCE.md`,
  `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` (§28.6/§28.8 replaced by one control-plane
  section; §28.7 kept with the CLI as its reader), `MAINTENANCE-HANDOFF.md`,
  `CONTRIBUTING.md`, `docs/DOCUMENTATION-INDEX.md` and
  `TYPESCRIPT-MIGRATION.md` all describe the terminal interface; no
  document still describes the removed surfaces as live.

## [0.5.1] — 2026-10-02

**This fixes a defect that made every default install of 0.4.0 and 0.5.0 inert.**

### Fixed

- **A shipped configuration the plugin itself rejected.** `cordis.patch.yml`
  ships `prompt.file: ''` and `diagnosticsExport.file: ''` — documented values
  meaning "none configured"/"off" — but both were validated with a
  non-empty-string check. `buildGovernance()` therefore threw on the shipped
  configuration, and because `apply()` must not throw (§26.2) ABG fell into its
  fault surface: **no prompt section, no hooks, no tools, and no GUI route**, with
  nothing reported by the host. Path fields now accept the empty string and still
  reject whitespace-only values.
- **The diagnostics mirror wrote an empty snapshot.** The forced flush ran before
  the mount records existed and the throttle then suppressed them, so the mirror
  was written once, empty, and never refreshed. It now flushes after `abg.mount`.
- **The gate could not see the defect.** `verify.sh` proved activation by applying
  `{}` (all defaults) rather than the shipped patch, so a package whose own config
  was rejected passed. The installed-artifact proof now applies the shipped
  `cordis.patch.yml` verbatim and asserts the prompt section still binds.

### Added

- `npm run build` (`src/**/*.ts` → `lib/`) is now check 1 of the gate, so
  emitted artifacts can never be validated stale (12 checks).
- `scripts/abg-npm.sh` and `scripts/abg-npm-lifecycle-check.sh`: an npm-native
  install/update/uninstall path. Note the verified host fact — plain
  `npm install` does **not** register the profile bundle, so the helper also
  maintains `dsh.profile.bundles`; `dsh plugin` itself forwards to pnpm.
- `docs/DOCUMENTATION-INDEX.md` and `scripts/check-docs.sh`: one authoritative
  home per information kind, with link, front-matter and index-coverage checking
  wired into CI.
- The first slice of the TypeScript migration: three kernel modules now have
  `.ts` sources with emitted JS and declarations as build artifacts
  (`TYPESCRIPT-MIGRATION.md` records the exception list and the plan).

### Documentation

- The Web GUI panel requires a **Web** profile; a headless profile has no web app,
  so no panel can appear there however the plugin is installed. `check-install.sh`
  now says which situation you are in and names the Web-capable profiles.

## [0.5.0] — 2026-10-02

The Web GUI panel becomes editable: it can now change the prompt and file
feedback, not just show status.

### Added

- **Prompt editor in the panel.** `POST /api/abg/prompt` persists an edited
  section text, and the change applies to the next assembly without a restart
  (the section provider is function-valued). The editor is **disabled unless
  `prompt.mode` is `replace` and `prompt.file` names a path** — there is
  deliberately no default write target, so an unconfigured deployment gets a
  read-only editor (409) rather than a surprise file. Validation runs through the
  same `composePromptOverride` as the file and the config, so an interpolation or
  over-budget edit is refused with the same wording (422 + issues), and an applied
  edit is attributed `PROMPT_VERSION+user:<hash>` and reports `promptUnchecked`.
- **Feedback form in the panel.** `POST /api/abg/feedback` composes through
  `composeFeedback`, so the browser path shares the kernel's redaction rather than
  reimplementing it. The form previews the exact markdown, copies it, opens the
  prefilled issue link, and files directly only in opt-in `api` mode.
- `lib/kernel/gui-actions.js`: the two write actions as pure functions with
  injected I/O, plus `MAX_REQUEST_BYTES` bounding the accepted body.

### Changed

- `GET /api/abg/status` also reports the editor's view and the feedback mode.
- Package version `0.5.0`. For a default configuration (`prompt.mode: compiled`)
  the compiled section is byte-identical to `0.4.0`, so `PROMPT_VERSION` stays
  `0.2.0` unless an override applies.

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

- **Web GUI panel** (`lib/client.js`, `lib/` host route; `ARCHITECTURE-SPEC`
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
