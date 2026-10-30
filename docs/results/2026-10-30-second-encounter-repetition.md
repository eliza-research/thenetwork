# Second-encounter repetition penalty — results, 2026-10-30

## Defect
`computeComponents` in `packages/engine/src/scoring.ts` penalised a
`second_encounter` candidate with repetition = 0.6 when the pair was proposed
within 30 days. The completed-interaction branch already exempted
`second_encounter`, but the recent-proposal branch did not. The
`second_encounter` generator only fires after a completed, mutually positive
meeting within 60 days, so its follow-ups almost always carry a recent
proposal and almost always paid the penalty.

## Fix
One line: the recent-proposal branch now also skips `second_encounter`
(`c.kind !== "second_encounter"`), matching the completed-interaction branch.

## Before / after (same harness, same data)
Trigger: pair proposed 10 days ago, met, completed 5 days ago.
- Before: `second_encounter` repetition = 0.6, identical to a plain intro control.
- After: `second_encounter` repetition = 0; intro control still 0.6.

## Sim gate
`scripts/sim/engine-second-encounter.ts`, wired into the network block of
`bun run sim`. Two gates: second encounter is not penalised; plain intro with
the same recent proposal still is. The gate passes with the fix; the
component-level harness above shows it fails (0.6) without the fix.

## Validation (commands run in this checkout)
- `bun run sim --only network`: PASS: 63/63 blocking gates, 0 tracked off
  target, 395.9s. Full `bun run sim` (all blocks) was not run, per the
  machine-load rule; only the network block, which runs the new gate.
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests.
  The 23 failures are the same count and environment pattern seen on PRs
  209/211/215 in this VM (no dev Postgres); none of the failing tests seen
  touch the scoring repetition code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same
  missing-Postgres reason.

## Model / clients
No model was used. The sim runs offline with no LLM. Real-LLM and
agent-client items are N/A for this engine-only scoring change, for the same
reason as PRs 209/211.
