# Expansion outside desires

The expansion generator in `packages/engine/src/packs/network/generators.ts` scored only the first desire stored outside the member's cluster. When that desire had no provider at or above `minSim` (0.2), the member got no expansion. A later desire with a real provider was ignored.

This note is hand-written. The counts come from the command output.

## Command

```sh
bun test --conditions eliza-source packages/network/test/expansion-desire.integration.test.ts
```

No seed sweep. Three fixtures. No model. Provider keys were unset. Cost 0.

The fixture uses the default engine config (`seed: 1`, city `nyc`). Ada's cluster is running. The first stored desire is a physics text. The second is sailing. Bo offers sailing and is not in Ada's cluster. Bo's text similarity to the physics desire is under 0.2. Bo's similarity to the sailing desire is above 0.2.

| Case | Before | After |
|---|---|---|
| First desire under 0.2, later desire has a provider | 0 candidates | 1 candidate, Ada and Bo, evidence `ada-sail` |
| Stronger desire stored first (control) | that provider | same provider, evidence `ada-physics` |
| No desire clears 0.2 (control) | 0 candidates | 0 candidates |
| Later-desire candidate after hard filters and score floors | not scored | 1 scored row, eligible |

The engine run log for the later-desire fixture reports `byGenerator.expansion` 1. The scored row is eligible. Expansion is an exploration pick, so a world with no other proposals does not put it in the selected set. The generator and the score floors are what this change fixes.

## NYC world, quick sim

Same command before and after: `bun run sim --only network --quick`. No model. Simulated reviewer (`review: "auto"`).

| | This run |
|---|---|
| Blocking gates | 51/51 pass. Four of them are the new expansion gates. |
| Invariant violations, minor contacts, canary leaks | 0 |
| Fingerprint, seed 3, 10 days | `24bb81f068060b33` |

That fingerprint is the value this command prints on main before this change. The pinned NYC run did not gain an expansion from a later desire. The fixture is the case that did.

## Other implementations

1. Lower `minSim` until the first desire passes. A weak text match would pass, and the later desire would still be ignored.
2. Average every outside desire into one embedding. A desire that fits nobody would pull the vector away from the desire that fits.

The change scores each outside desire on its own. The provider with the highest similarity at or above `minSim` is kept. A tie keeps the lower member id, then the lower desire id.

## Limits

The fixture is one seeker and one or two providers. No agent client sends a message. The engine judge is off, so there is no model call. The quick NYC run did not change its fingerprint. The 21-day consent comparison is not in `--quick`. It was not run.
