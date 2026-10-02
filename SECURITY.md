---
doc_type: security-policy
project: agent-behavioral-governance
version: 0.1.0
status: active
owner: maintainers
last_reviewed: 2026-10-02
audience: everyone
language: en
---

# Security Policy

## Project status

ABG is a **verifiable prototype**, not a production component. It is not
recommended for installation into a working profile; the model-backed
behavioural gates (C, D, E) are unmeasured, and the package stays
`"private": true`. Do not treat ABG as a security control.

## What ABG is — and is not

ABG is a governance layer. It is **not** a sandbox, an authorization system, or
a replacement for any DeepSeek Harness safety mechanism:

- it does **not** replace DSH authorization, sandbox, permission, credential, or
  approval controls;
- its mutation governance covers **tool-mediated** mutations only, not
  process-wide writes (a plugin calling `ctx.fs.writeText()` directly bypasses
  it);
- it deliberately **fails open** for optional capabilities, so an absent
  storage, filesystem, or approval service never becomes a hard block;
- where a rule is ambiguous, ABG prefers a safe refusal (`deny`) over assuming
  authorization.

The accepted boundaries are enumerated in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md)
§34.3 and in the "Risk" sections of that document.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's
private vulnerability reporting for this repository (the **Security** tab →
*Report a vulnerability*). If that channel is unavailable, open a minimal issue
asking for a private contact route and include no sensitive detail in it.

Include, as applicable:

- the ABG version and the `PROMPT_VERSION` reported by `abg_status`;
- your DSH version (`dsh -V`) and the profile used;
- the effective configuration (the `abg` row from `dsh --profile <name> --dump-config`);
- a minimal reproduction, and the `abg_status` output;
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
change will be recorded in [`plugin/CHANGELOG.md`](plugin/CHANGELOG.md) with the
problem it addresses.

## Known limitations (not vulnerabilities, not bugs)

This is the single home for the accepted-limits list. [`TESTING.md`](TESTING.md) §7
and [`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](docs/TASK-FAILURE-REPORT-TEMPLATE.md) §12
link here rather than restating it; the design-level boundaries are in
[`ARCHITECTURE-SPEC-AGENT-REFERENCE.md`](ARCHITECTURE-SPEC-AGENT-REFERENCE.md) §34.3.

1. `agent/pre-step` live dispatch is exercised by wiring and decision-shape
   tests, not by a full agent loop.
2. `ask_user_question` consolidation is unmeasurable in a headless composition
   with no answerer, so Gate D has no end-to-end number.
3. Behavioural improvement (Gates C/D/E) has no valid measurement for the
   current four-module prompt.
4. With no `ctx.storageDomain`, orientation does not survive a resume: ABG
   degrades to in-memory state and re-imposes the orientation requirement. This
   is accepted, documented behaviour.
5. Shell-write classification does not recognise an indirectly invoked wrapper
   (`env bash -c '…'`) or PowerShell `Remove-Item`.
6. `workspace.policy: 'ask'` and `overlapCheck: 'ask'` fail closed where no
   approval channel exists.
7. `degraded[]` non-empty can coexist with `mounted: true`; read `degraded`, not
   `mounted` alone.
8. Log narration (`ctx.logger`) is best-effort and invisible in stock
   compositions; use the `abg_status` diagnostic ring instead.

When reporting a *task* failure rather than a vulnerability, use
[`docs/TASK-FAILURE-REPORT-TEMPLATE.md`](docs/TASK-FAILURE-REPORT-TEMPLATE.md).
