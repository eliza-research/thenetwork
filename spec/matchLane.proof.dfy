lemma lawLanePairValueSymmetric_ensures(lane: MatchLane, laneNear: pairValue_PairSide, laneNearRole: LaneSide, laneFar: pairValue_PairSide, laneFarRole: LaneSide)
  ensures (lawLanePairValueSymmetric(lane, laneNear, laneNearRole, laneFar, laneFarRole) == true)
{
  lawLaneSidesSymmetric_ensures(lane, laneNearRole, laneFarRole);
  if laneSidesCompatible(lane, laneNearRole, laneFarRole) {
    lawLaneOffsetAntisymmetric_ensures(lane, laneNearRole, laneFarRole);
    assert laneOffset(lane, laneFarRole) == 0 - laneOffset(lane, laneNearRole);
    MatchLanePairValueSymmetric(laneNear, laneFar, laneOffset(lane, laneNearRole), laneLimits(lane).rules);
  }
}

lemma MatchLaneHarmonicSymmetric(left: int, right: int)
  ensures pairValue_harmonicValue(left, right) == pairValue_harmonicValue(right, left)
{
  assert (2 * left) * right == (2 * right) * left;
  assert left + right == right + left;
}

lemma MatchLaneGapSymmetric(standing: int, otherStanding: int, offset: int)
  ensures pairValue_standingGap(standing, otherStanding, offset) == pairValue_standingGap(otherStanding, standing, 0 - offset)
{
}

lemma MatchLaneBalanceSymmetric(given: int, received: int, floor: int, tolerancePercent: int)
  ensures pairValue_exchangeBalanced(given, received, floor, tolerancePercent) == pairValue_exchangeBalanced(received, given, floor, tolerancePercent)
{
}

lemma MatchLanePairValueSymmetric(side: pairValue_PairSide, other: pairValue_PairSide, offset: int, rules: pairValue_PairRules)
  ensures pairValue_pairValue(side, other, offset, rules) == pairValue_pairValue(other, side, 0 - offset, rules)
{
  MatchLaneHarmonicSymmetric(side.utility, other.utility);
  MatchLaneGapSymmetric(side.standing, other.standing, offset);
  MatchLaneBalanceSymmetric(other.exchange, side.exchange, rules.exchangeFloor, rules.balanceTolerancePercent);
  assert pairValue_pairAdmissible(side, other, offset, rules) == pairValue_pairAdmissible(other, side, 0 - offset, rules);
}
