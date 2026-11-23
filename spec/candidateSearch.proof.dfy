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

lemma CandidateSearchWorstScan(kept: seq<RankedCandidate>)
  ensures worstKeptScan(kept).position == |kept|
  ensures |kept| == 0 ==> worstKeptScan(kept).worstPosition < 0
  ensures |kept| > 0 ==> (0 <= worstKeptScan(kept).worstPosition < |kept| && worstKeptScan(kept).worst == kept[worstKeptScan(kept).worstPosition])
  ensures forall i :: 0 <= i < |kept| ==> !candidateRanksAbove(worstKeptScan(kept).worst, kept[i])
  decreases |kept|
{
  var step := (scan: WorstKeptScan, candidate: RankedCandidate) => (if ((scan.worstPosition < 0) || candidateRanksAbove(scan.worst, candidate)) then WorstKeptScan((scan.position + 1), scan.position, candidate) else scan.(position := (scan.position + 1)));
  var start := WorstKeptScan(0, -1, RankedCandidate(0, 0));
  assert worstKeptScan(kept) == Std.Collections.Seq.FoldLeft(step, start, kept);
  if |kept| > 0 {
    var front := kept[..|kept| - 1];
    var last := kept[|kept| - 1];
    assert front + [last] == kept;
    CandidateSearchWorstScan(front);
    assert worstKeptScan(front) == Std.Collections.Seq.FoldLeft(step, start, front);
    ProofLib.FoldLeftAppend(step, start, front, last);
    assert worstKeptScan(kept) == step(worstKeptScan(front), last);
  }
}

lemma CandidateSearchDistinctFilter(s: CandidateSearch)
  ensures alwaysKeptOrdinalsDistinct(s) == !((exists c :: c in s.kept && !((|ProofLib.Filter((d: RankedCandidate) => (d.ordinal == c.ordinal), s.kept)| == 1))))
{
}

lemma CandidateSearchDistinctToPositions(s: CandidateSearch)
  requires alwaysKeptOrdinalsDistinct(s)
  ensures ProofLib.DistinctBy(s.kept, (d: RankedCandidate) => d.ordinal)
{
  CandidateSearchDistinctFilter(s);
  forall i, j | 0 <= i < |s.kept| && 0 <= j < |s.kept| && i != j
    ensures s.kept[i].ordinal != s.kept[j].ordinal
  {
    var c := s.kept[i];
    assert c in s.kept;
    assert |ProofLib.Filter((d: RankedCandidate) => (d.ordinal == c.ordinal), s.kept)| == 1;
    ProofLib.FilterCountOneIffUnique((d: RankedCandidate) => (d.ordinal == c.ordinal), s.kept, (d: RankedCandidate) => d.ordinal, i);
  }
}

lemma CandidateSearchPositionsToDistinct(s: CandidateSearch)
  requires ProofLib.DistinctBy(s.kept, (d: RankedCandidate) => d.ordinal)
  ensures alwaysKeptOrdinalsDistinct(s)
{
  CandidateSearchDistinctFilter(s);
  forall c | c in s.kept
    ensures |ProofLib.Filter((d: RankedCandidate) => (d.ordinal == c.ordinal), s.kept)| == 1
  {
    var i :| 0 <= i < |s.kept| && s.kept[i] == c;
    ProofLib.FilterCountOneIffUnique((d: RankedCandidate) => (d.ordinal == c.ordinal), s.kept, (d: RankedCandidate) => d.ordinal, i);
  }
}

lemma CandidateSearchAppendDistinct(kept: seq<RankedCandidate>, candidate: RankedCandidate, added: seq<RankedCandidate>)
  requires added == kept + [candidate]
  requires ProofLib.DistinctBy(kept, (d: RankedCandidate) => d.ordinal)
  requires forall c :: c in kept ==> c.ordinal != candidate.ordinal
  ensures ProofLib.DistinctBy(added, (d: RankedCandidate) => d.ordinal)
  ensures forall c :: c in added ==> c in kept || c == candidate
{
  forall i, j | 0 <= i < |added| && 0 <= j < |added| && i != j
    ensures added[i].ordinal != added[j].ordinal
  {
    if i < |kept| && j < |kept| {
      assert added[i] == kept[i] && added[j] == kept[j];
    } else if i < |kept| {
      assert added[i] in kept;
    } else {
      assert added[j] in kept;
    }
  }
  forall c | c in added
    ensures c in kept || c == candidate
  {
    var k :| 0 <= k < |added| && added[k] == c;
    if k < |kept| {
      assert added[k] == kept[k];
    }
  }
}

lemma CandidateSearchRemoveDistinct(kept: seq<RankedCandidate>, w: int, rest: seq<RankedCandidate>)
  requires 0 <= w < |kept|
  requires rest == kept[0..w] + kept[(w + 1)..]
  requires ProofLib.DistinctBy(kept, (d: RankedCandidate) => d.ordinal)
  ensures ProofLib.DistinctBy(rest, (d: RankedCandidate) => d.ordinal)
  ensures forall c :: c in rest ==> c in kept && c.ordinal != kept[w].ordinal
{
  forall k | 0 <= k < |rest|
    ensures rest[k] == kept[if k < w then k else k + 1]
  {
  }
  forall i, j | 0 <= i < |rest| && 0 <= j < |rest| && i != j
    ensures rest[i].ordinal != rest[j].ordinal
  {
    assert rest[i] == kept[if i < w then i else i + 1];
    assert rest[j] == kept[if j < w then j else j + 1];
  }
  forall c | c in rest
    ensures c in kept && c.ordinal != kept[w].ordinal
  {
    var k :| 0 <= k < |rest| && rest[k] == c;
    assert rest[k] == kept[if k < w then k else k + 1];
  }
}

lemma CandidateSearchReplaceRanks(kept: seq<RankedCandidate>, w: int, rest: seq<RankedCandidate>, candidate: RankedCandidate, dropped: RankedCandidate, after: seq<RankedCandidate>)
  requires 0 <= w < |kept|
  requires rest == kept[0..w] + kept[(w + 1)..]
  requires after == rest + [candidate]
  requires ProofLib.DistinctBy(kept, (d: RankedCandidate) => d.ordinal)
  requires forall c :: c in kept ==> c.ordinal != candidate.ordinal
  requires forall i :: 0 <= i < |kept| ==> !candidateRanksAbove(kept[w], kept[i])
  requires candidateRanksAbove(candidate, kept[w])
  requires forall c :: c in kept ==> c.value >= dropped.value
  requires dropped.value > pairValue_noPairValue ==> forall c :: c in kept ==> candidateRanksAbove(c, dropped)
  ensures ProofLib.DistinctBy(after, (d: RankedCandidate) => d.ordinal)
  ensures forall c :: c in after ==> c.value >= searchHigherRanked(dropped, kept[w]).value
  ensures searchHigherRanked(dropped, kept[w]).value > pairValue_noPairValue ==> forall c :: c in after ==> candidateRanksAbove(c, searchHigherRanked(dropped, kept[w]))
{
  var worst := kept[w];
  CandidateSearchRemoveDistinct(kept, w, rest);
  CandidateSearchAppendDistinct(rest, candidate, after);
  forall c | c in rest
    ensures candidateRanksAbove(c, worst)
  {
    var k :| 0 <= k < |kept| && kept[k] == c;
    assert !candidateRanksAbove(worst, kept[k]);
  }
  assert worst in kept;
}

lemma CandidateSearchRefuseRanks(kept: seq<RankedCandidate>, w: int, candidate: RankedCandidate, dropped: RankedCandidate)
  requires 0 <= w < |kept|
  requires forall c :: c in kept ==> c.ordinal != candidate.ordinal
  requires forall i :: 0 <= i < |kept| ==> !candidateRanksAbove(kept[w], kept[i])
  requires !candidateRanksAbove(candidate, kept[w])
  requires forall c :: c in kept ==> c.value >= dropped.value
  requires dropped.value > pairValue_noPairValue ==> forall c :: c in kept ==> candidateRanksAbove(c, dropped)
  ensures forall c :: c in kept ==> c.value >= searchHigherRanked(dropped, candidate).value
  ensures searchHigherRanked(dropped, candidate).value > pairValue_noPairValue ==> forall c :: c in kept ==> candidateRanksAbove(c, searchHigherRanked(dropped, candidate))
{
  var worst := kept[w];
  assert worst in kept;
  assert candidateRanksAbove(worst, candidate);
  forall c | c in kept
    ensures candidateRanksAbove(c, candidate)
  {
    var k :| 0 <= k < |kept| && kept[k] == c;
    assert !candidateRanksAbove(worst, kept[k]);
  }
}

lemma checkCandidate_ensures(s: CandidateSearch, value: int, ordinal: int)
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysIdleSearchIsEmpty(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysChecksWithinBudget(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysKeptWithinLimit(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysKeptValuesAreRealPairs(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysDroppedOnlyWhenFull(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysKeptOrdinalsDistinct(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysKeptBeatDropped(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysKeptRankAboveDropped(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> alwaysExactBeatsUnseen(checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> stepEachCheckCountsOnce(s, "checkCandidate", checkCandidate(s, value, ordinal)))
  ensures (inv(s) ==> canCheckCandidate(s, ordinal) ==> stepClosedSearchStaysClosed(s, checkCandidate(s, value, ordinal)))
{
  if inv(s) && canCheckCandidate(s, ordinal) {
    var after := checkCandidate(s, value, ordinal);
    var candidate := RankedCandidate(value, ordinal);
    var scan := worstKeptScan(s.kept);
    var dropped := searchDroppedRank(s);
    CandidateSearchWorstScan(s.kept);
    CandidateSearchDistinctToPositions(s);
    assert forall c :: c in s.kept ==> c.ordinal != ordinal;
    assert forall c :: c in s.kept ==> c.value >= dropped.value;
    assert dropped.value > pairValue_noPairValue ==> forall c :: c in s.kept ==> candidateRanksAbove(c, dropped);
    if value < 0 {
      assert after.kept == s.kept;
      CandidateSearchPositionsToDistinct(after);
    } else if |s.kept| < s.limit {
      assert after.kept == s.kept + [candidate];
      CandidateSearchAppendDistinct(s.kept, candidate, after.kept);
      CandidateSearchPositionsToDistinct(after);
    } else if scan.worstPosition >= 0 && scan.worstPosition < |s.kept| && candidateRanksAbove(candidate, scan.worst) {
      var w := scan.worstPosition;
      var rest := s.kept[0..w] + s.kept[(w + 1)..];
      assert after.kept == rest + [candidate];
      CandidateSearchReplaceRanks(s.kept, w, rest, candidate, dropped, after.kept);
      assert searchDroppedRank(after) == searchHigherRanked(dropped, s.kept[w]);
      CandidateSearchPositionsToDistinct(after);
    } else {
      assert after.kept == s.kept;
      assert searchDroppedRank(after) == searchHigherRanked(dropped, candidate);
      CandidateSearchPositionsToDistinct(after);
      if |s.kept| > 0 {
        CandidateSearchRefuseRanks(s.kept, scan.worstPosition, candidate, dropped);
      }
    }
  }
}
