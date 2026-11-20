# Leak guard: a letter-spaced dot stays a word (2026-11-20)

Hand-written note. The numbers come from `pnpm run sim --only evals` on this tree. No LLM. The sim clears provider keys. Seeds do not apply. The evals block scores the hand-written corpora in `evals/`.

## Command

```bash
pnpm run sim --only evals
```

Base is upstream `vibestack` at `908aec03`. Node is v26.13.1. pnpm is 10.24.0. The same corpus is used before and after. The only code change between the two runs is `packages/core/src/guard.ts`. The new row is in `evals/guard/leaks.jsonl` for both runs.

## What was missed

`contactVariants` joins a run of spaced letters into one word when the text already has `at`, `dot`, or `@`. The run `g m a i l d o t c o m` became `gmaildotcom`. The spelled-dot pass then never saw the word `dot`, so the email was clean.

| Text | `findLeaks` before | `findLeaks` after |
|---|---|---|
| `my email is s a m at g m a i l dot c o m` | `contact:email` (already caught) | `contact:email` |
| `my email is s a m at g m a i l d o t c o m` | `[]` | `contact:email` |

Benign lines that stay clean include `I'm into polka dot dresses and com sci memes.`, `I am at the d o t i n the park`, and `the d o t c o m bubble`. A spelled `dot` is split out only when a label sits on the left and a known TLD sits on the right.

## Leak-guard gate

| Run | Gate | Result |
|---|---|---|
| Before the fix | `leak guard (n 223): evasions caught, benign text clean` | FAIL. The only miss is `my email is s a m at g m a i l d o t c o m`. |
| After the fix | `leak guard (n 223): evasions caught, benign text clean` | PASS. 0 misses. |

The other 222 rows keep the same `findLeaks` labels. One direct compare of every row showed one difference, and it is the new row.

Whole evals block, same command:

| Run | Blocking gates | Time |
|---|---|---|
| Before | 30/31 pass, exit 1 | 0.6s |
| After | 31/31 pass, exit 0 | 0.6s |

`model input privacy (n 96)` passes after the fix: 0 contact rows stay visible, and `I am 31 and I like climbing` stays in the masked profile line.

## What was not run

No real LLM call. The leak guard does not call a model. `pnpm run typecheck` after the fix: exit 0. Node v26.13.1. The toolkit install (`pnpm run spec:setup`) ran first, because the root typecheck reads the vibestack tools. `pnpm run test:integration` and `pnpm run test:e2e` were not run. This change does not touch Postgres or HTTP. No mutation tool was run.
