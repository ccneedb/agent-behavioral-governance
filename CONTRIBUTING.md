# Contributing to ABG

Thanks for considering a contribution. ABG (Agent Behavioral Governance) is an
additive project-governance plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
It is a **verifiable prototype**, not a released product — read the status
section of [`README.md`](README.md) before relying on it.

This document is the process contract. The technical contract lives in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md).

## Prerequisites

| Requirement | Why | Notes |
|---|---|---|
| Node.js **>= 20** | `package.json` `engines` | `node --test` is the test runner |
| A DeepSeek Harness installation (`@deepseek-ai/dsh` `0.2.0-rc.2`) | The integration tests mount the **real** host services rather than mocks | Without it those tests **skip**; the unit and conformance suites still run |
| `pnpm` (via `dsh plugin add`) | `scripts/verify.sh` performs a real install into a throwaway profile | Only needed for the full chain |

If your DSH installation is not at `/usr/local/lib/node_modules/@deepseek-ai/dsh`,
point the test loader at it:

```bash
export ABG_DSH_PACKAGES=/path/to/node_modules/@deepseek-ai
```

## Layout

| Path | What it is |
|---|---|
| `README.md` | project status, evidence chain, and layout |
| `PRODUCT-SPEC.md` | positioning, scope, goals, success criteria |
| `ARCHITECTURE-SPEC-AGENT-REFERENCE.md` | architecture; **§17** verified host seams, **§18** deltas, **Part B (§§22–34)** the v0.2.0 target design |
| `IMPLEMENTATION-VALIDATION-HANDOFF.md` | build order, validation cases, acceptance gates |
| `MAINTENANCE-HANDOFF.md` | point-in-time status, blockers, backlog, process gotchas |
| `plugin/` | the implementation: kernel, four modules, tests, and `scripts/verify.sh` |
| `eval/` | behavioural and end-to-end evaluation harness and scenarios |
| `docs/TASK-FAILURE-REPORT-TEMPLATE.md` | the template to fill in when reporting a task failure |

## Running the checks

```bash
cd plugin
npm run typecheck     # tsc --checkJs, strict, against the ambient seam contract
npm test              # node --test — unit, conformance, and integration
./scripts/verify.sh   # the full evidence chain (11 checks), including a real profile install
```

`scripts/verify.sh` is the **release gate**. It installs the plugin into a
throwaway `DSH_HOME` inside the repository and never touches your real profile.
It creates `.abg-verify/` and `.pnpm-store/`; both are gitignored.

Behavioural evaluation (`eval/`) runs **real agents** and therefore costs model
calls and needs credentials. It is deliberately not part of CI or `npm test`.
See [`eval/README.md`](eval/README.md).

## Rules that keep this project maintainable

These are enforced by the conformance suite or by review, and they are the
reason the project is as small as it is:

1. **One additive prompt section.** Modules never register their own section;
   the compiler emits exactly one (`abg:governance`). Never set `complete: true`
   — it replaces the host system prompt.
2. **Deterministic enforcement over prompt text.** If a rule is mechanically
   checkable, enforce it at a seam (`tools/pre-execute`, `ctx.tools.guard`,
   `agent/pre-step`) and **do not restate it in the prompt**; the conformance
   suite fails if you do.
3. **Host semantics stay authoritative.** ABG supplements; it never overrides
   plan mode, the permission/approval model, the sandbox, or
   `AGENTS.md`/`CLAUDE.md`.
4. **Zero runtime dependencies, zero first-party imports.**
   [`plugin/lib/contract.d.ts`](plugin/lib/contract.d.ts) is the single auditable
   record of the host seams; every import in the package is relative.
5. **`apply()` never throws** (§26.2). Register each capability in its own
   guarded step; a fault must degrade into something observable.
6. **No document that duplicates another.** If a change's content substantially
   overlaps an existing document, amend that document instead of adding a file
   (this is how Part B was integrated; see §22.5).
7. **Attribute every prompt change.** A change to the compiled prompt text
   requires `PROMPT_VERSION` to change and a [`plugin/CHANGELOG.md`](plugin/CHANGELOG.md)
   entry naming the problem or evaluation result that motivated it.
8. **Do not commit regenerable artifacts or credentials.** `.gitignore` covers
   the known ones; if you find a new one, add it there rather than committing it.

## Submitting a change

- Keep a change set focused: one problem, one set of tests, one verification run.
- Add or update tests for any behavioural change. A prompt change without a
  conformance test is incomplete.
- Run `npm run typecheck && npm test` before opening a pull request, and say in
  the description whether you also ran `./scripts/verify.sh`.
- Do not weaken a test to make it pass. A `todo` test that executes and fails is
  worse than no test: it makes a green run mean less. Prefer deleting an
  assertion that belongs to another composition, as
  [`plugin/test/integration/durability.test.js`](plugin/test/integration/durability.test.js)
  does for the no-storage case.
- Never include credentials, session logs, or private file contents in a commit,
  an issue, or a pull request. See [`SECURITY.md`](SECURITY.md).

## Release policy

ABG is **not production-ready**: the model-backed behavioural gates C
(improvement), D (user-attention), and E (information integrity) have no valid
measurement for the current prompt revision, the package is `"private": true`,
and the publish target is undecided. The rules a release must satisfy are in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
§31 and the acceptance matrix in its §32. In short:

- semver; a change to compiled prompt text or to the durable record shape forces
  at least a minor bump and a changelog entry;
- a new host release is added to `dsh.compatibility.dshReleases` only after the
  compatibility baseline test passes and the baseline file is reviewed;
- `scripts/verify.sh` must pass against the pinned host version;
- `npm pack` must contain exactly the `files` allowlist and no build step.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
