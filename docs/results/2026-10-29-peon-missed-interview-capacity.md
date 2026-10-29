# Keep replacement interviews open after a missed interview

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `c930e4f817cbe5e14ea37014d0ae1566d278b52e`.

## Requirement and cause

Reproduced bug in the existing Peon posting and interview flow, under the approved bug-fix scope
and PRD section 40.6. `docs/network.md` describes the seat capacity and close/fill checks.

After a candidate or manager says "I couldn't make it" at the interview check-in, the engine's
`seatFills` releases the opening. It proposes another candidate for review. On the next tick,
`checkSeats` counts the old missed interview as filled because it has a meeting time and is not
closed. It closes the new review item as "posting filled". The next candidate can suffer the same result.

Use `seatView` and the existing `seatFills` calculation for that check. Supply the interaction
history only: pending review/probe items reserve engine capacity, but must not count as filled
here, or the check would close the very items it checks. Read the posting's active status and
posted headcount as before. No change to feedback classification or engine capacity policy.

Alternatives considered:

1. Add a second no-show rule based on `Opp.post`. This duplicates the engine's outcome policy and
   can diverge again when feedback or supported outcomes change.
2. Close or erase the original opportunity when feedback arrives. This changes the feedback and
   history lifecycle to repair a capacity-check defect.

## measurement

Same command on base plus the new gate, then on the fix:
`bun run sim --only peon,peon-seats --json <file>`.

One regression gate runs five workflows on each seed 7, 13 and 17. Each uses real ConsentNetwork
and production Peon wiring, a SimClock, recorded messages, one verified adult manager and four
synthetic qualified adult candidates. It onboards members, posts one opening by text, requires a
separate confirmation, reviews the first match, obtains both yeses, waits for the actual feedback
question, submits the answer, restarts, advances three days and restarts again.

| Outcome across three seeds | Before | After |
| --- | ---: | ---: |
| Candidate missed: replacement remains reviewable and books after approval and both yeses | 0/3 | 3/3 |
| Manager missed: replacement remains reviewable and books after approval and both yeses | 0/3 | 3/3 |
| Completed interview: no replacement, capacity stays occupied | 3/3 | 3/3 |
| Unanswered check-in: no replacement, capacity stays occupied | 3/3 | 3/3 |
| Explicitly closed posting after a missed interview: no replacement | 3/3 | 3/3 |
| Incorrect "posting filled" closures during the wait | 12 | 0 |

The six recovered replacements are not contacted before human approval and do not book before
both yeses. A restart between their yeses retains state. Each pending replacement reserves the
one opening; after it books, no extra review appears. Nine control outcomes remain identical.
These are deterministic scenario observations, not statistical or live-user estimates.

Peon and seat gates: **36/37 before, 37/37 after**. All 37 other gate records are identical after
excluding runtime, including the Peon fingerprint `b7736da857812394`; zero tracked misses.
Runtime: 29.6s before, 47.7s after (integration tests shared the machine during the latter).

Combined with the preceding 23 contribution PRs: **41/41 gates**, 40.0s, all 38 common records
identical to the isolated fix, all four typechecks pass. The combined checkout is local only.
The gate-insertion conflict was resolved by preserving every earlier gate and adding this one.

## safety_gates

Existing review, consent, minors, held-member, capacity, closure, routing and leak gates keep
their passing values. Synthetic records and a recording channel only. No live messages or deploy.
The gate uses JSON export/import with fixture rows retained; it does not claim a new Postgres
persistence scenario. The existing Postgres suites are reported separately below.

## Validation

- `bun install --frozen-lockfile`: unchanged dependencies.
- `bun run typecheck`: all four configurations pass, isolated and combined.
- `REQUIRE_PG=1 bun run test:integration`: **675 pass, 8 skip, 6 fail**, 13,741 assertions,
  689 tests across 68 files, 582.10s. All 11 files in `bun run security` ran in this suite.
- `REQUIRE_PG=1 bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions,
  43 tests across 3 files, 67.47s.

The six integration failures match the preceding validated branch: Windows lacks the absolute
`/bin/bash` path used by the Wrangler test, has the known SIGTERM exit mismatch, and fails four
Unix path-separator comparisons in site tests. Eight integration skips require the separate
`NETWORK_RETRY_RECONCILIATION_TEST=1` opt-in. The e2e skip needs `PLAYWRIGHT_MODULE`.
Local PostgreSQL 16.15 used port 54339. Draft pending hosted CI; the full simulation allowance
was used earlier, so only the affected blocks ran here.

## llm_evidence

Deterministic capacity logic: no model-backed behavior changed. Zero validation model calls and
$0 validation model cost. No model-quality claim.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra` (operator supplied). The app version was not
collected for this run. No external agent-client acceptance run is claimed. The gate drives
the real backend conversation and matching directly.

## Limits

The change aligns the close/fill check with the existing engine outcomes. It does not resolve
contradictory attendance reports or redefine which feedback counts as completed. A completed
interaction still occupies capacity under the existing policy. Old replacement items already
closed in error are not reopened. The original missed interview and its feedback remain in history.
No scoring, outreach-budget, language parsing, storage or user-facing copy changes.
