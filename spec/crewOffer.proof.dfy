lemma forgetCrewInvitee_ensures(offer: CrewOfferState, memberId: string)
  ensures (inv(offer) ==> canForgetCrewInvitee(offer) ==> alwaysAnswersComeFromInvitees(forgetCrewInvitee(offer, memberId)))
  ensures (inv(offer) ==> canForgetCrewInvitee(offer) ==> stepResolvedOfferStaysClosed(offer, forgetCrewInvitee(offer, memberId)))
{
  if inv(offer) && canForgetCrewInvitee(offer) {
    var kept := forgetCrewInvitee(offer, memberId);
    var keep := (id: string) => id != memberId;
    assert kept.yes == ProofLib.Filter(keep, offer.yes);
    assert kept.no == ProofLib.Filter(keep, offer.no);
    assert kept.offered == ProofLib.Filter(keep, offer.offered);
    KeptRepliesStillInvited(offer.yes, offer.offered, memberId);
    KeptRepliesStillInvited(offer.no, offer.offered, memberId);
    assert Std.Collections.Seq.All(kept.yes, (id: string) => id in kept.offered);
    assert Std.Collections.Seq.All(kept.no, (id: string) => id in kept.offered);
  }
}

lemma KeptRepliesStillInvited(answers: seq<string>, invited: seq<string>, removed: string)
  requires Std.Collections.Seq.All(answers, (id: string) => id in invited)
  ensures Std.Collections.Seq.All(
    ProofLib.Filter((id: string) => id != removed, answers),
    (id: string) => id in ProofLib.Filter((id: string) => id != removed, invited))
{
  reveal Std.Collections.Seq.All();
  var keep := (id: string) => id != removed;
  var keptAnswers := ProofLib.Filter(keep, answers);
  var keptInvitees := ProofLib.Filter(keep, invited);
  forall id | id in keptAnswers
    ensures id in keptInvitees
  {
    ProofLib.FilterMember(keep, answers, id);
    assert id in invited;
    ProofLib.FilterMember(keep, invited, id);
  }
}
