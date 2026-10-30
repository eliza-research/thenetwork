# World alias response history — 2026-10-30

## Defect
The `World` constructor promises every identifier is mapped into ONE id
space (ME-006) before any filter runs. The interactions mapping in
`packages/engine/src/world.ts` canonicalised `participants`, `declinedBy`
and `contributors` — but not `acceptedBy` / `noResponse`. `responseHistory`
then bumped the raw alias id, so `acceptanceOf` (looked up by canonical
member id) never saw it.

Trigger: `idAliases: { oldA: "a" }`, one completed interaction with
`participants: ["a", "b"]`, `acceptedBy: ["oldA"]`. Before the fix, member
A's acceptance stayed at the prior 0.45 (prior 0.45, strength 2) instead of
(1 + 0.9) / (1 + 2) = 0.633. The symmetric `noResponse: ["oldA"]` case kept
acceptance at the prior-only 0.45 instead of 0.3 (the non-response was
dropped from the denominator, overstating acceptance).

## Fix
Map `acceptedBy` and `noResponse` through the canonicaliser `C` in the
interactions mapping, alongside the fields already mapped. One line added
(+1 line, no other logic changed). `acceptance` is stamped onto every
`EngineProposal`, so any consumer judging responsiveness now gets the
canonical value for members whose history was recorded under an old id.

## Evidence (sim gate, pinned inputs)
| Case | Before | After |
|---|---|---|
| `acceptedBy: ["oldA"]` (alias) | acceptance 0.45 (prior only) | 0.633 |
| `noResponse: ["oldA"]` (alias) | acceptance 0.45 (prior only) | 0.3 |
| `acceptedBy: ["a"]` (canonical, control) | 0.633 | 0.633 |
| No history (control) | 0.45 | 0.45 |

Gate: `scripts/sim/engine-world-alias.ts`, wired into the network block.
The two alias gates fail before the fix and pass after it (verified by
running the gate standalone before and after the change); both controls
pass in both states.

## Validation
- `bun run sim --only network`: PASS: 65/65 blocking gates, 0 tracked off
  target, 391.5s. Full `bun run sim` (all blocks) was not run, per the repo
  machine-load rule.
- `bun run typecheck`: pass, exit 0.
- `bun run test:integration`: 364 pass, 252 skip, 23 fail, 639 tests,
  206.68s — the same count and pattern as the earlier Network PRs in this
  environment (Postgres harness tests, no Postgres installed here); none
  of the failing tests touch the world code.
- `bun run test:e2e`: 0 pass, 47 skip, 0 fail — all skipped for the same
  missing-Postgres reason.

Real LLM: N/A — engine-only change, sim runs offline with no model.
Agent clients: N/A — engine-only change, no agent client flow involved.

## Risks and trade-offs
- No live caller was shown to pass aliased `acceptedBy`/`noResponse`
  today; this fixes the constructor contract for any caller that does,
  including future ones — the same class as the earlier forced-group fix.
- The fix only changes which id the history is booked under; it does not
  change the acceptance formula, the prior, or the strength.
- Alternative 1, canonicalise inside `responseHistory` instead: rejected —
  the constructor already owns canonicalisation for every other
  interaction field, and a second site would diverge.
- Alternative 2, canonicalise only `acceptedBy` and leave `noResponse`:
  rejected — the same bug, in the denominator direction (overstated
  acceptance), would remain.
