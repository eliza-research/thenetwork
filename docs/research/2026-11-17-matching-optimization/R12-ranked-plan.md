# R12. One ranked plan (15 items) across R1 to R11

**Goals.** The plan is chosen so that it:
- keeps every search exact, or gives an honest reported bound;
- makes Friend and Date searches cheap at 100,000 members;
- improves ranking quality where the simulator can show it, and says so where it cannot;
- adds the missing signifiers;
- lets a new member join without a full recompute;
- installs benchmarks that fail on quadratic growth.

**Status of the numbers.** Every effect below is an estimate from code reading and from measurements at N ≤ 5,000 under heavy machine load (R10). No 100k figure in any report was measured on an idle machine. Items 1 and 2 exist so that every later item is measured, not assumed.

**Effort.** S is under a day, M is days, L is a week or more.

**Proofs.** Each item that changes a decision adds or updates its LemmaScript law and its Quint model, and stamps the drift (AGENTS.md).

| # | Item (source) | Expected effect | Measure | Depends on | Effort |
|---|---|---|---|---|---|
| 1 | **Scale ladder and the no-n² gates.** Counters and gates in `scripts/sim/matching.ts` (R8 P2, R3 P11, R2 P1, R1 section 9, R10 A8, R11 G1). Details below. | Makes the speed claims of items 4 to 8 testable. Stops quadratic growth from hiding as lost exactness. | The counters are the measure. A slope gate is tracked for 2 weeks, then blocking. | none | M |
| 2 | **Paired, low-variance quality evaluation** (R9 P1-P3, R4 P1, R4 P3). Details below. | Paired SD of meetings from 11.5 per seed to below 3 (target). Makes 5 to 10% quality effects detectable. Without this, no quality item can be judged (174 against 132 was noise). | A/A arm: paired SD and correlation. P(false fail) under A/A below 2%. | none (parallel with 1) | M |
| 3 | **Remove the quadratic scans outside the engine** (R10 A6 step 1 and section 4; R8 P1). Details below. | Today one request costs O(N·(N+P+opps+I)). This removes the largest super-linear cost, behind 88% of ntwrk meetings, with no behaviour change. | Operation counts per request at 1k, 10k and 100k. Identical outputs on pinned seeds. | 1 | S |
| 4 | **Stop wasted checks, add bound monitors** (R3 P1 + P11; mechanism confirmed in `search.ts`, R11 section 1). Details below. | Friend about −25% time at 100k (the drain of about 472 checks). Date checks 438 → 100-250 (estimate). Kept lists identical. | Before/after counter of checks after settle (must reach 0). Edge diff identical on the same seeds. | 1 | S |
| 5 | **Date: symmetric segment and mutual acceptance masks at touch** (R10 A1/A2, R3 P2/P3, R8 P8). Details below. | Removes the measured 40% `segment_unreachable` and 12% `age_range` refusals (N 5,000). Window for gay men and lesbians about 0.15-0.2x. Budget goes to feasible partners, so small pools gain. | Refusal share below 10%. Exact share and window size by orientation and age group. Fairness ratio (first find which group fell 0.506 → 0.324). | 1, 4 | M |
| 6 | **Signifiers, stated and never inferred** (R6 P1, P2, P3, P5, P6, P8, P9; R5 P2/P12; R3 4.4). Details below. | Stated exclusions stop being ignored. Bi, pan and queer members get matched. Trans and nonbinary members are protected. New rules are exact (masks and segment). | Blocking gates: 0 pairs violating either side's stated gender, orientation, trans or friend-gender setting. Per-group exact share and fill. | 5, 2 (for evaluation) | M |
| 7 | **Integer Date pack value with a provable upper bound** (R1 P1, R3 P5, R10 A5/C6). Details below. | Removes the measured 28% arithmetic refusals. Lets Date posting walks close (today 96% walk the whole window). Date checks to about `limit +` refusals (estimate 20-60). | Bound-slack histogram. Pack-bound violations = 0. Date exact share at 10k and 100k. AUC unchanged if bit-identical. | 4, 5 | M |
| 8 | **Friend: exact cheap search** (R10 A3, A4, C1, C2, Q1; R11 G1, G4; R1 P4 / R3 P6 only if needed). Details below. | Friend from 22% exact to near 100% at 100k (estimate), CPU from about 620-1,474 s to tens of seconds. Correct complement coverage. | Exact share, bounds and touches per profile, CPU, kernel pairs per run, against the brute-force oracle. | 1, 4 | M (L with c-subsets) |
| 9 | **Clef honesty** (R7 P1, P2, P3, P7, P8, P9). Details below. | Honest uncertainty per member. Standing on a known scale. Standing switched off where it predicts nothing. | Uncertainty distribution. Calibration and validity monitors. Date outcome deltas with expected-value metrics at the Joel-calibrated knob. | 2, R9 P4/R7 P4 sim taste | S-M |
| 10 | **Route member requests through the lane index and pair gate** (R1 P9, R5 P5, R10 A6 steps 2-3, R4 P2, R11 G7). Details below. | Request search becomes bounded, exact or reported. Same gate, minors, blocks and caps for both paths. Quality effect unknown: the Intro AUC 0.73 arm lost meetings inside noise. | Meetings and everyone-yes rate with CRN, 20+ seeds, non-inferiority margin. Checks per request. | 2, 3, 5 | M-L |
| 11 | **Stable identity and capacity decoupling** (R8 P3, P5, P9; R10 C3; R3 P10 precondition). Details below. | Prerequisite for any cache. Profile build (slop about 30 s CPU at 100k) becomes proportional to changes. | Profiles rebuilt per run. Results identical to today on pinned seeds (or a documented change). | 1 | M |
| 12 | **Incremental add and remove, exact** (R8 P4/P6/P10, R1 P8, R3 P10, R10 A7, R2 P8, R5 P13). Details below. | Daily work about (changed members) × one search plus reverse checks, instead of N searches. | Incremental = full diff gate (100% on exact searches). Work at 1% and 10% churn against a full run. | 11, item 1 ladder (and item 8 summaries) | L |
| 13 | **Friends quality terms that match the truth** (R4 P6, R6 P7, R3 P8, R9 P7, R10 Q2, R11 G5). Details below. | Friends pair AUC can rise only a little: the systematic pair term is 8.9% of the latent. The gain is in expected meetup enjoyment and repeats. | Expected-value metrics (item 2): expected meetup enjoyment, repeat rate, V14. AUC is a secondary metric. | 2, 8 | M |
| 14 | **Learned private taste for Date** (R4 P4/P5/P9, R7 P4/P5/P6, R9 P6, R2 P3/P7). Details below. | In the simulator, potentially large (oracle ceiling 0.963 against 0.59 for stated data). In reality probably small (Joel et al. 2017). Count it as a gain only if it wins at the low knob. | AUC against soft labels by history length and knob. Second-date rate. Group exposure. | 2, 7, 9 | M-L |
| 15 | **Circles and crews** (R5 P4/P8/P9/P11, R2 P5, R1 P10 last, R11 G3; G2 for Hire). Details below. | Higher mean and least pair value in circles at the same floor. More repeat crews. Measured packing gap. | Greedy/ILP packing ratio, circle size distribution, attendance and repeat (expected-value), ARI on graded planted rungs. | 2, 8 | M |

## Item details

### 1. Scale ladder and the no-n² gates
- Ladder: N = 1k, 10k and 100k; 300k nightly.
- Worlds:
  - planted;
  - a de-leaked graded rung;
  - Zipf tags and heavy-tailed tag counts;
  - an adversarial dense-tag world;
  - a slop world with lifestyle variety.
- Counters per lane:
  - touches and bound evaluations;
  - checks, refusals by reason, and checks after the result is settled;
  - window W and feasible window;
  - the honest gap (unseenBound − k-th);
  - the bound-slack histogram;
  - pair-memo reuse.
- Blocking monitors (must stay 0):
  - bound below value;
  - "masks refuse, rules admit";
  - pack bound below pack value.
- Sampled brute-force recall@k on 200 members (linear cost).
- Slope gates on **uncapped work-to-exactness** (an offline run with no budget) and on exact share. Gate on counts, never on wall time.
- The brute-force window-scan kernel (R11 G1) runs as a baseline column.

### 2. Paired, low-variance quality evaluation
- Common random numbers: key every member decision by meaning (member, counterpart, week, activity), never by proposal index or message id.
- Expected-value engine metrics with fixed Monte Carlo draws: the slop `softLabel`, plus friends and ntwrk equivalents.
- Paired confidence intervals, non-inferiority gates and sequential seeds.
- Exact logged propensities for later off-policy evaluation.

### 3. Remove the quadratic scans outside the engine
- `searchFor`: build per-request maps for presence, open opportunities and recent interactions.
- `engineInput`, `evidence()` and `learnedLive`: group facets once.
- The O(opps²) diff in `PgStore.save`.
- Leave whole-document state storage as a tracked item. It is the next largest cost and belongs outside matching.

### 4. Stop wasted checks, add bound monitors
- Close Budgeted once no touched candidate can still enter the kept list.
- Count every check where value > bound (it must be 0).
- Report a touch-limit close separately from a check-limit close.

### 5. Date: symmetric segment and mutual acceptance masks at touch
- Date segment: own = is | seek-set | cell (+ radius class). Partners must be mutual.
- `windowSpans` iterates the member's partner list through a map.
- Cheap mutual masks are tested at touch: age buckets both ways, stated dealbreakers, and in peon mode, area, authorization, credentials and pay bucket.
- Run the slop gate before the arithmetic.
- New laws: `lawMaskBoundSound` and `lawMaskBlockingComplete`.

### 6. Signifiers, stated and never inferred
**Bug fix (S).** The seek parser drops "trans" and "cis", so a stated exclusion ("women but not trans women") is read as seeks [woman]. Fix it, and never drop a stated exclusion silently.

**Rule fix.** No straight default for a member who stated bi, pan or queer. Let them state several pools.

**Consented trans dimension.**
- Trans status is shared by the member only.
- Openness to trans partners is asked of everyone, and an unanswered question does not count as "open".
- "Only trans" is limited to members who shared trans status (T4T).
- Nonbinary members choose their own `alsoIn` pools.

**Other signifiers.**
- Friend gender openness (women, men, anyone) as a mutual mask. Circles inherit it through the pair gate.
- A lane-scoped signifier whitelist, proved: nothing of this kind in Hire, Mentor or Invest.
- Cofounder: role (technical or business), commitment, and idea attached or open, as must, prefer or any. This needs scope confirmation (PRD 28.3 and 40).
- Capture politics and faith so that stated dealbreakers can fire.

**Simulator.** Put all of these into the truth (R9 P5, R6 P10), otherwise no regression can be seen.

**Founder decisions needed.**
- An openness filter, or inclusion only?
- How is "unstated" handled?
- Is friend-gender openness in scope?

### 7. Integer Date pack value with a provable upper bound
- `datePackValue` moves to integer permille factor tables in a generated function.
- `packBoundPair` at touch, and `packClassCap` per (goal × known-lifestyle) class as block-max over a categorical sort key.
- New law: `packValue ≤ cap`.
- Compute both directions in one call.

### 8. Friend: exact cheap search
**Step 1.**
- Filter structural `lane:`, `side:` and `level:` tags from friends seeks and offers (also a quality fix; probably a production defect).
- Per-segment block-max with exact segment closeness, using the already-proved `bucketValueBound`.
- An accumulator walk.
- A symmetric pair memo with comparison propagation.
- An allocation-free kernel and a struct-of-arrays layout.

**Step 2.** Compare with the exact window-scan / self-join kernel (G1). Ship whichever the ladder shows is cheaper at the target market size.

**Step 3, only if 100k Friend searches still budget out.** Add c-subset postings (c = 4 at W ≈ 13.8k: about 1,260 touches, estimate) or Zipf IDF tiers.

**Founder.** Decide whether the transit rule becomes min(tolerance) instead of the sum. This caps W and makes any method linear.

### 9. Clef honesty
- Set `photos` in `WorkersAIClefRater.rate` (bug, confirmed). Derive uncertainty from photo count and agreement.
- Percentile standing per (market, pool) instead of an assumed z.
- Validity, calibration and drift monitors with a switch-off rule.
- Forgive the parity penalty inside the uncertainties, `max(0, gap − ua − ub)`. This is still monotone, so it can still prune.
- A static gate: no identity questions in the Clef bank.
- Reword the rating question away from "most dating-app users".

### 10. Route member requests through the lane index and pair gate
- A request becomes a temporary membership searched in its lane's block. `askFit` re-ranks only the kept list.
- Requests compete in the same selection pass under the same weekly capacity.
- The founder decides whether parity and balance apply to requests, and which lane one-way help asks use.

### 11. Stable identity and capacity decoupling
- Pair-hash or entity-sequence tie keys instead of positional ordinals.
- An append-only tag interner.
- Weekly capacity applied in selection, not by removing profiles from the index (option B keeps today's results).
- A profile memo keyed by `World.revision` plus the standing row.

### 12. Incremental add and remove, exact
- Base + delta + tombstone index per block.
- Persisted kept lists with k-th value and version.
- On insert: a forward search plus a reverse pass that skips buckets whose bound ≤ the least stored k-th value.
- On delete: top-k′ reserve with refill.
- Gate changes re-check the k kept pairs.
- A pending bound for any unfinished reverse pass.
- A `candidateCache` Quint and Dafny model.
- A weekly full rebuild.

### 13. Friends quality terms that match the truth
- Transit minutes and slot overlap.
- Incumbent-crew repetition priority.
- Age, life stage and group-size preference as traits (parsed today and ignored).
- IDF-weighted coverage tiers, judged only on a Zipf world.
- A hub cap against interest-stuffing.
- No Big Five questionnaire (R11 G5).

### 14. Learned private taste for Date
**Simulator first.** Plant taste clusters and private appearance taste, with the dyadic-predictability knob calibrated to Joel et al.

**Engine.**
- A per-member integer taste term from the member's own probe yes/no answers and post-date ratings, with cohort shrinkage, over allowed presentational attributes.
- Later, a double-centred taste-by-appeal cluster table (founder approval), for the "similar people like similar others" transfer.
- Seeds from 3-hop twins for budgeted searches only.
- Make it boundable (attribute postings or cluster boxes, R7 P6) so item 7's exactness holds.

**Exploration.** Thompson sampling, with the propensities logged.

### 15. Circles and crews
- Compute missing pair values directly under a circle check budget.
- Bounded wedge closing (at most 66 checks per member).
- Prefer circles of about four.
- Incumbent crews first.
- A swap-improvement round.
- An offline ILP packing oracle (G3), and an offline min-cost-flow b-matching oracle for Hire (G2), to report greedy's gap. Neither ships.
- Leiden-CPM only if the gap stays large.

## Not in the 15, on purpose
- **Epsilon-exact `Within` closing (R3 P7, R5 P3).** Decide it after items 2, 7 and 8, with data. It may become unnecessary once Friend and Date close exact. If it is adopted: slack 0 for Hire and Invest, and phases kept distinct.
- **Thin-pool exposure and band widening (R5 P1, R6 P4).** Add it after item 5 shows which group is starved.
- **Uncertainty classes in the index order (R1 P6), standing slices (R1 P2) and the geo-ordered walk (R1 P7).** These are small exact gains, subsumed by the block-max in items 7 and 8.
- **Directed blocking-pair counts and the greedy-uniqueness oracle check (R5 P6/P7).** Cheap diagnostics: add them to item 1 or item 15.
- **Scarce priority signals and senior-side pull (R5 P10/P14).** Product scope. They need founder confirmation.
- **Two-sided welfare diagnostics (R4 P10).** Fold into item 2.
- **Offline real-data check (speed dating, Joel data; R9 P10).** Do it as soon as the licence allows. It is the only quality test outside our generator.
