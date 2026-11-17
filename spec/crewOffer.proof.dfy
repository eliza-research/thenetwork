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
    KeptRepliesStillInvited(keep, offer.yes, offer.offered);
    KeptRepliesStillInvited(keep, offer.no, offer.offered);
  }
}

lemma KeptRepliesStillInvited(keep: string -> bool, answers: seq<string>, invited: seq<string>)
  requires forall id :: id in answers ==> id in invited
  ensures forall id :: id in ProofLib.Filter(keep, answers) ==> id in ProofLib.Filter(keep, invited)
{
  forall id | id in ProofLib.Filter(keep, answers)
    ensures id in ProofLib.Filter(keep, invited)
  {
    ProofLib.FilterMember(keep, answers, id);
    ProofLib.FilterMember(keep, invited, id);
  }
}
