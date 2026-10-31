# Retrieval need channel

The structured need channel in `retrieveForIntent` was never recorded. A member whose skill, offer, shared pool, or mutual romance preference meets the intent was dropped when their embedding similarity was below `minSim` (0.2). The rank term already adds that satisfaction, and the union step already keeps a `need` channel. Nothing set the channel, so both steps were dead.

This note is hand-written. The counts come from the command output.

`SAT.pool` is 0.85. That is the lowest level that opens the channel. A skill or an offer is `SAT.need` (1). A mutual romance preference is `SAT.romance` (0.9). Romance is above the pool bar, so `need >= SAT.pool` admits it. A test written as `need >= SAT.romance` would leave a shared pool out, because 0.85 is below 0.9. Interest overlap is `SAT.interest` (0.45). It stays on the semantic and tag channels.

## Command

```sh
bun test --conditions eliza-source packages/network/test/need-channel.integration.test.ts
```

No seed sweep. One fixture, two cases. No model. Provider keys were unset. Cost 0. Bun 1.4.2.

The fixture uses the default engine config (`seed: 1`, city `nyc`). Ada asks to learn sailing. Bo's offer tag is `sailing_instructor`. Bo's stored embedding is a vector that does not contain that tag, so similarity stays under 0.2. Bo also wants pitch feedback, which Ada can give, so the pair is reciprocal.

The before run is the same file copied onto upstream `main` `a0ed7bc`. The file is not on `main`.

| Case | Before | After |
|---|---|---|
| Skill match, similarity under 0.2 | 0 proposals (1 pass, 1 fail) | 1 proposal, generator `intent_to_capability`, channel `need` only (2 pass, 0 fail, 3 expect() calls) |
| Interest overlap only, similarity under 0.2 | 0 proposals | 0 proposals |

Before the change the skill case produced no candidate (`intent_to_capability` count 0). After the change the same command selects that pair. The interest case stays empty, so a weak overlap does not bypass `minSim`.

## Other implementations

1. Lower `minSim` for every channel. People who do not meet the intent would pass too.
2. Fold the skill tag into the embedding so the local hasher scores it above `minSim`. A stored embedding, or another embedding model, would still miss the tag.

## Full sim, same seeds

Command, both sides: `REQUIRE_PG=1 bun run sim --json <file>`. Upstream `main` `a0ed7bc`, then this branch. No model. Provider keys were unset. Simulated reviewer (`review: "auto"`). Dev Postgres 16.15 on port 54339. No Postgres gate was skipped.

The push baseline uses `StubNetwork` and the engine, so its rates move too.

| Metric | Before (`a0ed7bc`) | After (this branch) |
|---|---|---|
| Blocking gates | 330/330 pass, 14 tracked off target, 364.6 s | 330/330 pass, 14 tracked off target, 384.2 s |
| The 14 tracked misses | same gate names | same gate names |
| Everyone-yes, consent, seeds 1-3, 21 days | 0.847 | 0.891 |
| Invite-yes, consent, seeds 1-3 | 0.919 | 0.941 |
| Meetings, consent, seeds 1-3 | 144 | 170 |
| Meetings, seed 1, consent vs push | 50 vs 36 | 50 vs 35 |
| New members joined, consent, seed 1 | 20 | 19 |
| Unsafe proposals, seed 1, consent vs push | 0 vs 32 | 0 vs 36 |
| Plans held, consent, seeds 1, 2, 3 | 1, 0, 1 | 2, 2, 1 |
| Fingerprint, seed 3, 10 days | `24bb81f068060b33` | `c0b2be40ae00f5d6` |
| Fingerprint, consent vs push | `361f8cc2648fb9a6` | `80c746c37c9b45ea` |
| slop, peon, friends fingerprints | unchanged | unchanged |
| Invariant violations, minor contacts, canary leaks | 0 | 0 |

Consent yes-rates and meetings went up. Consent unsafe proposals stayed 0. One more new member joined on `main` at seed 1 (20, then 19).

An earlier full sim, before the follow-up below, was 329/330. Gate `network-consent-5` failed: `nw-3-74 -> nw-3-127` and `nw-3-49 -> nw-3-105`. The observatory `spam_wave` scorecard also counted 1 minor contact (`message o001957 to ny-0219 about an opportunity involving minor ny-0020`). That run is not the result above.

## Follow-up

Two paths did not keep the new matches inside the old consent rules.

1. A newcomer welcome did not read pair history. After `ny-0048` said no to `ny-0122`, a later welcome probed that pair. The welcome path now uses the same 60-day pair history as the engine.
2. `ny-0020` claimed 19 and was probed for a dinner pool, then said no and was replaced. A later line flagged them as under 18. The introduction stayed open, and a later probe on it counted as a minor contact. A minor signal now closes an open introduction that a probe already reached them on.
3. The audit gate used the roster from the first probe. A person who had already been replaced was treated as part of the declined pair. The gate now uses the roster at the time of the no. That is the pair `markDeclined` records.

## Other validation

Same machine, Bun 1.4.2, Postgres 16.15 on port 54339, `REQUIRE_PG=1`. No model.

| Command | Before (`a0ed7bc`) | After (this branch) |
|---|---|---|
| `bun run typecheck` | exit 0 | exit 0 |
| `bun run test:integration` | 681 pass, 8 skip, 0 fail, 13974 expect() calls, 689 tests, 68 files, 231.20 s | 683 pass, 8 skip, 0 fail, 14022 expect() calls, 691 tests, 69 files, 236.77 s |
| `bun run test:e2e` | 42 pass, 1 skip, 0 fail, 654 expect() calls, 43 tests, 3 files, 12.05 s | 42 pass, 1 skip, 0 fail, 654 expect() calls, 43 tests, 3 files, 10.88 s |

The branch integration count is higher by the two new cases. The 8 integration skips are `NETWORK_RETRY_RECONCILIATION_TEST` unset. The e2e skip is `PLAYWRIGHT_MODULE` unset. Both sides skip the same tests. Postgres was up for the rest.

## Limits

The fixture is one pair. The sim is the pinned seeds, not a new sample. No agent client sends a message. The engine judge is off, so there is no model call. Cost 0.
