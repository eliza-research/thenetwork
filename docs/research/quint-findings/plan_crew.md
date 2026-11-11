# Quint findings: `quint/plan_crew.qnt`

Model: [`quint/plan_crew.qnt`](../../../quint/plan_crew.qnt). Machine: M-124 `crew-offer-and-crew` (module plan
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md) section 6.7). This file is hand-written.

## 1. Why this model is separate

The crew machine was part of `quint/plan_run.qnt`. It moved to its own model so that Apalache can check both
models ([plan_run.md](plan_run.md) section 6). The crew shares no state with the plan run. It reads only STOP,
the trust watch and the minors policy (`planSeatOk`, network.ts:2888) and the clock. These are actor events in
this model too (`stop`, `goWatch`, `minorSignal`, `clock`), so the model has every crew trace of the combined
model. The defect history (SD-144, SD-444) is in [plan_run.md](plan_run.md) sections 3 and 4.

## 2. What the model contains

- Code: `packages/engine/src/plans.ts` (crewOptIn, crewSessionPlan) and `packages/network/src/network.ts`
  (crewCheck, onCrewAnswer, resolveCrew, crewSessions), at the same commit as `plan_run.qnt`.
- One crew offer to a, b and c; the offer resolves when everyone answered or after 3 days. Sessions by abstract
  week slot (0-4). A session opportunity ends "held" or "failed" (rejected, expired in review, or no quorum).
- `safety`: `sessionSlotOnce` (SD-144, fixed), `handoffCountsSessions` (SD-444 counting part, fixed),
  `crewOptedIn`.
- `skippedDefects`: `crewEndHeard` (SD-444 notice part, skipped: needs a founder decision on new member text).
- Witnesses: `witness_crewSession`, `witness_crewNotFormed`, `witness_crewHandedOff`.
- Run tests: `sd144SlotOnceTest`, `crewHandoffTest` (both from the combined model), and `crewSeatsTest` (new:
  a member on watch leaves the crew short of seats, so no session is proposed).

## 3. Checks

```
bun run quint:check --verify quint/plan_crew.qnt  (max-steps=30, max-samples=10000, verify-steps=12, seed 0x5eed)
ok   typecheck
ok   test                (3 run tests)
ok   safety
ok   witness_crewSession, witness_crewNotFormed, witness_crewHandedOff (all reachable)
ok   verify safety       (Apalache 0.62.4, no violation in 12 steps, about 25 s)
```

`quint verify --max-steps 16` also has no violation (3 min 11 s). Twelve steps reach the hand-off: three
answers, three proposals that are held, then the hand-off is 10 steps. `skippedDefects` alone is violated by the
random simulation, as expected; `crewHandoffTest` shows the trace.

The actor events (STOP, watch, minor signal) have weight 1 in 10 in `step`, so that random traces also reach the
hand-off.
