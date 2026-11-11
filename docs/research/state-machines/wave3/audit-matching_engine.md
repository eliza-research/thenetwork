# Audit: how completely quint/matching_engine.qnt covers its machines

Hand-written. Read-only audit. Code base: branch claude/quint-state-machines at f02196f (HEAD has every fix commit
the findings file lists). Line numbers are for this branch. Inputs: quint/matching_engine.qnt,
docs/research/quint-findings/matching_engine.md, section 6.16 of docs/research/2026-11-07-state-machines.md, the
drift review on claude/formal-main (docs/results/2026-11-09-quint-drift.md "matching_engine", quint/drift.json).

Probe files (scratchpad only): wave3/probe/me.qnt (model copy plus two audit invariants and one run),
wave3/probe/area.ts and area2.ts (bun scripts against the real engine code).

## 1. Summary

- The model's `safety` is mostly ghost flags. 17 of the 21 conjuncts are a flag that an action sets from a
  condition that the same action's guard already excludes. They cannot fail unless someone edits the guard.
  They record the fixes. They do not check interactions between actions (section 3, ME-ERR-1).
- The model has no approval-time recheck and no member drop. A member who states a minor age (or is held)
  after the daily run and before review is still probed in the model, and `safety` stays true (run
  `minorAfterReviewTest` in wave3/probe/me.qnt passes). The code is right here (reviewBlock, approvalCheck,
  dropMember), so this is a model gap, not a code defect.
- Five new suspected code defects (section 4). Two are P1 with a concrete repro on the real code:
  the stale `slop:area:` tag after an unknown zip (reproduced with bun), and unsent items still billed when
  they close from review without a "reject" or "expired" decision (reroll, drop, block, seat end) or when a
  probe never goes out.

## 2. Model gaps (code behaviour the model leaves out)

| # | Gap | Code | Could it break an invariant if added? |
|---|---|---|---|
| G1 | Approval-time recheck: `reviewBlock` refuses approve for a minor or a declined member and while matching is off; `approvalCheck` refuses opted-out, held, on-watch, busy, blocked pairs and re-runs `gateReason`; the item then closes "invalidated". `dropMember` closes a review item on minor signal, hold, STOP. | network.ts:2027-2036, 2052-2069, 2100-2114, 2725-2741 | Yes, it adds the real property. Add `noMinorProbed` / `noHeldProbed` (state predicates over `opp`). Today the model violates them with `safety` true (probe run `minorAfterReviewTest`). |
| G2 | Reroll decision (no alternate for slop: close "rerolled in review" plus markDeclined). | network.ts:2124-2148 | Yes: with reroll, `unsentNotBilled` (if widened to every item nobody received) fails on the code. See D1. |
| G3 | Probe expiry: PROBE_TTL (26 h) after send, PROBE_WAIT for a probe that never went out, "away" refusal, time retry, no common time. All go through replaceOrClose and close with an "expired" interaction. | network.ts:3591-3604, 2297-2299, 2442-2449 | Yes for billing (D1: a probe that never went out is billed). The 7-day reprobe after "expired" is already the engine rule. |
| G4 | Location is one bit (`loc`). The code has two tags (`slop:zip:`, `slop:area:`), an unknown-zip state, `slop_zip` vs `slop_location` questions and the anchor fallback for each. | extract.ts:829, 921-924; profile.ts:153-157; rules.ts:36-38 | Yes: `deletedFieldClearsTag` generalised to location fails on the code (D2). |
| G5 | Onboarding per-question caps and `skip` (drift item 0), late-read guard "adds a tag or moves the next reason" (drift item 1), soft questions and slop_zip/slop_seeks/slop_gender split (drift item 2), the founder default seeks=straight after two seeks asks. | onboard.ts:122-143; service/packs.ts:137-147; network.ts:1156-1168; extract.ts:861-863 | The cap makes `nextMsg` return "none" earlier, which makes `basicsAskDue` and `noBasicsAfterAnswer` reachable on more paths. The late guard narrows `memberSays`; `answersReachLoop` stays vacuous (G-ERR-1). |
| G6 | Engine asks (sendAsks): only for `stage === "active"`, no awaiting, once per ASK_EVERY_DAYS (7); the loop's next question replaces the engine's text. Engine hard-field asks (weekly, capped at maxAsksPerField 2), `slop_type`, `slop_widen`. | network.ts:3721-3732; slop/index.ts:121-138; options.ts:153-176 | It adds the lockout state of finding 6 (location answered without a location, asks capped): no invariant fails, but a liveness witness "every adult with core tags is eventually matchable or asked" would. |
| G7 | Daily-run framing: once per NY day in the run hour (`lastRunDay`), `matchingEnabled` switch, `maxNewPerDay` cap (`daily_cap`), player proposals first, seatRoute. The model allows any number of `slopDailyRun` per day. | network.ts:3514-3519, 3657-3690 | No; it narrows the model. Needed for budget-per-run reasoning with `perMemberPerTick` rounds (slop/assign.ts:107-120: one member can be selected twice in one run). |
| G8 | Engine-only slop holds: `review_hold` (verification, safety cues, trust_review from history: noShows, negativeFrom, blockedBy, eagerYes), `recently_matched` pacing after a liked date, `basics_pending`, `romance_opt_out`, lane. | slop/rules.ts:48-86 | No (they only remove pairs). They matter for liveness witnesses. |
| G9 | Booked-date lifecycle: opt-out window (handleDrop, cancel), reminders, check-in, no_show / completed interactions, `metRecently` (60 d) in the gate. | network.ts:811, 829-832, 3607-3640, 1851-1868 | Yes for peon: `metRecently` ignores the seat (D4), so an `engineAgreesWithGate`-style invariant for seats would fail. |
| G10 | Network romanceGate: verified adult age on the record, opt-in, stated `romance:seeks:`, mutual is/seeks. | network.ts:3871-3892 | No; it narrows. |
| G11 | Peon draft lifecycle: the 3-day sweep clears `awaiting: posting` (the draft is then unreachable), `expect()` replaces it with a probe, incomplete drafts (`ready: false`, at most 2 asks then dropped), "which post?" disambiguation, managerProblem refusal of a non-close draft. | network.ts:3508, 4392-4395, 4899-4927; jobs.ts:149-185 | No for safety (the model keeps drafts longer, a superset). SD-440's staleYes trace gets shorter windows in code. |
| G12 | Staff API: create a new posting (`POST /postings` without id); close of an already closed posting (rewrites closedReason, for example closed to filled or filled to closed); the read of `stored(id)` outside the unit (TOCTOU); verifyEmployer reads managerProblem and writes in two separate transactions. | postings.ts:127-158, 114-123 | Yes: with a non-atomic staffSave, `closedTerminal` fails (D3). `filledRecorded` is not checked against a later staff re-close. |
| G13 | Peon actors: one candidate only; no second candidate per seat, no openings decrease with items in flight, no manager drop ("manager unavailable"), no seat probe expiry (noAnswer). | network.ts:2510, 3591-3604, 4818-4828 | Yes: `seatCapacity` (made non-vacuous) fails (D5). |
| G14 | Judge cache: in-process field of the ConsentNetwork object (not in exportState), so it is lost at restart and not shared by replicas; entries are also invalidated by profile revision. | network.ts:3705-3711; runtime.ts:154 | `judgeCacheReused` would fail after a restart action. Cost only (judge is off by default). |
| G15 | Probe-flow modes: `parallel` (double_opt_in, order parallel) and group quorum; a member's second answer overwrites the first. | attention.ts:779-830 | No (checked by hand: every mode ends in revealed or closed once all answered). |
| G16 | Machines in the plan (section 6.16) not in the model: `attention-compose` (gate order) and `slop-member-history` (interactions, feedback, histories). | attention.ts compose path; slop/profile.ts:232-278 | History feeds trust_review holds (G8) and peon history (SD-441). |
| G17 | Unit atomicity is right for the network unit (advisory lock, runtime.ts:3-5), but dailyRun awaits the engine (LLM judge) inside the unit; staff postings and verify run partly outside it (G12). | runtime.ts:3-13; network.ts:3665 | See G12. |

## 3. Model errors (the model does something the code does not, or an invariant proves nothing)

ME-ERR-1 (P0). Ghost-flag invariants equal to the negated guard. Each flag below is set by an action from a
condition that the action's own guard makes false, so the invariant holds by construction:

- `minorNeverCandidate`, `heldNeverCandidate`: `matchedMinor/matchedHeld` need `gateOk`, and `gateOk` needs
  `netMemberOk` (adult, not held) (qnt:352, 363-367).
- `locatedBeforeMatch`: `matchedUnasked` needs `locUnasked`, but `slopDailyRun` needs `enginePairs`, which needs
  a loc tag or `locSilent` (qnt:151-156, 365).
- `budgetAcrossAssign`: `engineCount < BUDGET_N` in `engineMemberOk` (qnt:154, 369).
- `engineAgreesWithGate`: `enginePairOk` has `not(pairHistory(p))` (qnt:165, 368).
- `judgeCacheReused`: `judged` keeps only pairs with age >= TTL, the flag looks for age < TTL (qnt:355, 370).
- `activityFitsSlot`: the guard `activity != "hike" or slot == "day"` (qnt:397, 400).
- `askTerminates`: the guard `basicsAsks < MAX_ASKS` (qnt:335).
- `answersReachLoop`: `lostAnswer` needs "not read and pendingAsk and o2 != o", which is exactly `late` (qnt:284-288).
- `engineNeverSelectsHeld`, `declineScopedToJob`: `engineSeatOk` already has `not(mgrHeld)` and
  `not(seatDeclined(id))`, so `gateOk` is always true (qnt:187, 524-531).
- `confirmedInOwnThread`: `postings` changes only when `src == "sms"` (qnt:465-471).
- `filledRecorded`: `saved.reason` is "filled" exactly when `said == "filled"` (qnt:460, 472).
- `closedTerminal`: `saves` needs `not(isFinal)`, and `staffSave` needs `prev.status == "active"` (qnt:456, 465, 494).
- `openingsPreserved`: `openings` and `stated` are written together everywhere, so they never differ.
- `acceptedPostingPersists`: `Draft.mustDup` is written (qnt:421) and never read; `saved.status` is never "none"
  (see ME-ERR-2).

Effect: the model shows each fix as a guard, but a random or bounded check cannot find a new interaction
defect through these values. Proposal: replace each ghost flag by a state predicate that does not mention the
guard (for example "every opp in review/probing/scheduled has two adults who were not held when contacted",
"every opp created on day t has engineCount at t-0 < BUDGET_N computed from billed"), and make the engine an
adversary: let `slopDailyRun` pick any pair that the code's engine rules (written from rules.ts/filters.ts, not
reused from the gate) allow, so that the gate is the system under test.

ME-ERR-2 (P1). `acceptedPostingPersists` / `dupMustTest` are vacuous: the SD-227 duplicate must-have is a
field nobody reads, and the save always produces a status. The test passes with or without fix 6e5a4c4.
Proposal: model the save as a set of facet ids and fail the unit when two ids repeat
(postingFacts, jobs.ts:228; savePosting insert, postings.ts:33-35).

ME-ERR-3 (P1). `seatCapacity` is vacuous: one candidate, and a posting's openings never reach 0 in the model
(storedOpenings returns 1 for a closed post, qnt:177). It cannot see an over-fill (D5). Proposal: two
candidates, openings 1..2, manager update that lowers openings, and count booked seat items per posting.

ME-ERR-4 (P2). `planSeatHonorsHoldout` checks the model's own pure function `planReason` against the
nondeterministic `plan` facts. It is a tautology of qnt:200-201; it does not read plans.ts or filters.ts. It
also leaves out safety_hold, paused, category_opt_out, only_when_asked, and the host/guest forgive sets
(plans.ts:146-151). Proposal: drop it here (plan_run.qnt owns plans) or model memberReason's rule list as data.

ME-ERR-5 (P2). The `flow` part checks `ProbeFlow`, which has no caller outside attention.ts (grep of packages,
deploy, tests: only packages/engine/src/attention.ts). The production consent flow is the Network's Opp
stages, modelled by `slopReview`/`slopProbe`. `witness_flowRevealed` and `probeFlowProgresses` say nothing
about production. Proposal: say "library only, unwired" in the header and findings.

ME-ERR-6 (P2). `unsentNotBilled` looks only at `stage == "rejected"`. Items closed from review by other paths do
not exist in the model, so the rule "proposals the Network never sent neither count" (world.ts:170) is checked
on one path only (D1).

ME-ERR-7 (P2). `slopReview` approve appends a send for `p._1` unconditionally. In code the first probe can be
refused at send (quiet hours, away, budget) and wait for PROBE_WAIT; nothing is sent then (network.ts:2297,
3596). The model's `sentTimes` over-counts.

## 4. Suspected new code defects

### D1 (P1). Items closed without a reject or expiry decision are billed although nobody was contacted

`engineInput` builds `unsentProposalIds` only from `review.decision === "reject" | "expired"` or
`review.invalidated` (network.ts:3944-3945). Other closes from review set no decision:
`reroll` with no alternate (network.ts:2134-2138; every slop item has no alternates), `dropMember` on hold,
STOP or opt-out (network.ts:2739), `callOffPair` on a block (network.ts:1534), `endSeat` for a seat item in
review (network.ts:4835-4845). A probe that never went out (PROBE_WAIT, "away") closes as "expired" from
probing with an empty `contacted` set (network.ts:3596-3603, 2297).
`close()` writes no interaction for a review close (network.ts:2718), so the item is not "resolved".

Trigger: day 0 slop daily run proposes (a, b). The reviewer picks "reroll" (staff API accepts it,
service.ts:142). No alternate: the item closes, nobody is contacted. Next daily run: `recentProposals` still
holds the item (30 days, network.ts:3942-3943), `billOnlySent` does not drop it, so a and b each have one
proposal on their 2-per-7-days budget (world.ts:216-224) and the pair is in `activePairs` for 7 days
(world.ts:174-179). Same with b sending STOP while the item waits for review: a is billed.
Fix (in scope, extends the SD-210/SD-262 fix): build `unsent` from `o.contacted.size === 0` (or
`o.closedFrom === "review"` plus never-sent probes). Add an integration case next to
engine-unsent.integration.test.ts with reroll and with a hold during review.

### D2 (P1). A move to an unknown zip keeps the old neighborhood tag, so the member is matched at the old place

`slopOnboardTags` pushes `slop:zip:` into `replaces` only when the new location has a zip, and `slop:area:`
only when it has an area (extract.ts:921-924). An unknown zip has no area (`{zip, known:false}`, readLocation
extract.ts:542-548; merge rule extract.ts:829). The profile prefers the area when the zip is unknown
(profile.ts:154-157), so `cell` is the old area and `zipUnknown` is false; `missingFields` asks nothing
(rules.ts:36-38).

Reproduced (wave3/probe/area.ts, area2.ts, real engine code): "I live in Williamsburg" gives
`slop:zip:11211, slop:area:williamsburg`; then "actually I moved, my zip is 07030" gives tags
`slop:area:williamsburg, slop:zip:07030`; the profile has `cell` = the Williamsburg cell,
`zipUnknown: false`, `missingFields = []`. The member is proposed within radius of Williamsburg. The
onboarding loop asks `slop_zip` at most twice (onboard.ts:133) but matching does not wait (SD-060).
Fix (in scope, same class as SD-061): location is one field; when `p.location` is set, push both
`slop:zip:` and `slop:area:` into `replaces`. Add a corpus row or an integration case
(slop-onboard-tags.integration.test.ts).

### D3 (P1, peon local only, so lower order). Staff save can reopen a posting closed in the meantime

`POST /postings` with an existing id reads `stored(id)` in its own transaction (postings.ts:127, 140), checks
`prev.status !== "active"` there (postings.ts:143), builds `status: "active"` (postings.ts:151), then runs
`applyPosting` in a later unit (postings.ts:156). `applyPosting` does not check the stored status
(network.ts:4866-4877), and `savePosting` upserts `status = excluded.status` (postings.ts:28-31).

Trigger: staff send `POST /postings {id: p, managerId: m, payMax: 130}`; the handler reads p as active. Before
its unit gets the network lock (for example while a daily run holds it), manager m's "close my data analyst
post" + "yes" commits in a turn unit and endSeat runs. Then the staff unit writes p as active again: the
SD-114 reopening, through a race. The SD-114 fix (ce667b2) covers the sequential order only.
Fix: re-read the stored posting inside the unit (`storedPosting` in applyPosting, or pass `expectStatus`)
and refuse `posting_closed` there. The same pattern applies to `close` (postings.ts:132-134: a stale prev is
written back, which only loses the other writer's fields).

### D4 (P2). peon: a completed intro for job A blocks job B of the same manager for 60 days, and the engine keeps picking it

`gateReason` -> `pairBarred(candidate, manager, true, seat)` -> `pairHistory` keys `declined` by seat, but
then calls `metRecently(a, b, 60)` with the manager id and no seat (network.ts:1851-1853, 1866-1868). The
check-in interaction lists the manager as a participant (network.ts:2802). The engine sees that
interaction through `seatView` as (candidate, seat A) only (network.ts:4790-4797), so (candidate, seat B) is
eligible and selected every run; the gate drops it with `pair_history` every day (the SD-223 / SD-439 starvation).
Trigger: candidate c and manager m complete an intro for posting A (check-in answer "it went well"). Next
daily run: engine proposes (c, seat B); gate: pair_history. Repeats for 60 days.
Fix: in `pairHistory`, when a seat is given, read `metRecently` for the seat item only, or add avoid edges for
the met pairs in packInput as for `declined`. Founder or maintainer confirmation may be needed on whether a
second job of the same manager should be offered.

### D5 (P2). A seat can be over-filled when openings go down with items in flight

seats.ts:19-20 says "a seat is never over-filled: one member per opening". The engine counts in-flight
items (seatFills, seats.ts:100-111), but nothing checks capacity when the manager says yes, and
`applyPosting` ends seat items only for a closed posting (network.ts:4875). `checkSeats` ends only items that
are not scheduled, at the next tick (network.ts:4818-4828).
Trigger: posting p with 2 openings; candidates c1 and c2 both said yes (two items in probing, waiting for the
manager). Manager: "update my data analyst post: 1 opening", "yes" (saved, items untouched). Manager answers
"yes" to both probes before the next tick: two intros booked for one opening.
Fix: in applyPosting for an active posting, run the capacity part of checkSeats at once, or check capacity on
the manager's yes. Low harm (the manager said yes twice); report P2.

## 5. Open carve-outs

| Item | State | Fixable now in scope? |
|---|---|---|
| SD-060 `readBackBeforeMatch` | skipped, founder decision | No (founder decision; AI-assistant onboarding has no thread read-back). |
| SD-418 `readBackHasPath` | not reproduced | No harm while nothing reads `confirmed`. Keep. |
| `locatedBeforeMatchStrict` (SD-209 7-day fallback) | by design | No (founder decision). |
| Finding 6: location answered without a location: never silent, asks capped at 2 (engine maxAsksPerField and loop MAX_ASKS_PER_QUESTION), so `needs_location` forever | observed in the model, not run against the code | Yes, as a bug fix with a test: count an answered `slop_location` ask that left no location as silent after 7 days (profile.ts:133-145 `answeredAny`), or let the location ask come back after the cap with a long interval. Needs an integration case first. |
| `noBasicsAfterAnswer` (SD-419 residual) | bounded, not removed | Yes: `needsBasics` (rules.ts:43-45) can treat an answered `slop_basics` ask as answered (recentAsks `answeredAt`), so "no dealbreakers" stops the ask. A reproduced annoyance; small change. |
| SD-121 `activeIsLive` | skipped, founder decision | No. |
| SD-224 `candidatesWritable` | skipped, new scope | No (peon candidate onboarding is new scope). |
| SD-226 `postedCanMatch` | skipped, founder decision | No. |
| SD-228 | skipped, missing feature | No. |
| SD-415 | skipped, recorded design decision | No. |
| SD-329 | not reproduced (copy) | No (copy changes are not accepted). Note: readBackClose (jobs.ts:126) says intros "not done yet end"; endSeat keeps scheduled ones, which matches "done" only if "booked" means done. |
| SD-440 `inFlightMatchesPosting` | skipped, founder decision and copy | No. The model's draft never expires (G11), so the window is larger in the model than in code. |
| Drift items 0-2 (formal-main drift review) | open in the model | Yes, model work only (per-question `askCounts` in `Ob`, `skip`, late guard on "new tag or next reason moved"). |
| SD-062, SD-208, SD-310, SD-416, SD-417, SD-421 | in the plan's scope list (6.16), absent from the findings tables | Refuted in the register; the findings file should list them as refuted so the scope list closes. |

## 6. Checks run

- `quint test wave3/probe/me.qnt --match minorAfterReviewTest`: passes. The run proposes (a, b), then b
  states a minor age, then review approves; it expects `not(noMinorProbed) and safety`.
- `bun wave3/probe/area.ts` and `bun wave3/probe/area2.ts` (from /Users/nubs/thenetwork, no LLM calls):
  output in section 4, D2.
- No repo file changed. No git command that changes state.
