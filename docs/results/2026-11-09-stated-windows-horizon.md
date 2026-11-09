# Stated windows must stay inside the 7-day horizon (2026-11-09)

Hand-written note. The code and tests are in the PR.

## Problem

`statedWindows` (packages/network/src/plans.ts) turns a weekly check-in answer
("free Monday evenings") into this week's stated availability. It carries
`until = now + 7 * DAY`. The loop walks 8 calendar days (`k <= 7`) so that a
part that has already passed today still produces next week's same-weekday
window. But it pushed that eighth-day window without checking the horizon, so a
check-in whose weekday equals the check-in day produced TWO windows: this week
AND next week. The next-week window begins after `until`, i.e. after the stated
windows have expired, and makes the member look free a second time next week.

## Reproduction

`statedWindows(["evening:Mon"], now)` with `now = Monday 09:00 America/New_York`.

- Before: 2 windows (this Monday 17:00-22:00 and next Monday 17:00-22:00); the
  second starts at `now + 7d + 8h`, after `until = now + 7d`.
- After: 1 window (this Monday), every window `start < until`.

A check-in late the same day (Monday 23:00, the evening part already passed)
still yields exactly next Monday's window, and it stays inside the horizon.

Both cases are pinned by `packages/network/test/stated-windows.test.ts`
(the first case fails before the fix).

## Fix

Compute `until` before the loop and push a window only when `start < until`.
This drops the redundant next-week window when this week's is already present,
and keeps the next-week window when today's part has passed.

## Validation

- `bun test packages/network/test/stated-windows.test.ts` — 2 pass (first case
  fails on base).
- `bun run typecheck` — clean.
- `bun run sim --only network --quick` — 47/47 blocking gates pass, 1 tracked;
  minors, canary and leak invariants 0.
