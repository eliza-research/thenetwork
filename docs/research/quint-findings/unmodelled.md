# Quint findings: defects with no planned module

Hand-written, 2026-11-08. Wave 2 of the state-machine research.

## Scope

This file covers the 28 live defects that section 5 of
[2026-11-07-state-machines.md](../2026-11-07-state-machines.md) gives no Quint module ("none"):
SD-118, SD-188, SD-189, SD-190, SD-193, SD-194, SD-195, SD-201, SD-278, SD-330, SD-338, SD-373, SD-377, SD-399,
SD-401, SD-402, SD-404, SD-406, SD-408, SD-410, SD-411, SD-494, SD-497, SD-498, SD-502, SD-503, SD-506, SD-509.

For each defect, this file answers one question: can a Quint model express the machine that the defect lives in?
If yes, it names the module (one of the 16 planned modules in section 6, or a new module).

This step changes no code and no model. It adds no test.

## Method

For each id, I read the register row, the verdict and reason in
[defect-verdicts.json](../state-machines/defect-verdicts.json), the source report section that the row cites, and the
code lines where the report was not clear. I then put the defect in one of four classes:

| Class | Meaning | Quint result |
|---|---|---|
| A | The machine is a production machine that a planned module already owns. The register row did not link it. | Add the defect to that module. The model can find it. |
| B | The defect is in a simulator or test copy of a production machine (persona, World, judge, StubNetwork, per-app world). | Quint can express the copy, but section 6.18 keeps simulator code out of the models. The production rule goes into the named module as an invariant. That invariant is the specification the simulator must match. The model cannot find the simulator defect. The fix needs a sim gate, a scenario or a judge change. |
| C | The machine is real and has interleavings, but it is dev-only tooling with no planned module (`game-world` M-219, `lab-run` M-220). | Expressible. A new P2 module could find the defect. |
| D | The defect is not a state machine: document or comment text, CI configuration, a vacuous gate, a file list, or input parsing. | Not expressible in a useful way. For text drift, the module that owns the machine must use the value in the code, not the value in the text. |

## Results

| Id | Verdict | Class | Machine | Quint home | Reason | What the fix needs |
|---|---|---|---|---|---|---|
| SD-118 | disputed | D | `contract-mirror` | none | It is a list of files that a pin test covers. Section 6.18 leaves `contract-mirror` out: "a model adds nothing". A hash pin is not a state. | Decide whether the seven other `svc/` wire files are part of the mirror. If yes, the pins in `contract-mirror.test.ts` change, and that needs the same change upstream first (the contract rule in AGENTS.md). |
| SD-188 | confirmed | B | `judge-consent-tracking` (sim) over `sim-proposal-decision` | `opportunity.qnt` (spec) | The judge reads `decision` and ignores `intent`. The production rule is `revealNeedsYes` (sim.md Part 7, invariant 2): a reveal or booking needs `answer = yes` from each participant; a counter or silence fails it. The model checks the production machine, not the judge. | Judge change and a sim gate that fails when an ignored accept is counted as consent. |
| SD-189 | disputed | B | `judge-consent-tracking` (sim) | `opportunity.qnt` (spec) | `meeting_scheduled` is written by the Network under test, so the judge takes the Network as its own witness. The same `revealNeedsYes` invariant states the rule. A missing `meeting_without_consent` check is a judge gap, not an interleaving. | Judge check `meeting_without_consent` from World-side evidence, and a sim gate that a forged `meeting_scheduled` fails. |
| SD-190 | confirmed | B | `judge-review-gate` (sim) | `plan_run.qnt` (spec) | The judge reads `plan.id`; the field is `planId`. This is a field-name mismatch. A Quint model has no field names of the JSON log. The production rule (no plan probe reaches a minor, every plan probe is reviewed) belongs in `plan_run.qnt`. | Judge fix and a sim gate that a plan probe to a declared minor counts as a minor contact. |
| SD-193 | disputed | B | `judge-block-tracking` (sim), `sim-member-lifecycle` | `safety_trust.qnt` (spec) | The block record comes only from the Network, so a Network that does not parse "block Sam" is never blamed. The production rule is `blockWins` (sim.md Part 7, invariant 5) on `pair-relations`. | World logs the persona's block intent; a scenario where the Network ignores a block must fail. |
| SD-194 | confirmed | B | `sim-flake-and-meeting` (World) | `opportunity.qnt` (spec) | World has no cancelled meeting, so an outcome follows a cancel. The production rule is `cancelledIsFinal` (sim.md Part 7, invariant 6) on `opportunity-lifecycle` and `booked-attendance`. Sim.md Part 7 says to merge the World meeting into the production opportunity model; that gives the spec, not a check of World. | World handles `cancellation`; judge checks blocks at `outcome`; a scenario "block after schedule" must give a violation before the fix. |
| SD-195 | confirmed | D | `slop-world-flow` configuration | none | The pinned slop world turns on `verification: true`, which production does not have (decision 9). This is a configuration value of a gate, not a transition. | Change the pinned `WORLD` to the production configuration; the scammer-reach gate must then measure the live filter. |
| SD-201 | confirmed | D | `sim-gate-run` (slop block) | none | The "0 probes carry a photo" gate cannot fail, because the arm never turns on photos. Vacuity of a gate is a test-design defect. The Quint witness rule (README rule 4) is the same idea, but it applies to models, not to sim gates. | The gate must turn on the photo path, or the gate goes. A gate must fail on a forced photo probe. |
| SD-278 | confirmed | D | none (CI) | none | `profile-cleanup-reconciliation.postgres.test.ts` runs only with two environment variables that no CI file sets. This is CI configuration. The retry and rollback rules that the suite tests are in `profile_learning.qnt` (`connection-cleanup-v1`). | Set the variables in the CI integration job, or run the suite on the dev Postgres helper. |
| SD-330 | confirmed | D | `outreach-attention` (text only) | `opportunity.qnt` owns the machine | Comments and AGENTS.md say 14 days of silence and 48 h; `OUTREACH` in `packages/network/src/outreach.ts` says 30 days and 72 h. The machine is in `opportunity.qnt`. The model must take its thresholds from `OUTREACH`, not from the comments. The drift itself is text. | Text fix only. |
| SD-338 | confirmed | D | `collected-reply` (text only) | `outbound_queue.qnt` owns the machine | `packages/network/service/README.md` says collected replies are outside `platform.outbound`; `NetworkRuntime.save` records them in it. The machine is in `outbound_queue.qnt`. The model must use the code behaviour (collected replies are rows of the queue; a receipt poll resends on `not_found`; Cloud recover moves rows to `unknown_acceptance`). | Text fix only. |
| SD-373 | confirmed | A | `membership` (M-020) | `join_age.qnt` | `memberships.review` is read (`canJoin` returns reason `review`; the active-membership check needs `review === null`) but production writes only `null`. In `join_age.qnt`, model `review` as a field of `membership` with only the writes that exist. A witness `witness_reviewHeld` then fails, and that shows the `review` branch is dead. | Decide whether the review hold on a membership is wanted (founder or maintainer). If not, remove the dead branch; if yes, it is new scope. No code change before that decision. |
| SD-377 | confirmed | D | `erasure-saga` (comment only) | `identity_sagas.qnt` owns the machine | The `deleteAll` comment says own blocks are deleted; both stores keep blocks on purpose. The model must keep blocks after delete (that is the rule `blockWins` needs across a rejoin). The drift is a comment. | Comment fix only. |
| SD-399 | confirmed | B | `judge-minor-flag` (sim) | `join_age.qnt` (spec) | The judge reads `d.age` on `age_resolved`, which carries no `age`, so its clear branch is dead. The direction is safe (fail closed). The production rule is `lowestWins` / `lowestAgeMonotone` on `age-floor` and `member-age-policy`. Note S-23: if the logs get an `age`, the judge must still not clear a stated minor age. | Judge reads the log the Network writes; a sim gate that a member who gives an adult age after `age_unknown` is not a minor contact, and that a stated minor age is never cleared. |
| SD-401 | confirmed | B | `sim-channel-opt-out` (persona) | `turn_consent.qnt` (environment) | The persona guard lets only the literal `START` through after STOP and drops UNSTOP, RESUME and HELP. `turn_consent.qnt` gives the sender these kinds as nondeterministic input (`sendText(kind)` with stop, start, help), so the production path is covered there. The persona copy is not modelled. | Persona fix and a scenario that sends HELP and UNSTOP after STOP. |
| SD-402 | disputed | B | `sim-member-lifecycle` (persona initiative chain) | `turn_consent.qnt` (environment) | No persona sends START after STOP, so the START path is never run in a world. In `turn_consent.qnt` the environment can send START at any step, and the witness "START resumes the routed app" makes that path reachable. | A scenario or persona rule that returns from STOP. |
| SD-404 | disputed | B | `slop-world-flow` (sim) | `safety_trust.qnt` (spec) | `resolveWeek` checks `paused` only, so a hold from flow i does not stop flow i+1 in the same round. Production checks holds at send time (`slop-review-hold`, M-056). A small refinement model of the slop world could find this; section 6.18 leaves `slop-world-flow` out. | Re-check holds per flow in the slop world, with a sim gate. The three per-app worlds must agree. |
| SD-406 | confirmed | B | `peon-application-flow` (sim) | `matching_engine.qnt` (spec, `peon-candidate-onboarded`) | `exited` is not absorbing: review, interview and offer steps check only `hired`. The production rule (a candidate who left the search gets no new step) belongs to the peon candidate machine in `matching_engine.qnt`. Peon is local only. | Peon world checks `exited` at each step, with a peon sim gate. |
| SD-408 | disputed | B | `sim-stub-*` (StubNetwork `awaiting`) | `opportunity.qnt` (spec, `awaiting-slot`) | StubNetwork does not clear `awaiting` when an opportunity leaves `inviting`, or when feedback gets no answer. A `stub_network.qnt` could express the stub (explicit stage and status, sim.md M9), but the stub is the push baseline, not production. The production rule (an `awaiting` slot ends with its opportunity) is in `opportunity.qnt`. | Fix in the stub with a JSON scenario. |
| SD-410 | confirmed | B | `sim-stub-*` (deferred invite) | `opportunity.qnt` (spec, `send-pipeline-and-deferred`) | A deferred invite replays after STOP and overwrites `dropped` with `pending`. This is an interleaving that Quint finds at once in a stub model. The production rule `noSendAfterStop` (sim.md Part 7, invariant 4) with the deferred path is in `opportunity.qnt` and `turn_consent.qnt`. | Stub re-checks opt-out at replay; a scenario with STOP inside the quiet-hour deferral must show `send_after_stop` before the fix. |
| SD-411 | disputed | B | `sim-stub-*` (STOP and scheduled opportunity) | `opportunity.qnt` (spec) | STOP drops the member only from `inviting` opportunities, so reminders on a `scheduled` one still go and are suppressed by the channel. Same rule `noSendAfterStop`. | Stub drops the member from scheduled opportunities; scenario as for SD-410. |
| SD-494 | confirmed | D | `scenario-grade` (harness) | none | The `traveler` check reads presence once at the end, so it checks zero travelers and still passes. `bad_invitee` has the same escape. This is a check with no evidence count, not a state machine. | Each scenario check counts its evidence and fails at 0. |
| SD-497 | disputed | C | `game-world` (M-219) | new `sim_console.qnt` (P2) | `reset` is not in `WAITS_FOR_WORLD`, and `dispose` does not wait for `advancing`, so the old world's records reach the new projector (invariant W2 in observatory.md). One `await` is one interleave point; a model with `advance`, `reset` and `finally` actions finds it. | `reset` waits for the advance; an observatory integration test that sends `reset` during a long step. |
| SD-498 | disputed | A | `opp-projection` (M-156) | `staff_console.qnt` | `projector.ts` is used by the real source (`sources/real.ts`) and by the game. A second `meeting_scheduled` for the same proposal (a late joiner) increments `accepts` again for each member already `confirmed`. In `staff_console.qnt`, model the projector per opportunity row, and state `acceptsCountedOnce`: each member adds at most one accept per opportunity. | Projector counts an accept only on the first move to `confirmed`; a test in `packages/observatory/test/` that replays a re-reported meeting. |
| SD-502 | disputed | C | `lab-run` (M-220) | new `sim_console.qnt` (P2) | `save` is outside the `try`, so a throw leaves the run `running` for ever (LB3). A crash action at `save` finds it. | Move `save` into the `try` and catch the `exec` promise; a test that makes `save` throw. |
| SD-503 | disputed | C | `lab-run` (M-220), `staff-audit` | new `sim_console.qnt` (P2) | Two requests pass the route check, `record` yields, and the second `start` throws after an `ok:true` audit row. Two actors and one interleave point give the trace. | Check and start before the audit row, or audit the failure; a test with two concurrent lab requests. |
| SD-506 | disputed | D | `game-world` command input | none | `step` or `speed` with no number gives `NaN`, and `runUntil` drains the queue. Quint integers have no `NaN`. This is input validation. | Validate the command fields; an observatory test that sends `{type:"step"}`. |
| SD-509 | confirmed | D | `game-world` (text only) | none | `game.ts`, `lab.ts` and `docs/observatory.md` say slop runs with matching off; `PACK_READY` includes slop. No behaviour effect. | Text fix only. |

## Summary

| Class | Count | Ids |
|---|---|---|
| A: existing module owns the machine | 2 | SD-373 (`join_age`), SD-498 (`staff_console`) |
| B: simulator copy; production rule goes to an existing module as spec | 13 | SD-188, SD-189, SD-194, SD-408, SD-410, SD-411 (`opportunity`); SD-190 (`plan_run`); SD-193, SD-404 (`safety_trust`); SD-399 (`join_age`); SD-401, SD-402 (`turn_consent`); SD-406 (`matching_engine`) |
| C: expressible, dev tooling, new P2 module | 3 | SD-497, SD-502, SD-503 (`sim_console.qnt`) |
| D: not a state machine | 10 | SD-118, SD-195, SD-201, SD-278, SD-330, SD-338, SD-377, SD-494, SD-506, SD-509 |

## Recommendations

1. **Change the register.** Set the Quint module of SD-373 to `join_age` and of SD-498 to `staff_console`. The
   authors of those two modules add a witness (SD-373) and an invariant (SD-498).
2. **Production invariants from the simulator findings.** The authors of `opportunity.qnt`, `plan_run.qnt`,
   `safety_trust.qnt`, `join_age.qnt`, `turn_consent.qnt` and `matching_engine.qnt` state the rules in class B as
   invariants: `revealNeedsYes`, `cancelledIsFinal`, `noSendAfterStop` (with the deferred path and the scheduled
   state), `blockWins`, `lowestAgeMonotone`, no minor in any plan role, `exited` is absorbing for a peon candidate,
   an `awaiting` slot ends with its opportunity. These invariants do not find the class B defects. They give the
   specification that the judge and the worlds must match.
3. **Class B fixes are simulator fixes.** Each needs a sim gate or a JSON scenario that fails before the fix
   (docs/tests-policy.md). A Quint model of the judge as a monitor (`sim_judge.qnt`) is possible, but SD-190 and
   SD-399 are field-name and log-schema mismatches that a model of states does not see. Sim gates are cheaper and
   test the real code. I do not recommend that module.
4. **StubNetwork.** A `stub_network.qnt` would find SD-408, SD-410 and SD-411 quickly, because the stub has an
   explicit stage and status machine (sim.md M9). The stub never runs in production. A scenario per defect is
   enough. I do not recommend that module.
5. **New module `quint/sim_console.qnt` (P2, optional).** Machines `game-world` (M-219) and `lab-run` (M-220).
   State: `advancing`, `world` generation id, `projector` generation id, `labRuns: Id -> {state, done, total}`,
   `audit`. Actions: `advanceStart`, `advanceEnd`, `reset`, `dispose`, `labRequest`, `routeCheck`, `auditRecord`,
   `labStart`, `save`, `saveThrow`. Invariants: W2 (records of one world never reach another world's projector),
   LB3 (`running` ends), audit row matches the result. Witnesses: a reset with no advance in flight; a lab run
   that completes. It would find SD-497, SD-502 and SD-503. The observatory game and lab are simulation roles
   only and are not deployed for members, so this module comes after every P0 and P1 module. Integration tests
   in `packages/observatory/test/` are a cheaper fix path for all three.
6. **Class D.** No model. SD-118 needs a maintainer decision about the mirror file list, and any change to the
   pins goes upstream first. SD-373 also needs a decision (keep or remove the membership review hold) before code
   changes. The text fixes (SD-330, SD-338, SD-377, SD-509) are documentation work; the models must take their
   values from the code.

## What was not done

- No model was written or run. No code was changed. No test was added.
- I did not run the simulator to reproduce the class B defects. The source reports mark SD-188, SD-189, SD-190 and
  SD-194 as VERIFIED-RUN; the others are by reading.
- I did not check whether the real source re-emits `meeting_scheduled` for a late joiner in production (SD-498).
  The projector code path exists for the real source; the trigger in production is not confirmed here.
