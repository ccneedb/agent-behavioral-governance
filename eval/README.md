# ABG behavioural evaluation

ABG is the sanctioned short form for `dsh-agent-behavioral-governance`, the
plugin under evaluation.

Gate C of the implementation handoff asks for "at least one target failure mode
shows measurable improvement against baseline". This harness is how that is
measured: seeded throwaway sandboxes, two arms, and an outcome scored from the
**filesystem** rather than from the subject's own narration.

> **No current measurement exists.** Every result this harness has produced so far
> was measured against the **five-module** governance prompt (3,905 bytes), which
> contained the module later removed by explicit user decision
> (`ARCHITECTURE-SPEC-AGENT-REFERENCE.md` §23). The plugin now compiles a
> **four-module** prompt (3,459 bytes), so those numbers described a prompt
> revision that no longer exists. They were **deleted rather than annotated**:
> keeping superseded evidence beside current behaviour is exactly the failure mode
> ABG exists to prevent. Gates C, D, and E are therefore **unmeasured** for the
> current revision, and running this harness against the current plugin is what
> closes them.

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
treatment  = ABG governance section + framing + task + reporting
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
| `question-consolidation` | OBJ-3 (Gate D) | five release decisions are explicitly the owner's call and answerable only by a human, so a correct run must ask — and the question is whether it asks once or five times |

## Reaching `ask_user_question` in a headless trial

A headless composition has no human client, so `user-questions/request` is never
claimed and `ask_user_question` is never reached. `eval/answerer/` is an
**evaluation-only** DSH plugin that claims that waterfall and answers
deterministically (`byId` → first option → `byKeyword` → `defaultAnswer`), so the
batching path can be exercised. It is mounted in **both** arms: it is part of the
harness, not of the treatment. It answers on the user's behalf, so it must never
be installed in a profile a human uses.

```bash
node --test eval/answerer/answerer.test.mjs    # the pure decision function
```

## Metrics

| Metric | Meaning |
|---|---|
| `overlap.flagged` | a newly created document duplicates an existing one (body similarity, same H1, or same filename subject) |
| `contradiction.resolved` | no unmasked stale claim remains anywhere in the workspace |
| `created` / `new_files_total` | persistent artifacts added — the workspace-hygiene signal |
| `modified` / `deleted` | in-place correction, which is the desired behaviour |

Question consolidation (Gate D) uses the handoff's metric set:
`questions_registered`, `questions_sent`, `batches_sent`, `redundant_questions`,
`average_questions_per_batch`, `user_interruption_count`, and
`blocked_execution_time`.

## Reproducing the evaluation

**Where the record lives.** Sandboxes live under `eval/runs/<scenario>-<arm>-r<rep>`.
They are evidence, not scratch space, and they are created by a run — nothing is
stored until one is performed. `e2e.mjs` and `e2e-analyze.mjs` write JSON
summaries that cover only the invocation that produced them; those are transient
and are not kept.

**Re-creating the end-to-end environment.** The throwaway profile and the staged
credentials are regenerated, never stored: a previous home held a copy of the
user's credentials file, and its linked plugin copy went stale. `.abg-e2e/`
therefore holds only the two overlay files — `abg-config.yml` (treatment) and
`abg-off.yml` (control).

```bash
cd <repository root>
export DSH_HOME=$PWD/.abg-e2e/dsh-home
dsh --profile abge2e --from-default-profile headless --dump-config   # throwaway profile
dsh plugin --profile abge2e add "file:$PWD/plugin"                   # install ABG
cp /home/hero/.dsh/.credentials.yaml "$DSH_HOME/.credentials.yaml"   # stage credentials
chmod 600 "$DSH_HOME/.credentials.yaml"
node eval/e2e.mjs 4 auth-doc-request
node eval/e2e-analyze.mjs
rm -rf .abg-e2e/dsh-home                                             # also removes the credentials
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

## Limitations of the method

- **It needs a real model.** Every measurement costs API calls, and the harness
  cannot run without staged credentials.
- **Arm comparisons measure the prompt unless ABG is mounted.** Prompt-only arms
  differ by the governance section alone; an end-to-end arm differs by `enabled`
  in the ABG row and must be compared against a matched mounted control.
- **Scoring is rubric-based.** A claim of improvement needs a rubric frozen before
  the runs and, to avoid author bias, applied by a judge that does not see the arm.
- **Small `n` gives direction, not statistics.** Report the sample size with every
  number, and do not pool prompt-only and mounted runs.
