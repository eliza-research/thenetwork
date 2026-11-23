# Date pack value

This library gives the Date lane's pack term: one member's directed value of a first date with another member, from `0` to `1000`. The [reciprocal pair value](pairValue.md) weighs it with the other utility terms, and the [relationship lanes](matchLane.md) spec gives the Date weights (complement 3, affinity 2, pack 3) and the Date utility floor of 350. The [candidate search](candidateSearch.md) uses the bounds of this library in place of a full pack value. The flow models are the [matching engine](models/matching_engine.md) and the [candidate pool](models/candidate_pool.md). It serves [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction).

The slop pack shell (`packages/engine/src/packs/slop/score.ts`) reads each member's stated answers from the profile and supplies them as the sum types below. It also supplies four pair inputs: the number of shared interests, whether the planned activity misses the seeker's stated activities, the body-type fit, and whether the two members stated a common free slot. Three factors come from numbers that are not integer tables: the stated type against the partner's self-description, the seeker's revealed taste from post-date ratings, and the seeker's revealed body-type preference. The shell computes each as a permille factor and supplies it with the seeker's ceiling for that factor; this library clamps each factor at its ceiling. The shell keeps the hard filters (stated dealbreakers, age, orientation, distance, blocks), the appearance standing, and all storage. The value is private: it never appears in member-facing text.

Stated preferences are filters in the shell (`rules.ts`), so this value counts only compatibility signals: goals, lifestyle answers, shared interests, the planned activity, the stated type against the partner's self-description, the seeker's own revealed taste, logistics, and body type. The stated type has a small weight by design, because a stated type predicts little about who a person enjoys on a date (Eastwick and Finkel 2008). The revealed taste is a property of one pair, so no property of one member alone enters the value; the appearance rating is the member's private lane standing and is not a factor here ([member standing](memberStanding.md), "Story: Estimate standing from facts, never from popularity"). An unknown answer gives an expected factor, never zero and never a guess shown as a fact. The value reads no race or ethnicity (the profile has no such field) and no hidden simulator truth. The pack option `learned.enabled` turns the revealed-taste factor off (the factor is then 1000), and the body-type options `enabled`, `minConfidence` and `revealedShrink` select which partners have a confident rated body type and how much the revealed body-type preference shrinks toward 0. These options are not second paths of this library: they choose which input the shell supplies (a measured factor or the neutral 1000), and every table and the clamp stay the same. Production uses the defaults (both on); the simulator turns them off only in its ablation arms (`packages/sim/src/apps/slop/packEval.ts`).

This spec replaces the floating-point pack value of the slop pack (`compatEstimate`, `directional`, `logistics` and `bodyTypeFactor`) and its option tables (`compat`, `logistics`, `learned.taste`, `statedWeight`, `revealedWeight`). It does so because the candidate search needs a proved upper bound on the pack term, and a bound is provable only on integer arithmetic. The tables are now fixed in this spec. The slop pack evaluation presets `x typeWeight 0.3` and `- no compat model` set the removed options and are removed with them. Decision (2026-11-22): do not restore them as options, because an option that changes a proved table is a second path; a new ablation is a change to this spec.

## Story: Value a first date from stated answers

> As a member of slop.date, I want the agent to propose a first date with someone whose stated answers fit mine, and I want an unknown answer to count as a small doubt, never as a fact.

### Each stated answer gives a factor from a fixed table

A factor is in permille: `1000` is no change. A goal clash (casual against long-term) gives 600. A goal that differs in another way, or a goal that either member did not state, gives 850. A clash between two stated answers gives 800 for smoking (never against regular), 850 for drinking (never against regular), 850 for a religion importance gap of 2 or more, and 750 for politics (left against right). A wants-kids clash (yes against no) gives 700, and counts only when the seeker's goal is not casual. Each answer that either member did not state gives one unknown answer, and the unknown answers together give a factor of `0.97` to their number, in permille: 1000, 970, 941, 913, 885 and 859 for 0 to 5 unknown answers. A negative religion importance means not stated. Each entry is the float of the replaced model rounded to permille (0.6, 0.85, 0.8, 0.85, 0.85, 0.75, 0.7 and 0.97), so that the integer value moves as little as possible from the measured model.

```quint
pure val datePackScale: int = 1000

type DateGoal = DateGoalCasual | DateGoalLongTerm | DateGoalUnsure | DateGoalUnstated
type DateHabit = DateHabitNever | DateHabitOccasional | DateHabitRegular | DateHabitUnstated
type DateKids = DateKidsYes | DateKidsNo | DateKidsOpen | DateKidsUnstated
type DatePolitics = DatePoliticsLeft | DatePoliticsRight | DatePoliticsMiddle | DatePoliticsUnstated

type DatePackAnswers = {
  goal: DateGoal, smoking: DateHabit, drinking: DateHabit, religionImportance: int,
  politics: DatePolitics, hasKids: DateKids, wantsKids: DateKids
}

pure def dateGoalFactor(own: DateGoal, other: DateGoal): int =
  if (own == DateGoalUnstated or other == DateGoalUnstated) 850
  else if ((own == DateGoalCasual and other == DateGoalLongTerm) or (own == DateGoalLongTerm and other == DateGoalCasual)) 600
  else if (own != other) 850
  else 1000

pure def dateHabitClash(own: DateHabit, other: DateHabit, clash: int): int =
  if ((own == DateHabitNever and other == DateHabitRegular) or (own == DateHabitRegular and other == DateHabitNever)) clash
  else 1000

pure def dateReligionClash(own: int, other: int): int =
  val gap = if (own > other) own - other else other - own
  if (own >= 0 and other >= 0 and gap >= 2) 850 else 1000

pure def datePoliticsClash(own: DatePolitics, other: DatePolitics): int =
  if ((own == DatePoliticsLeft and other == DatePoliticsRight) or (own == DatePoliticsRight and other == DatePoliticsLeft)) 750
  else 1000

pure def dateKidsCounted(ownAnswers: DatePackAnswers): bool = ownAnswers.goal != DateGoalCasual

pure def dateKidsClash(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if (dateKidsCounted(ownAnswers) and
      ((ownAnswers.wantsKids == DateKidsYes and partner.wantsKids == DateKidsNo) or
       (ownAnswers.wantsKids == DateKidsNo and partner.wantsKids == DateKidsYes))) 700
  else 1000

pure def dateUnstatedCount(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  (if (ownAnswers.smoking == DateHabitUnstated or partner.smoking == DateHabitUnstated) 1 else 0) +
  (if (ownAnswers.drinking == DateHabitUnstated or partner.drinking == DateHabitUnstated) 1 else 0) +
  (if (ownAnswers.religionImportance < 0 or partner.religionImportance < 0) 1 else 0) +
  (if (ownAnswers.politics == DatePoliticsUnstated or partner.politics == DatePoliticsUnstated) 1 else 0) +
  (if (dateKidsCounted(ownAnswers) and (ownAnswers.wantsKids == DateKidsUnstated or partner.wantsKids == DateKidsUnstated)) 1 else 0)

pure def dateUnstatedFactor(count: int): int =
  if (count <= 0) 1000
  else if (count == 1) 970
  else if (count == 2) 941
  else if (count == 3) 913
  else if (count == 4) 885
  else 859
```

### A partner's answer that is often a dealbreaker counts when the seeker stated no dealbreakers

When the seeker stated no dealbreakers, each partner answer that people often hold as a dealbreaker lowers the value: a regular smoker for a seeker who does not smoke or did not say (720), a regular drinker for a seeker who does not drink regularly (877), a partner with kids for a seeker without kids (906), a wants-kids clash (720), an important religion for a seeker to whom religion is not important (877), no religion for a seeker to whom religion is important (720), and opposite politics (720). The factors are `0.72` to the powers 1, 0.4 and 0.3 of the measured model, in permille. The base 0.72 is `1 - 0.35 x 0.8` of the replaced model, where 0.35 was its chance that such an answer is a real dealbreaker; the powers were its weights per answer, and a table per answer replaces the float power so that the value is an integer product. A seeker who stated dealbreakers has them as hard filters in the shell, so these factors are 1000.

```quint
pure def dateHiddenSmoking(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if (partner.smoking == DateHabitRegular and (ownAnswers.smoking == DateHabitNever or ownAnswers.smoking == DateHabitUnstated)) 720 else 1000

pure def dateHiddenDrinking(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if (partner.drinking == DateHabitRegular and ownAnswers.drinking != DateHabitRegular) 877 else 1000

pure def dateHiddenHasKids(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if (partner.hasKids == DateKidsYes and ownAnswers.hasKids != DateKidsYes) 906 else 1000

pure def dateHiddenWantsKids(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if ((partner.wantsKids == DateKidsYes and ownAnswers.wantsKids == DateKidsNo) or
      (partner.wantsKids == DateKidsNo and ownAnswers.wantsKids == DateKidsYes)) 720 else 1000

pure def dateHiddenReligion(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if (ownAnswers.religionImportance < 0 or partner.religionImportance < 0) 1000
  else if (partner.religionImportance >= 2 and ownAnswers.religionImportance == 0) 877
  else if (partner.religionImportance == 0 and ownAnswers.religionImportance >= 2) 720
  else 1000

pure def dateHiddenPolitics(ownAnswers: DatePackAnswers, partner: DatePackAnswers): int =
  if ((partner.politics == DatePoliticsRight and ownAnswers.politics == DatePoliticsLeft) or
      (partner.politics == DatePoliticsLeft and ownAnswers.politics == DatePoliticsRight)) 720 else 1000
```

### Shared interests, the planned activity, logistics and body type give factors from fixed tables

No shared interest gives 880, one gives 950, and two or more give 1000. A planned activity that is not one of the seeker's stated activities gives 920. A common free slot gives 1000, no common slot gives 750, and a partner who stated no free slot gives 900; a seeker who stated no free slot gets 900 with every partner. When the seeker stated body-type preferences, a partner whose rated body type is one of them gives 1350, one whose rated body type is not gives 741, and a partner without a confident rating gives 1000. These entries replace the floats 0.88, 0.95, 1, 0.92, 0.75, 0.9 and `exp(0.3)` and `exp(-0.3)` of the replaced model, rounded to permille, so that the planned activity, logistics and body type keep their measured strengths.

```quint
type DateBodyFit = DateBodyWanted | DateBodyNotWanted | DateBodyUnrated
type DateSlots = DateSlotsShared | DateSlotsApart | DateSlotsUnknown

pure def dateInterestFactor(shared: int): int =
  if (shared <= 0) 880 else if (shared == 1) 950 else 1000

pure def dateActivityFactor(activityMiss: bool): int = if (activityMiss) 920 else 1000

pure def dateSlotsFactor(statesFreeSlots: bool, slots: DateSlots): int =
  if (not(statesFreeSlots)) 900
  else if (slots == DateSlotsShared) 1000
  else if (slots == DateSlotsApart) 750
  else 900

pure def dateBodyFactor(statesBodyPrefs: bool, bodyFit: DateBodyFit): int =
  if (not(statesBodyPrefs)) 1000
  else if (bodyFit == DateBodyWanted) 1350
  else if (bodyFit == DateBodyNotWanted) 741
  else 1000
```

### A measured factor counts only up to the seeker's ceiling

The shell supplies the stated-type factor, the revealed-taste factor and the revealed body-type factor in permille, and the seeker's ceiling for the last two. The stated-type factor is `exp(0.1 x match)` with the match between -2 and 2, so its ceiling is 1222 when the seeker stated a type and 1000 otherwise. The weight 0.1 is `DATE_TYPE_WEIGHT` in the shell: a change to the weight must change `dateTypeCeiling` too, and the bound test (`packages/engine/test/date-pack-bound.integration.test.ts`) fails when the largest shell factor is above the ceiling. The revealed-taste factor is `exp(t)` in permille, where `t` is the mean of `(rating - 0.5) x cosine` over the seeker's rated dates, divided by the number of ratings plus 1. The shell gives the taste ceiling as `exp` of the mean of `|rating - 0.5|` over the same count, rounded up, because no cosine is above 1. The revealed body-type factor is `exp(r)` in permille, where `r` is the seeker's shrunk mean rating difference for the partner's body type, and the shell gives its ceiling as the largest such factor over the body types the seeker rated, and at least 1000. Each ceiling counts between 0 and 3000. A factor counts between zero and its ceiling. The revealed body-type factor counts only when the seeker stated no body-type preference. These three factors were floating-point `exp` terms in the replaced model; they become bounded permille inputs with ceilings because an `exp` of a measured number is not an integer table, and the ceilings let the bounds below count them without the costly pair inputs.

```quint
pure val datePackBoostMost: int = 3000
pure val dateTypeCeiling: int = 1222

pure def datePackBoostTop(ceiling: int): int =
  if (ceiling < 0) 0 else if (ceiling > datePackBoostMost) datePackBoostMost else ceiling

pure def datePackBoost(factor: int, ceiling: int): int =
  val top = datePackBoostTop(ceiling)
  if (factor < 0) 0 else if (factor > top) top else factor

type DatePackSeeker = {
  answers: DatePackAnswers, statesDealbreakers: bool, statesType: bool, statesBodyPrefs: bool,
  statesFreeSlots: bool, tasteCeiling: int, bodyLearnedCeiling: int
}

pure def dateTypeTop(seeker: DatePackSeeker): int = if (seeker.statesType) dateTypeCeiling else datePackScale

pure def dateBodyLearnedTop(seeker: DatePackSeeker): int =
  if (seeker.statesBodyPrefs) datePackScale else datePackBoostTop(seeker.bodyLearnedCeiling)

pure def dateBodyLearnedFactor(seeker: DatePackSeeker, bodyLearned: int): int =
  if (seeker.statesBodyPrefs) datePackScale else datePackBoost(bodyLearned, seeker.bodyLearnedCeiling)
```

### The factors multiply in a fixed order with a fixed rounding rule

The product starts at one million and multiplies by each factor in turn, dividing by 1000 with truncation after each step, so three extra digits are kept. A negative factor counts as zero. The directional part (answers, dealbreakers, interests, activity, type and taste) is limited to one million, then logistics and the two body-type factors multiply. The result is rounded half up to permille and limited to `0` to `1000`. The product never falls when any factor rises. The replaced model multiplied floats and rounded once; the truncation after each step gives a different value for about 17% of pairs, by at most 2 permille, and the integer order makes the value and its bounds exact and provable. Measured on 200,000 seeded pairs: 82.8% of values are equal to the replaced model, and the difference has median 0, 99th percentile 1 and maximum 2.

```quint
pure val datePackMicro: int = 1000000

type DatePackFactors = {
  goal: int, smoking: int, drinking: int, religion: int, politics: int, kids: int, unstated: int,
  hiddenSmoking: int, hiddenDrinking: int, hiddenHasKids: int, hiddenWantsKids: int, hiddenReligion: int, hiddenPolitics: int,
  interests: int, activity: int, typeFit: int, taste: int, slots: int, body: int, bodyLearned: int
}

pure def datePackTimes(running: int, factor: int): int =
  val counted = if (factor > 0) factor else 0
  (running * counted) / datePackScale

pure def datePackProduct(factors: DatePackFactors): int =
  val p1 = datePackTimes(datePackMicro, factors.goal)
  val p2 = datePackTimes(p1, factors.smoking)
  val p3 = datePackTimes(p2, factors.drinking)
  val p4 = datePackTimes(p3, factors.religion)
  val p5 = datePackTimes(p4, factors.politics)
  val p6 = datePackTimes(p5, factors.kids)
  val p7 = datePackTimes(p6, factors.unstated)
  val p8 = datePackTimes(p7, factors.hiddenSmoking)
  val p9 = datePackTimes(p8, factors.hiddenDrinking)
  val p10 = datePackTimes(p9, factors.hiddenHasKids)
  val p11 = datePackTimes(p10, factors.hiddenWantsKids)
  val p12 = datePackTimes(p11, factors.hiddenReligion)
  val p13 = datePackTimes(p12, factors.hiddenPolitics)
  val p14 = datePackTimes(p13, factors.interests)
  val p15 = datePackTimes(p14, factors.activity)
  val p16 = datePackTimes(p15, factors.typeFit)
  val p17 = datePackTimes(p16, factors.taste)
  val directional = if (p17 > datePackMicro) datePackMicro else p17
  val q1 = datePackTimes(directional, factors.slots)
  val q2 = datePackTimes(q1, factors.body)
  val q3 = datePackTimes(q2, factors.bodyLearned)
  val rounded = (q3 + datePackScale / 2) / datePackScale
  if (rounded > datePackScale) datePackScale else rounded

pure val lowerValues = Set(
  { goal: 600, smoking: 800, drinking: 850, religion: 850, politics: 750, kids: 700, unstated: 859,
    hiddenSmoking: 720, hiddenDrinking: 877, hiddenHasKids: 906, hiddenWantsKids: 720, hiddenReligion: 720, hiddenPolitics: 720,
    interests: 880, activity: 920, typeFit: 819, taste: 700, slots: 750, body: 741, bodyLearned: 400 },
  { goal: 1000, smoking: 1000, drinking: 1000, religion: 1000, politics: 1000, kids: 1000, unstated: 1000,
    hiddenSmoking: 1000, hiddenDrinking: 1000, hiddenHasKids: 1000, hiddenWantsKids: 1000, hiddenReligion: 1000, hiddenPolitics: 1000,
    interests: 1000, activity: 1000, typeFit: 1222, taste: 1649, slots: 1000, body: 1350, bodyLearned: 2718 },
  { goal: -5, smoking: 0, drinking: 1000, religion: 1, politics: 999, kids: 1000, unstated: 970,
    hiddenSmoking: 1000, hiddenDrinking: 1000, hiddenHasKids: 1000, hiddenWantsKids: 1000, hiddenReligion: 1000, hiddenPolitics: 1000,
    interests: 950, activity: 1000, typeFit: 1000, taste: 1000, slots: 900, body: 1000, bodyLearned: 1000 },
)
pure val upperValues = lowerValues

pure def datePackFactorsAtMost(lower: DatePackFactors, upper: DatePackFactors): bool =
  and {
    lower.goal <= upper.goal, lower.smoking <= upper.smoking, lower.drinking <= upper.drinking,
    lower.religion <= upper.religion, lower.politics <= upper.politics, lower.kids <= upper.kids,
    lower.unstated <= upper.unstated, lower.hiddenSmoking <= upper.hiddenSmoking,
    lower.hiddenDrinking <= upper.hiddenDrinking, lower.hiddenHasKids <= upper.hiddenHasKids,
    lower.hiddenWantsKids <= upper.hiddenWantsKids, lower.hiddenReligion <= upper.hiddenReligion,
    lower.hiddenPolitics <= upper.hiddenPolitics, lower.interests <= upper.interests,
    lower.activity <= upper.activity, lower.typeFit <= upper.typeFit, lower.taste <= upper.taste,
    lower.slots <= upper.slots, lower.body <= upper.body, lower.bodyLearned <= upper.bodyLearned,
  }

pure def lawDatePackProductBounded(lower: DatePackFactors): bool =
  val product = datePackProduct(lower)
  0 <= product and product <= datePackScale

pure def lawDatePackProductMonotone(lower: DatePackFactors, upper: DatePackFactors): bool =
  datePackFactorsAtMost(lower, upper) implies datePackProduct(lower) <= datePackProduct(upper)
```

### The directed pack value is the product of the factors of one pair

The shell supplies, for one seeker and one partner, the cheap pair inputs (shared interests, the stated-type factor, the body-type fit and the free slots) and the costly ones (whether the planned activity misses, the revealed-taste factor and the revealed body-type factor). The value is new as integer arithmetic: it replaces the float product of the slop pack so that the Date lane's pack term has one proved definition that the bounds below can be compared with. The shell reads a member's answers once per profile and the seeker's ceilings once per profile and options, because the engine builds new profiles for each engine input.

```quint
type DatePackCheap = { sharedInterests: int, typeFit: int, bodyFit: DateBodyFit, slots: DateSlots }
type DatePackPair = { cheap: DatePackCheap, activityMiss: bool, taste: int, bodyLearned: int }

pure def datePackAnswerFactors(seeker: DatePackSeeker, partner: DatePackAnswers, cheap: DatePackCheap): DatePackFactors =
  val own = seeker.answers
  val hidden = not(seeker.statesDealbreakers)
  {
    goal: dateGoalFactor(own.goal, partner.goal),
    smoking: dateHabitClash(own.smoking, partner.smoking, 800),
    drinking: dateHabitClash(own.drinking, partner.drinking, 850),
    religion: dateReligionClash(own.religionImportance, partner.religionImportance),
    politics: datePoliticsClash(own.politics, partner.politics),
    kids: dateKidsClash(own, partner),
    unstated: dateUnstatedFactor(dateUnstatedCount(own, partner)),
    hiddenSmoking: if (hidden) dateHiddenSmoking(own, partner) else 1000,
    hiddenDrinking: if (hidden) dateHiddenDrinking(own, partner) else 1000,
    hiddenHasKids: if (hidden) dateHiddenHasKids(own, partner) else 1000,
    hiddenWantsKids: if (hidden) dateHiddenWantsKids(own, partner) else 1000,
    hiddenReligion: if (hidden) dateHiddenReligion(own, partner) else 1000,
    hiddenPolitics: if (hidden) dateHiddenPolitics(own, partner) else 1000,
    interests: dateInterestFactor(cheap.sharedInterests),
    activity: 1000,
    typeFit: datePackBoost(cheap.typeFit, dateTypeTop(seeker)),
    taste: datePackBoostTop(seeker.tasteCeiling),
    slots: dateSlotsFactor(seeker.statesFreeSlots, cheap.slots),
    body: dateBodyFactor(seeker.statesBodyPrefs, cheap.bodyFit),
    bodyLearned: dateBodyLearnedTop(seeker),
  }

pure def datePackPairFactors(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): DatePackFactors =
  val cheapFactors = datePackAnswerFactors(seeker, partner, pair.cheap)
  { ...cheapFactors,
    activity: dateActivityFactor(pair.activityMiss),
    taste: datePackBoost(pair.taste, seeker.tasteCeiling),
    bodyLearned: dateBodyLearnedFactor(seeker, pair.bodyLearned) }

pure def datePackValue(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): int =
  datePackProduct(datePackPairFactors(seeker, partner, pair))

pure val partnerValues = Set(
  { goal: DateGoalCasual, smoking: DateHabitRegular, drinking: DateHabitNever, religionImportance: 0, politics: DatePoliticsLeft, hasKids: DateKidsYes, wantsKids: DateKidsNo },
  { goal: DateGoalLongTerm, smoking: DateHabitNever, drinking: DateHabitRegular, religionImportance: 3, politics: DatePoliticsRight, hasKids: DateKidsNo, wantsKids: DateKidsYes },
  { goal: DateGoalUnstated, smoking: DateHabitUnstated, drinking: DateHabitUnstated, religionImportance: -1, politics: DatePoliticsUnstated, hasKids: DateKidsUnstated, wantsKids: DateKidsUnstated },
  { goal: DateGoalUnsure, smoking: DateHabitOccasional, drinking: DateHabitUnstated, religionImportance: 2, politics: DatePoliticsMiddle, hasKids: DateKidsNo, wantsKids: DateKidsOpen },
)
pure val seekerValues = Set(
  { answers: { goal: DateGoalLongTerm, smoking: DateHabitNever, drinking: DateHabitRegular, religionImportance: 3, politics: DatePoliticsRight, hasKids: DateKidsNo, wantsKids: DateKidsYes }, statesDealbreakers: false, statesType: true, statesBodyPrefs: false,
    statesFreeSlots: true, tasteCeiling: 1649, bodyLearnedCeiling: 2718 },
  { answers: { goal: DateGoalCasual, smoking: DateHabitRegular, drinking: DateHabitNever, religionImportance: 0, politics: DatePoliticsLeft, hasKids: DateKidsYes, wantsKids: DateKidsNo }, statesDealbreakers: true, statesType: false, statesBodyPrefs: true,
    statesFreeSlots: false, tasteCeiling: 1000, bodyLearnedCeiling: 1000 },
  { answers: { goal: DateGoalUnstated, smoking: DateHabitUnstated, drinking: DateHabitUnstated, religionImportance: -1, politics: DatePoliticsUnstated, hasKids: DateKidsUnstated, wantsKids: DateKidsUnstated }, statesDealbreakers: false, statesType: true, statesBodyPrefs: false,
    statesFreeSlots: true, tasteCeiling: -3, bodyLearnedCeiling: 9000 },
  { answers: { goal: DateGoalUnsure, smoking: DateHabitOccasional, drinking: DateHabitUnstated, religionImportance: 2, politics: DatePoliticsMiddle, hasKids: DateKidsNo, wantsKids: DateKidsOpen }, statesDealbreakers: false, statesType: false, statesBodyPrefs: true,
    statesFreeSlots: true, tasteCeiling: 1200, bodyLearnedCeiling: 0 },
)
pure val pairValues = Set(
  { cheap: { sharedInterests: 0, typeFit: 1221, bodyFit: DateBodyWanted, slots: DateSlotsShared },
    activityMiss: false, taste: 1649, bodyLearned: 2718 },
  { cheap: { sharedInterests: 1, typeFit: 819, bodyFit: DateBodyNotWanted, slots: DateSlotsApart },
    activityMiss: true, taste: 700, bodyLearned: 500 },
  { cheap: { sharedInterests: 3, typeFit: 5000, bodyFit: DateBodyUnrated, slots: DateSlotsUnknown },
    activityMiss: false, taste: 9000, bodyLearned: -2 },
  { cheap: { sharedInterests: -1, typeFit: -40, bodyFit: DateBodyWanted, slots: DateSlotsApart },
    activityMiss: true, taste: 1000, bodyLearned: 1000 },
)

pure def lawDatePackValueBounded(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): bool =
  val packValue = datePackValue(seeker, partner, pair)
  0 <= packValue and packValue <= datePackScale
```

## Story: Skip partners whose pack value cannot reach the floor

> As the matching engine, I want a cheap upper bound on the pack value of a partner, and of a whole class of partners, so that a search can pass over partners who cannot reach the Date floor without computing their full value.

### The pair bound needs only the cheap pair inputs and is at least the pack value

The pair bound uses every answer factor and the cheap pair inputs exactly. It counts the planned activity as a hit and the revealed taste and revealed body-type factors at the seeker's ceilings. This bound is new: before it, the candidate search counted the pack term of every touched candidate at 1000, so a Date partner with no shared tag had a utility bound of `3 x 1000 / 8 = 375`, above the Date floor of 350. With the Date weights (complement 3, affinity 2, pack 3, no closeness for slop), a partner with no shared tag misses the floor when its pack bound is 933 or less. The [candidate search](candidateSearch.md) now uses this bound for each touched Date candidate through the pack-bound hook next to `packValue`, which the slop pack fills with `datePackBound`. This changed because the search did not call the bound before, so no Date search got faster.

```quint
pure def datePackPairBound(seeker: DatePackSeeker, partner: DatePackAnswers, cheap: DatePackCheap): int =
  datePackProduct(datePackAnswerFactors(seeker, partner, cheap))

pure def lawDatePackPairBound(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair): bool =
  datePackValue(seeker, partner, pair) <= datePackPairBound(seeker, partner, pair.cheap)
```

### A partner class has a cap that is at least the pair bound of every partner in it

A partner's class is the partner's goal and the number of the partner's unstated answers among smoking, drinking, religion importance and politics, counted up to 3. That gives 16 classes. The class cap counts the goal factor exactly. It counts the unknown-answer factor for the larger of the seeker's own unstated answers and the class count, because an answer that either member did not state is unknown. It counts every other answer factor at 1000, the planned activity as a hit, logistics, the type and the body-type factors at the seeker's ceilings. An untouched partner shares no interest and no free slot with the seeker (the candidate search knows this for a partner that it found in no posting), so the cap for untouched partners counts no shared interest (880) and no common slot (900). The cap is new: it lets the search bound every partner that it did not touch by the largest cap over the classes in the window, in place of 1000. The untouched cap is sound for a partner only when the search walked every interest posting and every `free:<slot>` posting of the seeker without touching that partner. The slop pack puts each free slot in both the offers and the seeks of a member, so a common free slot is a complement hit. While a posting of either kind is still open, the search must use the cap with `untouched` false. The class key in the shell is `4 x goal + unstated` with the goals in the order casual, long-term, unsure, unstated, which gives the keys 0 to 15. The cap bounds only the seeker's own direction; the partner's direction is the partner's cap with the seeker's class. The [candidate search](candidateSearch.md) now uses the largest cap over the classes in the window for the seeker's direction of its untouched bound, and passes `untouched` true only when every tag range of its walk is fully walked, which includes every interest posting and every `free:<slot>` posting; the partner's direction still counts at 1000. This changed because the search did not call the cap before, so a Date search walked its whole window whenever its tag ranges did not close it.

```quint
type DatePackClass = { goal: DateGoal, unstated: int }

pure val datePackClassUnstatedMost: int = 3

pure def datePackPartnerUnstated(partner: DatePackAnswers): int =
  (if (partner.smoking == DateHabitUnstated) 1 else 0) +
  (if (partner.drinking == DateHabitUnstated) 1 else 0) +
  (if (partner.religionImportance < 0) 1 else 0) +
  (if (partner.politics == DatePoliticsUnstated) 1 else 0)

pure def datePackClassOf(partner: DatePackAnswers): DatePackClass =
  val unstated = datePackPartnerUnstated(partner)
  { goal: partner.goal, unstated: if (unstated > datePackClassUnstatedMost) datePackClassUnstatedMost else unstated }

pure def dateSeekerUnstated(ownAnswers: DatePackAnswers): int =
  (if (ownAnswers.smoking == DateHabitUnstated) 1 else 0) +
  (if (ownAnswers.drinking == DateHabitUnstated) 1 else 0) +
  (if (ownAnswers.religionImportance < 0) 1 else 0) +
  (if (ownAnswers.politics == DatePoliticsUnstated) 1 else 0) +
  (if (dateKidsCounted(ownAnswers) and ownAnswers.wantsKids == DateKidsUnstated) 1 else 0)

pure def datePackClassCap(seeker: DatePackSeeker, partnerClass: DatePackClass, untouched: bool): int =
  val ownUnstated = dateSeekerUnstated(seeker.answers)
  val unstated = if (ownUnstated > partnerClass.unstated) ownUnstated else partnerClass.unstated
  datePackProduct({
    goal: dateGoalFactor(seeker.answers.goal, partnerClass.goal),
    smoking: 1000, drinking: 1000, religion: 1000, politics: 1000, kids: 1000,
    unstated: dateUnstatedFactor(unstated),
    hiddenSmoking: 1000, hiddenDrinking: 1000, hiddenHasKids: 1000, hiddenWantsKids: 1000,
    hiddenReligion: 1000, hiddenPolitics: 1000,
    interests: if (untouched) dateInterestFactor(0) else 1000,
    activity: 1000,
    typeFit: dateTypeTop(seeker),
    taste: datePackBoostTop(seeker.tasteCeiling),
    slots: if (untouched or not(seeker.statesFreeSlots)) 900 else 1000,
    body: if (seeker.statesBodyPrefs) 1350 else 1000,
    bodyLearned: dateBodyLearnedTop(seeker),
  })

pure def lawDatePackClassCap(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair, untouched: bool): bool =
  val cap = datePackClassCap(seeker, datePackClassOf(partner), untouched)
  (untouched implies (pair.cheap.sharedInterests <= 0 and pair.cheap.slots != DateSlotsShared)) implies
    (datePackPairBound(seeker, partner, pair.cheap) <= cap and datePackValue(seeker, partner, pair) <= cap)
```
