---
doc_type: security-policy
project: information-environment-governance
version: 0.2.0
plugin_version: 0.7.0
status: active
owner: maintainers
last_reviewed: 2026-10-03
revision: 0.7.0-scope-reset
audience: everyone
language: en
---

# Security Policy

## Project status

IEG is a **verifiable prototype**, not a production component. It is not
recommended for installation into a working profile; the model-backed behavioural
gates (C and D) are unmeasured, and the package stays `"private": true`. Do not
treat IEG as a security control.

## What IEG is — and is not

IEG is a governance layer. It is **not** a sandbox, an authorization system, or a
replacement for any DeepSeek Harness safety mechanism:

- it does **not** replace DSH authorization, sandbox, permission, credential, or
  approval controls;
- its mutation governance covers **tool-mediated** mutations only, not
  process-wide writes (a plugin calling `ctx.fs.writeText()` directly bypasses
  it);
- it deliberately **fails open** for optional capabilities, so an absent storage,
  filesystem, or approval service never becomes a hard block;
- IEG **registers no approval answerer**: it gates with `ask` and inherits the
  host's fail-closed path where no approval channel exists;
- where a rule is ambiguous, IEG prefers a safe refusal (`deny`) over assuming
  authorization.

### Explicitly out of scope

The following are outside IEG's scope and must not be reported as missing
capabilities:

- general AI safety or security;
- sandboxing;
- authorization;
- user-attention optimization;
- unrelated agent behavior management.

Any future feature must show a direct connection to Information Environment
Governance. The canonical positioning and scope are in
[`PRODUCT-SPEC.md`](PRODUCT-SPEC.md) §1. The accepted design-level boundaries are
enumerated in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part B and in the "Risk" sections of that document.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's
private vulnerability reporting for this repository (the **Security** tab →
*Report a vulnerability*). If that channel is unavailable, open a minimal issue
asking for a private contact route and include no sensitive detail in it.

Include, as applicable:

- the IEG version and the `PROMPT_VERSION` reported by `ieg_status`;
- your DSH version (`dsh -V`) and the profile used;
- the effective configuration (the `ieg` row from `dsh --profile <name> --dump-config`);
- a minimal reproduction, and the `ieg_status` output;
- the impact you believe it has.

## What never to send

- Credentials, API keys, or the contents of `~/.dsh/.credentials.yaml`.
- Session logs or workspace files containing private data. Redact first; if a
  log is essential, quote only the minimum lines needed.
- Absolute paths that disclose private directory names beyond what is necessary.

## Response expectations

This is a prototype maintained on a best-effort basis. There is no guaranteed
response time and no supported release line. Fixes land on `main`; because the
durable record shape and the compiled prompt are versioned, a security-relevant
change will be recorded in [`CHANGELOG.md`](CHANGELOG.md) with the
problem it addresses.

## Known limitations (not vulnerabilities, not bugs)

This is the single home for the accepted-limits list. [`TESTING.md`](TESTING.md) §7
and [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/bug_report.yml)
link here rather than restating it; the design-level boundaries are in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
Part B.

1. Mutation governance covers **tool-mediated mutations only**. A plugin that
   calls `ctx.fs.writeText()` (or otherwise writes) directly is not covered, and
   IEG does not claim process-wide coverage.
2. Shell-write classification does not recognise an indirectly invoked wrapper
   (`env bash -c '…'`) or PowerShell `Remove-Item`; quoted text is treated as data
   unless the command wraps another command.
3. `agent/pre-step` live dispatch is exercised by wiring and decision-shape
   tests, not by a full agent loop.
4. **Question consolidation is no longer a capability at all.** The
   `user-attention` module and failure class `FC-2.4` were removed in 0.7.0,
   classified Out of Scope / Externally Solved. There is no question ledger, no
   `userAttention` config key, and no question-batching gate; an `ask_user_question`
   observation is not an IEG behaviour and its absence is not a defect.
5. IEG registers **no approval answerer**. `workspace.policy: 'ask'` and
   `overlapCheck: 'ask'` fail closed where no approval channel exists.
6. **Diagnostics are derived, not authoritative.** The bounded ring, the
   `ieg:status` runtime-context line, and the `ieg_status` tool mirror the
   plugin's own view for diagnosis; they are not a source of truth about host
   state, and a non-empty `degraded[]` can coexist with `mounted: true` — read
   `degraded`, not `mounted` alone.
7. With no `ctx.storageDomain`, orientation does not survive a resume: IEG
   degrades to in-memory state and re-imposes the orientation requirement. This
   is accepted, documented behaviour.
8. Log narration (`ctx.logger`) is best-effort and invisible in stock
   compositions; use the `ieg_status` diagnostic ring instead.

When reporting a *task* failure rather than a vulnerability, use the
[`.github/ISSUE_TEMPLATE/bug_report.yml`](.github/ISSUE_TEMPLATE/bug_report.yml)
issue form.
