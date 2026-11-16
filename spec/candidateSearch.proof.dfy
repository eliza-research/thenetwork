lemma CandidateSearchHarmonicSymmetric(left: int, right: int)
  ensures pairValue_harmonicValue(left, right) == pairValue_harmonicValue(right, left)
{
  if left > 0 && right > 0 {
    assert 2 * left * right == 2 * right * left;
    assert left + right == right + left;
  }
}

lemma CandidateSearchHarmonicBound(left: int, right: int, leftBound: int, rightBound: int)
  requires left <= leftBound && right <= rightBound
  ensures pairValue_harmonicValue(left, right) <= pairValue_harmonicValue(leftBound, rightBound)
{
  pairValue_lawHarmonicMonotone_ensures(left, leftBound, right);
  CandidateSearchHarmonicSymmetric(leftBound, right);
  pairValue_lawHarmonicMonotone_ensures(right, rightBound, leftBound);
  CandidateSearchHarmonicSymmetric(rightBound, leftBound);
}

lemma CandidateSearchPenaltyNonnegative(gap: int, freeGap: int, penaltyPerPoint: int)
  ensures pairValue_parityPenalty(gap, freeGap, penaltyPerPoint) >= 0
{
  if gap > freeGap && penaltyPerPoint > 0 {
    assert 0 <= penaltyPerPoint * (gap - freeGap);
  }
}

lemma lawBucketBoundSound_ensures(utility: int, otherUtility: int, penalty: int, utilityBound: int, otherUtilityBound: int, leastPenalty: int)
  ensures (lawBucketBoundSound(utility, otherUtility, penalty, utilityBound, otherUtilityBound, leastPenalty) == true)
{
  if utility <= utilityBound && otherUtility <= otherUtilityBound && penalty >= leastPenalty && leastPenalty >= 0 {
    CandidateSearchHarmonicBound(utility, otherUtility, utilityBound, otherUtilityBound);
    var penalised := pairValue_harmonicValue(utility, otherUtility) - penalty;
    var bound := pairValue_harmonicValue(utilityBound, otherUtilityBound) - leastPenalty;
    assert penalised <= bound;
    assert 0 <= bucketValueBound(utilityBound, otherUtilityBound, leastPenalty);
    if penalised > 0 {
      assert penalised <= bucketValueBound(utilityBound, otherUtilityBound, leastPenalty);
    }
  }
}

lemma lawCandidateBoundSound_ensures(side: pairValue_PairSide, other: pairValue_PairSide, offset: int, rules: pairValue_PairRules, utilityBound: int, otherUtilityBound: int)
  ensures (lawCandidateBoundSound(side, other, offset, rules, utilityBound, otherUtilityBound) == true)
{
  if side.utility <= utilityBound && other.utility <= otherUtilityBound {
    var raised := pairValue_PairSide(utilityBound, side.standing, side.uncertainty, side.exchange);
    var raisedOther := pairValue_PairSide(otherUtilityBound, other.standing, other.uncertainty, other.exchange);
    if pairValue_pairAdmissible(side, other, offset, rules) {
      assert pairValue_pairAdmissible(raised, raisedOther, offset, rules);
      var gap := pairValue_standingGap(side.standing, other.standing, offset);
      var penalty := pairValue_parityPenalty(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint);
      CandidateSearchPenaltyNonnegative(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint);
      lawBucketBoundSound_ensures(side.utility, other.utility, penalty, utilityBound, otherUtilityBound, penalty);
      assert pairValue_pairValue(raised, raisedOther, offset, rules) == bucketValueBound(utilityBound, otherUtilityBound, penalty);
    } else {
      assert pairValue_pairValue(side, other, offset, rules) == pairValue_noPairValue;
      assert pairValue_pairValue(raised, raisedOther, offset, rules) >= pairValue_noPairValue;
    }
  }
}

lemma lawUnseenBoundSound_ensures(side: pairValue_PairSide, other: pairValue_PairSide, offset: int, rules: pairValue_PairRules, utilityBound: int, otherUtilityBound: int, exchangeBound: int, otherExchangeBound: int)
  ensures (lawUnseenBoundSound(side, other, offset, rules, utilityBound, otherUtilityBound, exchangeBound, otherExchangeBound) == true)
{
  if side.utility <= utilityBound && other.utility <= otherUtilityBound
    && side.exchange <= exchangeBound && other.exchange <= otherExchangeBound {
    if pairValue_pairAdmissible(side, other, offset, rules) {
      assert rules.utilityFloor <= side.utility <= utilityBound;
      assert rules.utilityFloor <= other.utility <= otherUtilityBound;
      if rules.balanceRequired {
        assert pairValue_exchangeBalanced(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent);
        assert rules.exchangeFloor <= side.exchange <= exchangeBound;
        assert rules.exchangeFloor <= other.exchange <= otherExchangeBound;
      }
      assert unseenValueBound(utilityBound, otherUtilityBound, exchangeBound, otherExchangeBound, rules)
        == bucketValueBound(utilityBound, otherUtilityBound, 0);
      var gap := pairValue_standingGap(side.standing, other.standing, offset);
      var penalty := pairValue_parityPenalty(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint);
      CandidateSearchPenaltyNonnegative(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint);
      lawBucketBoundSound_ensures(side.utility, other.utility, penalty, utilityBound, otherUtilityBound, 0);
    } else {
      assert pairValue_pairValue(side, other, offset, rules) == pairValue_noPairValue;
      assert unseenValueBound(utilityBound, otherUtilityBound, exchangeBound, otherExchangeBound, rules) >= pairValue_noPairValue;
    }
  }
}
