# Expansion pair rule — 2026-10-30

## Defect
The `expansion` generator in `packages/engine/src/packs/network/generators.ts`
picks the single best provider for a member's outside-cluster desire, but
unlike every other intent generator it did not check pair rules before
ranking. A blocked (or dealbreaker / cooldown) best provider therefore took
the expansion slot, and the engine's later `candidateReason` dropped that
candidate as `blocked` — so the member got no expansion proposal at all, even
though a viable second-best provider existed.

Trigger (same data as the sim gate): member "a" wants chess most (cluster
"chess") and salsa as an outside-cluster desire; "b" and "c" offer identical
salsa skills, and "a" blocked "b". Before the fix, `expansion` returned
`[a, b]` (fit 1), which `candidateReason` rejects as `blocked`. After the
fix, it returns `[a, c]` (fit 1), which passes `candidateReason`.

## Fix
Filter the expansion pool with `!pairReason(w, a, id, category)`, exactly as
`intent_to_capability` already does for its pool. One condition added, no
other logic changed. The engine's hard filter still runs afterwards, so a
pair rule that appears later is still caught there; this fix only stops a
doomed best provider from crowding out a viable second-best at generation
time.

## Evidence (sim gate, pinned inputs)
| Case | Before | After |
|---|---|---|
| Blocked best provider, viable second-best | `[a, b]`, then dropped as `blocked` | `[a, c]`, passes `candidateReason` |
| Nobody blocked (control) | `[a, b]` | `[a, b]` |
| Only provider blocked (control) | `[a, b]` (dropped later) | no expansion candidate |

Gate: `scripts/sim/engine-expansion-pair.ts`, wired into the network block.
The first and third gates fail before the fix and pass after it (verified by
running the gate standalone before and after the change); the control passes
in both states.

## Validation
- `bun run sim --only network`: PASS: 64/64 blocking gates, 0 tracked off target, 388.9s. Full `bun run sim` (all blocks) was not run, per the repo machine-load rule; only the changed network block was run.
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests, 208.96s — the same count and pattern as the earlier Network PRs in this environment (Postgres harness tests failing with connection refused; no Postgres installed here); none of the failing tests touch the expansion code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same missing-Postgres reason.

Real LLM: N/A — engine-only change, sim runs offline with no model.
Agent clients: N/A — engine-only change, no agent client flow is involved.

## Risks and trade-offs
- The fix only changes which provider the expansion generator ranks first;
  it does not change any pair rule, threshold, or score. A pair that was
  previously proposed as expansion and then dropped is now replaced by the
  next-best viable provider, so expansion proposal counts can only stay the
  same or rise in worlds where the best provider was pair-blocked.
- Alternative 1, check pair rules only in the best-provider loop (skip a
  blocked best and keep scanning): rejected — filtering the pool matches
  `intent_to_capability` and keeps the ranking loop unchanged.
- Alternative 2, leave generation unchanged and rely on `candidateReason`:
  rejected — that is the current behaviour, and it loses the expansion
  opportunity entirely instead of falling back to the second-best.
