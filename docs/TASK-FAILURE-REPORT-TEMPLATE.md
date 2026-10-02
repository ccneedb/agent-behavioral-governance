# ABG Task-Failure Report Template

Use this when ABG's governance produced a wrong outcome during real work — it
blocked something legitimate, allowed something it should have caught, or its
state was not observable. For a defect in ABG's code that is not task-scoped, a
normal bug report is fine. For a vulnerability, follow [`SECURITY.md`](../SECURITY.md)
and **do not** open a public issue.

Copy the block below into the issue. Fill every field; an incomplete report
cannot be triaged. One failure per report. Report ID: `ABG-<YYYYMMDD>-<NNN>`.

> The single most valuable habit for this phase: capture `abg_status` **and** run
> the same task with ABG disabled. That A/B separates an ABG defect from a
> host/model defect, which is exactly what Gates C, D, and E need in order to be
> measured at all.

<!-- BEGIN TEMPLATE -->

```markdown
# ABG Task-Failure Report — ABG-<YYYYMMDD>-<NNN>

## 0. Pre-flight self-checks
- [ ] `abg_status` was called and its JSON pasted in §4 (if ABG mounted at all).
- [ ] The failure reproduces with ABG disabled (`enabled: false` or the abg-off overlay).
      -> If NO: it is a host/environment issue, not ABG.
- [ ] The failure is not in the "Known limitations" list in §12.
- [ ] I removed credentials, tokens, and private file contents from all pasted evidence.

## 1. Reporter and environment
- Reporter / contact:
- Date-time (with timezone):
- OS + version:
- Node version (`node -v`):
- DSH version (`dsh -V`):                 # verified baseline 0.2.0-rc.2
- DSH_HOME in use:                        # absolute path
- Profile name (e.g. web):
- ABG version (`plugin/package.json`):    # verified 0.2.0
- PROMPT_VERSION (`abg_status.mount.promptVersion`):
- Install method: [ ] file: path  [ ] other:
- Re-installed after the last source change? [ ] yes [ ] no [ ] n/a

## 2. ABG mount and configuration
- `mount.mounted`: true / false
- `mount.degraded[]` (verbatim; an empty array means a complete mount):
- `mount.configError` (verbatim, if any):
- `mount.moduleCount` and `mount.modules[]`:
- `mount.compatibility.verdict` and `.reasons[]`:
- Effective `abg` row (`dsh --profile <name> --dump-config`):
- Config overlays applied (`--patch` files):

## 3. The task that failed
- Task goal in one sentence:
- What the agent was asked to do (exact prompt, trimmed of private data):
- Working directory / sandbox:
- Tools in use when it failed:
- Turn / step index, if known:

## 4. What ABG reported
Paste the full `abg_status` result verbatim:
```json
{ "mount": {}, "status_line": "abg: diagnostics=… last=… warnings=…",
  "diagnostic_counts": {}, "diagnostics": [], "agentId": "…" }
```
- `status_line`:
- `diagnostic_counts`:
- Relevant diagnostic entries (code / time / data):
- Relevant `abg.*` codes observed (e.g. abg.orientation_required,
  abg.workspace_mutation_blocked, abg.document_overlap_flagged,
  abg.question_batch_blocked, abg.error, abg.capability_missing):
- Was the outcome a DENY or an ASK (approval request)?
- Exact refusal/allowance text shown to the agent:

## 5. Expected vs actual
- Expected behaviour:
- Actual behaviour:
- Why you believe ABG caused this (or why you are unsure):
- Did disabling ABG change the outcome? [ ] yes [ ] no [ ] not tested

## 6. Reproduction
- Minimal reproduction: numbered steps, smallest config, smallest task.
- Determinism: [ ] every time  [ ] intermittent (~__%)  [ ] once
- If intermittent: any ordering or parallelism involved?
- Related files (paths only, no private content):

## 7. Evidence and logs
- Session log path (`$DSH_HOME/sessions/<bucket>/<session>/session.v4.jsonl.zstd`).
  NOTE: multi-frame zstd, and composition-coupled — do not strip ABG events.
- Command output / stderr (verbatim, secrets removed):
- Terminal captures (optional):
- `verify.sh` output, if the failure is install- or compose-time:

## 8. Severity and impact
- Severity: [ ] S1 blocks all work  [ ] S2 blocks a task  [ ] S3 degrades quality  [ ] S4 cosmetic
- Scope: [ ] one session  [ ] one profile  [ ] all profiles
- Safety impact: [ ] none  [ ] blocked a legitimate write  [ ] allowed an unauthorized write
- Data loss? [ ] no  [ ] yes (describe):
- Workaround available (and does it work?):

## 9. Classification (best guess)
- [ ] false positive (ABG blocked/allowed wrongly)
- [ ] false negative (ABG missed something it should catch)
- [ ] mount / configuration fault (mounted:false, configError, degraded[])
- [ ] host-compatibility drift (compatibility verdict != COMPATIBLE)
- [ ] diagnostics gap (state not observable)
- [ ] performance / prompt-budget
- [ ] unclear

## 10. Attachments checklist
- [ ] `abg_status` JSON (§4)
- [ ] Effective config dump (§2)
- [ ] Minimal repro (§6)
- [ ] Redacted logs (§7)

## 11. Privacy checklist
- [ ] No API keys/tokens/passwords (including `~/.dsh/.credentials.yaml` contents).
- [ ] No absolute paths that reveal private directory names beyond what is necessary.
- [ ] No private document bodies; quote only the minimum necessary lines.
- [ ] Session logs redacted for user content if your policy requires it.

## 12. Known limitations that are NOT bugs (do not file these)
1. `agent/pre-step` live dispatch is not verified against a live agent loop.
2. `ask_user_question` consolidation (Gate D) is unmeasurable in a headless
   composition with no answerer.
3. Behavioural improvement (Gates C/D/E) has no valid measurement for the current
   four-module prompt.
4. With no `ctx.storageDomain`, orientation does not survive a resume; ABG
   degrades to in-memory state and re-imposes the requirement.
5. Shell-write classification misses indirect wrappers (`env bash -c '…'`) and
   PowerShell `Remove-Item`.
6. `workspace.policy: 'ask'` and `overlapCheck: 'ask'` fail closed where no
   approval channel exists.
7. `degraded[]` non-empty and `mounted: true` can coexist: read `degraded`, not
   `mounted` alone.
8. Log narration (`ctx.logger`) is best-effort and may be invisible in stock
   compositions — always attach the `abg_status` ring instead.

## 13. Triage outcome (maintainers only)
- Reproduced? [ ] yes [ ] no
- Root cause:
- Fix / PR:
- Regression test added:
- Disposition:
```

<!-- END TEMPLATE -->
