lemma lawStandingMonotoneInEvidence_ensures(evidence: seq<StandingEvidence>, extra: StandingEvidence)
  ensures (lawStandingMonotoneInEvidence(evidence, extra) == true)
{
  var add := (total: int, fact: StandingEvidence) => total + standingEvidencePoints(fact);
  var total := Std.Collections.Seq.FoldLeft(add, 0, evidence);
  var points := standingEvidencePoints(extra);
  ProofLib.FoldLeftAppend(add, 0, evidence, extra);
  assert standingFromEvidence(evidence) == standingClamp(total);
  assert standingFromEvidence(evidence + [extra]) == standingClamp(total + points);
  assert points >= 0;
  assert standingClamp(total) <= standingClamp(total + points);
}

lemma StandingQuotientIsDivision(a: int, b: int)
  requires a >= 0 && b > 0
  ensures quotient_memberStanding(a, b) == a / b
{
}

lemma StandingMulLe(a: int, b: int, c: int)
  requires a <= b && c >= 0
  ensures a * c <= b * c
{
  assert b * c - a * c == (b - a) * c;
}

lemma StandingMulLt(a: int, b: int, c: int)
  requires a < b && c > 0
  ensures a * c < b * c
{
  assert b * c - a * c == (b - a) * c;
}

lemma StandingDivisionMonotone(a: int, c: int, b: int)
  requires 0 <= a <= c && b > 0
  ensures a / b <= c / b
{
  var qa := a / b;
  var qc := c / b;
  assert a == qa * b + a % b;
  assert c == qc * b + c % b;
  if qa > qc {
    StandingMulLe(qc + 1, qa, b);
    assert (qc + 1) * b == qc * b + b;
    assert false;
  }
}

lemma StandingQuotientAtMost(a: int, b: int, m: int)
  requires 0 <= a && b > 0 && a <= m * b
  ensures a / b <= m
{
  var q := a / b;
  assert a == q * b + a % b;
  if q > m {
    StandingMulLe(m + 1, q, b);
    assert (m + 1) * b == m * b + b;
    assert false;
  }
}

lemma StandingFloorsClose(x: int, d: int, y: int, e: int)
  requires x >= 0 && y >= 0 && d > 0 && e > 0
  requires x * e - y * d <= 5 * (d * e)
  ensures x / d - y / e <= 5
{
  var q := x / d;
  var r := y / e;
  assert x == q * d + x % d;
  assert y == r * e + y % e;
  assert q * d <= x;
  assert y < (r + 1) * e;
  if q - r > 5 {
    StandingMulLe(q * d, x, e);
    StandingMulLt(y, (r + 1) * e, d);
    StandingMulLe(r + 6, q, d * e);
    assert q * d * e == q * (d * e);
    assert (r + 1) * e * d == (r + 1) * (d * e);
    assert (r + 6) * (d * e) == (r + 1) * (d * e) + 5 * (d * e);
    assert false;
  }
}

lemma StandingPercentileExact(below: int, equal: int, rated: int)
  requires below >= 0 && equal >= 0 && 2 * below + equal <= 2 * rated && rated > 0
  ensures standingPercentile(below, equal, rated) == ((2 * below + equal) * 100) / (2 * rated)
  ensures 0 <= ((2 * below + equal) * 100) / (2 * rated) <= 100
{
  var x := (2 * below + equal) * 100;
  assert (2 * below + equal) * matchLane_standingCeiling == x;
  StandingQuotientIsDivision(x, 2 * rated);
  StandingQuotientAtMost(x, 2 * rated, 100);
}

lemma lawStandingPercentileRisesWithRank_ensures(below: int, equal: int, rated: int)
  ensures (lawStandingPercentileRisesWithRank(below, equal, rated) == true)
{
  if below >= 0 && equal >= 0 && rated > 0 {
    var low := (2 * below + equal) * matchLane_standingCeiling;
    var high := (2 * (below + 1) + equal) * matchLane_standingCeiling;
    assert low == (2 * below + equal) * 100;
    assert high == low + 200;
    StandingQuotientIsDivision(low, 2 * rated);
    StandingQuotientIsDivision(high, 2 * rated);
    StandingDivisionMonotone(low, high, 2 * rated);
  }
}

lemma lawStandingPercentileStableWhenOneJoins_ensures(below: int, equal: int, rated: int)
  ensures (lawStandingPercentileStableWhenOneJoins(below, equal, rated) == true)
{
  if below >= 0 && equal >= 1 && below + equal <= rated && standingPoolReady(rated) {
    var n := rated;
    assert n >= 20;
    var x := (2 * below + equal) * 100;
    var d := 2 * n;
    var e := 2 * n + 2;
    assert 0 <= x <= 200 * n - 100;
    assert d * e == 4 * (n * n) + 4 * n;
    StandingMulLe(20, n, n);
    assert 5 * (d * e) >= 400 * n;
    StandingPercentileExact(below, equal, n);
    StandingPercentileExact(below, equal, n + 1);
    StandingPercentileExact(below + 1, equal, n + 1);
    StandingPercentileExact(below, equal + 1, n + 1);
    assert (2 * (below + 1) + equal) * 100 == x + 200;
    assert (2 * below + (equal + 1)) * 100 == x + 100;
    assert x * e - x * d == 2 * x;
    assert x * e - (x + 200) * d == 2 * x - 400 * n;
    assert (x + 200) * d - x * e == 400 * n - 2 * x;
    assert x * e - (x + 100) * d == 2 * x - 200 * n;
    assert (x + 100) * d - x * e == 200 * n - 2 * x;
    assert d * e == e * d;
    StandingFloorsClose(x, d, x, e);
    StandingFloorsClose(x, e, x, d);
    StandingFloorsClose(x, d, x + 200, e);
    StandingFloorsClose(x + 200, e, x, d);
    StandingFloorsClose(x, d, x + 100, e);
    StandingFloorsClose(x + 100, e, x, d);
  }
}
