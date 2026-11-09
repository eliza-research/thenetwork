# Stated windows must stay inside the 7-day horizon (2026-11-09)

Hand-written note. The code and the sim gate are in the PR.

## Problem

`statedWindows` (packages/network/src/plans.ts) turns a weekly check-in answer
("free Monday evenings") into this week's stated availability. It carries
`until = now + 7 * DAY`. The loop walks 8 calendar days (`k <= 7`) so that a
part that has already passed today still produces next week's same-weekday
window. The eighth calendar day repeats the check-in weekday, so a tag whose
weekday equals the check-in day could produce TWO windows: this week AND next
week, making the member look free a second time.

The first revision guarded the push with `start < until`. That removed the
duplicate only when the check-in happened *before* the part began. A check-in
made *during* this week's part (e.g. Monday 20:30 NY with `evening:Mon`, whose
part is 17:00-22:00) still produced two windows, and this time the second one
begins *before* `until` (next Monday 17:00 against `until` = next Monday 20:30),
so it is live rather than expired — strictly worse than the case the guard
fixed. All three parts (`morning [9,12]`, `afternoon [12,17]`, `evening
[17,22]`) are multi-hour, so any member who answers inside the window they just
named double-books.

## Fix

Emit at most one window per stated (weekday, part) with a `seen` set keyed by
`weekday|part`, and still require `start < until`. `seen` is recorded only on a
push, so:

- A check-in **before** the part: this week's window is pushed at `k = 0`; the
  eighth-day repeat is skipped. One window.
- A check-in **during** the part: this week's window is pushed at `k = 0`
  (start clamped to `now`); the eighth-day repeat is skipped. One window, inside
  the horizon.
- A check-in **after** the part: nothing is pushed at `k = 0` (the part has
  ended, so `end > now` is false and `seen` stays empty), and next week's window
  is pushed at `k = 7`. One window, inside the horizon.

## Reproduction

`statedWindows(["evening:Mon"], now)` in `America/New_York`:

| `now` (Mon 2026-11-02) | before fix | after fix |
|---|---|---|
| 09:00 (before the part) | 2 windows (2nd starts after `until`) | 1 window (this Mon) |
| 20:30 (inside the part) | 2 windows (2nd starts **before** `until`) | 1 window (this Mon, from 20:30) |
| 23:00 (after the part) | 1 window (next Mon) | 1 window (next Mon) |

The 09:00 case fails on upstream main (base `a0ed7bc`); the 20:30 case fails on
the PR's previous head (`dc2742f`), which only added the `start < until` guard.

## Validation

- `bun run sim --only network` — the new gate "plans: statedWindows gives one
  window per stated (weekday, part); none begins at/after `until`" asserts all
  three cases (before / during / after the part) and the passed-part window. It
  fails before the fix (the 20:30 case returns 2 windows) and passes after.
  (A sim gate, not a `bun:test` unit test: the repository accepts a sim gate, a
  scenario, a corpus row, or an integration/e2e case — docs/tests-policy.md.)
- `bun run typecheck` — clean.
