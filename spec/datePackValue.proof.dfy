lemma DatePackDivideMonotone(smaller: int, larger: int)
  requires 0 <= smaller <= larger
  ensures 0 <= quotient_datePackValue(smaller, datePackScale) <= quotient_datePackValue(larger, datePackScale)
{
  assert quotient_datePackValue(smaller, datePackScale) == smaller / datePackScale;
  assert quotient_datePackValue(larger, datePackScale) == larger / datePackScale;
  var low := smaller / datePackScale;
  var high := larger / datePackScale;
  assert smaller == low * datePackScale + smaller % datePackScale;
  assert larger == high * datePackScale + larger % datePackScale;
  assert 0 <= smaller % datePackScale < datePackScale;
  assert 0 <= larger % datePackScale < datePackScale;
  if low > high {
    assert low * datePackScale >= (high + 1) * datePackScale;
    assert smaller >= (high + 1) * datePackScale;
    assert larger < (high + 1) * datePackScale;
  }
  if low < 0 {
    assert low * datePackScale <= -datePackScale;
  }
}

lemma DatePackTimesMonotone(running: int, raised: int, factor: int, larger: int)
  requires 0 <= running <= raised && factor <= larger
  ensures 0 <= datePackTimes(running, factor) <= datePackTimes(raised, larger)
{
  var counted := if factor > 0 then factor else 0;
  var largerCounted := if larger > 0 then larger else 0;
  assert 0 <= counted <= largerCounted;
  assert 0 <= (raised - running) * counted;
  assert running * counted <= raised * counted;
  assert 0 <= raised * (largerCounted - counted);
  assert raised * counted <= raised * largerCounted;
  assert 0 <= running * counted;
  DatePackDivideMonotone(running * counted, raised * largerCounted);
  assert datePackTimes(running, factor) == quotient_datePackValue(running * counted, datePackScale);
  assert datePackTimes(raised, larger) == quotient_datePackValue(raised * largerCounted, datePackScale);
}

lemma lawDatePackProductMonotone_ensures(lower: DatePackFactors, upper: DatePackFactors)
  ensures (lawDatePackProductMonotone(lower, upper) == true)
{
  if datePackFactorsAtMost(lower, upper) {
    var a1 := datePackTimes(datePackMicro, lower.goal);
    var b1 := datePackTimes(datePackMicro, upper.goal);
    DatePackTimesMonotone(datePackMicro, datePackMicro, lower.goal, upper.goal);
    var a2 := datePackTimes(a1, lower.smoking);
    var b2 := datePackTimes(b1, upper.smoking);
    DatePackTimesMonotone(a1, b1, lower.smoking, upper.smoking);
    var a3 := datePackTimes(a2, lower.drinking);
    var b3 := datePackTimes(b2, upper.drinking);
    DatePackTimesMonotone(a2, b2, lower.drinking, upper.drinking);
    var a4 := datePackTimes(a3, lower.religion);
    var b4 := datePackTimes(b3, upper.religion);
    DatePackTimesMonotone(a3, b3, lower.religion, upper.religion);
    var a5 := datePackTimes(a4, lower.politics);
    var b5 := datePackTimes(b4, upper.politics);
    DatePackTimesMonotone(a4, b4, lower.politics, upper.politics);
    var a6 := datePackTimes(a5, lower.kids);
    var b6 := datePackTimes(b5, upper.kids);
    DatePackTimesMonotone(a5, b5, lower.kids, upper.kids);
    var a7 := datePackTimes(a6, lower.unstated);
    var b7 := datePackTimes(b6, upper.unstated);
    DatePackTimesMonotone(a6, b6, lower.unstated, upper.unstated);
    var a8 := datePackTimes(a7, lower.hiddenSmoking);
    var b8 := datePackTimes(b7, upper.hiddenSmoking);
    DatePackTimesMonotone(a7, b7, lower.hiddenSmoking, upper.hiddenSmoking);
    var a9 := datePackTimes(a8, lower.hiddenDrinking);
    var b9 := datePackTimes(b8, upper.hiddenDrinking);
    DatePackTimesMonotone(a8, b8, lower.hiddenDrinking, upper.hiddenDrinking);
    var a10 := datePackTimes(a9, lower.hiddenHasKids);
    var b10 := datePackTimes(b9, upper.hiddenHasKids);
    DatePackTimesMonotone(a9, b9, lower.hiddenHasKids, upper.hiddenHasKids);
    var a11 := datePackTimes(a10, lower.hiddenWantsKids);
    var b11 := datePackTimes(b10, upper.hiddenWantsKids);
    DatePackTimesMonotone(a10, b10, lower.hiddenWantsKids, upper.hiddenWantsKids);
    var a12 := datePackTimes(a11, lower.hiddenReligion);
    var b12 := datePackTimes(b11, upper.hiddenReligion);
    DatePackTimesMonotone(a11, b11, lower.hiddenReligion, upper.hiddenReligion);
    var a13 := datePackTimes(a12, lower.hiddenPolitics);
    var b13 := datePackTimes(b12, upper.hiddenPolitics);
    DatePackTimesMonotone(a12, b12, lower.hiddenPolitics, upper.hiddenPolitics);
    var a14 := datePackTimes(a13, lower.interests);
    var b14 := datePackTimes(b13, upper.interests);
    DatePackTimesMonotone(a13, b13, lower.interests, upper.interests);
    var a15 := datePackTimes(a14, lower.activity);
    var b15 := datePackTimes(b14, upper.activity);
    DatePackTimesMonotone(a14, b14, lower.activity, upper.activity);
    var a16 := datePackTimes(a15, lower.typeFit);
    var b16 := datePackTimes(b15, upper.typeFit);
    DatePackTimesMonotone(a15, b15, lower.typeFit, upper.typeFit);
    var a17 := datePackTimes(a16, lower.taste);
    var b17 := datePackTimes(b16, upper.taste);
    DatePackTimesMonotone(a16, b16, lower.taste, upper.taste);
    var ad := if a17 > datePackMicro then datePackMicro else a17;
    var bd := if b17 > datePackMicro then datePackMicro else b17;
    assert 0 <= ad <= bd;
    var a18 := datePackTimes(ad, lower.slots);
    var b18 := datePackTimes(bd, upper.slots);
    DatePackTimesMonotone(ad, bd, lower.slots, upper.slots);
    var a19 := datePackTimes(a18, lower.body);
    var b19 := datePackTimes(b18, upper.body);
    DatePackTimesMonotone(a18, b18, lower.body, upper.body);
    var a20 := datePackTimes(a19, lower.bodyLearned);
    var b20 := datePackTimes(b19, upper.bodyLearned);
    DatePackTimesMonotone(a19, b19, lower.bodyLearned, upper.bodyLearned);
    assert quotient_datePackValue(datePackScale, 2) == 500;
    DatePackDivideMonotone(a20 + 500, b20 + 500);
    var ar := quotient_datePackValue(a20 + 500, datePackScale);
    var br := quotient_datePackValue(b20 + 500, datePackScale);
    assert datePackProduct(lower) == (if ar > datePackScale then datePackScale else ar);
    assert datePackProduct(upper) == (if br > datePackScale then datePackScale else br);
  }
}

lemma DateUnstatedFactorFalls(fewer: int, more: int)
  requires fewer <= more
  ensures dateUnstatedFactor(more) <= dateUnstatedFactor(fewer)
{
}

lemma lawDatePackPairBound_ensures(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair)
  ensures (lawDatePackPairBound(seeker, partner, pair) == true)
{
  var valueFactors := datePackPairFactors(seeker, partner, pair);
  var boundFactors := datePackAnswerFactors(seeker, partner, pair.cheap);
  assert valueFactors.activity <= boundFactors.activity;
  assert valueFactors.taste <= boundFactors.taste;
  assert valueFactors.bodyLearned <= boundFactors.bodyLearned;
  assert datePackFactorsAtMost(valueFactors, boundFactors);
  lawDatePackProductMonotone_ensures(valueFactors, boundFactors);
}

lemma lawDatePackClassCap_ensures(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair, untouched: bool)
  ensures (lawDatePackClassCap(seeker, partner, pair, untouched) == true)
{
  if !untouched || (pair.cheap.sharedInterests <= 0 && !pair.cheap.slots.DateSlotsShared?) {
    var partnerClass := datePackClassOf(partner);
    var ownUnstated := dateSeekerUnstated(seeker.answers);
    var unstated := if ownUnstated > partnerClass.unstated then ownUnstated else partnerClass.unstated;
    var capFactors := DatePackFactors(dateGoalFactor(seeker.answers.goal, partnerClass.goal), 1000, 1000, 1000, 1000, 1000, dateUnstatedFactor(unstated), 1000, 1000, 1000, 1000, 1000, 1000, (if untouched then dateInterestFactor(0) else 1000), 1000, dateTypeTop(seeker), datePackBoostTop(seeker.tasteCeiling), (if (untouched || !(seeker.statesFreeSlots)) then 900 else 1000), (if seeker.statesBodyPrefs then 1350 else 1000), dateBodyLearnedTop(seeker));
    assert datePackClassCap(seeker, partnerClass, untouched) == datePackProduct(capFactors);
    var boundFactors := datePackAnswerFactors(seeker, partner, pair.cheap);
    var count := dateUnstatedCount(seeker.answers, partner);
    assert count >= ownUnstated;
    assert count >= datePackPartnerUnstated(partner);
    assert count >= unstated;
    DateUnstatedFactorFalls(unstated, count);
    assert boundFactors.unstated <= capFactors.unstated;
    assert boundFactors.goal == capFactors.goal;
    assert boundFactors.interests <= capFactors.interests;
    assert boundFactors.typeFit <= capFactors.typeFit;
    assert boundFactors.slots <= capFactors.slots;
    assert boundFactors.body <= capFactors.body;
    assert datePackFactorsAtMost(boundFactors, capFactors);
    lawDatePackProductMonotone_ensures(boundFactors, capFactors);
    lawDatePackPairBound_ensures(seeker, partner, pair);
  }
}

lemma lawDatePackValueBounded_ensures(seeker: DatePackSeeker, partner: DatePackAnswers, pair: DatePackPair)
  ensures (lawDatePackValueBounded(seeker, partner, pair) == true)
{
  lawDatePackProductBounded_ensures(datePackPairFactors(seeker, partner, pair));
}
