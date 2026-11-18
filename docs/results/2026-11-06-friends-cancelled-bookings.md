# Friends cancelled bookings — 2026-11-06

## Problem and scope

Friends plans cancelled after a backout could retain one recorded booked seat.
The harness never reserved that seat or asked its member to attend.
The attendance report nevertheless counted the seat in its denominator.

This reproduced simulator defect is within the approved project scope.
PRD 34.1 and 34.4 require simulation validation and reliability measurements.
The existing Friends report defines attendance as `P(came | booked)`.
Its workflow cancels a plan when fewer than two members remain after the reveal.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
The branch starts from current main and includes no other open PR.
Runtime: Bun 1.4.2 on Windows, with PostgreSQL 16.15 for service validation.

## Cause and fix

`bookTable` assigned the remaining members to `g.booked` before checking whether the plan could continue.
When only one person remained, it recorded a cancellation and returned before updating the booking ledger.
The flow record therefore disagreed with the reservation decision.
`friendsMetrics` sums booked seats from those records, which understated attendance.

Keep the remaining members in a local variable until the cancellation check passes.
Assign `g.booked` immediately before reserving the seats.
Cancelled flows retain the empty booked array with which they were created.
This uses the existing cancellation threshold and booking logic.

Other implementations considered:

1. Filter cancelled flows only in `friendsMetrics`. That leaves incorrect booked seats in the flow record and other consumers.
2. Assign the array, then clear it on cancellation. Delaying the assignment keeps the record consistent with the reservation decision throughout.

## measurement

The committed integration case runs the real Friends planner, persona oracle, booking flow and metric collector.
It identifies cancellations from the world's recorded interactions.
It checks that cancelled plans have no booked seats and that attendance uses the remaining booked seats.
No responses, cancellations, attendance outcomes or records are fabricated.

The same case runs on base and the fix: seeds 5–8, 400 personas, eight weeks.
All four worlds complete before the report assertions.
It requires both cancellations and actual bookings, preventing an empty run from passing.

| Primary pack seed | Cancelled plans | Incorrect booked seats before | Recorded seats before | Actual seats, both revisions | Attendances, both revisions |
|---|---:|---:|---:|---:|---:|
| 5 | 19 | 19 | 733 | 714 | 637 |
| 6 | 5 | 5 | 705 | 700 | 632 |
| 7 | 13 | 11 | 706 | 695 | 618 |
| 8 | 7 | 6 | 703 | 697 | 626 |

After the fix, incorrect booked seats are zero and recorded seats equal actual seats in each world.
The primary pack retains all 2,513 actual attendances while removing 41 incorrectly recorded seats.
Some cancelled plans already had zero booked seats because nobody remained.

The unchanged regression fails on base: 0 pass, 1 fail, three assertions, 21.72 seconds.
With the fix: 1 pass, 0 fail, three assertions, 23.36 seconds.

The wider comparison uses four existing arms and seeds 5–12, with 400 personas and eight weeks in every world.
That is 32 worlds per revision. No policy or persona parameters were tuned.
Seeds 9–12 are the additional corpus.
Rates below are unweighted means of the four per-seed rates.

| Seeds | Arm | Incorrect seats before → after | Recorded seats before → after | Actual attendances, unchanged | Mean attendance before → after |
|---|---|---:|---:|---:|---:|
| 5–8 | pack | 41 → 0 | 2,847 → 2,806 | 2,513 | 88.2827% → 89.5589% |
| 5–8 | random | 5 → 0 | 1,288 → 1,283 | 1,132 | 87.7763% → 88.1355% |
| 5–8 | oracle | 48 → 0 | 3,372 → 3,324 | 2,965 | 87.9312% → 89.2033% |
| 5–8 | pack-options3 | 48 → 0 | 2,795 → 2,747 | 2,473 | 88.4781% → 90.0181% |
| 9–12 | pack | 36 → 0 | 2,517 → 2,481 | 2,213 | 88.0276% → 89.2727% |
| 9–12 | random | 3 → 0 | 1,123 → 1,120 | 987 | 87.9531% → 88.1837% |
| 9–12 | oracle | 44 → 0 | 3,018 → 2,974 | 2,639 | 87.4013% → 88.6787% |
| 9–12 | pack-options3 | 33 → 0 | 2,586 → 2,553 | 2,300 | 88.9116% → 90.0415% |

The comparison finds 258 incorrect booked seats across 30 worlds before the fix and zero afterwards.
For every world, it verifies:

- Unchanged cancellation counts, actual booked seats and actual attendances.
- Reported attendance equal to actual attendances divided by non-cancelled booked seats.
- Exact equality of every metric except attendance.
- SHA-256 equality of all flow records after normalizing only cancelled flows' booked arrays to empty.
- SHA-256 equality of meetups, contacts, value-day entries and recorded interactions.

All comparisons pass.
Only attendance changes in the 30 affected worlds.
Every metric remains identical in the two unaffected random controls: primary seed 8 and additional seed 11.
These are exact record corrections in deterministic runs; no improvement in member behavior or statistical estimate is claimed.

## safety_gates

The command is identical on base and the fix:

```text
bun run sim --only friends --json ../friends-booking-gates.json
```

The base qualification was reused from the earlier run at the same unchanged main revision on 2026-11-06.
That run is recorded locally as `friends-proposal-gates-before.json`.
The new regression and all 32 baseline worlds were run specifically for this fix.

Both qualifications pass 18/18 blocking gates, with three tracked records and one tracked miss.
Twenty of 21 gate records match after excluding elapsed time.
Only the metrics fingerprint changes: `e5bf70e069eaa7e9` → `4cd0fd6c5dcbe05c`.
The wider comparison shows that attendance alone accounts for the changed metrics.
Runtime was 49.7 seconds on base and 49.5 seconds with the fix.

The existing tracked miss remains: undetected-adversary harms are 17.5 versus 10.5 per seed, or 1.67x against a 0.5x target.
No threshold, classification, contact, matching decision or persona behavior changes.
Every safety metric remains identical across the 32-world comparison.

The full simulation was not repeated.
AGENTS.md permits one full run per agent; that allowance was used earlier on PR #355.
That earlier full run is not evidence for this revision.

## Service validation

`bun run typecheck` passes all four configurations.

`bun run test:integration`, including the security suite, reports:

```text
676 pass
8 skip
6 fail
13744 expect() calls
Ran 690 tests across 69 files. [581.96s]
```

The new regression passes inside that command in 28.05 seconds.
All six failure names match the saved clean-base reproduction after removing durations.
The underlying errors also match: missing `/bin/bash`, SIGTERM exit 143 instead of 0, and four Windows path-separator assertions.
The eight skips belong to the optional PostgreSQL completed-cleanup reconciliation suite.
The integration command exits 1; a green integration suite is not claimed.

`bun run test:e2e` reports 42 pass, 1 skip, 0 fail and 654 assertions in 80.58 seconds.
The optional browser SDK case needs `PLAYWRIGHT_MODULE`, which was not configured.
Both service commands used the isolated local PostgreSQL cluster at port 54339.
After validation, no client connections remained and the cluster was stopped.

## llm_evidence

N/A: this fixes deterministic booking records in the model-free Friends world.
Real-model calls: zero. Cost: $0. No model-backed behavior is claimed.
Live-send and deployment flags were disabled.

## agent_clients

N/A: there is no changed member-facing agent flow.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Provider: OpenAI. The exact assistant model identifier was unavailable.
The attribution helper supports `unavailable` for disclosure.
No other agent client, browser or computer control was used.

## Reproduction

Use the repository's audited dependency setup.
Run the committed case on this revision and unchanged on a base checkout:

```text
bun test --conditions eliza-source packages/sim/test/friends-cancelled-bookings.integration.test.ts
```

Expect one failure on base, showing booked seats in cancelled plans and understated attendance.
Expect one passing case with three assertions on the fix.
The primary per-seed booking counts are in the table above.

To print the same arms through the existing CLI:

```text
bun run --conditions eliza-source packages/sim/src/apps/friends/cli.ts --seeds 5-8 --n 400 --weeks 8 --only pack,random,oracle,pack-options3 --json ../friends-bookings.json
```

Use seeds 9–12 for the additional corpus.
The wider comparison calls these same world and metric functions through a temporary observer.
It does not claim that the additional corpus passes the official launch gates.

## Risks and limits

Cancelled flow records no longer retain the lone remaining member in `booked`.
Their original group remains in `going`, and cancellation interactions keep their participants.
Consumers that need the revealed group must use those fields.
Old serialized runs are not rewritten; rerun the world for corrected records and reports.

This does not validate the oracle's calibration or resolve other open Friends changes.
There is no UI, dependency or production-service change.
Only synthetic populations were used. No raw persona data, run logs or credentials are committed.
