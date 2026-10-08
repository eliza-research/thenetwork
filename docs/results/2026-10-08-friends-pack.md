# friends.help on the shared engine: the NYC world, friendsPack and the simulation (2026-10-08)

friends.help (app id `friends`, renamed from buddies.nyc) is the friendship app on The Network's shared engine, NYC first. This report covers the simulated NYC world (`packages/worlds/src/friends/`), the app pack (`packages/engine/src/packs/friends/`), the oracle calibration, the design, the tuning trail, the held-out results, the ablations and the gate table.

- **Branch:** `engine/friends`, worktree `/Users/shawwalters/thenetwork-friends`, rebased onto `origin/main` @ `70c988b` (it includes slopPack and peonPack). Not pushed or merged.
- **LLM use:** none. Tests and runs used empty keys and no `LIVE_TESTS`. Persona text is templated, and friendsPack has no judge.
- **Core and engine changes:** none outside `packages/engine/src/packs/friends/`. The `AppPack` contract, `conformance.ts`, `plans.ts`, `attention.ts` and the core types are unchanged. The only edit made after the rebase is inside the pack: a `tz` fallback, because core `timezones` is now `Partial<Record<City, string>>`.
- **Checks:**
  - networkPack goldens are byte-identical (`golden.test.ts`, fast tier).
  - `bunx tsc --noEmit -p .` is clean.
  - `bun test --conditions eliza-source ./packages/engine ./packages/worlds`: 451 pass, 2 skip, 0 fail. This includes `runConformance(friendsPack)` and the friends-specific checks.

## Result in brief

All numbers are on held-out seeds 5-8, 400 personas, 8 weeks, unless a line says otherwise. Mean ± SE over seeds.

- **The wedge works.** friendsPack re-groups people who enjoyed each other and keeps them near home:
  - **Repeat-meetup rate:** 33.7% ± 4.2 (reshuffled random groups 13.3%; oracle 37.1%).
  - **Members with a friendship forming** (a pair met 3+ times and both said "see again"): **9.4% ± 1.3**, 3.9× random. At 12 weeks it is 17.1% vs 7.0%.
  - **Crews formed:** 9.8 per seed.
  - **V14:** **34.7% ± 0.5** (random 17.0%; oracle 42.1%).
  - **Median of each group's longest trip:** **26.9 min**.
  - **Safety:** 0 contacts with declared minors and 0 contacts with any adversary the Network could see.
- **Three proposed gates cannot be met as written. They are adjusted below, with the evidence.**
  1. **V14 ≥ 60% at 8 weeks.** Even the oracle upper bound, which uses hidden truth (true availability, likes, chemistry and adversary labels), reaches only **42%** in this world. The cause is the probe yes rate (about 40% for a well-aimed invite) combined with quorum 3 at about 400 members spread over five boroughs. Doubling the plan allowance changed nothing: no arm ever sends a member more than one new-plan invite a week. With 1,200 personas the pack reaches 37.9% and the oracle 49.2%. Proposed gate: V14 ≥ 0.75× the oracle bound and ≥ 1.75× random. The pack is at 0.82× and 2.0×.
  2. **No borough below 0.7× the overall value rate.** Staten Island has about 9-10 real members at 400 personas, spread over 7 neighborhoods 30-50 transit minutes apart, and gets almost nothing from any arm (pack 1.5%, oracle 9%). Across the four boroughs with ≥ 30 members the ratio is 0.68 ± 0.06 at 8 weeks (Bronx 24.7% vs 34.7%) and 0.76 ± 0.04 at 12 weeks. With 1,200 personas Staten Island reaches 15.4%, but the ratio is still below 0.7.
  3. **0 adversary contacts.** The pack never matches anyone the Network can see is risky: a failed or unfinished check, an uncleared safety cue, or a report. Undetected romance seekers, MLM promoters and harassers still reach their first tables:
     - 50.5 member-pairs per seed (random 53.3);
     - 11.0 adversaries reached (random 19.3);
     - harm events 17.5 (random 41.5).

     No matcher without hidden truth can reach 0. A 0 gate is right for known adversaries and declared minors; for undetected ones the gate should be relative to random, plus a per-adversary reach cap.
- **The repeat rate falls with time.** At 12 weeks it is 27.4% (held-out), because crews hand off and new tables keep being formed. Over the first 8 weeks it passes.

## 1. The world (`packages/worlds/src/friends/`)

| File | What |
|---|---|
| `persona.ts` | Personas with hidden truth and a stated side |
| `snapshot.ts` | The agent-visible snapshot, verification and review over time |
| `visible.ts` | Typed reader of the snapshot for baselines |
| `oracle.ts` | Acceptance, attendance, enjoyment, "see again", hours, harms |
| `world.ts` | The weekly harness and caps |
| `metrics.ts` | All metrics |
| `baselines.ts` | random-within-area, greedy-popular, oracle |
| `packMatcher.ts` | The friendsPack adapter: snapshot → engine World → pack planner → proposals |
| `cli.ts` | The comparison tables |
| `calibrate.ts` | The calibration diagnostics |
| `sweep.ts` | Tuning sweeps |

### Personas (hidden truth vs what the agent learns)

| Part | Hidden truth (oracle only) | Stated / observed (snapshot) |
|---|---|---|
| Age | `trueAge`. 4% are 13-17; 40% of those lie and claim 18-21 (`age_liar`) | Claimed age. Claimed minors keep every facet agent_private, have no intent and are never matched (core) |
| Place | Home and often-around neighborhoods, sampled by adult population weight over 93 NTA-level neighborhoods in 22 planning zones and 5 boroughs. 55% have a Manhattan or LIC work hub | `Presence.areas` (neighborhood names; no coordinates) |
| Life stage | student / early career / established / parent / retired, by age | matchable fact (medium richness and up) |
| Activities | True enjoyment of each of 31 activities (network `ACTIVITIES` minus `tech_meetup`), from 2-3 favourite families. Dinner and coffee are near-universal (+0.2). Loves = like ≥ 0.65 | 85% of loves stated, plus one aspirational activity (40%) and a liked dinner or coffee (50%). Interest facets carry the activity tag, 60% shareable |
| Social energy, group size | `energy` 0-1, `groupPref` (one-to-one / group / either) | Energy bucket (noisy), group preference |
| Availability | P(free) per weekly slot (11 slots: weekday evenings, weekend morning, afternoon and evening). 1-3 good weekday evenings (0-1 for parents), 2-4 good weekend slots. A weekly shock (p 0.15) makes a usual slot busy | Usually-free slots (by richness). The opt-in weekly check-in (25% + 35% × energy) lists this week's truly free slots, with recall 0.85 and 0.05 false |
| Reliability | Flakiness (log-normal, median 0.08), reply probability (N(0.85, 0.1)), honesty | Only through history (no-shows, the reliability hold-out) |
| Travel | True tolerance (stated + N(0, 5)), travel cost | Stated max minutes (20 / 30 / 40 / 45 / 60) |
| Other | Appetite, loneliness, new to the city, warmth (actor), likability (partner) | New to the city: agent_private, never shown |
| Chemistry | Per pair, symmetric, N(0, 0.55), unknowable | none |
| Adversaries | romance_seeker 2.5%, mlm 1.5%, bot 2%, harasser 1%, age_liar | Safety cues observed in onboarding chat, 15-70% by kind and richness; 1% false positives (5% age signal for claimed ≤ 20) |
| Verification | Selfie liveness: people pass 95%, 4% pending; bots fail 85%. Age assurance: facial estimate (true age + N(0, 2.5)); under 25 → ID check; real adults finish 90%; lying minors fail 97% | `verify:liveness:*`, `verify:age:*`. Pending checks finish at 0.25 per week (real people only) |
| Human review | A reviewer reads each flagged chat weekly: honest false positives are cleared at 0.6 per week; real adversaries are wrongly cleared at 0.05 per week | `review:cleared` |

Each member's canary is planted in one agent_private fact. The tests check:
- the canary never appears in any explanation or probe;
- changing any hidden field leaves the snapshot byte-identical;
- no hidden field name or adversary label appears in the snapshot.

### Harness (weekly)

1. The check-in.
2. The matcher reads only the snapshot and returns proposals:
   - new plans (groups);
   - partner intros (one-to-one);
   - "same table again" repeats;
   - crew offers;
   - crew sessions.
3. **Anonymous probes with 1-3 time options.** A yes picks the options the member is truly free for.
   - A plan books the option most yes-sayers picked once quorum is reached (3 for groups, 2 for pairs). Seats are capped at 6 and alternates backfill.
   - A pair is probed first-then-second.
4. **The reveal is the booked plan**, and that is when a "contact" happens.
   - A member may back out (4%, +30% if someone they did not want to see again is there).
   - Bots show up in the group thread.
5. **The meetup.** Attendance, enjoyment, harms, the private "see again?" answers and the rating the member reports (honesty-filtered), and hours together.
6. **Crews.** An offer is opted into person by person; at least 3 opt-ins form the crew. Sessions are weekly. After 3 sessions the crew is handed to its own chat and keeps meeting on its own, decaying 3% a week.
7. **Pairs who both want more meet on their own.** These hangouts are hidden from the Network but count toward hours.

**Caps** (the founder decisions carried to every app, PRD 40.4):
- 1 new-plan invite per member per week (the plan allowance);
- 2 one-to-one intros per week (the intro cap);
- repeats and crew offers ride on the member's own post-meetup answer, and crew sessions are opted into, so none of these count;
- at most 2 booked meetups a week, never two in one slot.

A proposal naming a claimed minor is dropped and counted.

## 2. Oracle and calibration

- **Acceptance.**
  - Formula: P(yes) = (0.5 + 0.5 appetite) × (0.5 + 0.5 like) × travel × size comfort × 0.8^(probes this week) × 1.3 if this week's check-in covers an option. It is capped at 0.95 and given only if free at one of the options.
  - Travel factor: 1 − 0.1 t/tol within tolerance, decaying beyond it.
  - Repeat or crew invites use max(like, 0.35 + 0.7 × previous enjoyment) × 1.2 after a good time.
  - Adversaries say yes 70-90%.
- **Attendance:** (1 − flakiness) × (1 if free, else 0.3) × 0.7 if the trip exceeds 1.3× tolerance. Bots never come.
- **Enjoyment:**
  - Formula: e_i = σ(0.35 + 2.0 (like − 0.5) + mean_j [chem + similarity + 0.4 likability_j] + warmth + energy balance + 0.9 bond − travel cost − size discomfort + N(0, 0.35)).
  - `bond` is hours with that person at meetups both enjoyed (10 h saturates). This makes repetition pay.
  - A meetup is "good" by least misery (min e ≥ 0.45).
  - A romance seeker halves one victim's enjoyment, a harasser cuts one victim's to 0.3, and an MLM pitch cuts everyone's to 0.8.
- **See again (i→j):** σ(6 (e_i − 0.55) + 1.4 chem + 1.5 sim + 0.5 likability_j + 0.8 bond − 0.6), and −2.5 toward an adversary.
- **Hours** (Hall 2018: about 50 h casual friend, about 90 friend, 200+ close):
  - A meetup gives each pair its duration if ≤ 4 came, else × 3/(n−1), plus 0.75 h when both enjoyed it.
  - Own hangouts add 2.5 h with p = 0.22 × min(1, meetups/2) × exp(−max(0, t−15)/20) × √(appetite_a × appetite_b) per week. This is proximity plus repeated unplanned interaction (Back, Schmukle & Egloff 2008; Adams).
- **Transit** (`packs/friends/geo.ts`):
  - The agent sees access overheads + 4 min wait + 2.2 min/km + a borough-crossing penalty (Staten Island ferry +25).
  - The truth is that estimate × a fixed per-route log-normal error (SD 0.15).
  - NYC has 262 NTAs; this table is a 93-neighborhood subset. `prototypes/poc-travel-time` validated the cell heuristics for walking, cycling and driving, not for transit.

**Calibration** (8 weeks, seeds 1-4; `bun run packages/worlds/src/friends/calibrate.ts`):

| Measure | random (reshuffled) | friendsPack | oracle | Anchor |
|---|---:|---:|---:|---|
| P(yes \| probed) | 41.7% | 40.6% | 59.4% | Plans sim plan-probe yes 53% (2026-10-08-plans.md); slop probe yes 42% |
| P(came \| booked) | 86.2% | 87.6% | 88.8% | Booked-plan reveal with an opt-out; free Meetup events are worse |
| Mean enjoyment | 0.570 | 0.613 | 0.711 | none |
| Attendees who would do it again (e ≥ 0.6) | 48.6% | 56.9% | 80.5% | Timeleft self-reports 96% "felt compatible" (marketing; not used) |
| Meetups with ≥ 1 mutual "see again" (C1 Quality) | 38.6% | 62.2% | 80.1% | none |
| Own hangouts per week (whole world) | 1.3 | 7.0 | 9.8 | none |

**How the calibration was set (disclosed).** The world was recalibrated three times while the pack was being built on seeds 1-2. Each change applies to every arm equally, and each was made against an outside anchor, not a pack result:

1. **A hashing bug.** FNV-1a draws that differ only in the last key part (week 3 vs week 4, slot 2 vs slot 3) were correlated, so verification, review and availability were frozen across weeks. Every uniform now goes through the murmur3 finalizer (`h01`).
2. **The yes model** was raised from about 31% to about 42% on a reshuffled invite, toward the plans simulator's 53% and slop's 42%.
3. **The enjoyment intercept** was raised (−0.15 → 0.35) so that about half of reshuffled attendees would do it again, rather than about a quarter.

No world parameter changed after the pack's structure was settled (tuning trail step 5).

## 3. friendsPack (`packages/engine/src/packs/friends/`)

| Slot | friendsPack |
|---|---|
| Ontology | Lanes `social` and `hobby` (default on); **no romance lane**; non-romance objectives only; `mutualPreferenceMatch` is always false. Warm edges are `would_interact_again`, `enjoyed`, `knows`, vouches and invites; a bare `met` is not warm |
| Eligibility (`rules.ts`) | Member rules, in order: `romance_excluded`, category opt-in, **`unverified`** (liveness and age both passed; fails closed), **`safety_review`** (an uncleared cue), only-when-asked, the reliability hold-out, **`group_first`** (one-to-one only after attending a group). Pair rules: `romance_excluded`, negative-feedback cooldown, dealbreakers. Configuration rules: `romance_excluded`, group size. Account tier 13-17 never matchable; minMatchAge 18 |
| Geo | `friendsGeo`: NYC market only; city-bucket overlap held to NYC; `pairReason` = the estimated trip between two homes exceeds the sum of the two tolerances (symmetric); bucketed minute copy. `chooseVenue` minimizes the group's **longest** trip |
| Generators (runEngine) | `same_table_again` (people with a mutual "see again" after a completed meetup), `zone_interest_group` (a 3-6 group around a shared interest within a planning zone), `activity_partner` (nearest one-to-one partner by transit, groups first) |
| Consent | Anonymous probe first; pairs are probed in parallel and named only on mutual yes; `group_rsvp` (quorum 3) for groups |
| Attention | `DEFAULT_ATTENTION`; network calibrator knots borrowed (no friends labels yet); a romance item is gated; probe copy is activity-first with no romance framing (`ROMANCE_FRAMING` is asserted absent) |
| Plans | `FRIENDS_PLANS` (`friends-plans-0.1.0`): lead time 30 h to 6.5 days, groups of 3-6 (invite 6 + 6 alternates), familiarity bonus 0.08 with **no clique penalty**, crews after one great plan, hand-off after 3 sessions |
| Judge | None. The friends rubric (domain research C4) is future work |
| Metrics / gates | In `friendsPack.metrics` (section 5) |

**The weekly planner** (`planner.ts`, `planFriendsWeek`) is built on the shared plans planner. It uses `planProposals`, `scorePlanGroup` (least misery), `activityFit`, `hasWindow`, `detectCrews`, `crewSessionPlan`, `buildPlanProbe` and the attention slots. Each week it runs these steps in order:

1. **Crew sessions:** the same weekday and time, opt-in, quorum 2.
2. **Crew offers:** after one great plan, when at least 3 attendees would do it again. "Would do it again" means a positive rating, or a mutual "see again" with another attendee.
3. **Same table again:** at least 2 positive attendees get the same activity at the same time next week, including the people whose crew offer did not form.
4. **New plans, near home first.**
   - **Dinner or coffee tables** come first, within 25 and then 35 minutes of each zone hub. These activities are open to any member who wants to meet people: fit 0.75 when not stated.
   - **Activity tables** come next. Least-misery greedy build, up to 12 invitees asked at once ("open table"); the first 6 yes-sayers at the time get the seats. Building them gives +0.2 for someone a member already said they'd see again: the repeat bias.
   - **The shared planner's single-time passes** run per zone, then per borough, then a looser family-fit pass.
   - **Venue:** the public venue that minimizes the longest trip. Invitees whose estimated trip exceeds 1.15× their tolerance are dropped.
5. **Activity partners:** one-to-one, on the intro cap, from the engine's `activity_partner` generator, for members who have already attended a group. They get 2-3 time options.

**Time options.** Tables carry one time. Plans from the shared planner and partner intros carry up to three. With several options on a table, the yes-sayers split across times and fail quorum; this was measured, and three options cost 2.3 V14 points and 5 repeat points.

## 4. Tuning trail (seeds 1-4, 8 weeks)

V14 / repeat at each step, mean of seeds 1-2 or 1-4:

| Step | V14 | Repeat | What it showed |
|---|---:|---:|---|
| 1. Shared planner per zone (slot-first), as the plans doc specifies | 8% | 11% | At 400 members a zone has about 4 people per (time, activity), so almost no groups of 4+ form; 80% of plans were pairs |
| 2. + radius passes (25 / 35 min), borough and loose passes, open table | 10% | 13% | Groups of 4; about 35% yes, so quorum 3 of 4 fails 80% of the time |
| 3. + multi-time activity tables | no gain | none | Options covering different members split the yes-sayers across times |
| 4. + partner intros on the intro cap (founder caps: 2 intros + 1 plan a week) | +1-2 | none | Pairs need only 2 yeses |
| 5. *World recalibration and hashing fix (section 2)* | 17% | 17% | All arms moved |
| 6. **Dinner/coffee tables first, one time, 12 invited** | **32%** | 23% | The Timeleft base layer near home: the decisive change |
| 7. Members in a crew or repeat may also get a new table (`spreadNew` off) | 36% | 34% | More seats; repeats no longer crowd out new tables |
| 8. Feedback review (≥ 3 "no" and no "yes" holds a member) | none | −9 | **Rejected.** Precision 10 adversaries vs 66 honest members flagged (3 seeds) |
| 9. Exposure-floor ordering (starved members first) | −1 | −10 | **Rejected.** No Staten Island gain |
| 10. Sparse-zone tables (4 invitees within 45 min) | −1 | −6 | **Rejected.** No Staten Island gain |

Final tuning-seed result (seeds 1-4): V14 36.5% ± 2.3, repeat 35.8% ± 2.3, friendship forming 10.0% ± 1.7 (random 1.3%), travel 27.0 min.

## 5. Gate table (held-out seeds 5-8)

| Gate | Proposed | Pack, 8 weeks | Pack, 12 weeks | Random / oracle, 8 weeks | Verdict |
|---|---|---:|---:|---:|---|
| Repeat-meetup rate (≥ 2 of a meetup meet again within 30 days) | ≥ 30% | **33.7% ± 4.2** | 27.4% ± 1.7 | 13.3% / 37.1% | **Pass at 8 weeks**; fails at 12 (crews hand off and new tables dilute) |
| V14 | ≥ about 60% | 34.7% ± 0.5 | 34.5% ± 0.6 | 17.0% / 42.1% | **Fail** as proposed: the oracle bound is 42%. **Adjusted** to ≥ 0.75× oracle and ≥ 1.75× random: 0.82× and 2.0×, **pass** |
| Members with a friendship forming (pair met 3+ times, mutual "see again"; C1) | ≥ 2× random | **9.4%** (3.9×) | 17.1% (2.4×) | 2.4% / 18.9% | **Pass** |
| Same, Hall pace (≥ 12 h and on pace for 50 h by month 6) | none | 0.4% | 0.4% | 0.1% / 1.1% | Informational: almost nobody is on Hall pace by week 8-12, even the oracle |
| Median of each group's longest trip | ≤ 35 min | **26.9** | 27.0 | 24.6 / 31.3 | **Pass** (greedy, with no geography: 39.9) |
| No borough below 0.7× V14 (≥ 10 real members) | ≥ 0.7 | 0.20 ± 0.14 | 0.20 | 0.57 / 0.41 | **Fail**: Staten Island 1.5% |
| Same, boroughs with ≥ 30 members | ≥ 0.7 | 0.68 ± 0.06 | 0.76 ± 0.04 | 0.70 / 0.81 | Borderline (Bronx 24.7% vs 34.7%); passes at 12 weeks and on seeds 1-4 (0.79) |
| Declared-minor contacts and proposals | 0 | **0** | **0** | 0 / 0 | **Pass** (core) |
| Hidden-minor contacts (age liars past the ID check) | 0 | **0** | 0.5 ± 0.5 | 7.3 / 0 | Pass on held-out 8 weeks; 0.5-1 per seed elsewhere (a borrowed ID gets through 3% of the time) |
| Known-adversary contacts (visible red flag or hold before the proposal) | 0 | **0** | **0** | 29.8 / 0 | **Pass** |
| All adversary contacts (distinct member-pairs) | 0 | 50.5 ± 6.1 | 58.8 | 53.3 / 0 | **Fail** as written; adversaries reached 11.0 vs 19.3, harms 17.5 vs 41.5 |

### Full held-out comparison

Seeds 5-8, 8 weeks (`bun run packages/worlds/src/friends/cli.ts --seeds 5-8 --weeks 8`):

| Metric | pack | random-within-area | greedy-popular | oracle |
|---|---:|---:|---:|---:|
| Meetups held / seed (crew sessions) | 191.3 (12.5) | 99.3 | 27.5 | 231.3 |
| Probe yes / quorum rate | 40.1% / 34.9% | 42.0% / 17.1% | 23.3% / 5.1% | 60.4% / 52.1% |
| Good meetups (least misery) | 55.9% | 44.8% | 55.9% | 89.6% |
| Repeat (≥ 2 again) / same group (≥ 3 again) | 33.7% / 8.2% | 13.3% / 0.5% | 4.7% / 1.6% | 37.1% / 14.6% |
| Crews formed / handed off per seed | 9.8 / 1.8 | 0 | 0 | 0 |
| Hours with members per real member (top person) | 8.1 (2.4) | 3.0 (1.4) | 0.7 (0.4) | 12.1 (3.7) |
| Friendship forming | 9.4% | 2.4% | 0.1% | 18.9% |
| Members with a meetup / median days to the first | 69.8% / 14.5 | 49.2% / 23.3 | 16.2% / 29.5 | 78.3% / 12.3 |
| V14 | 34.7% | 17.0% | 4.4% | 42.1% |
| V14 by borough (Manhattan / Brooklyn / Queens / Bronx / Staten Island) | 41.6 / 36.2 / 33.0 / 24.7 / 1.5 | 16.3 / 19.2 / 16.4 / 14.4 / 9.2 | 5.8 / 4.6 / 3.7 / 3.7 / 0 | 49.1 / 44.6 / 36.9 / 37.2 / 9.3 |
| Median group max trip / seats over tolerance | 26.9 min / 6.9% | 24.6 / 6.4% | 39.9 / 17.3% | 31.3 / 5.8% |
| Gini of meetups / real members with none | 0.517 / 30.2% | 0.617 / 50.8% | 0.856 / 83.8% | 0.438 / 21.7% |
| Known-adversary / all adversary contacts / adversaries reached | 0 / 50.5 / 11.0 | 29.8 / 53.3 / 19.3 | 12.8 / 21.5 / 10.3 | 0 |
| Hidden-minor contacts / harm events | 0 / 17.5 | 7.3 / 41.5 | 2.8 / 19.0 | 0 / 0 |

**Adversary contacts by kind (pack).** Romance seekers 32.5, harassers 11.3, MLM 6.8, bots 0. Liveness removes bots. Romance seekers are the main residual: only 30-65% show a cue at onboarding, and they say yes to almost everything.

**At 12 weeks (held out).** Meetups 283.5, V14 34.5%, repeat 27.4%, friendship forming 17.1% (random 7.0%, oracle 34.0%), crews 12.5 (3.5 handed off), hours with the top person 3.3. No pair crosses 50 h in any arm: Hall's thresholds are months away even with weekly crews.

## 6. Ablations (seeds 1-8, 8 weeks; one change each)

| Arm | Meetups | Repeat | Friendship forming | V14 | Borough ratio (≥ 30 members) | Group max trip | Adversary pairs |
|---|---:|---:|---:|---:|---:|---:|---:|
| **pack** | 195.8 | **34.7%** | 9.7% | **35.6%** | 0.73 | 27.0 | 56.5 |
| no crews | 189.6 | 26.3% | 9.7% | 34.6% | 0.78 | 27.3 | 58.6 |
| no crews, no repeat or regrouping | 178.6 | **17.8%** | **5.2%** | 34.5% | 0.78 | 27.4 | 57.4 |
| no dinner/coffee tables | 114.0 | 25.8% | 4.8% | **19.7%** | 0.55 | 28.6 | 30.3 |
| shared planner only (no tables) | 130.3 | 25.6% | 5.8% | 20.7% | 0.63 | 27.3 | 27.4 |
| no planning zones (city-wide pools) | 151.3 | 26.1% | 5.4% | 26.4% | 0.79 | **37.9** | 46.0 |
| no min-max venue | 195.8 | 31.5% | 10.2% | 35.3% | 0.75 | 27.0 | 54.8 |
| no partner intros | 184.3 | 30.2% | 10.9% | 34.8% | 0.79 | 27.1 | 53.6 |
| spread seats (no new table while in a crew or repeat) | 166.0 | 23.8% | 7.6% | 31.2% | 0.74 | 27.3 | 51.4 |
| exposure-floor ordering | 193.4 | 26.5% | 9.7% | 35.7% | 0.81 | 27.5 | 55.5 |
| 3 time options per table, split tables | 192.9 | 29.3% | 10.4% | 34.1% | 0.81 | 26.2 | 53.9 |

What the ablations show:

- **Repetition is what makes friendships.** Removing crews, "same table again" and regrouping halves the repeat rate (34.7% → 17.8%) and the friendships forming (9.7% → 5.2%), while V14 is unchanged. Value per se comes from coverage; friendships come from repetition (Hall; Adams).
- **Dinner/coffee tables near home carry coverage.** Without them V14 drops to 19.7%.
- **Zones carry proximity.** City-wide pools push the median longest trip to 37.9 min and cost 9 V14 points.
- The min-max venue (on top of zone pooling) and the partner intros are within noise here.

## 7. Sensitivity

| Run (seeds 5-8, 8 weeks) | V14 pack / random / oracle | Repeat pack | Friendship forming pack / random | Staten Island V14 (pack) | Borough ratio (≥ 30) |
|---|---|---:|---|---:|---:|
| 400 personas (base) | 34.7 / 17.0 / 42.1 | 33.7% | 9.4% / 2.4% | 1.5% | 0.68 |
| 1,200 personas | 37.9 / 18.9 / 49.2 | 29.1% | 10.9% / 1.9% | 15.4% (n ≈ 32) | 0.49 (Staten Island now counted) |
| Plan allowance 2 per week | identical to base | | | | |

Every arm already sends at most one new-plan invite per member per week, so the allowance is not the binding constraint. The binding constraints are the yes rate × quorum and density.

## 8. Conformance and tests

**`packages/worlds/test/friends-conformance.test.ts`** runs `runConformance(friendsPack)` on four friends worlds. Each world is a snapshot after 3 weeks of friendsPack meetups, with:
- 160 personas, including 13-17 year olds and age liars;
- adversaries and canaries;
- holds and blocks from reports;
- feedback history.

It passes:
- registration;
- minors (1, 1b);
- blocks;
- consent before reveal;
- the leak gate;
- determinism;
- attention;
- geo.

Check 6 (the judge) is skipped because the pack has no judge. The test runs on friends worlds rather than the testkit's network worlds because friendsPack fails closed on verification, so the testkit world, which has no verification facts, yields no proposals.

The friends-specific checks:
- **No romance lane or objective.** `romance_excluded` at member, configuration, attention-item and probe level.
- **No romance framing** in any explanation, engine probe or plan probe (`ROMANCE_FRAMING` regex), and no canary in any of them.
- **No claimed minor in any plan role** (sessions, offers, repeats, tables, partners).
- **Members with an uncleared cue, an unpassed check or a hold** are in no runEngine proposal and no planner plan.
- **In the simulator** (2 seeds × 8 weeks): 0 declared-minor proposals and contacts, 0 known-adversary contacts.

**`packages/worlds/test/friends.test.ts`** (15 tests) covers:
- determinism;
- hidden-truth invariance of the snapshot;
- canary scope;
- minors and liars;
- verification and review over time;
- geo (symmetry, min-max venue, slot round-trip);
- oracle symmetry and the bond effect;
- harness caps and seats;
- baselines.

## 9. Limits and next steps

- **The world is calibrated to outside anchors, not to friends.help data.** Recalibrate on pilot data: the yes rate to a dinner table near home, attendance, "see again" rates and crew retention. The oracle bound on V14 depends mostly on the yes rate.
- **No judge yet.** Domain research C4 has the rubric: hard constraints, a reason per member, balance, repeat potential, safety, shareable explanations.
- **Not modelled:**
  - affinity tables (women-only, LGBTQ+);
  - 21+ alcohol venues beyond `ageMin` (no wine-bar member fit);
  - budgets;
  - accessibility;
  - weather and subway disruption;
  - hosts burning out;
  - outside-world events, which V14 would count as value (the attention results show they raise V14).
- **Staten Island needs either a car or ferry model, or a policy decision.** Options: SI-only tables at St. George with longer tolerances, or one-to-one partners before a group. The second conflicts with groups-first and is not done.
- **Undetected romance seekers are the main residual safety risk.** Options:
  - a post-meetup "anyone make you uncomfortable?" check feeding holds faster;
  - first tables hosted by a veteran;
  - a dating-intent classifier on relay messages.

  Feedback-only flagging was tried and rejected (section 4).
- **Transit is a heuristic over 93 neighborhoods.** Production needs the 262-NTA OTP/r5 matrix on MTA GTFS.

## Commands

```bash
export OPENAI_API_KEY= SURPLUS_API_KEY= CEREBRAS_API_KEY=
bun run packages/worlds/src/friends/cli.ts --seeds 5-8 --weeks 8 --only pack,random,greedy,oracle   # held-out table
bun run packages/worlds/src/friends/cli.ts --seeds 5-8 --weeks 12                                   # 12 weeks
bun run packages/worlds/src/friends/cli.ts --seeds 1-8 --only pack,pack-no-crews,pack-no-repeat,pack-no-universal,pack-planner-only,pack-no-zones,pack-no-minmax,pack-no-partner,pack-spread,pack-fairness,pack-options3
bun run packages/worlds/src/friends/cli.ts --seeds 5-8 --n 1200 --only pack,random,oracle          # density
bun run packages/worlds/src/friends/calibrate.ts --seeds 1-4
bun test --conditions eliza-source ./packages/worlds ./packages/engine
```

Runtime: one pack run (400 personas, 8 weeks) takes about 3.5 s.

## References

- Hall, J. A. (2018). How many hours does it take to make a friend? *Journal of Social and Personal Relationships*. About 50 h for a casual friend, about 90 for a friend, 200+ for a close friend.
- Back, M. D., Schmukle, S. C., & Egloff, B. (2008). Becoming friends by chance. *Psychological Science* 19. Randomly assigned seat neighbours became friends.
- Adams, R. G. (via the NYT, 2012). Proximity, repeated unplanned interaction, and a setting to confide.
- Domain research `docs/research/2026-10-08-domain-research.md` Part C:
  - the landscape: Timeleft, 222, Pie, Les Amis, Bumble BFF reshuffle strangers;
  - the 262 NYC NTAs;
  - safety and age policy;
  - the C1 metrics ("friends who met 3+ times", repeat within 30 days).
- PRD 40.6 / 40.8 (`docs/prd-snapshot.md`); `docs/results/2026-10-08-plans.md` (planner, crews, allowance); `docs/results/2026-10-07-attention-budget.md` (caps, V14); `docs/results/2026-10-08-app-packs-core.md` (contract, conformance).
