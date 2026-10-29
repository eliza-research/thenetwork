# Forced group dropped (PR 211)

Date: 2026-10-29. Command: `bun run sim --only network`. Seeds: the network block's pinned seeds. Provider and model: none, the sim runs offline with no model. Sample size: the full network block, 64 blocking gates.

## Result
Before the fix, the sim gates for a valid forced trio fail: `composeGroup` returns null with an empty pool and with only an incompatible pool member. After the fix, both gates pass and return the forced trio. The control gate, a forced group below `minSize`, returns null before and after.

## Reachable path note
Live generators checked today force at most one member, so this defect does not change today's main matching paths. It bites the multi-member forced contract of `composeGroup` itself, and any future caller that passes a multi-member forced group, including a forced group already at `maxSize`.

## Validation lines
- `bun run sim --only network`: PASS: 64/64 blocking gates, 0 tracked off target, 386.6s (network 386.6s)
- `bun run typecheck`: pass, exit 0
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests across 68 files, 213.63s. All 23 failures are Postgres harness tests that fail with `initdb not found` in this environment. None touch the engine group code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail, 47 tests across 3 files, 580ms, exit 0. All e2e cases skip because they need the dev Postgres cluster, which is not installed here.
