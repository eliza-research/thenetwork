# Newcomer pair rule — 2026-10-30

## Defect
The `newcomerWelcome` generator in `packages/engine/src/packs/network/generators.ts`
builds its pool from `eligibleMembers` (member-level checks only), ranks the
pool by affinity, and keeps only the first `group.poolSize` (24) members
before `composeGroup` runs. Unlike `intent_to_capability` and `expansion`, it
did not check pair rules against the newcomer before ranking. A member blocked
against the newcomer therefore took a pool slot, and `composeGroup` pruned
that member as incompatible — so when 24 blocked members filled the pool, a
viable host and guest ranked below the cut never entered the pool at all,
and the newcomer got no welcome, even though a valid group existed.

Trigger (same data as the sim gate): newcomer "n" (joined 2 days ago) plus
24 members with the same desire as "n" (so they rank first) who are all
blocked against "n", plus a viable host "vh" (host facet, different desire)
and a viable guest "vg" (positive ties to six members in another city, so
its affinity clears 0.1). Before the fix, `newcomerWelcome` returned no
candidate: the pool was the 24 blocked members, none of them a host, so the
generator stopped before `composeGroup`. After the fix, it returns
`[n, vh, vg]` (roles newcomer, host, guest), which passes `candidateReason`.

## Fix
Filter the newcomer pool with `!pairReason(w, n, id, "social")`, exactly as
`intent_to_capability` and `expansion` already do for their pools. One
filter added, no other logic changed. The engine's hard filter still runs
afterwards, so a pair rule that appears later is still caught there; this
fix only stops a member who can never join the forced group from crowding
out a viable member at pool time.

## Evidence (sim gate, pinned inputs)
| Case | Before | After |
|---|---|---|
| 24 blocked members fill the pool, viable host + guest below the cut | no candidate | `[n, vh, vg]`, passes `candidateReason` |
| Only a few members blocked (control) | `[n, vh, vg]` | `[n, vh, vg]` |
| No viable host exists (control) | no candidate | no candidate |

Gate: `scripts/sim/engine-newcomer-pair.ts`, wired into the network block.
The first gate fails before the fix and passes after it (verified by
running the gate standalone before and after the change); the controls
pass in both states.

## Validation
- `bun run sim --only network`: PASS: 64/64 blocking gates, 0 tracked off target, 423.6s. Full `bun run sim` (all blocks) was not run, per the repo machine-load rule; only the changed network block was run. Pooled meetings stayed at 144 (floor 140).
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests, 203.86s — the same count and pattern as the earlier Network PRs in this environment (Postgres harness tests failing with connection refused; no Postgres installed here); none of the failing tests touch the newcomer code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same missing-Postgres reason.

Real LLM: N/A — engine-only change, sim runs offline with no model.
Agent clients: N/A — engine-only change, no agent client flow is involved.

## Risks and trade-offs
- The fix only changes which members enter the newcomer pool; it does not
  change any pair rule, threshold, or score. A member who was previously
  ranked into the pool and then pruned by `composeGroup` is now replaced by
  the next-best viable member, so newcomer welcome counts can only stay the
  same or rise in worlds where a pool member was pair-blocked against the
  newcomer.
- Alternative 1, check pair rules only inside `composeGroup` (skip a blocked
  member and keep expanding): rejected — `composeGroup` already prunes
  incompatible members, and that is the current behaviour; it cannot bring
  back a viable member who was cut from the pool before `composeGroup` ran.
- Alternative 2, leave generation unchanged and rely on `candidateReason` /
  `composeGroup` pruning: rejected — that is the current behaviour, and it
  loses the welcome entirely when blocked members fill the pool.
- Out of scope: a viable host can still be crowded out of the pool by
  viable high-affinity guests (no pair rule is involved there); that is a
  separate ranking question, not a pair-rule defect, and this fix does not
  change host ranking.
