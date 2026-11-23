# Stated openness: dating, friendship and cofounder facts (2026-11-22)

Hand-written. Every number comes from a saved output file in `<run dir>/` (named after each number; the wave's run directory on the build machine, not in the repository). The base files are the unchanged code at d483de38 (`base/`); the package files are in `w1-sig/`. The simulator runs used the simulated reviewer (`review: "auto"` in the block worlds, `sim_reviewer_approves_all` in slop-live) and no LLM (`pnpm run sim` clears the provider keys). No real-LLM run was made: the worktree had no provider key. These runs predate the review judge (owner decisions D15 to D17 of 2026-11-22): they used the removed simulated reviewer that approved every item, and the simulator now uses the deterministic stand-in judge.

## What the package changes

- Decisions: [mutual openness](../../spec/mutualOpenness.md) (new: `mutuallyOpen`, `datingOneWayOpen`, `datingClassAdmits`, `datingSegmentClassOf`, `transAnswerAdmits`, `friendsMutuallyOpen`, `friendAdmits`, 13 laws), [cofounder intent](../../spec/cofounderIntent.md) (new story: `cofounderFactsFit` and 4 laws), [slop onboarding](../../spec/slopOnboarding.md) (the plain seeking question, the trans question, the shown-to question, no straight default after a stated label; `lawStatedLabelIsAskedPlainlyNotDefaulted`).
- Wiring: the slop pair rule, the slop judge check, the Date segment key and the ConsentNetwork romance gate call `mutuallyOpen`; the friends pair rule `friend_openness` and the Friend segment key call the friend decision; the ntwrk and peon Cofounder lanes call `cofounderFactsFit` (hard rule) and add complement offers and seeks (preferences). The engine README lists the tags and readers.

## Decision: the simulator measures stated openness in its own arm

The first build drew stated trans status, trans answers, nonbinary shown-to choices and friendship openness into the pinned slop and friends worlds. Two launch gates that the base passes then failed:

| Gate | Base | Openness in the pinned world |
|---|---|---|
| slop: lowest rating quintile dates vs overall (>= 0.85x) | 0.928 (`base/sim-slop.txt`) | 0.789 (`w1-sig/fix1/sim-slop-4.txt`) |
| friends: repeat-meetup rate, 8 weeks (>= 30%) | 30.5% (`base/sim-friends.txt`) | 27.2% (`w1-sig/sim-friends-2.txt`) |

The isolation runs show that the engine wiring is not the cause. With every new statement neutral (nobody states trans, every slop member open, no shown-to choice, no friendship openness), each block equals the base: slop q1 0.928 (`w1-sig/q1-neutral.txt`), friends repeat 30.5% and V14 0.89x oracle (`w1-sig/friends-neutral.txt`). Each half of the slop world change alone moves the quintile gate: only the shown-to choices 0.818 (`w1-sig/q1-trans-off.txt`), only the trans statements 0.807 (`w1-sig/q1-shown-off.txt`), all shares halved 0.895 (`w1-sig/fix1/q1-half.txt`). Halved friendship shares still give repeat 29.7% (`w1-sig/fix1/friends-half.txt`). The gates were set on the pinned worlds, and four seeds move them by about 0.1 under any change of trajectory; choosing shares until they pass would tune the world to the gate.

So the pinned worlds keep the truth that their gates were set on (`SlopGenOptions.statedOpenness` and `FriendsGenOptions.statedOpenness` are off by default), and each block runs one more arm, the "stated openness world", on the same seeds:

- slop: a random and a slop arm with `statedOpenness: true`. The openness, minor, stated-filter and scammer-reach gates block; every other gate is tracked.
- friends: one pack arm with `statedOpenness: true`. The minor, known-adversary and openness gates block; the repeat-meetup gate and the share of members proposed by openness group are tracked.
- The conformance worlds of the slop block and the onboard block keep the openness draws on (they passed with them: `w1-sig/fix1/sim-slop-4.txt`, `w1-sig/fix1/sim-onboard-3.txt`).

Expected values in the new arm, from the runs with the openness draws in the pinned world (the seeds and draws are the same): slop openness violations 0, stated trans members 0.36x the overall proposal rate and 0.06 dates each (n 15.5 per seed), nonbinary members 0.86x, lowest orientation group man:gay 0.207 (`w1-sig/fix1/sim-slop-4.txt`); friends openness violations 0, repeat 27.2%, members proposed at least once: anyone 94.0%, women only 86.1%, men only 91.4% (`w1-sig/sim-friends-2.txt`). These are the cost of honouring the stated openness in a small world; the product owner decides whether the new world replaces the pinned one and with which gate values.

## Fix: the one-date gate reads the network's close records

With the trans question in onboarding, the slop-live trajectory changed and the base gate "one date at a time" failed for d0071 on seed 22 (`w1-sig/fix1/sim-slop-4.txt`). The trace (`w1-sig/one-date-2.txt`) shows the network was right: d0071 said "I'll pass this time" to the booked date, the network logged `booked_cancelled` and closed the opportunity ("participant dropped"), and nine hours later it booked d0071 for another date. The base gate counted every `meeting_scheduled` record as pending until its time, because the sim world has no meeting cancel. The gate now ends a booking at its time, at the network's `opportunity_closed` for that proposal, or at the network's `booked_cancelled` for that member, whichever is first after the booking; it also compares a booking with every earlier one, not only the one before. A control gate checks the reader on fixed records: an open booking still fails, a booking another member called off still fails, a close logged before the booking does not count.

## Fix: "trans women only" from a member who is not trans

A member who did not state trans and answered "only trans partners" (in the seeking list or to the trans question) kept the seeking set, so the member was proposed members who are not trans. Now no seeking set is stored while that answer stands (`seeksAnswerOf`); both questions are asked again and the member is not matchable. Corpus rows 37 and 38 of `evals/slop-onboarding/openness.jsonl` check it.

## Other measurements of the package

| Check | Result | File |
|---|---|---|
| Openness corpus (46 rows), current extractor | 0 wrong (before the two rows above changed) | `w1-sig/fix1/corpus-NEW-3.txt` |
| Openness corpus, extractor before fix round 1 | 15 wrong | `w1-sig/fix1/corpus-PREFIX-2.txt` |
| dating-shown-to integration test | pass; fails on the old romance gate | `w1-sig/fix1/test-shown-to-2.txt`, `w1-sig/fix1/test-shown-to-OLDGATE.txt` |
| engine integration tests | 74 passed | `w1-sig/fix1/test-engine-1.txt` |
| proofs | mutualOpenness 13/13, slopOnboarding 13/13, 0 unproved | `w1-sig/fix1/prove-1.txt` |
| matching --quick | 36/36 blocking (base 32/32: four new openness gates) | `w1-sig/sim-matching-quick-4.txt` |
| peon, network, onboard | 27/27, 67/67, 20/20 | `w1-sig/sim-peon-2.txt`, `w1-sig/fix1/sim-network-3.txt`, `w1-sig/fix1/sim-onboard-3.txt` |

The code changed after these runs (the separate arms, the one-date reader, `seeksAnswerOf`, the service-apps test order). None of the numbers above is a claim about the final tree until the runs in the package report are made again.

## Simulated shares and their sources

slop (`packages/sim/src/apps/slop/persona.ts`, only with `statedOpenness`): 76% of trans members state it (GLAAD x eharmony 2024, in docs/research/2026-11-17-matching-optimization/R6-signifiers-audit.md, Part B.2); 12.5% of straight members are open to trans partners (Blair and Hoskin 2019: 87.5% chose cisgender-only options). No source was found for the other shares, which are world assumptions for the product owner to confirm: open to trans partners gay 30%, lesbian 30%, bisexual 50%, pansexual, queer and nonbinary 70%; trans members open 70%, only trans 20%; nonbinary members also shown to women seekers 15%, men seekers 10%, both 15%; 10% never answer. friends (`packages/sim/src/apps/friends/persona.ts`): 1% nonbinary (Pew Research Center 2022), 15% state no gender; with `statedOpenness`, 20% of women want women friends only and 8% of men want men friends only (no source; R6 B.4 names women-only friend finding as a common request). The planted matching worlds (`packages/sim/src/planted.ts`) use cost-and-gate shares, not population estimates: one Date circle in five is trans-inclusive, one Friend circle in four is women-only, Cofounder circles take complementary roles with the role and the commitment as must-haves.

## Decisions for the product owner

1. The defaults in [mutual openness](../../spec/mutualOpenness.md): an unanswered trans question is not open; trans status not stated is not trans; only trans partners only for a stated trans member; a nonbinary member appears only where they chose; unstated gender is not admissible in Date; unanswered friendship openness is anyone.
2. Every slop member gets the trans question after the read-back.
3. Whether the stated openness world replaces the pinned slop and friends worlds, and the gate values for it.
4. The simulated shares without a source (above).
5. Scope: no conversation step asks for the cofounder work facts yet, so in production they come only from facets that already carry the tags.
