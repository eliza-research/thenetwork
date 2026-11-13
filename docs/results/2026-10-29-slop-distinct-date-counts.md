# Count dates once when both members give feedback

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `a3cd342552428e45f8ad1e2c7844653eba6e0f4c`.

## Requirement and cause

Reproduced matching defect under the approved contribution scope and PRD 40.5:
post-date feedback informs matching, and exposure floors distribute opportunities.

The Network stores one completed interaction for each check-in. Each record lists both participants.
Slop counts every record as a date for both people. Two replies about one date become two dates.
The default rating-group exposure floor uses this count. Feedback participation therefore changes
the fairness adjustment even when everyone attended exactly one date.

Attach the known opportunity ID to each interaction. Count each ID once per canonical member in
Slop's completed-date history. Preserve every individual feedback and interaction record.
The optional field survives existing JSON persistence without a schema migration.

Alternatives considered:

1. Remove later completed interaction records. That changes history for every consumer and loses observations.
2. Parse opportunity IDs from record IDs. That couples matching to one producer's undocumented string format.
3. Group by participants or timestamp. Separate dates may share either value.

Explicit opportunity identity keeps the fix local to date counts. Existing records without the field
retain their previous counts. New and legacy records are not merged or rewritten.

## measurement

Commands: `bun run sim --only slop,network --json <file>` and a final baseline
`bun run sim --only slop --json <file>` after correcting an unreached fixture continuation.
The final baseline Slop gate records equal the first baseline exactly, excluding timing.

One added gate uses seeds 1, 2 and 3. Each world contains ten synthetic adult members.
Production Slop wiring handles onboarding, five reviewed proposals, mutual consent, bookings and check-ins.
The first reply to each date gives all ten people one date. Two partners then reply after a JSON restart.
A sixth reviewed booking joins returning members from separate first dates. Both reply, in reverse order.
Another restart checks the saved history. The gate retains all nine feedback records and nine interactions.
Every proposal waits for simulated staff approval; the recording channel sends nothing externally.

| Per ten-member world | Before | After |
|---|---:|---:|
| Correct date counts after two partner check-ins | 6/10 | 10/10 |
| Members with an unearned exposure-floor boost | 6 | 0 |
| Boost applied to each affected member | 0.0827586207 | 0 |
| Date count for each member who attends a second date | 4 | 2 |
| Individual feedback records retained | 9 | 9 |

Additional local controls repeat the flow on seeds 5 and 7 and reverse interaction-array order.
Across all five seeds: 30 bookings and 45 feedback replies; correct first-date counts rise from 30/50
to 50/50. All 30 unearned boosts disappear. Original record fields, feedback and bookings are identical.
Reversing record order preserves final date counts.
The ratings are synthetic stored facets, not photo-rater outputs. The score adjustment is the production
`ratingFloorLift` function using its default options. This is deterministic correctness evidence,
not an estimate of real dating outcomes or a full live-client acceptance test.

The exploratory continuation waited seven days but did not reach the next review queue.
It was replaced with an immediate, separately reviewed booking between two members who had answered.
No product rule changed to make that control pass.

| Validation | Before | After |
|---|---:|---:|
| Slop blocking gates | 39/40 | 40/40 |
| Network blocking gates | 61/61 | 61/61 |
| Existing tracked misses | 8 | 8 |

All 120 other gate records are identical, excluding runtime.
Final baseline Slop: 29.6s. First Network baseline: 155.6s.
After: 211.8s (28.9s Slop, 182.9s Network).
The Slop weekly runs use seeds 13-16, four weeks and 300 personas per city.
Slop live uses seeds 21-22, 30 days and 80 personas. Network retains its pinned invariant run,
comparison arms, NYC scenarios, scenario pass^3 checks and conformance seeds.

## safety_gates

Every existing blocking gate retains its value. Review, consent, minors, leaks, caps and matching
quality gates pass. No threshold changes. The existing eight tracked misses remain unchanged.
The existing no-show review rule reads the corrected completed-date count; it is not bypassed or relaxed.

Combined locally with the other 21 contributions: 108/108 affected blocking
gates and all four typechecks pass. All 121 common gate records match the isolated run.
Resolve overlaps with PR #179 by retaining both metadata fields and both regression gates.
The combined branch stays local.

## Reproduce and validate

1. Check out base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` and load only `scripts/sim/slop-live.ts` from `a3cd342552428e45f8ad1e2c7844653eba6e0f4c`.
2. Run `bun install --frozen-lockfile`, then `bun run sim --only slop,network`.
   Expect the added gate to fail on duplicate counts and the exposure adjustment.
3. Apply the three production files from the code commit. Repeat the same command.
   Expect 101/101 blocking gates. The final two returning members must each have two dates.
4. Run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e`.

Windows, Bun 1.4.2, PostgreSQL 16.15 on 127.0.0.1:54339. `USER=postgres`, `REQUIRE_PG=1`,
`PG_BIN_DIR` and `OBSERVATORY_PG_DIR` point to the local test installation; Git Bash is on PATH.
All four typecheck configurations pass.

- Integration: **675 pass, 8 skip, 6 fail**, 13741 assertions, 570.83s.
- All eleven security-command files ran within integration.
- The six failures match the established Windows baseline: missing absolute `/bin/bash`,
  SIGTERM status 143 versus 0, and four path-separator assertions. Integration is not claimed green.
- Eight integration skips require the opt-in retry reconciliation setting.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions, 82.64s.
  The optional recovery-feedback browser test requires unconfigured `PLAYWRIGHT_MODULE`.

The full simulation allowance was used for PR #136; affected blocks are used here.
Draft pending maintainer Linux CI.

## llm_evidence

Deterministic record identity and aggregation. Zero validation model calls, $0.
No changed model behavior or model-quality claim. No LLM credentials were available locally.

## agent_clients

Production backend flow exercised directly. External agent clients were not tested.
Authoring: Codex desktop, OpenAI `gpt-6-astra`, identified by the operator.

## Limits

Legacy interactions without opportunity IDs retain their old counts, including mixed histories created
across an upgrade. No migration or guessed identity. Other history counts, attendance-slot samples,
feedback sentiments, timestamps and recency remain unchanged. PR #179 independently fixes learned local times.
The fixture retains snapshot rows across restart; it does not add a new database persistence scenario.
No deployment, real messages, model-rating validation or live attendance improvement is claimed.
