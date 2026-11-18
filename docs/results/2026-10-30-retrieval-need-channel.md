# Retrieval need channel

The structured need channel in `retrieveForIntent` was never recorded. A member whose skill, offer, shared pool, or mutual romance preference meets the intent was dropped when their embedding similarity was below `minSim` (0.2). The rank term already adds that satisfaction, and the union step already keeps a `need` channel. Nothing set the channel, so both steps were dead.

This note is hand-written. The counts come from the command output. This branch holds only this fix and its regression. The welcome pair history, the minor-signal close, and the audit roster live on `cursor/network-consent-split-7058`.

`SAT.pool` is 0.85. That is the lowest level that opens the channel. A skill or an offer is `SAT.need` (1). A mutual romance preference is `SAT.romance` (0.9). Romance is above the pool bar, so `need >= SAT.pool` admits it. A test written as `need >= SAT.romance` would leave a shared pool out, because 0.85 is below 0.9. Interest overlap is `SAT.interest` (0.45). It stays on the semantic and tag channels.

## Command

```sh
bun test --conditions eliza-source packages/network/test/need-channel.integration.test.ts
```

No seed sweep. One fixture, two cases. No model. Provider keys were unset. Cost 0. Bun 1.4.2.

The fixture uses the default engine config (`seed: 1`, city `nyc`). Ada asks to learn sailing. Bo's offer tag is `sailing_instructor`. Bo's stored embedding is a vector that does not contain that tag, so similarity stays under 0.2. Bo also wants pitch feedback, which Ada can give, so the pair is reciprocal.

The before run is the same file on upstream `main` `a8b60e7`. The file is not on `main`.

| Case | Before | After |
|---|---|---|
| Skill match, similarity under 0.2 | 0 proposals. Exit 1. 1 pass, 1 fail, 2 expect() calls. The skill case expected `["intent_to_capability"]` and received `[]`. | 1 proposal, generator `intent_to_capability`, channel `need` only. Exit 0. 2 pass, 0 fail, 3 expect() calls. |
| Interest overlap only, similarity under 0.2 | 0 proposals (that case passed) | 0 proposals |

Before the change the skill case produced no candidate. After the change the same command selects that pair on the `need` channel only. The interest case stays empty, so a weak overlap does not bypass `minSim`.

## Other implementations

1. Lower `minSim` for every channel. People who do not meet the intent would pass too.
2. Fold the skill tag into the embedding so the local hasher scores it above `minSim`. A stored embedding, or another embedding model, would still miss the tag.

## Typecheck

`bun run typecheck` on this branch: exit 0.

## Limits

The fixture is one pair. No full `bun run sim` on this narrowed head. The earlier full-sim counts were measured with the welcome, minor, and audit edits on an older `main`, so they are not evidence for this branch. No agent client sends a message. The engine judge is off, so there is no model call. Cost 0.
