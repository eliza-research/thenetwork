# candidateSlots window overrun — results

Date: 2026-10-30. Command: `bun run sim --only network` (network block only;
the repo machine-load rule allows one full sim per agent, and only the changed
block was run here). Seeds: the network block's pinned seeds. Provider/model:
none — the sim runs offline with no model (sim clears provider keys). Request
settings: default. Sample size: the full network block.

## Defect

`candidateSlots` in `packages/engine/src/attention.ts` says slots are "inside
`window` if given", but the filter was
`slot.end > o.window.end + A.slotHours * HOUR`. Since
`slot.end = start + slotHours * HOUR`, that is exactly `start > window.end`:
a slot only had to start by the window's end. A 19:00-21:00 slot was returned
for a 17:00-20:00 window, and a slot starting exactly at the window end
(entirely outside it) also passed.

Reproduction (before the fix, same data as the gate): window Wednesday
2026-10-07 17:00-20:00 America/New_York, now Monday 2026-10-05 12:00 EDT —
returned one slot, 19:00-21:00 EDT, ending an hour after the window closes.
After the fix: no slot returned for that window.

## Fix

Drop the `+ A.slotHours * HOUR` tolerance: a slot is kept only when
`slot.end <= o.window.end` (and `start >= o.window.start`, unchanged).

## Gate

`scripts/sim/engine-candidate-slots.ts`, wired into the network block:
a slot ending after the window is rejected; a slot fully inside a wider
window is still returned (control); no window given still returns the
template slots (control). The gate fails on upstream source (the 19:00-21:00
slot is returned) and passes with the fix.

## Validation

- `bun run sim --only network` with the fix: 63/64 blocking gates pass,
  379.8s. The one failing gate is `consent vs push: meetings (pooled) > 140`
  at 139. The same block on upstream source passes 61/61, with that metric
  at 144. Dropping horizon-edge slots therefore costs about 5 pooled
  meetings against that regression floor: the broad horizon windows live
  callers pass end at `now + horizonDays`, so slots starting inside the
  horizon but ending after it were previously usable, and are now excluded.
  This is a real trade-off of the fix, stated in the PR body.
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests.
  The 23 failures are dev-Postgres harness failures in this environment
  (`initdb not found` / connection refused; no Postgres installed here);
  none touch the attention slot code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same
  missing-Postgres reason.
- Full `bun run sim` (all blocks) was not run, per the machine-load rule;
  only the changed network block was run.
