# Use booked date times for availability and pacing

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `65b08e1d78513a04766fc9fa80f58ea2fc920d78`.

## Requirement and cause

Reproduced scheduling and history defects under the approved bug-fix scope, PRD 40.5,
32.13 (feedback) and 33 (history-based matching), and `docs/network.md` section 4.1.
The existing Slop policy pauses new matching for ten days after a date the member liked.

The Network records an interaction at each post-date check-in. Its `at` is the reply time.
Slop was treating that as the date time in UTC. A Sunday afternoon date followed by Tuesday
feedback teaches Tuesday evening. A later reply from the other person also replaces the
latest-date timestamp; the first person's positive feedback then predates that timestamp and
is ignored. The ten-day pause is also measured from a reply rather than the booked date.

Keep optional `InteractionRecord.meeting` metadata with the booked timestamp and timezone.
The current scheduler uses `America/New_York`; the metadata records that same zone. Slop uses
core's `localParts` to learn attended slots and the booked timestamp to identify its latest date
and start the existing pacing window. A second check-in cannot move the date forward.
Original observation timestamps, the ten-day setting, feedback text parsing and count semantics
remain unchanged. JSON export/import retains the metadata.

Alternatives considered:
1. Replace the interaction's `at`: that changes every history consumer's recency semantics.
2. Treat every existing timestamp as New York time: that still learns delayed reply days and
   breaks the weekly simulator's UTC slots.
3. Fix only the timezone or only the first check-in: delayed replies or the partner's later
   check-in still supply the wrong date timestamp.

Optional event metadata distinguishes the booked date from observations. Older records without
it retain the existing timestamp/UTC fallback; there is no migration or guess at old bookings.

## measurement

One regression gate drives 24 real ConsentNetwork workflows on seeds 1, 2 and 3, using production
Slop wiring, onboarding text, human review, mutual consent, real bookings, feedback and JSON restarts.
No planner, booking, interaction row or consent decision is mocked. Sends are recorded locally.
Stored appearance ratings in the pacing cases are explicitly synthetic, not photo-rater results.

The original twelve cases preserve their booked-slot and next-probe checks:

| Actual New York date | Reply delay | Learned on main | Learned after |
|---|---:|---|---|
| October 10, Saturday 2pm (EDT) | 3 hours | Saturday evening | Saturday afternoon |
| October 11, Sunday 2pm (EDT) | 2 days | Tuesday evening | Sunday afternoon |
| December 5, Saturday 2pm (EST) | 2 days | Monday evening | Saturday afternoon |
| December 6, Sunday 2pm (EST) | 3 hours | Sunday evening | Sunday afternoon |

Each case runs on three seeds: correct learned slots **0/12 -> 12/12**; correct next-probe
alternatives **3/12 -> 12/12**. The expected options are Saturday 2pm, Saturday 7pm and Sunday 2pm.
No attendance is learned before feedback, and all twelve observation timestamps are retained.

The added twelve cases book one date and answer at +3h and +4h: the first person liked it, the
last person liked it, both liked it, or neither liked it. Each runs matching on the resulting
production `packInput` after feedback, one millisecond before the ten-day boundary, and at the
boundary. Interaction and feedback reordering preserves the measured histories. Restarts retain
the fixture's external rows; this is not a new database-persistence claim.

| Pacing observation | Main / earlier PR head | After |
|---|---:|---:|
| Positive member signals retained | 6/12 | 12/12 |
| Correct latest-date timestamps | 0/24 | 24/24 |
| Central members correctly paused after liking the date | 3/9 | 9/9 |
| Neutral central members still eligible | 3/3 | 3/3 |
| Central members matched at the ten-day boundary | 9/12 | 12/12 |
| Member exclusions remaining at that boundary | 6 | 0 |

The earlier PR head `26a56812050ac8f8ea98a41891f4536e0c5111ed` already fixed slot learning;
the expanded gate also fails there because pacing still uses reply time. Its pacing rows exactly
match main. This follow-up extends the same booked-time fix and the same gate.

## Simulations and safety_gates

Main and earlier-head runs: `bun run sim --only slop --json <file>`, **39/40** blocking gates;
only the expanded gate fails. Runtimes 49.3s and 50.6s.
After: `bun run sim --only slop,network --json <file>`, **101/101** blocking gates in 304.1s
(Slop 49.1s, Network 255s). Eight tracked misses remain.
The 63 Network records exactly match the unchanged-base run; only the targeted Slop gate and
the live-run fingerprint and quality/style measurements change. Weekly Slop arm fingerprint stays
`445afd705328fe54`; Network invariant fingerprint stays `24bb81f068060b33`.

**Material live-simulation tradeoff:** across the pinned two live seeds (21-22), 30 days and
80 personas, the corrected pacing changes subsequent assignments:

| Live measurement | Before | After |
|---|---:|---:|
| Probes sent | 342 | 352 |
| Yes per probe answer | 0.461 | 0.449 |
| Dates booked | 42 | 43 |
| Opportunities / approvals | 268 / 256 | 303 / 284 |
| Dates held (both showed) | 32 | 28 |
| Adult daters booked at least once | 0.391 | 0.404 |
| Overlength probe texts (tracked target 0) | 4 of 342 | 2 of 352 |

The lower number of held dates is a review concern. This deterministic bug fix is not a general
matching-quality win; no scoring parameters, gates or thresholds were tuned. The live fingerprint
changes from `eaeaf7bbe8c99c81` to `a3c37201349ef10e`. These are synthetic outcomes, not live-user
estimates or evidence of statistical improvement.

All existing blocking safety gates retain their passing values: zero invariant violations,
minor contacts and canary leaks, review before contact, consent before reveal, one date at a time,
quiet hours, caps and stated filters. The weekly Slop model and its tracked misses are unchanged.

Combined locally with the other 24 contributions: **109/109** blocking
Slop/Network gates. All prior combined records remain identical except this expanded gate and
the live fingerprint/quality/style records; the updated records match this isolated branch. The merge
retains PR140's opportunity correlation, PR180's distinct-date counts and PR184's absence attribution.
The combined branch is local only. Four typechecks pass on both branches.

## Reproduction and validation

1. At main `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, copy only `scripts/sim/slop-live.ts`
   from tested code `65b08e1d78513a04766fc9fa80f58ea2fc920d78` and run the Slop command above.
   Expect wrong learned slots, lost positive signals and the expanded gate failing.
2. Repeat on earlier head `26a56812050ac8f8ea98a41891f4536e0c5111ed`. Slot cases pass; pacing fails.
3. Run the tested code with `--only slop,network`. Expect 101/101 blocking gates and the table above.
4. Run `bun run typecheck`, `bun run test:integration`, and `bun run test:e2e`.

Bun 1.4.2, PostgreSQL 16.15, Windows. Frozen dependencies unchanged. Local Postgres on 54339,
`USER=postgres`, `REQUIRE_PG=1`, `PG_BIN_DIR` and `OBSERVATORY_PG_DIR` point to the test installation.
An initial integration attempt used the wrong local port and was interrupted; it is discarded as
setup failure. The rerun used the verified 54339 server:

- Integration including all eleven security files: **675 pass, 8 skip, 6 fail**, 13,741 assertions;
  493.58s. Failure identities match the established Windows baseline: missing absolute `/bin/bash`,
  SIGTERM 143 versus 0, and four Unix path-separator assertions. Integration is not claimed green.
- Eight integration skips require `NETWORK_RETRY_RECONCILIATION_TEST=1`.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions; 43.45s. The optional browser case needs
  `PLAYWRIGHT_MODULE`, which was not configured.

The one full-simulation allowance was used earlier; affected blocks ran here. Draft pending
maintainer review and hosted CI. No live messages, production data or deployment.

## llm_evidence and agent_clients

Zero validation model calls, no request settings, $0. This changes deterministic timestamp handling;
no model-quality or optional judge acceptance is claimed. Backend conversations and matching were
exercised directly. No external-client acceptance claim. Authoring: Codex desktop, OpenAI
`gpt-6-astra` (operator supplied); app version not collected.

## Limits

Old interactions without metadata keep their old behavior. Date counts, no-show attribution,
general history recency and existing booked/offered times are unchanged. Availability stays a
prior. PR140 separately correlates delayed feedback with its own date; PR141 selects the latest
eligible meeting. This change uses the booked time after the correct meeting has received feedback.
