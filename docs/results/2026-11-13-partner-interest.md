# A partner's hobby is not the member's interest

Base `dc9002b8caa9f71b0d93770149f59461dc1418ef`. No LLM calls. `$0`.

Two parsers read a hobby named for someone else as the member's own interest, or they drop the member's own hobby when the same sentence names someone else.

- Network `extractProfile` stored `tennis` from "Looking for someone who likes tennis", and it stored both `hiking` and `tennis` from "I love hiking and I'm looking for someone who plays tennis". The want `tennis_partner` was already correct. The interest was not.
- slop.date `readInterests` skipped a whole sentence that contained "someone who". "I love hiking and I'm looking for someone who plays tennis" stored no interest. "I'm someone who likes hiking" stored no interest. "ideal first date is a museum with someone who likes coffee" stored no activity.

The lexical interest pass and the taxonomy-label pass now skip a hobby only when the words immediately before it name someone else (`someone who plays`, `a person who likes`, `someone who works in`). "I'm someone who likes hiking" stays the sender's. A hobby earlier in the same sentence stays. A want such as `tennis_partner` or `climbing_partner` is unchanged. "Need someone who can belay me" still stores `climbing`.

## Measurement

Same command before and after, on the new gates plus the existing blocks. Bun 1.4.2. No provider key.

```sh
bun run sim --only evals,onboard
```

| | Blocking gates | The two new gates | Unchanged corpus and persona gates |
|---|---|---|---|
| Before, parsers at `dc9002b` | 44/46 | both fail | evals wants 20/20 at recall >= 0.8; areas 1.000 (n 197); negated wants 0/102 wrong; slop hard fields 306/306 and 70/70; soft fields 71/72 (98.6%); P4 fill 89.7% of fields, 79.3% of 576 personas, seeds 13-14 |
| After | 46/46 | both pass | same figures, including the tracked ported-row read 175/186 (94.1%) |

Before, the network gate stopped on `["tennis"]` for "Looking for someone who likes tennis". The slop gate stopped on `[]` for the mixed hiking sentence. `bun run typecheck` exits 0 after the change.

## Limits

The check is the words immediately before the hobby. "Someone who can belay me" stays the sender's climbing, because "can" is not "likes" or "plays". A hobby more than 100 characters after the "who" phrase is not covered. The persona onboarding sim does not use these sentences, so its fill rate does not move. No Postgres, integration, or e2e run. No model.
