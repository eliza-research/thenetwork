# Count accepted job introductions when both people agree

Both people accept a job introduction, but the engine reports no answered
application until the future interview time. The Network projects an accepted
interaction with `at = meetingAt`. Peon's `historyOf` correctly skips records
whose timestamp is later than the current clock.

This is a reproduced hiring defect under the approved scope and PRD 40.6.
The existing policy learns employer responsiveness from answered applications.
It also counts active introductions and uses answered applications for company
probation. Those facts should exist when both people accept.

The Network now saves `seatAcceptedAt` when mutual consent books a job
introduction. Its existing accepted interaction uses that time. The interview
time stays separate. Existing JSON serialization persists the optional field;
no database migration is needed. Existing 28-day history windows start at acceptance.

For an older snapshot, the first delivered introduction can establish that
acceptance already happened. The projection uses the earlier of that delivery
time and the original interview time. A snapshot without either new acceptance
data or delivery data retains the existing interview-time fallback.

Using the current clock on every read would renew the history window forever.
Letting the history reader accept future records would hide incorrect inputs.
Recording the event fixes the producer and preserves the existing policy.

## Revisions and setup

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Fix and regression: `56bea8bfd3f38d905f883f56472aa2331fe6c6a4`.
- Local combined compatibility code: `6b60dc2ded003ab59cea03b3c022db60442f5885`; never pushed.
- Native Windows, Bun 1.4.2 and PostgreSQL 16.15; frozen dependencies.

## measurement

Run the same command before and after:

```sh
bun run sim --only peon,peon-seats --json result.json
```

For the baseline, apply only the `scripts/sim/peon-seats.ts` diff to the base.
Production remains at the base revision. Before and after use the same seeds,
fixtures, clock and commands.

One gate uses seeds 1, 2 and 3, with four cases each. The existing SeatWorld
harness drives the real Peon wiring. A synthetic manager posts a job through
text intake and confirms the read-back. The real engine creates the review item.
The gate approves it as simulated staff, answers the candidate-first probe,
restarts, and then receives the manager's probe.

The waiting control stops before the manager agrees. Other cases answer yes.
One reads history before the future interview; another reads it after that time.
The older-snapshot case waits for both introductions to be delivered, then
removes only the new timestamp from the exported JSON before import. It retains
the real delivery times. This represents the earlier persisted shape.

All cases check history through the actual engine World, Peon profile reader,
company probation and responsiveness functions. They restart again and advance
one hour to check that the interaction time stays fixed. No history result,
trust decision or matching result is injected. The channel records sends locally.

| Case, three seeds each | Before | After |
|---|---|---|
| Manager has not answered | No accepted record or answered application | Identical |
| Both accepted, interview still in the future | Application, answered and candidate-in-flight counts are 0 | Each count is 1 |
| Older delivered booking, interview still in the future | Same missing counts | Each count is 1 |
| Interview time reached | Each count is 1 | Policy results unchanged; record uses acceptance time |

Correct cases improve **6/12 → 12/12**. In both affected cases, employer
responsiveness changes from `2 / 2.5` to `3 / 3.5`. The existing answered-application
probation condition becomes true immediately. No case invents a no-response.
All cases preserve review-before-contact, mutual consent, restart stability
and a fixed history timestamp. Each accepted case books once; the waiting
control books nothing.

The initial nine-case reproduction covered new bookings only and passed 6/9.
Before changing production, it was extended with the older-snapshot case.
The reported baseline is the fresh 12-case run. These deterministic checks
are not a population estimate or a measured hiring-quality improvement.

Hiring simulations improve **36/37 → 37/37** blocking gates. All 37 prior
records, including the hiring-world fingerprint `b7736da857812394`, stay identical
after excluding elapsed time. No tracked target changes or fails.

The combined branch passes **54/54** blocking gates. All 54 prior output records
(53 blocking plus the fingerprint) stay identical. All 12 new rows match
standalone. Shared-file reconciliation preserves the prior posting and response
history gates, including #225. The comparison uses the hiring blocks from the
previous combined run at `5ffa3cc7e9f345d9985dadbd6e26f27ab107f5d9`.
Later changes to that combined branch only reconciled a Slop test and its report.

## safety_gates

```sh
REQUIRE_PG=1 bun run sim --only safety --json safety.json
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

PostgreSQL safety passes **17/17** before and after with identical records.
All four typecheck configurations pass before, after and combined. Minor,
consent, review, block and leak assertions retain their values. Database suites
run sequentially on isolated port 54339, role `postgres`, with `PG_BIN_DIR`,
`OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339` set.

Standalone integration includes the repository's security subset:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [504.36s]
```

The six known Windows failures are the `/bin/bash` lookup, SIGTERM exit 143
instead of 0, and four site path comparisons. The path fix is separate PR #223,
absent from this branch. Skips are opt-in cleanup reconciliation and hooks.
Full integration remains red.

Standalone E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [39.22s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. Hosted fork CI needs
maintainer approval. No live sends, deployment, UI, copy, real member data,
dependencies or database schema changed.

## llm_evidence

Deterministic workflow history: zero validation model calls/$0. No model-backed
behavior is qualified. The repository's one-full-simulation allowance was used
for #136. Only the two affected hiring blocks and safety were run here.
No new full simulation claim.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0, from package inventory rather than a running-executable claim.
No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, an elizaOS agent or Cursor.

## Limits

The fix records acceptance, not attendance or a hire. Pending applications,
closed applications and later feedback retain their existing paths. Old snapshots
with no acceptance or delivery timestamp cannot recover the exact earlier time.
Their fallback is unchanged. The existing open-opportunity dispatch guard remains
in force; this evidence measures history rather than extra-probe incidence.
The tests do not qualify a live deployment or change matching policy thresholds.
