# Retrieval need channel

The structured need channel in `retrieveForIntent` was never recorded. A member whose skill, offer, or shared pool meets the intent was dropped when their embedding similarity was below `minSim` (0.2). The rank term already adds that satisfaction, and the union step already keeps a `need` channel. Nothing set the channel, so both steps were dead.

This note is hand-written. The counts come from the command output.

## Command

```sh
bun test --conditions eliza-source packages/network/test/need-channel.integration.test.ts
```

No seed sweep. One fixture, two cases. No model. Provider keys were unset. Cost 0.

The fixture uses the default engine config (`seed: 1`, city `nyc`). Ada asks to learn sailing. Bo's offer tag is `sailing_instructor`. Bo's stored embedding is a vector that does not contain that tag, so similarity stays under 0.2. Bo also wants pitch feedback, which Ada can give, so the pair is reciprocal.

| Case | Before | After |
|---|---|---|
| Skill match, similarity under 0.2 | 0 proposals | 1 proposal, generator `intent_to_capability`, channel `need` only |
| Interest overlap only, similarity under 0.2 | 0 proposals | 0 proposals |

Before the change the skill case produced no candidate (`intent_to_capability` count 0). After the change the same command selects that pair. The interest case stays empty, so a weak overlap does not bypass `minSim`.

## Other implementations

1. Lower `minSim` for every channel. People who do not meet the intent would pass too.
2. Fold the skill tag into the embedding so the local hasher scores it above `minSim`. A stored embedding, or another embedding model, would still miss the tag.

The change records the `need` channel when satisfaction is at least the shared-pool level (`SAT.pool`). A direct skill or offer is higher than that. Interest overlap stays on the semantic and tag channels.

## NYC world, quick sim

Same command before and after: `bun run sim --only network --quick`. No model. Simulated reviewer (`review: "auto"`).

| | Before | After |
|---|---|---|
| Blocking gates | 47/47 pass | 47/47 pass |
| Invariant violations, minor contacts, canary leaks | 0 | 0 |
| Fingerprint, seed 3, 10 days | `24bb81f068060b33` | `4b36ca5f3314772d` |

The fingerprint changed, so some proposals in that run changed. Every blocking safety gate stayed at its pass value. The 21-day consent comparison is not in `--quick`. It was not run.

## Limits

The fixture is one pair. The quick sim is not a precision estimate. No agent client sends a message. The engine judge is off, so there is no model call.
