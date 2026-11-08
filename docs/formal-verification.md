# Formal verification with LemmaScript

LemmaScript proves properties of TypeScript functions. You write `//@ ` annotations in ordinary TypeScript. `lsc` generates Dafny, and Dafny checks the proof. The toolchain is a pinned dev dependency (`lemmascript`) and Dafny 4.11.0.

## What is proved

The safety decisions: age rules, consent, STOP, bans, review, relay, send gates, and the OAuth and routing checks. The list is [LemmaScript-files.txt](../LemmaScript-files.txt). The proofs are in `proofs/`, in the same paths as the sources.

Decision logic in `sites/` and `packages/observatory/web` lives in import-free cores with `//@` contracts. React components and the DOM are the unverified shell, and they call the core instead of recomputing the decision.

A proof covers the function, on its inputs. Inputs that the caller reads from SQL, HTTP or a regex are trusted. Do not write "verified" about a flow unless every seam of the flow calls the proved function.

## What is not proved

- SQL: `person_cap_take`, per-line caps, row-level security, advisory locks.
- Concurrency and ordering across transactions.
- Regex tables: the keyword, phone and contact parsers. Use corpus rows in `evals/`.
- Crypto, parsers of `unknown` JSON, and the Eliza model reply, which is outside this repository.
- Number edge cases. `number` is an ideal integer or real, so NaN, Infinity and rounding are outside the model.

Integration tests, e2e tests and `bun run sim` stay the validation layer for these.

## Commands

```bash
bun run formal                                                  # every proof and the structure gates (the formal block of bun run sim)
bunx lsc check --backend=dafny packages/core/src/policy.ts      # one file
bunx lsc regen --backend=dafny packages/core/src/policy.ts      # after a change to the TypeScript
```

Install Dafny 4.11.0 from the release zip (https://github.com/dafny-lang/dafny/releases/tag/v4.11.0). The zip has the Z3 builds that Dafny supports, and CI uses it. Do not use Homebrew's build: it uses Z3 5.x, and some proofs that pass in CI fail with it. Without Dafny the block records a tracked "skipped" gate. CI sets `REQUIRE_DAFNY=1`, so there it fails.

## Rules

1. Production must run the proved code. Put decisions in an import-free module of top-level functions, and call it from the shipping code. Annotating the shipping function is better when it works. A parallel model is not accepted. The formal block fails when no non-test code imports a listed file.
2. Add every file with `//@ verify` to `LemmaScript-files.txt`. The formal block fails when a file is missing.
3. Do not use `//@ assume`, `//@ havoc` or `{:axiom}` to make a proof pass. `proofs/trust.json` holds the allowed counts. A higher count fails the block, and raising it needs a review.
4. Use `lsc regen` after a TypeScript change. Do not delete a `.dfy` file: it can hold proof additions. Do not edit a `.dfy.gen` file.
5. A spec must have force. Change the logic once, confirm that `lsc` reports an error, and undo the change. Put the result in the PR evidence.
6. Use a named interface for object parameters. Do not put `Set`, `RegExp` or `Intl` constants at the top level of a proved file: one unsupported constant stops the whole file. The reports in [docs/research/lemmascript/](research/lemmascript/) list more limits.

`packages/core/src/svc/contract.ts` and `svc-auth.ts` are byte-pinned to upstream. Do not annotate them.
