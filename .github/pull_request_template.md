## What this changes

<!-- One problem, one change set. Explain what a reviewer cannot see from the diff. -->

## Problem it addresses

<!-- The failure class (FC-2.x), gate, blocker number, or evaluation result. -->

## Checks run

- [ ] `cd plugin && npm run typecheck`
- [ ] `cd plugin && node --test`
- [ ] `cd plugin && ./scripts/verify.sh` (say if not run, and why)
- [ ] `./scripts/check-docs.sh` (links, front matter, and index coverage)

## Prompt and state impact

- [ ] No injected model-facing text changed (`PROMPT_VERSION` unchanged)
- [ ] Compiled prompt text changed → `PROMPT_VERSION` bumped and
      `CHANGELOG.md` names the problem or evaluation result that motivated it
- [ ] Durable record shape changed → `DOMAIN_VERSION` decision recorded

## Documentation

- [ ] Affected documents were amended **in place** rather than duplicated
      (see `ARCHITECTURE-SPEC` §22.5)
- [ ] A new or renamed document is listed in `docs/DOCUMENTATION-INDEX.md` and
      carries `owner` and `last_reviewed` front matter
- [ ] Content that belongs to another document's single source of truth is a link,
      not a restatement (`docs/DOCUMENTATION-INDEX.md`)
- [ ] No `child-agent-lifecycle`, `user-attention`, or other withdrawn/removed
      identifier was reintroduced
- [ ] Regenerable artifacts and credentials are not part of this change

## Notes for the reviewer

<!-- Known limits, follow-ups, and anything you deliberately did not do. -->
