# Leak guard: spaced defanged dots (2026-11-05)

Hand-written note. The numbers come from `bun run sim --only evals` on this tree, and from `findLeaks` on the same strings before the change. No LLM. The sim clears provider keys. Seeds do not apply: the evals block scores the hand-written corpora in `evals/`.

## Command

```bash
bun run sim --only evals
bun run typecheck
```

Base of this follow-up is `1e54e64` (`fix(core): catch defanged dots in the leak guard`) on `cursor/leak-dot-defang-474c`. Upstream `main` is `a0ed7bc`.

## What was missed

On `1e54e64`, before this change:

| Text | `findLeaks` |
|---|---|
| `see example (.) com` | `contact:url` |
| `visit example (.) ai` | `[]` |
| `visit example [.] co` | `[]` |
| `visit example [.] dev` | `[]` |
| `example 。 co` | `[]` |
| `example<dot>com` | `[]` |
| `sam[@]gmail` | `[]` |
| `sam(@)outlook` | `[]` |
| `sam{@}yahoo` | `[]` |
| `sam<@>icloud` | `[]` |
| `sam<at>gmail` | `[]` |

The bracket unwrap turned `example (.) ai` into `example . ai`. The closer then joined a space-dot only before `com|net|org|io|xyz|biz|info`. `<dot>` and `<at>` were not in the word-form brackets. `[@]`, `(@)`, `{@}`, and `<@>` were not turned into `@`.

## Leak-guard gate

| Run | Gate | Result |
|---|---|---|
| Before, corpus of 162 | `leak guard (n 162): evasions caught, benign text clean` | PASS. This was the previous fix. |
| After, corpus of 181 | `leak guard (n 181): evasions caught, benign text clean` | PASS. 0 misses. |

The 162 rows already in the corpus keep the same labels. The 19 new rows are the review examples, the other bracket forms, and two benign `@` lines (`use items[@]length in the code`, `wave (@) if you see me`).

Whole evals block after the change: 25/25 blocking gates pass, exit 0, 0.4s.

`bun run typecheck` after the change: exit 0.

## What stays limited

A dot with no space before it is still sentence punctuation. It joins only `com|net|org|io|xyz|biz|info`, so `urbanism. Dev`, `away. Ai`, `chess. Co`, `Out. To`, and `7. In` stay clean.

A spaced middle dot, bullet, or katakana middle dot joins only that same short list. `example · com` is a contact. `example · co` and `Saturday · in Brooklyn` are not. The full TLD list applies to a space before an ASCII dot, a spaced ideographic full stop, and a bracket dot (`(.)`, `[.]`, `{.}`, `<.>`).

`(@)` is unwrapped only when the next word is a known mail provider or a domain. `wave (@) if you see me` stays clean.

## What was not run

No real LLM call. The leak guard does not call a model. `bun run test:integration` and `bun run test:e2e` were not run. This change does not touch Postgres or HTTP. The leak-guard corpus is the sim evals block.
