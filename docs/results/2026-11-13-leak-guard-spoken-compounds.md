# Leak guard: spoken compound phone numbers

Hand-written report. The corpus rows are hand-written. The pass and miss counts are from `findLeaks` on this checkout. No model call. No seed. The guard is deterministic.

## Command

Base: `upstream/main` at `dc9002b8caa9f71b0d93770149f59461dc1418ef`.

```bash
bun -e 'import { findLeaks } from "./packages/core/src/guard.ts"'
bun run sim --only evals
bun run typecheck
```

The before column uses `packages/core/src/guard.ts` from `dc9002b` on the same `evals/guard/leaks.jsonl` (155 rows). The after column uses this branch.

## Sample

`evals/guard/leaks.jsonl`, 155 rows. 132 rows were already on `dc9002b`. 23 rows are new: 10 spoken or `period` contacts, 13 benign lines.

## Result

| Check | Before | After |
|---|---|---|
| Corpus misses | 10 of 155 | 0 of 155 |
| New contact rows caught | 0 of 10 | 10 of 10 |
| `bun run sim --only evals` | not re-run on the old guard | PASS 25/25, leak guard n 155, 0.3s |
| `bun run typecheck` | — | exit 0 |

The 10 misses on the old guard are only the new contact rows. The 132 old rows and the 13 new benign rows are clean on both.

The evals block also reports benign adult phrasing precision 100% (n 221) and 0 minor signals. That block does not call a model.

## What is not shown

`bun run test:integration` and `bun run test:e2e` need Postgres. This machine has no `psql` or `pg_ctl`. Those suites were not run. The change is the pure contact pass in `packages/core/src/guard.ts`.
