# Shared intent best match — 2026-10-30

## Defect
The `sharedIntentPooling` generator in `packages/engine/src/packs/network/generators.ts`
builds its `similar` list from every intent in the category, but it kept only
the first intent seen per member. Intents arrive in id order, not fit order.
So when a member's weaker intent sorts before their perfect intent in the
same category, the pair (and any group) was scored on the weaker fit even
though a perfect match existed.

Trigger (same data as the sim gate): member "a" wants "play chess". Member
"z" has two hobby intents: "play chess on weekends" (sim 0.786 to "a") with
id "za", and "play chess" (sim 1) with id "zb". The weaker intent sorts
first, so before the fix the pair candidate had fit 0.786. After the fix, it
has fit 1, and it passes `candidateReason`.

## Fix
When a member is already in the `similar` list, keep the intent with the
higher sim instead of the first intent seen. The member already passed every
check (same category, above the pool threshold, can meet, no pair rule, no
member rule), so only the fit and the risk text change. No pair rule,
threshold, or score formula changed.

## Evidence (sim gate, pinned inputs)
| Case | Before | After |
|---|---|---|
| Weaker intent sorts first, perfect intent second | pair fit 0.786 | pair fit 1, passes `candidateReason` |
| Best intent already sorts first (control) | pair fit 1 | pair fit 1 |
| No intent clears the pool threshold (control) | no candidate | no candidate |

Gate: `scripts/sim/engine-shared-intent-best.ts`, wired into the network block.
The first gate fails before the fix and passes after it (verified by
running the gate standalone before and after the change); the controls
pass in both states.

## Validation
- `bun run sim --only network`: PASS: 64/64 blocking gates, 0 tracked off target, 392.4s. Full `bun run sim` (all blocks) was not run, per the repo machine-load rule; only the changed network block was run. Pooled meetings stayed at 144 (floor 140).
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests, 211.45s — the same count and pattern as the earlier Network PRs in this environment (Postgres harness tests failing with `initdb not found`; no Postgres installed here); none of the failing tests touch the shared-intent code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same missing-Postgres reason.

Real LLM: N/A — engine-only change, sim runs offline with no model.
Agent clients: N/A — engine-only change, no agent client flow is involved.

## Risks and trade-offs
- The fix only changes which intent of a member represents that member in
  the `similar` list: the best-fitting one instead of the first one in id
  order. A pair or group fit can only stay the same or rise, never fall,
  because the replacement happens only when the new sim is higher.
- Alternative 1, generate one candidate per intent pair and let the engine
  dedupe keep the best. Why not: that would change the generator's output
  shape and the seen-set logic, for the same result as keeping the best
  intent here.
- Alternative 2, leave generation unchanged and rely on the engine's
  dedupe by participant set. Why not: that is the current behaviour, and
  it cannot help, because the better pair is never generated — the seen
  set blocks it after the weaker pair is already made.
- Out of scope: the romance generator also keeps only the first romance
  intent per member. That is a separate generator with its own rules, and
  this fix does not change it.
