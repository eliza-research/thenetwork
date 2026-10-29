# Learn date availability from the booked local time

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `cc40975e4f6f6c3b194fd2e9d900883339b5afa9`.

## Requirement and cause

Reproduced scheduling defect under the approved contribution scope, PRD 40.5 and
`docs/network.md` section 4.1: attended times inform later date options.

The Network records a completed interaction when the member answers the post-date check-in.
The interaction's `at` is the reply time. Slop then interprets that timestamp as the attended
date time, in UTC. A Sunday afternoon date followed by Tuesday feedback teaches Tuesday evening.
Even a prompt same-day reply can turn an afternoon date into an evening pattern.

Preserve the booked timestamp and its zone in optional `InteractionRecord.meeting` metadata.
The Network's current scheduler books in `America/New_York`. Slop reads the metadata through
core's existing `localParts` helper when learning attended slots. JSON export/import retains it.
The original interaction `at` remains the feedback timestamp, so unrelated recency calculations
and date counts keep their current inputs. No model, threshold, copy, client contract or wire mirror changes.

Alternatives considered:

1. Change `at` to the meeting time. That changes every history consumer's recency semantics.
2. Treat every existing timestamp as New York time. That still learns the reply day and breaks
   the weekly Slop world's documented UTC slots.
3. Fix the timezone alone. Delayed replies still teach the wrong weekday.

Explicit optional metadata distinguishes event time from observation time without guessing old records.
Records without it retain the existing UTC interpretation, including the weekly Slop world.

## measurement

Paired command: `bun run sim --only slop,network --json <output-file>`.
One added gate runs twelve real ConsentNetwork flows: four cases on seeds 1, 2 and 3.
Each uses the production Slop wiring and onboarding, three synthetic adults, two staff-composed
proposals, two human review decisions, mutual consent to the first date, an actual booked meeting,
the member's feedback, a JSON restart, and the next anonymous probe to a new pair.
Both proposals must wait for simulated staff approval. The channel records messages only.
No booking, planner result or consent answer is mocked. Snapshot rows remain in the fixture across
restart; this gate does not claim a new database persistence test.

| Actual New York date | Reply delay | Learned before | Learned after |
|---|---:|---|---|
| October 10, Saturday 2pm (EDT) | 3 hours | Saturday evening | Saturday afternoon |
| October 11, Sunday 2pm (EDT) | 2 days | Tuesday evening | Sunday afternoon |
| December 5, Saturday 2pm (EST) | 2 days | Monday evening | Saturday afternoon |
| December 6, Sunday 2pm (EST) | 3 hours | Sunday evening | Sunday afternoon |

Each case runs on three seeds. Correct learned slots: **0/12 -> 12/12**.
Correct next-probe alternatives: **3/12 -> 12/12**.
Nine probes replace an incorrectly favored Monday, Tuesday or Sunday evening with Sunday afternoon.
The first case already offers the correct three alternatives, but learns the wrong slot before the fix.
No attendance is learned before feedback. All twelve feedback timestamps stay unchanged.
The correct next-probe set is Saturday 2pm, Saturday 7pm and Sunday 2pm for these fixtures.
These are deterministic regressions, not a statistical attendance or user-acceptance estimate.

| Validation | Before | After |
|---|---:|---:|
| Blocking Slop + Network gates | 100/101 | 101/101 |
| Tracked gates off target | 8 | 8 |
| Runtime | 221.1s | 241.5s |

All 120 other gate records are identical after removing runtime fields.
Fingerprints stay `445afd705328fe54` (weekly Slop arms), `eaeaf7bbe8c99c81` (Slop live),
and `24bb81f068060b33` (Network invariant run).
Slop uses seeds 13-16, four weeks and 300 personas per city; its live arm uses seeds 21-22,
30 days and 80 personas. Network runs its pinned seed-3 invariants, seeds 1-3 comparisons,
NYC scenarios, all sim scenarios at pass^3 and seeds 1-4 conformance.

## safety_gates

Every existing blocking gate retains its passing value: review-before-contact, consent-before-reveal,
minors, leaks, one date at a time, quiet hours, caps, stated filters and matching quality.
The existing 8 tracked misses remain unchanged. Synthetic sends and simulated review only.
Combined locally with the other twenty contributions: **107/107 affected gates**
and all four typechecks pass. All 121 shared gate records match the isolated run.
The code applies without conflicts; the combined branch is local-only.

## Reproduction and validation

1. On base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, load only `scripts/sim/slop-live.ts` from `cc40975e4f6f6c3b194fd2e9d900883339b5afa9`.
2. Run `bun install --frozen-lockfile`, then `bun run sim --only slop,network --json before.json`.
   Expect only the new gate to fail, with wrong learned slots and probe alternatives.
3. Load the three production files from the code commit and repeat. Expect 101/101 blocking gates.
4. Run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e`.

Windows host, Bun 1.4.2, PostgreSQL 16.15. Local test cluster on 127.0.0.1:54339,
`USER=postgres`, `REQUIRE_PG=1`, `PG_BIN_DIR` and `OBSERVATORY_PG_DIR` point to the test installation,
and Git Bash is on PATH. All four typecheck configurations pass.

- Integration: **675 pass, 8 skip, 6 fail**, 13741 assertions; 533.12s.
- All eleven security-command files ran in integration.
- Six failures match the established Windows baseline: absolute `/bin/bash` missing, SIGTERM 143
  versus 0, and four path-separator assertions. Integration is not claimed green.
- Eight skipped cases require the opt-in retry reconciliation setting.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions; 71.42s.
  The optional recovery-feedback browser test requires `PLAYWRIGHT_MODULE`, which was not configured.

Draft pending maintainer Linux CI. The full simulation allowance was used for PR #136;
the affected Slop and Network blocks were rerun here.

## llm_evidence

Deterministic scheduling and timestamp handling. Zero validation model calls, $0.
No model-backed behavior changes or model-quality claim.

## agent_clients

The production backend flow is exercised directly. External clients were not tested.
Authoring: Codex desktop, OpenAI `gpt-6-astra`, identified by the operator.

## Limits

Previously saved interactions without meeting metadata retain their legacy interpretation;
this change does not reconstruct or migrate them. It does not change date counts, no-show attribution,
date pacing, general history recency, or existing booked/offered times.
Availability remains a prior, not a hard exclusion. No live-delivery or attendance improvement is claimed.
PR #140 selects the correct date for delayed feedback; #141 selects the most recent eligible meeting.
This fix concerns the time learned after the correct meeting has already received feedback.
