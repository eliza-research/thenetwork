# Audit: quint/engine_rules.qnt coverage

Read-only audit, 2026-11-11. Inputs read: quint/engine_rules.qnt (265 lines), quint/drift.json (engine_rules entry, lines 75-80), docs/formal-coverage.md rows 144-145 and 171-172, docs/results/2026-11-09-quint-drift.md (engine_rules section), docs/results/2026-11-08-lemmascript-frontend.md:163. There is no docs/research/quint-findings/engine_rules.md. Code read in full: packages/engine/src/packs/network/rules.ts, rulesCore.ts, packages/engine/src/packs/slop/geo.ts, geoCore.ts. Code read in part: engine/src/world.ts:130-310, filters.ts (all), policy.ts:20-200, geo.ts (cityBucketGeo.overlap), packs/slop/{assign.ts:60-110, generators.ts:55-105, profile.ts:281-289, zips.ts:443-450, rules.ts:1-80, index.ts}, packs/friends/rules.ts, packs/peon/rules.ts:20-50, network/src/network.ts (engineInput 3966-4010, close 2710-2752, replaceOrClose 2530-2563, probe no 2440-2466, dropMember 2755-2778, overBudget 4514, send 4165-4180), network/service/packs.ts:70.

Probe runs: `bun run quint:check quint/engine_rules.qnt` gives all ok (typecheck, 4 witnesses, test, safety). Four mutants in the scratchpad (no category cooldown guard, no pair cooldown guard, one-way radius, no budget guard) each give `[violation]` on `safety` in under 2 s. So the invariants have force against their own guards. The problems are about what the model leaves out and what it claims.

## Model errors

### ME-1 (P1). pairOk combines rules from two packs, and no pack runs that combination
- engine_rules.qnt:105-109 puts networkPack's pair rules (pair_cooldown, romance_incompatible, from network/rules.ts:53-72) together with slopPack's radius geo (slop/geo.ts:56-63).
- networkPack uses `cityBucketGeo` (network/index.ts:51), which has no `pairReason`. slopPack uses `slopPairRules` (slop/rules.ts:69 on: already_introduced/reprobeReason, agesMutual, mutualSeek, dealbreaker), not `romancePairReason` and not `pair_cooldown`.
- Result: `radiusMutual` holds for a pack that does not exist. `romanceMutual` and `pairCooldownHeld` say nothing about slop. Slop's real mutual-preference rules (packs/decisions.ts agesMutual, mutualSeek, reprobeReason) are not covered by this model.
- Fix: split the model into a networkPack instance and a slopPack instance. The slop instance takes the slop pair rules plus the radius. Or document in the header that each decision is checked alone, and add a slop pair section that calls the decisions.ts cores.

### ME-2 (P1). budgetHeld depends on re-checking before each send, which the rule does not do
- The model's `send` re-reads `recentSends` each step (engine_rules.qnt:90, 99-101, 136-142). The code's rule reads a snapshot that is built once per run: `recentProactive` (world.ts:226-236, 301). It gets `extraProactive` only through `candidateReason(w, c, usage)`. No caller passes `usage` (engine.ts:130 calls `candidateReason(w, c)`, filters.ts:189), so `c.extraProactive` is always undefined and the rule always gets extra = 0.
- Within one run, the budget is held only by policy.ts `selectOnce.canTake` (policy.ts:125) and `guardSelection` (policy.ts:93-99), or by slop's `budgetLeft` (assign.ts:79), and these are modeled in matching_engine (`budgetAcrossAssign`).
- The code also counts proposals, multiplied by participants, created in the state period (world.ts:229-236), not sends. In the model, a proposal uses no budget, and a send involves no pair. The coupling the code enforces is never checked: each participant of a proposal is within budget.
- Result: `budgetHeld` proves a per-send property that rules.ts alone does not give. The header says "a proactive send asks the member rules", which is not how the code calls the rule.
- Fix: model the rule as a check against a run snapshot plus a selection step (or cite matching_engine for the batch), and charge each proposal against both members' budgets.

### ME-3 (P1). The minors invariant is weaker than the rule
- K is a minor, but `send("K", c)` and `propose("A","K","social")` are both enabled. `memberOk` and `pairOk` have no core prefix (filterCore memberCore/pairCore, filters.ts:60, 73). `romanceAdultsOnly` (engine_rules.qnt:200) checks only the romance lane.
- The code rule is "minors are never matched in any lane" (filters.ts:175, 73; core policy). The model reaches states with a social proposal that includes a minor, and no invariant fails.
- Fix (in scope, about 5 lines): add `not(minor.get(a)) and not(minor.get(b))` as the pairCore prefix in `pairOk`, add the same check for `m` in `memberOk`, and add `minorsNeverProposed = proposals.forall(p => not(minor.get(p.a)) and not(minor.get(p.b)))` to `safety`. Keep `romanceAdultsOnly` as the defense-in-depth check by testing `romancePairOk` on its own, which the runs already do.

### ME-4 (P2). pairDecisionSymmetric cannot fail
- engine_rules.qnt:212. `samePair` is symmetric, `romancePairOk` is a symmetric conjunction, and `marketMutual` is called with `absDiff` and both limits. So the invariant is true by construction for every state. It repeats the LemmaScript `ensures` (rulesCore.ts:179, geoCore.ts:17, 30) and adds no force. A mutant has to change the pure defs to break it.
- Fix: keep it as a test, or remove it from `safety` and state it as a `run` assertion.

### ME-5 (P2). The meaning of a "decline" in the header does not match what network.ts writes
- Header line 33: "A send decline stands for a declined or an expired item". In network.ts:2749, `outcome` is "declined" only when `reason === "declined"`. That reason comes from `dropMember(id, "declined")` in `forget` (network.ts:969), and it reaches `close(o, "declined")` only in the review stage (2773), where `wasReview` drops the record. So in practice the Network never writes "declined".
- A probe that ends after a no is written as "expired" (wasProbing). A probe "no" sets status `unavailable`, not `no` (transitions.ts:122-125), so `declinedBy` is empty. world.ts:167-169 then gives a category cooldown to every remaining participant.
- In the model, only the member who got the send declines (engine_rules.qnt:144-150), so the model cannot show SD-new-B below.

## Model gaps (code that the model leaves out)

| # | Gap | Code | Could adding it break an invariant? |
|---|---|---|---|
| G1 | Participation state: per-state budgets (open 4/7, normal 2/7, quiet 1/30, receiving 2/7, paused 0/7), and state changes inside a window | config.ts:121-126; world.ts:231-233 (period per current state); rules.ts:26 | budgetHeld as written (one fixed WINDOW/LIMIT) fails after a quiet-to-open change. That change is allowed by design, so the invariant must be stated per state at send time. It is not a code defect. |
| G2 | Unsent proposals do not count (billOnlySent: review reject, expired or invalidated) | world.ts:180-182; network.ts:4004 | No. It removes usage that was never sent. |
| G3 | The budget is billed from the opp's current participants: a member who is replaced out is no longer counted, and an alternate who is swapped in is billed from the opp's `createdAt` | network.ts:2547-2550 (replaceOrClose), 3896 toProposal (`participants: [...o.participants]`) | Yes. See SD-C. |
| G4 | Asks (planAsks extraProactive) count only in their own run. `recentAsks` never adds to `recentProactive` | policy.ts:38-57, world.ts:226-236 | Yes, for a budget that counts every proactive message. See SD-D. |
| G5 | Group interactions cool every pair in the group (world.ts:161-165). Category cooldown goes to `declinedBy`, or to all participants when it is empty; "expired" goes to all participants; "cancelled" starts no category cooldown | world.ts:161-174 | categoryCooldownHeld stays true, but the model's "decline only by the recipient" is too narrow. See SD-B. |
| G6 | Member rules that are not in the model and not in the OUTSIDE list: state_receiving_contributor, category_opt_out, romance_opt_out (member level) | rules.ts:18-20 | No. They only refuse. |
| G7 | The candidate pre- and post-rules: group_size, romance_group, high_risk, and home_entry_rule (which also WRITES `c.safetyClass = "medium"`, a side effect inside a filter). Also networkHardGate (`w.get(id)!` throws on an unknown id). None of them is listed under OUTSIDE | rules.ts:74-111 | No safety invariant is affected. The side effect is a hidden write that the model does not show. |
| G8 | Rule ORDER is the funnel contract ("first failing reason", rules.ts:2). The model ANDs the guards | rules.ts:2-5; filters.ts:63-66, 79-84 | No safety effect. Funnel counts are not checked. |
| G9 | Geo: several markets, `visiting` (datingMarkets returns only the visited markets), a visitor at the market's anchor cell, a member with no cell at the anchor (SD-209), the limitMiles fallbacks (asks off gives unknownDefaults 25 mi; silentFallback 5 mi), `distance_unknown`/`unknown_member`, `cellMiles = Infinity` | geo.ts:17-38; profile.ts:281-289; zips.ts:443-445; options.ts:156-170 | Yes. See SD-A: the market that passes the radius check need not be the city that is proposed. |
| G10 | The facts are fixed at init (age/minor, opt-ins, admits, positions, limits). In the code, all of them change (a lower stated age makes a member a minor, romance opt-out, a new zip or limit) | world.ts rebuilt per run; filters.ts:231-245 sendTimeReason | romanceMutual and radiusMutual are stated over all past proposals, so they would fail on old proposals after a fact changes. Restate them "at proposal time" and model the send-time re-check (sendTimeReason) for the lane opt-in and minors. |
| G11 | Time: a day is one tick. The code uses ms, interactions carry `at` = close time (days after the send), `age < 0` proposals are skipped for the budget, and a future-dated interaction cools a pair (pairCooling has no `at <= now` check) | world.ts:228; rulesCore.ts:116 | Only with clock skew. The Clock is monotonic in the network. |
| G12 | negative_feedback_cooldown (max `at`, wouldMeetAgain=false), active_duplicate (pending/accepted interactions for 4x activeProposalDays, unresolved recent proposals), dealbreaker, quotas, contribution budget, only_when_asked, reliability holdout, requireStatedPrefs | rules.ts:21-41, 55-71; world.ts:142-147, 166, 188 | They only refuse, so the safety invariants still hold. Each is listed under OUTSIDE (except active_duplicate's 4x window). requireStatedPrefs is a one-boolean addition to romancePairOk. |

## Open carve-outs

- **OC-1 (P1, fix now, ledger only).** The drift ledger for engine_rules (drift.json:75-80) maps only rules.ts and geo.ts. The decisions are in rulesCore.ts and geoCore.ts (their coverage rows say "see its shell", formal-coverage.md:145, 172). The derived state the model abstracts is in world.ts:161-174 and 226-236 and network.ts:2749. slop/profile.ts (datingMarkets/cellIn) and friends/rules.ts reuse NETWORK_* rules. A change in any of these does not mark engine_rules stale. Fix: add rulesCore.ts, geoCore.ts, world.ts, slop/profile.ts and friends/rules.ts to the engine_rules ledger, then re-stamp.
- **OC-2 (P2, fix now).** No findings file exists and the drift list is empty. The 2026-11-09 drift review reported "all decisions match" and did not see ME-1, ME-2 and ME-3. Write docs/research/quint-findings/engine_rules.md with ME-1 to ME-5 and set `drift` for the items this round does not fix.
- **OC-3 (P2, fix now).** peon/rules.ts:26-30 computes the interruption budget inline (`mi.recentProactive + extra >= limit`) and does not call `rulesCore.interruptionBudgetReason`. That breaks the AGENTS.md rule that shipping code calls the proved function. It is the same decision, so swapping in the core call changes no behavior.
- **OC-4 (P2).** The OUTSIDE list (engine_rules.qnt:37-41) leaves out quotas, contribution, only-when-asked, reliability, negative feedback, requireStatedPrefs, dealbreakers and active duplicates. Each is a one-guard addition to memberOk/pairOk with the proved core as a pure def. requireStatedPrefs and negative feedback are the cheapest to add and the most relevant to safety.
- **OC-5.** These belong to matching_engine and are not repeated here. SD-207 (slopAssign ignores asks and budgets: assign.ts:76-79; the guard gives ownCaps `picks.length`, policy.ts:98) is disputed and mitigated by network.ts:4178. SD-223 is the slop reprobe 7 days against the Network's 60 days. SD-209 is the anchor-cell fallback.

## Suspected defects (new)

### SD-A (P2). A slop proposal's city can be a market where the mutual radius was never checked
- geo.ts:56-63 refuses only when NO mutual market exists. The generator sets `preferredCity` to the closest mutual market (slop/generators.ts:72-75, 97).
- candidateReason then calls `w.overlap(..., c.preferredCity)` (filters.ts:207). cityBucketGeo.overlap (engine/src/geo.ts:40-53) only PREFERS that city. When it lacks `minOverlapHours`, overlap returns another city. filters.ts:209 rejects a different city only when `c.fixedWindow` is set, and slop intros have none. So `c.city` becomes a market where the pair was not radius-checked, or where one member does not date at all.
- Trigger (slop default config cities ["sf","nyc","la"], slop/index.ts:40): A and B have home NYC, cells 15 mi apart, limits 5 mi, and scope `{mode:"multi", markets:["sf"]}` (or `visiting:["la"]` with an LA trip shorter than minOverlapHours). Their presence in the window is NYC only. datingMarkets returns ["sf"]. Both are at the SF anchor, d = 0, so geo.pairReason is null. overlap finds no SF hours and returns NYC. `c.city = "nyc"`, and the intro is proposed in a city where they are 15 mi apart against 5 mi limits.
- Production slop uses `cities: ["nyc"]` (network/service/packs.ts:70), so it cannot occur there today. It is latent for any multi-city slop network and present in the sims.
- Fix: in candidateReason, reject when `c.preferredCity` is set and `ov.city !== c.preferredCity` (drop the `c.fixedWindow` condition for radius packs), or have geo.pairReason take the chosen city. A slop sim gate is needed.

### SD-B (P2). The category cooldown falls on members who did not decline (the requester, or a member who said yes)
- After a probe "no", status becomes `unavailable` (transitions.ts:125, network.ts:2464-2465). replaceOrClose with no alternate calls `close(o, "no one available")` (network.ts:2562). Because wasProbing is true, the outcome is "expired" and `declinedBy` is empty (network.ts:2749).
- world.ts:167-169 gives "expired" to `r.participants`. So the requester R, who asked for this (`replaceOrClose` never replaces the requester, 2535), or a member who already said yes, gets a 7-day `category_cooldown` (rules.ts:33-35, config categoryDeclineDays 7) in that category.
- Trigger: R makes a request in category hobby. The Network probes X. X replies "no". No alternate is left. In the next engine run, every candidate for R in hobby fails `category_cooldown` for 7 days, although R declined nothing.
- The same happens when A says yes and B stays silent until the probe expires.
- The rulesCore comment says "A member who declined the category". Fix: write `declinedBy` from the members whose probe answer was no (keep a no marker instead of `unavailable` for the record, as seats already do at 2465), and have world.ts give "expired" only to `noResponse` members.

### SD-C (P2). A member replaced out of a probe loses their engine history (budget, category cooldown, pair interaction)
- replaceOrClose removes X from `o.participants` (network.ts:2547-2550 for a swap, 2554 for a group). toProposal (network.ts:3896) and the close record (2749) use only the current participants.
- So X's proactive probe no longer counts in X's `recentProactive` (world.ts:229-236). X's no gives X no category cooldown. The pair X-requester has no `pairInteractions` record.
- Trigger: the engine proposes A-X (social). X says no. Alternate Y is swapped in. In the next run, X's budget and category show no use, and the engine can propose X in social again at once.
- Mitigations: network.ts markDeclined (2457) and pairBarred keep the pair out, and overBudget (4178, m.proactive) refuses the send. The engine-level rules ME-002 and category cooldown are still wrong in their input, and any caller without those mitigations (sims) is exposed.
- Fix: record a per-member interaction (outcome declined, declinedBy [X]) when a member is replaced, and keep `contacted` members in the billed participant set.

### SD-D (P2, mitigated in production). Asks are counted against the budget only in the run that plans them
- planAsks (policy.ts:51-54) adds to `extraProactive` for that run only. world.ts builds `recentProactive` from `recentProposals` alone (226-236). `recentAsks` is used only to avoid repeating an ask.
- policy.ts:37 says an ask "needs the same availability and budget as an invitation".
- Trigger (normal state, 2 per 7 days): on day 0 the member gets 1 proposal. On day 1 the member gets the romance_prefs ask (allowed, 1 + 1 <= 2). On day 2, `recentProactive = 1`, so canTake allows 1 more proposal. That is 3 engine-planned proactive messages in 7 days.
- Production is mitigated by network.ts overBudget at send time. The engine's own guarantee and the sims are not.
- Fix: count `recentAsks` in the period in world.ts `proactive`.

### SD-E (P2, local-only app). friendsPack has no pair cooldown, active-duplicate, category-cooldown or interruption-budget rule
- friends/rules.ts:45-61 keeps from network rules only category_opt_out, only_when_asked, reliability_holdout, negative_feedback_cooldown, unknown_member and dealbreaker. No friends file reads `pairInteractions` or `recentPairs`.
- A declined friends pair, or a pair that is still pending, can be generated again in the next run. Selection (policy.ts:125) still applies the budget.
- Mitigated only if the ConsentNetwork gate (pairBarred, busy) runs. friends matching is local only (AGENTS.md decision 4). No comment says that leaving these out was intentional.
- Fix: add netPair("pair_cooldown") and netPair("active_duplicate") to friendsPairRules, or document why they are left out.
