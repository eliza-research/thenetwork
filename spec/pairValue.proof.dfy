lemma PairValueWeightedTotalsBounded(terms: seq<UtilityTerm>, initialWeight: int, initialValue: int)
  requires initialWeight >= 0 && 0 <= initialValue <= initialWeight * pairValueScale
  ensures
    var weight := Std.Collections.Seq.FoldLeft((total: int, term: UtilityTerm) => total + utilityTermWeight(term), initialWeight, terms);
    var weighted := Std.Collections.Seq.FoldLeft((total: int, term: UtilityTerm) => total + utilityTermWeight(term) * boundedValue(term.value), initialValue, terms);
    weight >= 0 && 0 <= weighted <= weight * pairValueScale
  decreases |terms|
{
  var addWeight := (total: int, term: UtilityTerm) => total + utilityTermWeight(term);
  var addValue := (total: int, term: UtilityTerm) => total + utilityTermWeight(term) * boundedValue(term.value);
  reveal Std.Collections.Seq.FoldLeft();
  if |terms| == 0 {
    assert Std.Collections.Seq.FoldLeft(addWeight, initialWeight, terms) == initialWeight;
    assert Std.Collections.Seq.FoldLeft(addValue, initialValue, terms) == initialValue;
  } else {
    var term := terms[0];
    var weight := utilityTermWeight(term);
    var value := boundedValue(term.value);
    assert 0 <= value <= pairValueScale;
    assert 0 <= weight * value;
    assert 0 <= weight * (pairValueScale - value);
    var nextWeight := initialWeight + weight;
    var nextValue := initialValue + weight * value;
    assert 0 <= nextValue <= nextWeight * pairValueScale;
    PairValueWeightedTotalsBounded(terms[1..], nextWeight, nextValue);
    assert Std.Collections.Seq.FoldLeft(addWeight, initialWeight, terms) == Std.Collections.Seq.FoldLeft(addWeight, nextWeight, terms[1..]);
    assert Std.Collections.Seq.FoldLeft(addValue, initialValue, terms) == Std.Collections.Seq.FoldLeft(addValue, nextValue, terms[1..]);
  }
}

lemma lawDirectedUtilityBounded_ensures(terms: seq<UtilityTerm>)
  ensures (lawDirectedUtilityBounded(terms) == true)
{
  PairValueWeightedTotalsBounded(terms, 0, 0);
  var weight := Std.Collections.Seq.FoldLeft((total: int, term: UtilityTerm) => total + utilityTermWeight(term), 0, terms);
  var weighted := Std.Collections.Seq.FoldLeft((total: int, term: UtilityTerm) => total + utilityTermWeight(term) * boundedValue(term.value), 0, terms);
  if weight > 0 {
    PairValueQuotientBounds(weighted, weight, 0, pairValueScale);
  }
  assert directedUtility(terms) == (if weight > 0 then quotient_pairValue(weighted, weight) else 0);
}

lemma PairValueQuotientBounds(numerator: int, divisor: int, low: int, high: int)
  requires numerator >= 0 && divisor > 0
  requires low * divisor <= numerator <= high * divisor
  ensures low <= quotient_pairValue(numerator, divisor) <= high
{
  PairValueDivideLower(numerator, divisor, low);
  PairValueDivideUpper(numerator, divisor, high);
  assert quotient_pairValue(numerator, divisor) == numerator / divisor;
}

lemma PairValueDivideLower(numerator: int, divisor: int, low: int)
  requires numerator >= 0 && divisor > 0 && low * divisor <= numerator
  ensures low <= numerator / divisor
{
  var q := numerator / divisor;
  if q < low {
    var r := numerator % divisor;
    assert numerator == q * divisor + r;
    assert 0 <= r < divisor;
    assert 0 <= (low - q - 1) * divisor;
    assert (q + 1) * divisor <= low * divisor;
    assert numerator < (q + 1) * divisor;
  }
}

lemma PairValueDivideUpper(numerator: int, divisor: int, high: int)
  requires numerator >= 0 && divisor > 0 && numerator <= high * divisor
  ensures numerator / divisor <= high
{
  var q := numerator / divisor;
  if q > high {
    assert numerator == q * divisor + numerator % divisor;
    assert 0 <= numerator % divisor;
    assert 0 < (q - high) * divisor;
    assert high * divisor < q * divisor <= numerator;
  }
}

lemma PairValueQuotientOrdered(leftN: int, leftD: int, rightN: int, rightD: int)
  requires leftN >= 0 && rightN >= 0
  requires leftD > 0 && rightD > 0
  requires leftN * rightD <= rightN * leftD
  ensures quotient_pairValue(leftN, leftD) <= quotient_pairValue(rightN, rightD)
{
  var q := leftN / leftD;
  assert quotient_pairValue(leftN, leftD) == q;
  assert leftN == q * leftD + leftN % leftD;
  assert q * leftD <= leftN;
  assert 0 <= (leftN - q * leftD) * rightD;
  assert q * leftD * rightD <= leftN * rightD <= rightN * leftD;
  if q * rightD > rightN {
    assert 0 < (q * rightD - rightN) * leftD;
    assert q * leftD * rightD > rightN * leftD;
  }
  assert q * rightD <= rightN;
  assert rightN <= rightN * rightD;
  PairValueQuotientBounds(rightN, rightD, q, rightN);
}

lemma PairValueOrderedMean(low: int, high: int)
  requires 0 < low <= high
  ensures low <= harmonicValue(low, high) <= high
{
  var numerator := 2 * low * high;
  var denominator := low + high;
  assert low * denominator <= numerator by {
    calc {
      numerator - low * denominator;
      == low * (high - low);
      >= 0;
    }
  }
  assert numerator <= high * denominator by {
    calc {
      high * denominator - numerator;
      == high * (high - low);
      >= 0;
    }
  }
  PairValueQuotientBounds(numerator, denominator, low, high);
}

lemma lawHarmonicBetweenSides_ensures(left: int, right: int)
  ensures (lawHarmonicBetweenSides(left, right) == true)
{
  if left > 0 && right > 0 {
    if left < right {
      PairValueOrderedMean(left, right);
    } else {
      PairValueOrderedMean(right, left);
      PairValueMeansSymmetric(left, right);
    }
  }
}

lemma PairValueMeansSymmetric(left: int, right: int)
  requires left > 0 && right > 0
  ensures harmonicValue(left, right) == harmonicValue(right, left)
{
  assert 2 * left * right == 2 * right * left;
  assert left + right == right + left;
}

lemma lawHarmonicMonotone_ensures(left: int, raised: int, right: int)
  ensures (lawHarmonicMonotone(left, raised, right) == true)
{
  if right > 0 && left <= raised {
    if left <= 0 {
      if raised > 0 {
        lawHarmonicBetweenSides_ensures(raised, right);
        assert 0 < harmonicValue(raised, right);
      }
    } else {
      var leftN := 2 * left * right;
      var rightN := 2 * raised * right;
      assert 0 <= (raised - left) * right;
      assert 0 <= 2 * ((raised - left) * right) * right;
      calc {
        rightN * (left + right) - leftN * (raised + right);
        == 2 * ((raised - left) * right) * right;
        >= 0;
      }
      PairValueQuotientOrdered(leftN, left + right, rightN, raised + right);
    }
  }
}

lemma PairValuePenaltyOrdered(near: int, far: int, freeGap: int, penalty: int)
  requires near <= far
  ensures 0 <= parityPenalty(near, freeGap, penalty) <= parityPenalty(far, freeGap, penalty)
{
  if penalty > 0 && near > freeGap {
    assert 0 <= penalty * (near - freeGap);
    assert 0 <= penalty * (far - near);
    assert penalty * (near - freeGap) <= penalty * (far - freeGap);
  } else if penalty > 0 && far > freeGap {
    assert 0 <= penalty * (far - freeGap);
  }
}

lemma lawPairValueBounded_ensures(side: PairSide, other: PairSide, offset: int, rules: PairRules)
  ensures (lawPairValueBounded(side, other, offset, rules) == true)
{
  if 0 <= side.utility <= pairValueScale && 0 <= other.utility <= pairValueScale {
    var gap := standingGap(side.standing, other.standing, offset);
    var mean := harmonicValue(side.utility, other.utility);
    lawHarmonicBetweenSides_ensures(side.utility, other.utility);
    assert mean <= pairValueScale;
    PairValuePenaltyOrdered(gap, gap, rules.parityFreeGap, rules.parityPenaltyPerPoint);
    assert mean - parityPenalty(gap, rules.parityFreeGap, rules.parityPenaltyPerPoint) <= pairValueScale;
  }
}

lemma lawSmallerGapNeverWorse_ensures(side: PairSide, other: PairSide, nearer: PairSide, offset: int, rules: PairRules)
  ensures (lawSmallerGapNeverWorse(side, other, nearer, offset, rules) == true)
{
  var near := standingGap(side.standing, nearer.standing, offset);
  var far := standingGap(side.standing, other.standing, offset);
  if nearer.utility == other.utility && pairAdmissible(side, other, offset, rules)
    && pairAdmissible(side, nearer, offset, rules) && near <= far {
    PairValuePenaltyOrdered(near, far, rules.parityFreeGap, rules.parityPenaltyPerPoint);
    var mean := harmonicValue(side.utility, other.utility);
    var nearerValue := mean - parityPenalty(near, rules.parityFreeGap, rules.parityPenaltyPerPoint);
    var otherValue := mean - parityPenalty(far, rules.parityFreeGap, rules.parityPenaltyPerPoint);
    assert nearerValue >= otherValue;
    assert pairValue(side, nearer, offset, rules) == (if nearerValue > 0 then nearerValue else 0);
    assert pairValue(side, other, offset, rules) == (if otherValue > 0 then otherValue else 0);
  }
}
