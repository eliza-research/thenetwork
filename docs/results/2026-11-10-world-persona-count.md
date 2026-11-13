# World personas count validation (2026-11-10)

## Problem, requirement and fix

The world simulator's population size is not checked. `packages/sim/src/cli.ts` reads
`--personas` with `Number(a.personas)`, and `generatePersonas` (`packages/sim/src/generator.ts`)
uses the value directly.

Two results are wrong on base `a0ed7bc`:

1. A blank value becomes zero. `Number("")` is `0`, so `--personas ""` (or spaces) exits 0 and
   writes a complete report for a world with no members. The report shows `personas: 0`,
   `joined: 0` and zero in every rate, and it reads as a successful run.
2. A fractional or non-finite value dies inside allocation. `2.5`, `-1`, `NaN` and `Infinity`
   reach `Array(n)`, which throws `RangeError: Array length must be a positive integer of safe
   magnitude.` The operator gets an allocation error, not a statement about the count.

The same count reaches the generator from other callers: the Observatory game source
(`packages/observatory/src/sources/game.ts:158`, from `--personas` on the console CLI),
`scripts/synthetic/generate.ts:69`, `scripts/sim/slop-live.ts:128` and
`packages/network/harness/growth.ts`.

Requirement: PRD 34.3 (repeatable generated worlds). A population size is a count, so a value that
is not a count is a configuration error, and a blank option is not a request for an empty world.

Fix: `generatePersonas` requires a non-negative safe integer before it allocates or draws, and the
CLI passes `NaN` for a blank value so the same check refuses it.

Two other implementations were rejected:

1. Check only in the CLI. Direct callers (the Observatory, the synthetic generator, the harness)
   would keep the allocation error.
2. Floor, clamp or default the value. That silently changes the requested experiment size and
   removes the difference between a malformed option and an explicit zero.

No maximum population, no new dependency and no change to generation for a valid count are added.
An explicit `0` stays valid as the empty-world control.

## measurement

Invalid values, same command and seed, before and after (`--days 1 --seed 1 --json`, Bun 1.4.2):

| `--personas` | Base `a0ed7bc` | This branch |
| --- | --- | --- |
| `""` | exit 0, report written, `personas: 0`, `joined: 0` | exit 1, `personas must be a non-negative safe integer, got NaN`, no report |
| `"   "` | exit 0, report written, `personas: 0` | exit 1, same diagnostic |
| `2.5` | exit 1, `RangeError: Array length must be a positive integer of safe magnitude.` | exit 1, `personas must be a non-negative safe integer, got 2.5` |
| `-1` | exit 1, same `RangeError` | exit 1, `... got -1` |
| `NaN` | exit 1, same `RangeError` | exit 1, `... got NaN` |
| `Infinity` | exit 1, same `RangeError` | exit 1, `... got Infinity` |
| `-Infinity` | exit 1, same `RangeError` | exit 1, `... got -Infinity` |
| `abc` | exit 1, same `RangeError` | exit 1, `... got NaN` |

Native callers get the same rule. `generatePersonas({ n: 2.5, seed: 1 })` throws the count
diagnostic instead of the `RangeError`.

Valid values are unchanged. Four configurations (12/3/1, 40/2/7, 5/1/3, 24/4/11 as
personas/days/seed) print metrics JSON that is byte-identical on both revisions after the
`runId` timestamp is removed. `--personas 0` still runs and reports an empty world.

Focused regression, same file and method on both revisions:

```text
bun test --conditions eliza-source packages/sim/test/personas-count.integration.test.ts
Base:  1 pass, 2 fail, 9 expect() calls (929 ms)
After: 3 pass, 0 fail, 23 expect() calls (1.70 s)
```

The base fails on the first malformed CLI value and on the generator case. The case drives the real
CLI in a child process and the real generator; it does not mock generation.

## safety_gates

`bun run sim --only network`: 61/61 blocking gates pass and 0 tracked off target on both revisions,
411.1 s on this branch and 406.3 s on base `a0ed7bc`. A fixed count cannot reach these worlds (their
persona counts are constants), and the four-configuration comparison above shows identical metrics
for valid counts.

## Validation

- `bun run typecheck`: all four TypeScript configurations pass.
- `bun run test:integration`: 684 pass, 8 skip, 0 fail (692 tests across 69 files, 468.61 s).
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail (43 tests across 3 files, 26.71 s).
- The 8 skipped and 1 skipped cases are the optional Postgres/provider cases, as on main.

## Limits

- This does not change `--days`, `--seed`, `--speed`, `--adversarial-rate` or `--minor-share`.
- It adds no maximum population size. A very large valid count still allocates that many personas.
- It does not change any matching, safety or review rule.
