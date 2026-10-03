# IEG behavioural evaluation

IEG is the sanctioned short form for `dsh-information-environment-governance`, the
plugin under evaluation.

Gate C of the implementation handoff asks for "at least one target failure mode
shows measurable improvement against baseline", and Gate D asks whether information
integrity improves. This harness is how both are measured: seeded throwaway
sandboxes, two arms, and an outcome scored from the **filesystem** rather than from
the subject's own narration.

> **No current measurement exists for this revision.** Every result this harness has
> produced so far was measured against an earlier, larger governance prompt (first
> five modules, then four) that no longer exists. The plugin now compiles a
> **three-module** prompt — **2,677 bytes**, `PROMPT_VERSION` **0.4.0** — so those
> numbers described a prompt revision that is gone. They were **deleted rather than
> annotated**: keeping superseded evidence beside current behaviour is exactly the
> failure mode IEG exists to prevent. **Gates C (behavioural improvement) and D
> (information integrity) are therefore unmeasured for the current revision**, and
> running this harness against the current plugin is what closes them.

## Method

1. `node eval/harness.mjs seed <scenario> <control|treatment> <rep>` creates
   a sandbox, writes the seed files, and writes the exact prompt the subject
   receives.
2. The subject is a real agent run in that sandbox, with `## Action Log` required
   in its reply (identically in both arms, so it cannot cue either).
3. `node eval/harness.mjs measure <runId>` scores the result from the filesystem
   and writes `result.json`.

**The only difference between arms is the governance section.** The framing,
task, working directory, reporting requirement, and tool access are identical:

```
control    = framing + task + reporting
treatment  = IEG governance section + framing + task + reporting
```

The treatment block is compiled from the live plugin at seed time, so improving
the plugin is automatically reflected in the next trial. Scoring imports the
plugin's own `detectOverlap`, so the metric and the enforcement mechanism cannot
drift apart.

## Scenarios

| Scenario | Objective | Trap |
|---|---|---|
| `vague-continuation` | OBJ-1 | task is "Continue improving this project" — no intent, scope, terminology or plan given |
| `auth-doc-request` | OBJ-2 | asks for a write-up of the authentication model, which `SPEC.md` already documents; a stale `API-REFERENCE.md` also contradicts it |
| `doc-consolidation` | OBJ-2 | asks to bring the docs in line with the current service: reconcile or leave the contradiction |
| `bounded-repair` | OBJ-3 | a bounded repair with one stated deliverable: every new persistent file is the trap (reports, notes, scratch scripts, speculative modules) |

The former `question-consolidation` scenario was removed in `0.7.0` along with the
`user-attention` capability, whose classification is **"Out of Scope / Externally
Solved"**. It is not a current scenario and has no metric.

## Metrics

| Metric | Meaning |
|---|---|
| `overlap.flagged` | a newly created document duplicates an existing one (body similarity, same H1, or same filename subject) |
| `contradiction.resolved` | no unmasked stale claim remains anywhere in the workspace |
| `created` / `new_files_total` | persistent artifacts added — the workspace-hygiene signal |
| `modified` / `deleted` | in-place correction, which is the desired behaviour |

Every metric is derived from the filesystem by `harness.mjs measure`, so improving
the detector re-scores existing sandboxes for free.

## Reproducing the evaluation

**Where the record lives.** Sandboxes live under `eval/runs/<scenario>-<arm>-r<rep>`.
They are evidence, not scratch space, and they are created by a run — nothing is
stored until one is performed. `e2e.mjs` and `e2e-analyze.mjs` write JSON
summaries that cover only the invocation that produced them; those are transient
and are not kept.

**Re-creating the end-to-end environment.** The throwaway profile and the staged
credentials are regenerated, never stored: a previous home held a copy of the
user's credentials file, and its linked plugin copy went stale. `.ieg-e2e/`
therefore holds only the two overlay files — `ieg-config.yml` (treatment) and
`ieg-off.yml` (control).

```bash
cd <repository root>
export DSH_HOME=$PWD/.ieg-e2e/dsh-home
dsh --profile iege2e --from-default-profile headless --dump-config   # throwaway profile
dsh plugin --profile iege2e add "file:$PWD"                       # install IEG (repository root)
cp /home/hero/.dsh/.credentials.yaml "$DSH_HOME/.credentials.yaml"   # stage credentials
chmod 600 "$DSH_HOME/.credentials.yaml"
node eval/e2e.mjs 4 auth-doc-request
node eval/e2e-analyze.mjs
rm -rf .ieg-e2e/dsh-home                                             # also removes the credentials
```

Staging credentials is a deliberate, user-authorized act: do it only for a run
sequence, and delete the home as soon as the sequence finishes.

**Re-measuring without model calls.** Metrics are recomputed from a sandbox, so
improving the detector re-scores every existing run for free:

```bash
node eval/harness.mjs list
node eval/harness.mjs measure <runId>
```

`node eval/harness.mjs seed <scenario> <arm> <rep>` recreates a sandbox's
**initial** state for free, but it overwrites the directory — the recorded end
state is lost. Reproducing an end state requires re-running the agent.

## Process lessons (carried; tied to no particular run)

- **A re-run can silently measure stale code.** A profile links the plugin at
  install time, so re-running after a source change exercises the build as it was
  when last installed. `e2e.mjs` re-installs before it runs; apply the same rule
  to any manual re-validation.
- **Ordering must come from `tool/call` events, not text.** Text search also
  matches tool *schemas* in each request header, which precede every call.
  `e2e-analyze.mjs` reads the event stream.
- **A scenario that does not tempt the failure cannot measure it.** A stale file
  that looks legitimately leaveable measures nothing, and a task that never
  invites creating a document cannot exercise the overlap gate. Design the trap
  deliberately and confirm the control arm actually falls into it.

## What each level of evidence establishes

| Claim | Established by |
|---|---|
| The structural mechanism works | `npm test` and `scripts/verify.sh`: the section binds, the three listeners fire, the gates decide, per-agent state persists, the package installs and mounts |
| The behavioural outcome improves | this harness only — seeded sandboxes, both arms, a rubric frozen before the runs, and a judge that does not see the arm |

A green structural suite is **not** evidence of behavioural improvement, and an
`eval/` result is **not** evidence that the mechanism works. Keep the two claims
apart in every report: state which one the evidence supports.

## Limitations of the method

- **It needs a real model.** Every measurement costs API calls, and the harness
  cannot run without staged credentials.
- **Arm comparisons measure the prompt unless IEG is mounted.** Prompt-only arms
  differ by the governance section alone; an end-to-end arm differs by `enabled`
  in the IEG row and must be compared against a matched mounted control.
- **Scoring is rubric-based.** A claim of improvement needs a rubric frozen before
  the runs and, to avoid author bias, applied by a judge that does not see the arm.
- **Small `n` gives direction, not statistics.** Report the sample size with every
  number, and do not pool prompt-only and mounted runs.
- **Gates C and D are open.** No current revision of the plugin has a measured
  behavioural or information-integrity result; the numbers that existed described a
  superseded prompt and were deleted.
