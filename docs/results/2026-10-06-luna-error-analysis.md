# Why gpt-6-luna gets intros wrong: error analysis of the judgment passes (2026-10-06)

Companion to `2026-10-06-judge-passes.md`. Scope: the **gate > pass 1 > pass 3** pipeline (110 wrong of 362, 69.6% accuracy) and **pass 1** alone (114 wrong, 68.5%). Pass 3 on its own is covered more briefly.

No model was called for this analysis. Every judgment below comes from reading the per-item records against the simulator's hidden truth.

## TL;DR

- **About a third of the pipeline's errors can't be fixed by any judge.** Pair chemistry is a random draw with SD 0.13. It decides 66 of the 362 labels (18%). Even a judge that knew every hidden trait exactly would top out at **81.8%** (80.4% behind the current hard gate). There is also a selection effect: **57 of the 144 "good" items are good only because of a lucky chemistry draw.** The dataset picks its good items with the noisy oracle, so the positive class is full of pairs with mediocre fit.
- **Two simulator/data bugs together cause about 15% of pipeline errors (category F):**
  1. **Dating-desire bug.** The generator gives a "dating" desire to people whose hidden romance opt-in is false. This is true of 264 of the 505 adults who want to date. Those people say "meet someone to date", so the Network shows `romance_opt_in=true`, but the oracle gives the date zero value. This causes 8 pipeline false positives, 14 for pass 1 and 13 for pass 3.
  2. **Opt-in mismatch.** The hard gate rejects category opt-outs, which the oracle ignores. That causes 9 false negatives.
- **About a quarter of errors are the information gap (category A).** The decisive fact was never collected:
  - how strongly someone wants something;
  - the specific want behind a vague minimal-tier intent;
  - the second and third intents of light-tier members (only their first intent is captured);
  - gender, orientation and age range for dating;
  - group-size comfort.
- **The prompts cause about 14% of errors, all false negatives (category E):**
  - pass 3 treats a soft private boundary as a veto;
  - pass 1 wants a shared-interest hook even when both people stated the same intent (65% of such pairs are good);
  - pass 1 requires every group member to have stated the objective;
  - both passes over-weight unknown schedules.
- **True "missed" errors (B) are about 9% of the pipeline's errors.** The model had the information and mis-weighed it, mostly by proposing a shared-interest intro where neither person's intent matched. Pass 3 also once overlooked an identical, 3-day-old intent.
- **Bad connected-source data (C) barely matters.** 55% of items contain a stale or wrong-inference fact, but the models cited one in only 18 pass verdicts. Only 4 of those were wrong, and none was a pipeline error.
- **The expired-intent bug does not affect this run (0 errors).** All 1,357 intents shown to pass 3 were 0 to 3 days old, with 57 to 60 days left. That bug is in the long-running simulator snapshot, not in the eval worlds.
- **The capacity factor (0.3+0.7·capacity) is not in this label.** "Good" means enjoyment if the meeting happens, not acceptance. Capacity enters only through a ≤0.10 term. Yet pass 1 is told to say yes only when each person "would plausibly accept". The prompt and the label measure different things.

**Estimated ceiling:**

| Setting | Accuracy |
|---|---|
| Hard cap, set by chemistry | 81.8% |
| Omniscient judge behind today's gate | 80.4% |
| Oracle formula on everything a fully onboarded member would say | 78.2% |
| Oracle formula on what the Network sees today (luna is already here) | 70.4% |
| Realistic with the prompt fixes below on today's data | 73–74% |
| Realistic with the onboarding fixes as well | about 77% |

## Method

1. **Read the label code.**
   - `packages/sim/src/oracle.ts` (`evaluate`, `pairEnjoyment`) and `packages/evals/src/recDataset.ts` (`label`, `makeConfig`, candidate pools).
   - `packages/sim/src/sources.ts` (tiers, connected sources, truth labels) and `packages/sim/src/snapshot.ts` (what the Network sees).
   - `packages/sim/src/generator.ts` (how hidden and public traits are drawn).
2. **Decomposed every label offline.** `packages/evals/src/analysis/lunaErrors.ts` rebuilds the richness-tier dataset deterministically. It found 0 mismatches against the results file. For each item it splits each person's oracle enjoyment into these parts:
   - `0.22 + 0.3·interest-overlap + 0.42·(own want met) + 0.1·(other's want met)·capacity + actor term`;
   - penalties: age gap, boundaries, group size, one-on-one;
   - the chemistry draw.

   It then re-scores the same formula four ways:
   - (a) with chemistry removed, which gives the "systematic" label;
   - (b) on what the Network could see (chat + all source facts), with priors for latent traits (desire strength 0.7, energy/openness/capacity 0.5);
   - (c) as (b) but without stale or wrong-inference facts;
   - (d) on the member's full public profile, i.e. everything they would say if fully onboarded.

   Run it with `bun run packages/evals/src/analysis/lunaErrors.ts <items.jsonl> <out.jsonl>`. It makes no network calls.
3. **Read errors by hand.** I took a stratified sample of 95 items that the pipeline or pass 1 got wrong. That is 165 wrong decisions: 83 by the pipeline and 82 by pass 1. The sample covers:
   - every group error;
   - every minimal and very_rich error;
   - random draws of 4–12 per light/medium/rich × false positive/false negative cell;
   - every item where pass 3 abstained.

   For each item I read the three visible profiles, the pass 1 and pass 3 reasoning and steelmen, and the hidden truth: traits, desires with strengths, boundaries, the source-fact truth labels and the decomposition.
4. **Encoded the root-cause rules I settled on while reading** (in order of precedence), checked them against the sample, and applied them to every error. Six sample decisions needed hand overrides; the tallies below include them.

## What "correct" means here (read this first)

`label.good` = the oracle says the configuration is `compatible` and no policy rule is violated:

- **Pairs:** both people's enjoyment is at least 0.55.
- **Groups:** mean enjoyment is at least 0.55 and the lowest is at least 0.40.
- **Hard flags force "bad":** minor, ex, adversarial, romance mismatch, or `city_mismatch`.

Each person's enjoyment is driven by these terms:

- **Whether the other person meets one of my hidden desires** (weight 0.42 × strength), and how:
  - a needed skill counts 1.0;
  - the other person having a desire in the same pool counts 0.85;
  - a matching interest only counts 0.45.
- **Interest overlap** (0.3).
- **A chemistry draw** of N(0, 0.13), stable per pair. For pairs it is a single shared shock.
- **Small penalties:**
  - age gap over 15 years: −0.05;
  - "prefers groups over one-on-one with strangers" in a pair: −0.15;
  - "no networking-heavy events" with the professional category: −0.12;
  - group size beyond an introvert's preference.

The oracle also computes accept and show-up probabilities, using capacity, flakiness and fatigue, **but `compatible` never uses them.** So "would they say yes" is the wrong question for this label. The right question is "would each enjoy it if it happened".

Three oracle behaviors matter for the errors below:

- **Dating counts only when romance is mutually compatible.** Both people must have the hidden opt-in, each must be seeking the other's gender, and each must be inside the other's age range. None of that except the opt-in is visible.
- **`city_mismatch` is checked at a single instant, the window start**, not "can they meet at some point in the 7-day window".
- **Category opt-ins and schedules play no part in the oracle.**

## Taxonomy

| Code | Meaning | How it is detected |
|---|---|---|
| A | **Unknowable.** The decisive fact was not in anything the Network knew. | The visible-view score agrees with the model's verdict while the full-profile or hidden score disagrees. Also hidden risks (lying minor, adversarial person, ex), and dating pairs whose orientation or age range doesn't match. |
| B | **Missed.** The fact was visible and the model ignored or mis-weighed it. | The visible-view score is clearly on the correct side (margin ≥0.08 for false positives, ≥−0.06 for false negatives), and no prompt pattern explains the reasoning. |
| C | **Misled by a bad source fact.** | The pass's cited facts or reasoning rely on a stale or wrong-inference fact. |
| D | **Label noise or oracle artifact.** | The chemistry draw flips the label versus the systematic score; or the label is bad only because of the point-in-time `city_mismatch` while the window has overlap hours and enjoyment clears the threshold. |
| E | **Prompt or rubric.** | False negatives where the visible score says good and the reasoning hits a rubric pattern: boundary veto, "no shared hook", "not every group member stated it", schedule or travel, category opt-in, age gap. |
| F | **Data or pipeline bug.** | The hard gate's category opt-out on an oracle-good item; the dating-desire / hidden-opt-out generator bug; pass 1's input missing a known boundary that drives the label. |

## Tallies

### Hand-verified sample (95 items, 165 wrong decisions)

| | A | B | C | D | E | F | total |
|---|---|---|---|---|---|---|---|
| Pipeline gate>1>3 | 23 | 7 | 0 | 30 | 11 | 12 | 83 |
| Pass 1 | 31 | 7 | 1 | 27 | 8 | 8 | 82 |
| Pipeline false positives | 18 | 6 | 0 | 10 | 0 | 4 | 38 |
| Pipeline false negatives (incl. 6 abstentions) | 5 | 1 | 0 | 20 | 11 | 8 | 45 |

### All errors, classified programmatically with the same rules

**Pipeline gate > pass 1 > pass 3:** 110 errors (54 false positives, 56 false negatives including 6 pass-3 abstentions).

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| All | **31** (28%) | **10** (9%) | 0 | **37** (34%) | **15** (14%) | **17** (15%) |
| False positives (54) | 25 | 9 | 0 | 12 | 0 | 8 |
| False negatives (56) | 6 | 1 | 0 | 25 | 15 | 9 |
| minimal (42 items, 11 errors) | 4 | 0 | 0 | 5 | 0 | 2 |
| light (127 items, 36 errors) | 17 | 0 | 0 | 10 | 7 | 2 |
| medium (150 items, 46 errors) | 8 | 4 | 0 | 20 | 5 | 9 |
| rich (39 items, 15 errors) | 1 | 6 | 0 | 2 | 3 | 3 |
| very_rich (4 items, 2 errors) | 1 | 0 | 0 | 0 | 0 | 1 |
| pairs | 23 | 9 | 0 | 27 | 9 | 17 |
| groups | 8 | 1 | 0 | 10 | 6 | 0 |

**Pass 1:** 114 errors (73 false positives, 41 false negatives).

| | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| All | 38 | 12 | 3 | 32 | 13 | 16 |
| False positives | 29 | 12 | 3 | 13 | 0 | 16 |
| False negatives | 9 | 0 | 0 | 19 | 13 | 0 |

**Pass 3 (model only):** 131 errors. A 52, B 24, D 34, E 8, F 13. This count includes yes verdicts on policy-unsafe items that the hard gate always catches.

### Top specific causes (pipeline, all errors)

| Cause | Count |
|---|---|
| D: chemistry draw flips the label | 33 |
| A: near threshold, decided by latent desire strength, energy or interests | 17 |
| F: hard-gate category opt-out on an oracle-good item | 9 |
| B: visible profile pointed to a weak fit | 9 |
| A: the member had not told the Network yet (vague or untold intent) | 8 |
| F: dating-intent person is a hidden romance opt-out (generator bug) | 8 |
| E: over-weights schedule or travel uncertainty | 5 |
| E: soft private boundary treated as a veto (pass 3) | 4 |
| E: wants a shared-interest hook beyond the matching intent (pass 1) | 4 |
| D: oracle checks presence only at the window start (plus 1 window-fit case) | 4 |
| A: orientation or age range never collected | 2 |
| E: group, requires every member to have stated the objective | 2 |
| A: hidden risk | 1 |
| B: ignored a visible matching intent | 1 |

### By tier

- **Minimal (accuracy 73.8%).** Errors are almost all false negatives: 9 of the 11 errors, with a 24% yes-rate. The causes are A and F: a one-line vague want ("find something fun to do on weekends") hides a strong specific desire. The judge is right to be cautious there, and pass 3 asks a question in some of these cases.
- **Light (71.7%).** Mostly A. Light members' chat coverage records only their first intent, so a second want such as "meet other parents nearby" is invisible. The rest is pass 1 prompt strictness (E).
- **Medium (69.3%).** This is where chemistry noise hits hardest: 21% of medium items have a chemistry-flipped label. The dating-bug false positives also concentrate here.
- **Rich (61.5%, the worst).** It has the fewest chemistry flips (8%) and the highest B share. More facts give the model more shared interests to over-read: it proposes intros on a shared interest when neither person's intent matches.

### Pass-3 abstentions

Pass 3 abstained 32 times: 13 on good items and 19 on bad ones.

- **In the pipeline**, 9 abstentions were reached: 6 on good items (counted as false negatives) and 3 on bad ones.
- **Cause of the 6 false negatives:** five are chemistry-lifted labels (D) and one is a genuine miss (B, nyc-1:p010 below).
- **What the questions asked:** about 20 of the 32 asked about intent ("Are you a parent looking to meet other parents nearby?"). These are exactly the A-gap questions and the behavior we want. The other 12 asked about format or logistics. The format questions, such as "would one-to-one work for you?" in sf-1:p004 and nyc-2:p014, break the prompt's rule: "Never use it for format or opt-in questions".

## Worked examples (15)

The P-references are as the model saw them. Private boundaries and other agent_private facts are paraphrased.

1. **sf-2:p047 (FP, pipeline and pass 1). A: orientation is never collected.** "Intro around: meet someone to date". Both people state `"meet someone to date"` and have `romance_opt_in: true`, and both passes said yes. Pass 3 wrote: "both have a fresh, explicit goal of meeting someone to date." Hidden truth: both are women, and both are seeking men. The oracle gives the date zero value (minimum enjoyment 0.148). **Missing detail:** gender, who they want to date and their age range. None of these is in any profile, at any tier.
2. **sf-2:p040 (FP, pipeline). F: dating-desire bug.** Both people state "meet someone to date", so the Network shows `romance_opt_in: true`. In hidden truth both have `romance.optIn = false` while holding a "dating" desire. The generator samples "dating" from the general desire list independently of the opt-in. The label is bad (minimum enjoyment 0.203). The model was right given everything stated; the simulated person contradicts themselves.
3. **nyc-1:p050 (FP, pipeline). F and A.** Again a dating pair. P1 is a hidden opt-out, and P1's age (23) is outside P2's hidden age range (28–42). Pass 3 noted "The 11-year age difference … could mean different life stages" but proposed anyway. With a "who are you looking for" answer, this would be an easy no.
4. **sf-1:p028 (FN, pipeline and pass 1). A: vague minimal-tier intent.** "Intro around: find something fun to do on weekends". P1 (minimal tier) shows only `"find something fun to do on weekends"` and no interests. Pass 1 said: "the input gives no reason to think P1 plays chess." Hidden truth: P1 wants over-the-board chess (strength 0.95) and is a rated player. P2 wants chess and is also rated. The label is good (minimum enjoyment 0.849). **Missing detail:** the concrete activity behind the vague want. One follow-up onboarding question would close this gap.
5. **nyc-1:p019 (FN, pipeline). A, and a model abstention we should want.** "Intro around: meet other parents nearby". P1 (light tier) shows only `"meet someone to date"`, because light members' coverage records only their first intent. Hidden truth: P1 also wants to meet other parents (strength 0.7). Pass 3 abstained with "Are you a parent looking to meet other parents nearby?" That is exactly the right question; the metric counts it as an error.
6. **nyc-1:p010 (FN, abstention). B: missed a visible matching intent.** "Intro around: find a hardware collaborator for a side project". Pass 3 wrote: "P2 has no current stated intent to collaborate; the only apparent prior collaborator goal is old and inferred (P2.facts[12])." But P2.intents[0] is `"find a hardware collaborator for a side project"`, created 3 days ago with 57 days left. Pass 1 cited it correctly. The label is good (0.701). Pass 3 anchored on the stale ai_memory goal and overlooked the live intent.
7. **sf-2:p046 (FP, pipeline). B: an intro on a shared interest, with no intent on either side.** "Intro around a shared interest in cooking". The intents are P1 "get help moving a couch" / "meet someone to date" and P2 "get help moving a couch" / "meet other founders". Pass 1 itself noted the intents are "for help and dating … rather than socializing", then said yes on shared cooking. Neither person's want is met (complementarity 0 for both), so enjoyment is about 0.38 for both. The visible profile already said this was weak.
8. **nyc-1:p036 (FP, pipeline). B: an asymmetric fit read as mutual.** Both want a hardware collaborator. P2 is the electrical engineer (`P2.matchable_do_not_quote[4]`), and P1 shows no hardware skill. P2's want is met only at "interest" level (0.45 weight), so P2's enjoyment is 0.453 and the label is bad. Pass 3 said it "makes the potential collaboration concrete", which is true only for P1. The rubric should ask "what does each person get from the other's skills".
9. **nyc-2:p013 (FN, pipeline). E: soft boundary treated as a veto.** "Intro around: meet people working in climate", professional category. Pass 3 said no with `risk_safety: 3, values_energy: 1`, because "A private boundary recorded for P2 is materially at odds with the proposed topic and format". P2's boundaries are [private: topic boundary about work] and [private: format boundary about networking events]. The oracle does apply its −0.12 boundary penalty, and the pair is still good (0.569). The pass-3 rubric drives this: risk_safety 1 includes "a violated boundary", and "yes" requires nothing at 1. The model reads a preference as a prohibition.
10. **nyc-2:p009 (FN, pipeline and pass 1). E: wants a shared-interest hook.** Both state "make a few new friends in the city". Pass 1 said no: "that is the only specific shared interest evident … mutual interest is too uncertain to recommend". Pass 3 said yes. The label is good (0.646): the oracle scores two people who both want friends at 0.85 × strength. **Base rate:** among friend-intent pairs with no visible shared interest, 33 of 51 (65%) are good. Pass 1's extra requirement is simply miscalibrated.
11. **nyc-1:g078 (FN, pipeline). E: group strictness.** A 5-person "make a few new friends" group. Pass 1 said no because "P5 … does not state an interest in making friends; that makes the group's purpose a weak fit." All five share the climate intent. The group's mean enjoyment is 0.616 and the lowest is 0.534 (good; systematic score also good). Pass 1's "every attending person clearly gains" rule becomes "every person must have stated the objective".
12. **sf-2:p024 (FN, pass 1). D: chemistry.** Two "make a few new friends" members with no shared interests. The systematic minimum enjoyment is 0.415, which is a clear "no" even with perfect knowledge. The chemistry draw is +0.381 (about 3 SD), so the label is good (0.796). No judge should get this right. Pass 3 said yes, for the same reasons it says yes to the bad version of this pair.
13. **sf-2:p037 (FP, pipeline). D: point-in-time presence.** A dinner-group pair. P1 is traveling from day −1 to day 5 of the 0–7 window, and logistics show `overlap_hours_in_window: 48`. Enjoyment is 0.691 and 0.753, which is good on fit. The label is bad only because the oracle checks presence at the window start. Pass 3 correctly reasoned that "the provided logistics still show 48 hours of SF overlap".
14. **nyc-1:p060 (FP, pass 1). C: wrong-inference source fact.** "Intro around a shared interest in painting". Pass 1 reasoned "P2 has a painting habit (P2.matchable_do_not_quote[10])". That fact is a Gmail inference, "receipts suggest a painting habit", which the hidden truth marks `wrong_inference` (a gift purchase). Pass 3 caught it: "the only painting signal is inferred (P2.facts[19])." Pass 3 sees each fact's basis and confidence; pass 1 doesn't. Enjoyment is 0.01.
15. **nyc-1:p023 (FN, pipeline). F: gate versus oracle on opt-ins.** "Intro around: find people to run with", hobby category. The hard gate stopped it with `category_opt_out`: P2 opted into social and romance, not hobby. Hidden truth: both are newcomers who want new friends (strength 0.9). The label is good at 0.956 (systematic 0.709). The dataset builder pairs people on intents in categories one side never opted into, and the oracle ignores opt-ins. These items can never be "right" in the gated pipeline.

## Recommendations, ranked by expected impact

### 1. Fix the labels before tuning the judge further (category D, 34% of pipeline errors)

- **Score against the expected label, not one chemistry draw.** For each item, compute `p_good = P(systematic + chemistry ≥ threshold)`. For pairs that is Φ((systematic min enjoyment − 0.55)/0.13); for groups, use Monte Carlo. Report Brier score / log-loss against `p_good` alongside accuracy against the drawn label. Keep the drawn label for outcome simulation.
- **Stop selecting "good" items with the noisy oracle.** `recDataset.ts` keeps good pairs with `evalPair(ps).compatible`, which includes chemistry. That is why 57 of 144 good items are chemistry-lifted while only 9 bad items are chemistry-lowered. Select on the systematic score, or stratify on `p_good`. Otherwise recall numbers mostly measure luck.
- **Fix the presence check.** `Oracle.presentIn` should accept a window with some overlap. For example: present if any day in [start, end] has the member in the city, or require at least N overlap hours, the same rule the engine's logistics use. This removes 4 pipeline errors and about 10 pass-level errors.
- **Optionally make the label agree with the product question.** "Good" today ignores acceptance. If the product means "a proposal both accept and enjoy", either add the accept model or change the prompts (recommendation 4) to stop asking about acceptance.

### 2. Fix two data bugs (category F, 15% of pipeline errors)

- **Dating desire versus hidden opt-in (`generator.ts`).** The `desireCandidates` sample can include `dating` when `romanceOptIn` is false. Fix: filter `dating` out unless `romanceOptIn`, or set the opt-in when the desire is sampled. This removes 8 pipeline false positives, 14 pass-1 false positives and 13 pass-3 false positives, and makes every "meet someone to date" item meaningful.
- **Opt-in mismatch between dataset, gate and oracle.** Either:
  - have `makeConfig` / the candidate pools skip configurations whose category a participant hasn't opted into, as production would; or
  - model opt-ins in the oracle, with zero category want for opted-out categories.

  This removes 9 false negatives (2.5 pp). The report already flags it as understated recall.
- **Dating anchors are relabelled "social".** `makeConfig` maps a romance anchor to `category: "social"` with the objective "Intro around: meet someone to date". The gate's romance check never fires, and the judge sees a dating objective in a social intro. Keep `romance` as the category so policy and the oracle's romance-mismatch logic apply.
- **Give pass 1 a redacted boundary signal.** Pass 1 never sees private boundaries (0 of 362 inputs contain one), so it proposes cold one-on-one intros to members who have said they prefer groups. Add a non-quotable flag such as `format_concern: true` or `prefers_group_first: true`. Here that caused 2 pass-1 errors. Overall, 55 pair items carry the −0.15 penalty, and in 37 of them the Network already knows the boundary.

### 3. Collect the data that closes category A (28% of pipeline errors; the main ceiling lever)

Re-scoring with the full public profile instead of the current tiered view lifts the visible-information ceiling from 70.4% to 78.2%. In order of value for this oracle:

1. **How much they want each thing, and how soon.** Desire strength is the term that decides near-threshold cases (17 pipeline errors). Ask: "How much do you want this right now: someday / would be nice / actively looking?" Store it on the intent. Today every intent looks equally strong.
2. **The specific want behind a vague one.** Minimal-tier members give "find something fun to do on weekends" or "maybe meet someone". Ask one follow-up per vague intent: "What kind of thing? Name one activity." This closes the minimal-tier false negatives (sf-1:p028, sf-2:g086).
3. **All of a member's intents, not just the first.** Light-tier coverage records only intent [0]. A one-tap "anything else you'd like help with?" prompt after the first intent would have surfaced the parenting intent in nyc-1:p019 and the friend intent in nyc-1:p023 and nyc-2:p018.
4. **For dating: gender, who they want to meet and their age range,** asked only after opt-in. Without these, no judge can avoid incompatible-orientation false positives. Policy should treat a dating intro without mutual "seeking" data as ineligible.
5. **Group comfort / social energy.** "One-on-one or small group first?" plus "How big a group is comfortable?" This drives the introvert size penalty that sinks pooled groups (sf-1:g078, nyc-1:g081).
6. **"Are you a parent?"** and similar yes/no facts that make an interest actionable. Pass 3 keeps asking this one, correctly.

**Which sources matter for this label:**

- **High value:** sources that reveal **desires and skills**. These are AI-memory goals (they map directly onto desires), LinkedIn, GitHub and personal-site skills (they satisfy `needsSkills`, the 1.0 weight), and repeated attendance from Eventbrite, Partiful and Luma (a strength proxy: 2–9 events vs "went to 1").
- **Moderate value:** Strava, Spotify and Instagram. They add interests (overlap weight 0.3).
- **No value for this label:** Calendar availability, because the oracle ignores schedules. It still matters for real acceptance.
- **Ranking:** AI-memory > LinkedIn/GitHub > event platforms > Strava/Spotify/Instagram > Gmail > Calendar.

### 4. Prompt and rubric changes (category E, 14%; plus B, 9%)

**Pass 1 (screen):**

- **Replace the acceptance criterion.** Change "say yes only when every attending person clearly gains and would plausibly accept" to "…would plausibly enjoy and benefit from meeting". Keep `accept_probability` as a separate output; it should not gate the verdict.
- **Stop requiring a shared-interest hook.** Add: "When two people state the same or complementary intent (both want friends, both want a climbing partner, one needs a skill the other has), that IS the reason to meet; do not require an additional shared hobby." Its friend-intent false negatives conflict with a 65% base rate.
- **Groups.** Add: "For groups, judge the group as a whole: say yes when most members directly want the objective and no one is clearly mismatched; one member without a stated identical intent is not a reason to reject if they share the group's anchor pool or interests."
- **Schedules.** Add: "Unknown schedules are normal; only reject on logistics when presence or overlap makes meeting impossible."
- **Show basis and confidence on matchable facts**, as pass 3 does: `[inferred, 0.55]` or `[stated]`. Add: "Do not anchor an intro on a single inferred, unconfirmed interest." This would have caught nyc-1:p060.
- **Require each person's gain to map to their own intent.** Add: "For each person, name which of their own intents or skills this serves. If a person's only connection is a shared interest and neither person's intent mentions it, the answer is usually no." This targets the B false positives (sf-2:p046, nyc-1:p061, nyc-2:p053), which are concentrated in the rich tier.

**Pass 3 (deep):**

- **Boundaries are soft unless they are prohibitions.** Remove "a violated boundary" from the risk_safety=1 definition, or limit it to explicit no-go boundaries (no romance setups, no bars). Add: "Format boundaries (e.g. preferring groups to one-on-one) lower values_energy but are not vetoes; suggest a group framing or ask. Topic boundaries apply only when the intro is primarily about that topic."
- **Live intents outrank inferred goals.** Add: "Before claiming someone has no intent, re-read their `intents` list; live intents outrank inferred `goal` facts." This fixes nyc-1:p010.
- **Enforce the existing abstention rule.** Format and opt-in questions are already forbidden. Have code reject or convert abstentions whose question is about format. Of the 32 abstentions, 12 asked about format or logistics.
- **Keep the intent-question abstentions.** They are the right behavior for category A. Score them separately (as "asked") instead of as false negatives.

**Pass 2:** the earlier report's advice stands (give it pass 3's context, or drop it). This analysis didn't study it further.

### 5. Handle low-confidence source facts

Category C is small here because pass 3 already discounts inferred facts. The ground truth is cleanly separable on observable fields:

| Fact type | Confidence | Observed |
|---|---|---|
| wrong inference | 0.40–0.65 | |
| correct, inferred | 0.55–0.85 | |
| stale | 0.70–0.85 | 400–1,100 days ago |
| member-confirmed | ≥0.90 | |

Rules:

- show `basis`, `confidence` and `age_days` in **every** pass, not just pass 3;
- below 0.65 confidence and unconfirmed, label the fact "hypothesis" and never let it be the sole anchor or the objective's "shared interest";
- drop occupation and employer facts older than 365 days unless confirmed;
- ask the member to confirm high-impact inferences, such as an interest that would anchor an intro, during onboarding.

### 6. Pipeline note

Configurations anchored on a vague minimal-tier intent produce objectives like "Intro around: find something fun to do on weekends" and "Intro around: get a hand with something". The objective then carries no information. When the anchor intent is vague, `makeConfig` should fall back to the other person's specific intent or to a shared interest.

## Accuracy ceiling

| Judge | Information | Accuracy vs current labels |
|---|---|---|
| luna, gate > 1 > 3 (today) | what the Network sees | 69.6% |
| Oracle formula with priors for unknowns | what the Network sees | 70.4% |
| Oracle formula | full public profile (fully onboarded member) | 78.2% |
| Oracle formula without chemistry (omniscient) | all hidden traits | 80.4% (gated), 81.8% (ungated) |

The chemistry draw alone puts **81.8%** out of reach of any judge. Luna is already at the level of a mechanical oracle on the visible data, so further gains come from:

- **Label and dataset fixes (1, 2).** These change what is measured, and the dating-bug fix removes about 2 pp of false positives outright.
- **Prompt fixes (4).** Fixing half of the E and B errors is worth about +3.5 pp, to roughly 73%.
- **Onboarding (3).** This moves the information ceiling toward 78%. Expect about 77% in practice.

Expect precision to rise more than accuracy: most fixable false positives are dating-bug, shared-interest-only and asymmetric fits.

## Caveats

- **The visible-view re-scoring is a proxy.** It uses population priors (desire strength 0.7) and the oracle's own formula. A better calibrated prior would shift some items between A and B. For example, newcomers get "new_friends" at strength 0.9, which the visible `newcomer: true` flag partly reveals. The B count is therefore a lower bound on "the information was there", and A an upper bound.
- **Hand-verified sample:** 95 of 129 union-error items (all groups, minimal, very_rich and abstention items, and roughly 40–70% of each pair cell). The full-error tallies use the same rules with 6 hand overrides on sample items; I expect a few percent misclassification between A and B and between E and B on items I did not read.
- **The tier strata are small:** 39 rich and 4 very_rich items. The rich-tier finding (lowest accuracy, highest B share) is directional.
- **Labels are synthetic.** "Category D" is partly a design choice: the oracle puts about 50% of enjoyment variance in chemistry on purpose. The point is not that chemistry should be removed, but that a single draw should not be the evaluation target.
- **Nothing here re-ran a model.** Effect sizes for prompt changes are upper bounds from counting errors, not measured gains. Re-run the passes suite on the fixed dataset before adopting any of them.
