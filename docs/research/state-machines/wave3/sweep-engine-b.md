# Wave 3 sweep: packages/engine and packages/capital (sweep-engine-b)

Branch read: claude/quint-state-machines (read-only). Models compared: quint/*.qnt on this branch, plus the
models that exist only on claude/formal-main (engine_rules, candidate_pool, chatjson_loop) and its drift
review (docs/results/2026-11-09-quint-drift.md, quint/drift.json). Hand-written. No code or model changed.
No model run was needed: every claim below comes from reading code and the model files (grep of the
model text for the state names).

Already known and not repeated here: the matching_engine open drift (per-question ask caps, the late-read
guard, soft onboarding questions), SD-060/121/224/226/228/415/418/440 carve-outs, SD-064 (relay age
half), the notify_capital residuals (SD-150 cap, SD-049 routes), D20 (judge cache not persisted across a
process restart), D9 (AskPlan.exclude never filled), and the two defects that claude/formal-main fixed
(rotateSession race, under-13 on the invite_only exit).

## 0. Coverage check of the engine and capital machines

| Machine (catalog id) | Model on this branch | Verdict |
|---|---|---|
| engine-pipeline M-100, hard-filter-chain M-101, slop-onboarding M-102, probe-flow M-103, judge cache M-161 (pass 2 only), slop-assignment M-162, job-posting/seat M-164/165 | matching_engine | covered (drift open on asks) |
| member-budgets-and-cooldowns (engine.md section 7) | none here; engine_rules on claude/formal-main | covered only after the formal-main merge |
| retrieval, group composer, friends planner | none here; candidate_pool on claude/formal-main | covered only after the merge |
| attention-compose M-163 | assigned to matching_engine, but not in its header or actions (no compose, cap, allowance, streak state); plan_run treats the allowance as an oracle deferral | NOT covered (model_gap) |
| slop-member-history M-169 | assigned to matching_engine, not in its header | derived, low value |
| exposure-debt M-198 | none (6.18: "a value with no machine") | NOT covered (new_machine, and a defect) |
| slop widen ask (no catalog id) | none (grep "widen" in quint/: no hit) | NOT covered (model_gap of matching_engine) |
| judge passes 1 and 3 caches, judge LLM budget | matching_engine has one cache; nothing has the budget | gap / new_machine (P2) |
| peon employer probation -> trusted (selection.ts) | none (grep "probation", "trusted": no hit) | NOT covered (P2, peon local only) |
| Clef rating version / ratings switch | photos_rating has the rating row, not the weights version or the switch | model_gap and suspected defect |
| bias monitor M-151/M-152 | runtime_ops | covered; bias-group-verdict stays arithmetic (6.18) |
| relay-item, relay-classifier-hook | relay | covered |
| capital intake, eligibility, vouch credit, plan attended, help, persistence | notify_capital Part B | covered |
| capital debit paths: plan_confirmed, plan_cancelled, plan_no_show, plan_ghosted, safety_flag, abuse_confirmed, member_removed (stake), organized, need_answered, review_completed, fraud_confirmed | notify_capital has only cJoin, cActivate, cLearnMinor, cPlanAccept, cSayGood, cFinalize (attended), cHelp, cForget, cRestart | NOT covered (model_gap); all eleven are emitted by network.ts in production |

## 1. new_machine

### N1. exposure-debt (M-198): carried per-member debt, P1 for fairness, with a defect (section 3, D1)

- Where: packages/engine/src/policy.ts:270-285 (`updateExposureDebt`), engine.ts:232-237 (prior debt into
  selection), engine.ts:281 (new debt in the run log), policy.ts:131-137 (networkPack lift, weight 0.05),
  packs/slop/assign.ts:48-53 (slop lift, debtWeight 0.02, debtCap 3); network.ts:3667 (carry),
  :3712 (field), :3959 (into the input), :4013 (app packs keep adults only), :979 (deleted on forget),
  :4965 / :5021 (saved and restored in the state blob).
- States per member: absent (0) | owed(d) with 0 < d <= 2 * exposureDebtCap. Minors have no row.
- Transitions per engine run: owed' = clamp(0, 2*cap, d + rel - got), where rel = best eligible score /
  threshold (<= 1) and got = number of selected proposals that name the member. A member not in `w.ids`
  this run (left the NYC set, in `declinedIds`, or not in the app pack's `adult` set, for example a
  temporary minorSignal) loses the row (only `w.ids` are written). Forget deletes it. A failed run keeps
  the old value. Restart restores it.
- Rules: AGENTS.md 11 "persist exposure debt" (holds). Policy comment (policy.ts:4-5, 270): debt is
  "carried debt + best viable relevance this run - proposals received". The SD-210 / SD-262 fix
  (world.ts:171 `billOnlySent`, network.ts:3945) says an item nobody was contacted about does not count
  against a member. The debt has no such rule (D1).
- Model: extend matching_engine (slop part). Add `debt: str -> int` (0..2), a `got` set from the daily
  run, and the existing review reject/expiry action. Invariant `debtPaidOnlyBySent`: a member's debt does
  not go down in a run whose only proposal for them was later rejected, expired or gated. Value: a small
  integer abstraction is enough; it shows D1 in two steps and pins the drop-on-leave rule. Scores stay
  oracles (rel in {0, 1}).

### N2. peon employer probation (implicit, derived), P2

- Where: packages/engine/src/packs/peon/selection.ts:58-69 (`companyTrusted`), :98-109 (`slateCap`:
  probation probes 3, or 10 for an urgent verified employer, split across the company's open seats).
- States per company: probation | trusted (an application answered; `probationUntil: "answered"`), and
  back to probation when the answered application leaves the history window (derived from history rows).
- Rules: code comments only (pacing, "no ghosted queues"). No PRD rule.
- Model: extend the matching_engine peon part with `trusted: bool` and a slate cap of 1 vs 2. Low value:
  peon matching runs locally only (AGENTS decision 4) and no safety rule depends on it.

### N3. engine judge budget (process-wide LLMBudget), P2

- Where: packages/network/service/service.ts:367-373 and :382 (one `LLMBudget` for all apps when
  NETWORK_ENGINE_JUDGE=1); packages/core/src/llm.ts:96-115 (`take` before each HTTP attempt, `charge`
  after the response); engine judgeCommon.ts:71-96 (a failure is not cached), engine.ts:174-200 (pass 2
  fails open to the pre-judge outcome).
- States: open(spent, requests) -> exhausted (absorbing until the process restarts; a restart resets it).
  While exhausted, every daily run tries topK judge calls, each throws at once, and proposals go out
  unjudged (runLog.judge.coverage shows it).
- Rules: service README "bounded real-model qualification"; AGENTS.md LLM section. The request limit is
  exact; the dollar limit can be passed by the calls in flight (concurrency 4 per app, all apps share it).
- Model: not worth a Quint module. The safety rules do not depend on the judge (hard filters ran first).
  An integration case on the budget overshoot is enough if a bound is wanted.

## 2. model_gap

### G1. matching_engine: the slop widen ask is not in the model, P2

- Where: packages/engine/src/packs/slop/index.ts:134 (asked once when the run degree <= 2 and the limit is
  under 25 miles, `askCounts.slop_widen` 0), generators.ts:23-24 and :79-83 (`runDegree`, a WeakMap
  written by the generator and read by `extraAsks` in the same World), network/service/packs.ts:127-130
  (a yes with no new distance sets radius 25), network.ts:3721-3733 (sendAsks sends the onboarding loop's
  question instead when the loop has one left), profile.ts:31-45 (askCounts from recentAsks).
- States: not_eligible -> asked (one-shot) -> widened (yes) | kept (no, other text, or silence). No path
  back to asked.
- Proposal: add it to the per-question ask-count change that the drift review already asks for
  (matching_engine.qnt nextMsg / basicsAskDue). Invariants: `widenAskedOnce`, `widenOnlyOnYes` (the radius
  grows only on `classifyYesNo == yes`, the consent rule of AGENTS.md 11).

### G2. matching_engine / plan_run: attention-compose on the wired plan-allowance path, P2

- Where: packages/network/src/network.ts:3166-3175 (composeMessage with `planAllowanceConfig`, the item's
  reviewState hard-coded "approved", a ledger of plan invites only), engine attention.ts:469-550 (gate
  order), :129-159 and :230-255 (ledger, two unanswered).
- Gap: catalog M-163 is assigned to matching_engine, but the model has no compose state; plan_run.qnt
  (lines 17-18, 562) treats the allowance as a nondeterministic deferral. So "at most 1 allowance invite
  per 7 days" and "no allowance invite while two plan invites are unanswered" are not checked.
- Proposal: extend plan_run with `planInvites: str -> List[int]` and the two gates as guards on
  planProbe. Invariant `allowanceCap`. Value: moderate; the gate order is pure and small.

### G3. matching_engine: judge passes 1 and 3 and cache growth, P2

- Where: engine.ts:163-223 (three caches: screen, judge, deep), judgeCommon.ts:34-46 (`JudgeCache`: an entry
  is deleted only when its own key is read again after expiry), network.ts:3705-3710 (all three caches
  are replaced when ttl changes).
- Gap: the model has one cache. Passes 1 and 3 are off by default (config.ts:183-185), so this is latent.
  A key whose revision changed is never read again, so it is never deleted: the map grows for the process
  lifetime (small: about topK entries per run per app).
- Proposal: no Quint change needed now; record the abstraction in the model header.

### G4. photos_rating: the rater weights version and the ratings switch, P1

- Where: packages/engine/src/packs/slop/appearance.ts:142-152 (`appearanceFacet` tags hold face, body,
  overall, conf, bodyType; no rater id or weights version), clef.ts:190 (`this.id` holds the weights
  version but is never stored), network/service/service.ts:1837-1845 (`writeRating` upsert), platform
  photos.ts:67-69 (CLEF_RATINGS off/on only chooses whether a rater exists), engine options.ts:185-188
  (`appearance.mode = "soft"`, independent of the flag), profile.ts:197 (every stored facet is read).
- Gap: the model has the rating row but no weights version and no switch. Two transitions are missing:
  (a) the weights change (placeholder to fitted, CLEF_WEIGHTS_PATH): stored ratings keep the old scale
  and are re-made only on a photo upload or delete; (b) CLEF_RATINGS=off: new ratings stop, stored ratings
  still feed matching. See D2.
- Proposal: add `weights: int` and `ratingsOn: bool` to photos_rating, a version on each rating row, and
  the invariants `ratingsMatchWeights` (a rating that feeds matching was made with the current weights)
  and `offMeansUnused` (no rating feeds matching while the switch is off). Both fail on the current code.

### G5. notify_capital Part B: the debit and stewardship paths, P2 (latent: runtime.ts:121 reader false)

- Where: packages/capital/src/ledger.ts:187-191 (safety_flag), :192-205 (member_removed: stake and vouch
  reversal), :206-211 (abuse_confirmed), :218-221 (plan_confirmed), :223-230 (plan_cancelled: free with
  notice, late after confirm = no-show), :232-238 (plan_no_show), :240-246 (plan_ghosted), :287-295
  (organized), :296-302 (need_answered), :304-306 (review_completed), :308-323 (fraud_confirmed clawback
  with dependent feedback), :369-378 (no-show forgiveness window). Emitters: network.ts:1250, 1324-1325,
  2499, 2655, 2951-2952, 2956, 2987, 3030-3031, 4337.
- Gap: the model header says these have "no production trigger". That is true for the fraud flags
  (`capital.flags` absent), but plan_confirmed, plan_cancelled, plan_no_show, plan_ghosted, safety_flag,
  abuse_confirmed, member_removed, organized, need_answered and review_completed are emitted and stored in
  network.capital_events in production, so replay must reproduce them (replayEqualsLive covers only the
  credit events).
- Proposal: extend Part B with plan states {accepted, confirmed, resolved} and actions cConfirm, cCancel,
  cNoShow, cGhost, cFlag, cRemoveAbuse. Invariants: `debitNeedsCommitment` (no no_show entry unless the
  plan was accepted and confirmed; no ghosting entry unless accepted), `stakeOnce`, `clawbackOnce`,
  `ineligibleNeverDebited` (holds on the code: every penalty path checks isEligible), and the existing
  `replayEqualsLive` over the debit events.

### G6. Cross-branch note

member-budgets-and-cooldowns, retrieval and the friends planner have models only on
claude/formal-main (engine_rules, candidate_pool). Until that branch merges, this branch has no model for
them; do not open new modules for them here.

## 3. suspected_defect

### D1. Exposure debt is paid by proposals that never reached the member (P2, fairness)

- Where: policy.ts:276-283 (`got` counts every selected proposal), engine.ts:281, network.ts:3667 (the
  value is carried as is), network.ts:3681-3686 (daily_cap, seat_without_manager and gateReason drop
  selected proposals after the debt is computed), network.ts:3945 (review reject, expiry and invalidation
  are excused for budgets only, through unsentProposalIds; world.ts:171).
- Trigger: slop, review mode human. Day 1 run: member X has prior debt 2; the engine selects X-Y, so
  debt(X) = 2 + rel - 1. The reviewer rejects X-Y (or the 12 h SLA expires). Day 2 run: the budget is
  excused (SD-210 fix), but the debt is not given back, so X gets less lift (slopAdjust debtWeight) than a
  member who got nothing selected. A member whose items are always rejected or cut by the daily cap
  loses the debt that the policy keeps to stop starvation. Same with a daily_cap drop (maxNewPerDay 20):
  the proposal never becomes an Opp, yet debt(X) drops by 1.
- Fix direction (for the owner): pay the debt from the items that were sent (the same unsent ids the
  budgets use, or a correction at the next run), with a sim gate on starvation for rejected members.

### D2. Ratings survive a weights change and the off switch (P1 if the founder reads "off" as off)

- Where: G4 above.
- Trigger (a): CLEF_WEIGHTS_PATH changes from the placeholder to fitted weights and the service restarts.
  Members rated before keep placeholder-scale scores (no version on the facet); members who upload after
  get fitted-scale scores; `slopProfiles` reads both, and the quintile floor (profile.ts:205) and the
  similarity term mix two scales. Nothing re-rates the old rows.
- Trigger (b): CLEF_RATINGS=off. `raterFromEnv` returns no rater, so no new rating is written, but the
  stored `appearance:` facets are still read and still change slop matching (mode "soft").
- Founder text: "CLEF_RATINGS ... `off` as off" (AGENTS 2026-10-09 item 5). If "off" means "the rater
  stops" only, (b) is intended; (a) is a defect in either reading.

### D3 (minor). A planned engine ask takes a proposal slot that the Network may not use (P2)

- Where: policy.ts:51-54 (each planned ask adds 1 to extraProactive), :102 (canTake counts it),
  network.ts:3721-3733 (sendAsks sends at most one ask per member per 7 days, and none while the member
  is awaiting or not active), network.ts:3715-3719 comment ("an ask ... does not count on the intro cap").
- Trigger: networkPack, romance.requireStatedPrefs on. Member X (budget normal 2 per 7 days) has a romance
  intent and no stated preferences, and is awaiting another answer. Each daily run plans the romance_prefs
  ask (lastAsk is -Infinity until one is sent), so X gets at most 1 proposal per run instead of 2, while
  no ask is sent. The engine and the Network disagree on whether an ask counts as proactive budget.
  Small effect; the slop pack's assign ignores extraProactive (assign.ts:76-79).

## 4. What was not done

- No quint run: no model was changed and the claims are about missing states, found by reading.
- Bias monitor arithmetic (biasMonitor.ts:27-50, minN 15 gate, zero memberMonths groups) left to
  arithmetic tests, as section 6.18 says.
- clef-fit, relayClefFit, testkit, learn.ts (off by default) and capital detect.ts / store.ts / view.ts
  (no production caller) were read only far enough to confirm they hold no live state.
