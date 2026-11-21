# Expansion outside desires

The expansion generator in `packages/engine/src/packs/network/generators.ts` keeps one provider for a member. It now scores every desire stored outside that member's cluster. It keeps the eligible provider with the highest similarity at or above `minSim` (0.2). A tie keeps the lower member id, then the lower desire id.

Two holes are closed.

1. A first desire below `minSim` used to hide a later desire that had a real provider.
2. A blocked strongest provider used to take the only slot. The hard filter then dropped that pair as `blocked`. A viable second provider was never scored.

The pool uses the shared pair rule, `pairReason`. That rule rejects a blocked pair, a dealbreaker, an active duplicate, a pair cooldown, and a negative-feedback cooldown. Open PR #290 adds the same pool check and still scores only `outside[0]`. This note's scan scores every outside desire, so the change stands if #290 does not merge. The scenario-repetition gate from #246 is on main as `scenarioRepetitionGate`, merged in #483. The network block registers that gate, `inviteRootGate` from merged #319, and `expansionDesireGate`.

This note is hand-written. The counts come from the command output.

## Fixture

The fixture uses the default engine config (`seed: 1`, city `nyc`). Ada's cluster is running. The first stored desire is a physics text. The second is sailing. Bo offers sailing and is not in Ada's cluster. Cy offers the same physics text and is not in Ada's cluster. No model. Provider keys were unset. Cost 0.

Measured similarities, `minSim` 0.2:

| Desire | Bo | Cy |
|---|---|---|
| Physics (`ada-physics`) | 0.1069 (`bo-sail`) | 0.9089 (`cy-physics`) |
| Sailing (`ada-sail`) | 0.3501 (`bo-sail`) | 0.0838 (`cy-physics`) |

In the blocked fixture Ada has a `blocked` edge to Cy. `pairReason` returns `blocked` for Ada and Cy, and null for Ada and Bo.

| Case | Before | After |
|---|---|---|
| First desire under 0.2, later desire has a provider | 0 candidates | 1 candidate, Ada and Bo, evidence `ada-sail` |
| Stronger desire stored first (control) | Ada and Cy, evidence `ada-physics` | same |
| No desire clears 0.2 (control) | 0 candidates | 0 candidates |
| Later-desire candidate after hard filters and score floors | not scored | 1 scored row, eligible |
| Blocked strongest provider, viable second | Generator emits Ada and Cy, fit 0.9089, evidence `ada-physics`. Funnel: `expansion` 1, `rejectedBy.blocked` 1, passed 0. Scored expansion rows: 0. | Generator emits Ada and Bo, fit 0.3501, evidence `ada-sail` and `bo-sail`. Funnel: `expansion` 1, `rejectedBy` empty, passed 1, eligible 1. Scored row Ada and Bo, eligible, score 0.2309. |

A pool filter on `outside[0]` only, which is the shape of #290, also returns no candidate on this fixture. Cy is the only provider at or above 0.2 for the physics desire, and Cy is blocked. Bo's physics similarity is 0.1069.

The engine run log for the later-desire fixture reports `byGenerator.expansion` 1. The scored row is eligible. Expansion is an exploration pick, so a world with no other proposals does not put it in the selected set.

## Commands

```sh
bun test --conditions eliza-source packages/network/test/expansion-desire.integration.test.ts
```

Bun 1.4.2. No seed sweep. Four fixtures. Output:

```
bun test v1.4.2 (744846f84)

packages/network/test/expansion-desire.integration.test.ts:
(pass) a later desire is proposed when the first stored desire is below minSim
(pass) the stronger desire wins when it is stored first
(pass) no outside desire below minSim is proposed
(pass) a blocked strongest provider does not hide a viable second

 4 pass
 0 fail
 16 expect() calls
Ran 4 tests across 1 file. [56.00ms]
```

The log also printed one line that no Surplus or OpenAI key is set. That path does not call a model.

```sh
bun run typecheck
```

Exit 0. The command printed the four `tsc --noEmit` projects and no error.

```sh
bun run sim --only network --quick
```

No model. Simulated reviewer (`review: "auto"`). Output is in the next section.

## NYC world, quick sim

```
-- network: 57/57 blocking gates pass, 1 tracked (139.9s)

PASS: 57/57 blocking gates, 0 tracked off target, 139.9s (network 139.9s)
```

The five expansion gates pass, including the blocked-strongest gate. `scenarioRepetitionGate` and `inviteRootGate` from merged #319 also pass. Invariant violations, minor contacts, and canary leaks are 0. The fingerprint for seed 3 over 10 days is `3324e683e0e37345` on main `64d85fb`. A second run on current main with this pair filter removed was not made.

## Other implementations

1. Lower `minSim` until the first desire passes. A weak text match would pass, and the later desire would still be ignored.
2. Average every outside desire into one embedding. A desire that fits nobody would pull the vector away from the desire that fits.
3. Apply `pairReason` only while scoring `outside[0]`. The blocked strongest provider for that first desire is dropped, and the viable later desire is still ignored. This fixture then returns no candidate.

The change scores each outside desire on its own, and only among providers the pair rule accepts.

## Limits

The blocked fixture is one seeker and two providers. No agent client sends a message. The engine judge is off, so there is no model call. The quick NYC run on main `64d85fb` printed fingerprint `3324e683e0e37345`. The 21-day consent comparison is not in `--quick`. It was not run.
