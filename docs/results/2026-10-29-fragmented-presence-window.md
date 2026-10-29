# Fragmented presence window (PR 209)

Date: 2026-10-29. Command: `bun run sim --only network`. Seeds: the network block's pinned seeds. Provider and model: none, the sim runs offline with no model. Sample size: the full network block, 63 blocking gates.

## Result
Before the fix, the sim gate `engine: fragmented presence totalling 3h in 20-minute pieces is no overlap` fails: `candidateReason` accepts the candidate, so a 20-minute fragment becomes the meeting window. After the fix, the gate passes: the candidate is rejected with `no_presence_overlap`. The control gate, a single 4-hour interval, passes before and after.

## Validation lines
- `bun run sim --only network`: PASS: 63/63 blocking gates, 0 tracked off target, 387.5s (network 387.5s)
- `bun run typecheck`: pass, exit 0
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests across 68 files, 210.57s. All 23 failures are Postgres harness tests that fail with `initdb not found` in this environment. None touch the engine filter code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail, 47 tests across 3 files, 570ms, exit 0. All e2e cases skip because they need the dev Postgres cluster, which is not installed here.
