# Preserve delivered date introductions in matching history

A delivered date can leave no interaction record when someone cancels or neither
person answers the later check-in. After the recent-proposal window expires,
Slop can treat the pair as new. The regression reproduces another proposal and
review item after 32 days in all nine introduced cases.

This is a reproduced defect under the approved scope and PRD 40.5. Slop's existing
contract in `packages/engine/src/packs/slop/options.ts` allows anonymous retries,
but forbids another introduction after a reveal. `slopPairRules` reads interaction
history to enforce that rule. The Network's own rules already include a
cancellation cooldown. The missing input prevents those rules from working.

The first delivered Slop reveal now records one accepted introduction. Its ID ends
with `:introduced`; its timestamp is the delivery time. Persisted `bookedTold`
prevents the second reveal or a restart from adding it again. The record does not
claim attendance or add response-learning attribution. Later feedback can still
record completion or a no-show.

When a booked opportunity ends because a participant drops, the shared Network
also records one cancelled interaction. Groups with two remaining participants
stay scheduled. The existing notice path stays intact. No participant receives
a new no-show or decline attribution from this change.

Recording these events repairs the input to existing rules. Waiting for feedback
leaves the gap open. Calling the general close handler would also send another
cancellation notice. No matching rule, target or threshold changes.

## Revisions and setup

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Final production code and regression: `15a9f764bef8f63c6277cbd9578eba8089507726`.
- Local combined compatibility code: `126831c767edef0a80f3fa8cfc7d3ae1fdfd0ddb`; never pushed.
- Native Windows, Bun 1.4.2 and PostgreSQL 16.15.
- Frozen dependencies; source checkout uses `core.autocrlf=false`.

## measurement

Run the same command before and after:

```sh
bun run sim --only network,slop,peon,peon-seats,friends --json result.json
```

For the baseline, apply only the `scripts/sim/slop.ts` diff between the base and
final code revision. Keep production code at the base. The baseline production
file was checked byte-for-byte against that revision before measurement.

One new gate uses seeds 1, 2 and 3 with four cases each. It drives the real Slop
wiring through the existing Mini harness, a SimClock and recording channel.
Synthetic adults onboard through text, receive a generated match, pass simulated
human review, answer sequential consent probes and receive the booked introduction.
The gate checks that no proposal reaches them before review approval.

Two cases cancel from opposite sides. Another leaves the booked date without
feedback. The control lets an anonymous probe expire before any reveal.
State is exported as JSON and imported into a new Network. Duplicate cancellations
must add no record or notice. The clock advances 32 days; both members re-engage.
The engine and actual daily matching then run again.

No matching result, interaction history or trust decision is injected. Appearance
values are synthetic profile fixtures; no photo model is called.

| Case, three seeds each | Before | After |
|---|---|---|
| Alex cancels | 3 repeats; no history | 0 repeats; one introduction and one cancellation per booking |
| Blair cancels | 3 repeats; no history | 0 repeats; one introduction and one cancellation per booking |
| Booked date receives no feedback | 3 repeats; no history | 0 repeats; one introduction per booking |
| Anonymous probe expires | 3 retries; expired records | Identical |

Correct cases improve **3/12 → 12/12**. Each repeat count covers both an engine
proposal and an actual review item. All nine introduced cases retain one booked
meeting. Each cancellation case sends one counterpart notice. The three anonymous
controls stay identical. These are deterministic case checks, not population estimates.

The five blocks improve **154/155 → 155/155** blocking gates. All 154 previous
blocking records stay identical, excluding elapsed time. Of 178 previous records,
170 stay identical. All eight changed records are tracked:

| Tracked record | Before | After |
|---|---|---|
| fingerprint: consent vs push arms | 361f8cc2648fb9a6 | cb4a73ef9dae60f2 |
| fingerprint: slop-live runs | eaeaf7bbe8c99c81 | 653467aa86ea633c |
| slop-live quality: probes sent (pooled) | 342 | 344 |
| slop-live style: probe texts that break the Network's style rules (target 0) | 4 of 342 (too_long) | 2 of 344 (too_long) |
| slop-live quality: yes per probe answer | 0.461 | 0.416 |
| slop-live quality: dates booked per opportunity approved | 42 dates, 268 opportunities, 256 approvals | 34 dates, 289 opportunities, 269 approvals |
| slop-live quality: dates held (both showed) | 32 | 27 |
| slop-live quality: share of adult daters booked at least once in 30 days | 0.391 | 0.327 |

The live dating counts use existing pinned seeds 21–22, 30 days and 80 personas
per seed. Review is simulated. Booked dates fall from **42 to 34**; held dates fall
from **32 to 27**. This is not an aggregate quality-improvement claim. No population
effect, confidence interval or statistical generalization is claimed from these
two worlds. Nine tracked targets remain off target. No target is weakened.

The pure Slop, Peon and Friends fingerprints stay identical. The Network invariant
fingerprint also stays identical. Consent-arm and Slop live fingerprints change
as listed above.

## Additional live trace check and rejected first attempt

An initial local fix only recorded cancellations. Its nine-case gate passed,
but a live trace exposed a repeated booking while introduction history depended
on later feedback. That version was held and never submitted. It produced 38
bookings and 29 held dates on standalone live seeds 21–22. The final version adds
the delivered introduction and extends the same gate with missing-feedback cases.

For an additional check, replay `runSlopLive(seed)` from `scripts/sim/slop-live.ts`
on seeds 21 and 22. Count `meeting_scheduled` records by sorted participant pair.
Count held dates from outcomes with at least two attendees. Count later review
items using opportunity creation time after a same-pair booking's
`opportunity_closed` event with reason `participant dropped`.

The replays match each official live-run fingerprint exactly. Historical baseline
replays use the exact base Network source; the combined baseline uses the prior
combined revision. These are descriptive traces, not additional blocking gates.

| Revision | Seed | Booked | Held | Repeated bookings | Review items after same-pair cancellation |
|---|---|---|---|---|---|
| standalone before | 21 | 22 | 17 | 0 | 1 |
| standalone before | 22 | 20 | 15 | 0 | 0 |
| standalone after | 21 | 18 | 15 | 0 | 0 |
| standalone after | 22 | 16 | 12 | 0 | 0 |
| combined before | 21 | 24 | 13 | 0 | 6 |
| combined before | 22 | 19 | 15 | 0 | 0 |
| combined after | 21 | 17 | 10 | 0 | 0 |
| combined after | 22 | 19 | 16 | 0 | 0 |

The baseline already has zero repeated bookings in these two worlds, but creates
review items after cancellation. The final trace removes those review items and
keeps zero repeated bookings. Lower total bookings cannot be explained as simply
subtracting duplicate bookings; removing old pairs changes later selections.

## Combined compatibility

Across the five blocks, the local combined branch passes **194/194** blocking
gates. The initial five-block run passed all 147 gates outside Slop. Slop passed
46/47: #180's test counted all interactions as feedback and rejected the new
accepted-introduction records. Its date counts and rating-floor assertions were
already correct. The first combined run is not claimed green.

The combined-only test reconciliation counts accepted `:introduced` records
separately. It checks exactly five introductions, then six after a new booking.
Feedback interaction counts remain five, seven and nine. All original date-count,
rating-floor, restart and feedback assertions remain. No production change was
needed. This reconciliation is required when merging this fix with #180; the
standalone PR does not contain #180's test.

After that test-only change, `bun run sim --only slop` passes **47/47** and all
four typecheck configurations pass again. The other four blocks' production and
tests are unchanged. The 194/194 total combines their initial results with this
Slop rerun. All 193 prior blocking gate output records match their prior passing
values after reconciliation; this does not claim every test predicate is unchanged.
Of 217 prior output records, 209 stay identical. The new 12-case gate matches
standalone. The same eight tracked records change:

| Tracked record | Previous combined | With this fix |
|---|---|---|
| fingerprint: consent vs push arms | 361f8cc2648fb9a6 | cb4a73ef9dae60f2 |
| fingerprint: slop-live runs | a3c37201349ef10e | 1d666afd319a49ef |
| slop-live quality: probes sent (pooled) | 352 | 332 |
| slop-live style: probe texts that break the Network's style rules (target 0) | 2 of 352 (too_long) | 2 of 332 (too_long) |
| slop-live quality: yes per probe answer | 0.449 | 0.453 |
| slop-live quality: dates booked per opportunity approved | 43 dates, 303 opportunities, 284 approvals | 36 dates, 279 opportunities, 254 approvals |
| slop-live quality: dates held (both showed) | 28 | 26 |
| slop-live quality: share of adult daters booked at least once in 30 days | 0.404 | 0.353 |

The comparison uses the latest Network/Friends, Slop and Peon combined results.
The prior combined source is `9553e4ff9fbfc9e3e48c06922c9851d0de89ab52`.
Existing regression gates remain present, including aliased dates and closed
application responses. This is compatibility evidence; the PR itself contains
only this fix and its regression.

## safety_gates

```sh
REQUIRE_PG=1 bun run sim --only safety --json safety.json
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

PostgreSQL safety passes **17/17** before and after with identical records.
The baseline safety artifact comes from the initial attempt on the same exact
base production source. The final safety run uses the final code revision.
All four typecheck configurations pass before, after and combined.
Existing minor-contact, consent, review, block and leak assertions keep their values.

Database suites run sequentially on isolated port 54339, role `postgres`, with
`PG_BIN_DIR`, `OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339` set.

Standalone integration includes the repository's security subset:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [533.97s]
```

The six existing Windows failures are the `/bin/bash` lookup, SIGTERM exit 143
instead of 0, and four site path comparisons. The path fix is separate PR #223,
absent from this branch. Skips cover opt-in cleanup reconciliation and hooks.
Full integration remains red.

Standalone E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [44.85s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. Hosted CI requires
maintainer approval for fork runs. No live sends or deployment occurred.
No UI, copy, dependencies, database schema or real member data changed.

## llm_evidence

Deterministic workflow history: zero validation model calls/$0. No model-backed
behavior is qualified. The repository's one-full-simulation allowance was used
for #136. These five affected blocks were run here; no new full simulation claim.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0, from package inventory rather than a running-executable claim.
No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT,
Hermes Agent, OpenClaw, Muse, Grok bot, an elizaOS agent or Cursor.

## Limits

Earlier revealed or closed bookings are not backfilled. Newly delivered Slop
introductions receive the new event. Pre-existing open bookings receive a
cancellation event if they close through this path after the update. A successful
first reveal records the introduction even if delivery to the second person
later fails. This matches the rule that a revealed pair cannot be reintroduced.
The cancellation record feeds existing pair-history policies across apps.
Simulation tradeoffs are reported above; these runs do not qualify a live deployment.
