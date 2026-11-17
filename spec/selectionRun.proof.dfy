// A reservation never names a refused member, so its folds over the choice's
// members leave the use of every refused member as it was.
lemma reserveSelection_ensures(s: SelectionRun, choice: SelectionChoice, timeFree: bool, exploring: bool, packAllows: bool, value: int)
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> alwaysSelectedCountIsNonnegative(reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> alwaysRefusedMemberStaysFull(reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> stepCompletedRunStaysClosed(s, reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> stepGreedyValuesNeverRise(s, reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> stepOnlyReserveIncreasesSelections(s, "reserveSelection", reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
  ensures (inv(s) ==> canReserveSelection(s, choice, timeFree, exploring, packAllows, value) ==> stepRefusedMemberGetsNoReservation(s, reserveSelection(s, choice, timeFree, exploring, packAllows, value)))
{
  if inv(s) && canReserveSelection(s, choice, timeFree, exploring, packAllows, value) {
    var after := reserveSelection(s, choice, timeFree, exploring, packAllows, value);
    assert after.refusals == s.refusals;
    assert after.proactive == Std.Collections.Seq.FoldLeft((counts: map<string, int>, m: SelectionMember) => addUse(counts, m.id), s.proactive, choice.members);
    assert after.contribution == Std.Collections.Seq.FoldLeft((counts: map<string, int>, m: SelectionMember) => (if m.contributor then addUse(counts, m.id) else counts), s.contribution, choice.members);
    forall r | r in s.refusals
      ensures proactiveUsed(after, r.member.id) == proactiveUsed(s, r.member.id)
      ensures numberUsed(after.contribution, r.member.id) == numberUsed(s.contribution, r.member.id)
    {
      forall m | m in choice.members
        ensures m.id != r.member.id
      {
        assert !selectionMemberRefused(s, m.id);
      }
      ProactiveFoldKeeps(s.proactive, choice.members, r.member.id);
      ContributionFoldKeeps(s.contribution, choice.members, r.member.id);
    }
    assert stepRefusedMemberGetsNoReservation(s, after);
    assert alwaysRefusedMemberStaysFull(after);
  }
}

lemma DollarKeysDiffer(a: string, b: string)
  requires a != b
  ensures ("$" + a) != ("$" + b)
{
  assert ("$" + a)[1..] == a;
  assert ("$" + b)[1..] == b;
}

lemma ProactiveFoldKeeps(start: map<string, int>, members: seq<SelectionMember>, id: string)
  requires forall m :: m in members ==> m.id != id
  ensures numberUsed(Std.Collections.Seq.FoldLeft((counts: map<string, int>, m: SelectionMember) => addUse(counts, m.id), start, members), id) == numberUsed(start, id)
  decreases |members|
{
  if |members| > 0 {
    var f := (counts: map<string, int>, m: SelectionMember) => addUse(counts, m.id);
    DollarKeysDiffer(members[0].id, id);
    assert numberUsed(f(start, members[0]), id) == numberUsed(start, id);
    assert forall m :: m in members[1..] ==> m in members;
    ProactiveFoldKeeps(f(start, members[0]), members[1..], id);
  }
}

lemma ContributionFoldKeeps(start: map<string, int>, members: seq<SelectionMember>, id: string)
  requires forall m :: m in members ==> m.id != id
  ensures numberUsed(Std.Collections.Seq.FoldLeft((counts: map<string, int>, m: SelectionMember) => (if m.contributor then addUse(counts, m.id) else counts), start, members), id) == numberUsed(start, id)
  decreases |members|
{
  if |members| > 0 {
    var f := (counts: map<string, int>, m: SelectionMember) => (if m.contributor then addUse(counts, m.id) else counts);
    DollarKeysDiffer(members[0].id, id);
    assert numberUsed(f(start, members[0]), id) == numberUsed(start, id);
    assert forall m :: m in members[1..] ==> m in members;
    ContributionFoldKeeps(f(start, members[0]), members[1..], id);
  }
}
