# Leak guard: defanged dots (2026-10-30)

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-30-leak-guard-defanged-dots.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Hand-written note. The numbers come from `pnpm run sim --only evals` on this tree. No LLM. The sim clears provider keys. Seeds do not apply: the evals block scores the hand-written corpora in `evals/`.

## Command

```bash
pnpm run sim --only evals
```

Base is upstream `main` at `a0ed7bc` (`fix(deploy): support paired Eliza backend cutover (#132)`). Both runs used the same 162-row corpus. Only `packages/core/src/guard.ts` changed between them.

## Leak-guard gate

| Run | Gate | Result |
|---|---|---|
| Before the fix | `leak guard (n 162): evasions caught, benign text clean` | FAIL. The gate prints the first five misses: `visit example[.]com`, `sam at example[.]com`, `www[.]example[.]com/sam`, `example(.)com`, `see example (.) com`. |
| After the fix | `leak guard (n 162): evasions caught, benign text clean` | PASS. |

The same `findLeaks` check the gate uses, on the same 162 rows, misses 19 contacts before the fix and 0 rows after it. All 19 misses are the new contact rows. The 11 new benign rows are clean before and after. The other evals gates do not change.

Whole evals block, same command:

| Run | Blocking gates | Time |
|---|---|---|
| Before | 24/25 pass, exit 1 | 0.3s |
| After | 25/25 pass, exit 0 | 0.3s |

`pnpm run typecheck` after the fix: exit 0.

## What was not run

No real LLM call. The leak guard does not call a model. `pnpm run test:integration` and `pnpm run test:e2e` were not run. This change does not touch Postgres or HTTP. The leak-guard corpus is the sim evals block.
