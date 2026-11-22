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
