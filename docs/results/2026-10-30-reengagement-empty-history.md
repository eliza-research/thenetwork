# Re-engagement with no value history — results

Date: 2026-10-30. Command: `bun run sim --only network`, seeds pinned by the
network block. Provider: none (the sim runs offline, no model calls).
Sample: the network block, 65 blocking gates.

## Defect

`reengagement` in `packages/engine/src/attention.ts` judged a held item
against the member's 75th percentile of past item values (`valueHistory`).
When the member had no history, the bar fell back to the candidates' own
values. A single held item set its own bar, so the strict `>` check always
failed with `not_high_value`. The same failure hit tied items. The most
common re-engagement shape (one held item, auto-paused, silent 60 days)
could never send.

## Fix

When `valueHistory` is empty, the bar is the member state's quality bar
(`cfg.qualityBar[m.state]`), the absolute value floor already used in this
file. The candidates are never their own bar. The history path is unchanged.

## Evidence

| Gate | Before the fix | After the fix |
| --- | --- | --- |
| Single high-value held item (enjoy 0.9), no history | `send: false, not_high_value` | `send: true, ok` |
| Tied held items, no history | `send: false, not_high_value` | `send: true, ok` |
| Single low-value held item (enjoy 0.2), no history | `send: false, not_high_value` | `send: false, not_high_value` (control: the floor still guards) |
| Single high-value held item, history [0.1, 0.2, 0.3, 0.4] | `send: true, ok` | `send: true, ok` (control: unchanged path) |

Validation, all run on this branch:

- `bun run sim --only network`: PASS: 65/65 blocking gates, 0 tracked off
  target, 381.6s. Full `bun run sim` (all blocks) was not run, per the
  repo machine-load rule.
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests,
  211.68s. All 23 failures are Postgres harness tests failing with
  `initdb not found` in this environment (no Postgres installed here);
  none touch the attention code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail, 486ms. All e2e cases skip
  for the same missing-Postgres reason.

## Limits

- No live caller of `attention.reengagement()` exists in `packages/network`
  today (Blooio implements its own re-engagement flag). This fix bites
  when the function is wired in, or in sim runs that use it.
- With a real history, a candidate exactly at the percentile bar still
  fails the strict `>` check. That is normal percentile behaviour, not
  part of this fix.
