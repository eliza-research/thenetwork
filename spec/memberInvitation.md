# Member invitation

The default is a forwarding link. [Expected invitation delivery](expectedMemberInvitation.md) covers the optional confirmed service send.

## Story: Forward an invitation for someone I know

> As a member, I want a link I can forward to a person I can vouch for so they can decide whether to join.

### A direct named vouch can use the adult member's allowance

Issue a link only for a direct request from an eligible adult member. The member must have current consent, be clear of trust and report holds, name a personal relationship, and have room under their invitation allowance. Count committed links and invitations held for review against the rolling 30-day allowance. An unavailable issuer does not spend a slot. A vouch is invite evidence and does not create a profile for the invitee. Recheck the issuer's account, consent, age and holds before replay or redemption.

```quint
pure val memberInviteWindowMs: int = 2592000000
pure val defaultMemberInviteCapacity: int = 3

pure def memberInviteWithinWindow(ageMs: int): bool = ageMs >= 0 and ageMs < memberInviteWindowMs

pure def memberInviteSourceCurrent(adult: bool, accountEligible: bool, consents: bool, clearOfHolds: bool,
  now: int, invitesBlockedUntil: int): bool =
  adult and accountEligible and consents and clearOfHolds and now >= invitesBlockedUntil

pure def memberMayRequestInvite(adult: bool, accountEligible: bool, consents: bool, clearOfHolds: bool,
  now: int, invitesBlockedUntil: int, used: int, limit: int): bool =
  memberInviteSourceCurrent(adult, accountEligible, consents, clearOfHolds, now, invitesBlockedUntil) and used >= 0 and used < limit

pure def memberInviteRelationshipKnown(relationship: str): bool =
  relationship == "friend" or relationship == "coworker" or relationship == "roommate" or relationship == "family"

pure def memberInviteCanIssue(directMemberRequest: bool, eligible: bool, relationship: str): bool =
  directMemberRequest and eligible and memberInviteRelationshipKnown(relationship)

pure def memberInviteUsesAllowance(status: str): bool = status == "issued" or status == "review"

pure def lawMemberInviteNeedsAdult(accountEligible: bool, consents: bool, clearOfHolds: bool, now: int,
  invitesBlockedUntil: int, used: int, limit: int): bool =
  not(memberMayRequestInvite(false, accountEligible, consents, clearOfHolds, now, invitesBlockedUntil, used, limit))

pure def lawMemberInviteNeedsDirectRequest(eligible: bool, relationship: str): bool =
  not(memberInviteCanIssue(false, eligible, relationship))

pure def lawUnavailableMemberInviteDoesNotSpend(status: str): bool =
  status == "unavailable" implies not(memberInviteUsesAllowance(status))
```

### Confirm private relationship evidence before issuance

Ask the inviter how long and how well they know the person. Read back the reported relationship, duration and depth. A confirmation must come from the inviter's direct turn and refer to that current draft. A draft is valid for fifteen minutes from the request. A cancellation or opt-out ends the draft. Keep only the reported relationship, coarse duration and depth with the invitation. An invitee's phone, profile details and the inviter's raw notes do not go to matching, delivery or staff review.

```quint
pure val memberInviteDraftMs: int = 900000
pure val memberInviteMaxMonths: int = 1500

pure def memberInviteDraftCurrent(ageMs: int): bool = ageMs >= 0 and ageMs < memberInviteDraftMs

pure def memberInviteEvidenceValid(durationMonths: int, depth: str): bool =
  durationMonths >= 0 and durationMonths <= memberInviteMaxMonths and
    (depth == "met_once" or depth == "somewhat" or depth == "well")

pure def memberInviteConfirmationReady(direct: bool, draftCurrent: bool, evidenceValid: bool, explicitlyConfirmed: bool): bool =
  direct and draftCurrent and evidenceValid and explicitlyConfirmed

pure def lawMemberInviteRequiresConfirmation(direct: bool, draftCurrent: bool, evidenceValid: bool): bool =
  not(memberInviteConfirmationReady(direct, draftCurrent, evidenceValid, false))
```

### Hold weak or unusual invitations for staff

Flag a reported relationship of less than a month or a single meeting, a new invitation after at least two other committed or held invitations in 24 hours, or words that indicate unusual risk. Each flag is enough to hold the request. Save the reasons as categories without retaining the invitation conversation. A held request cannot return a token until staff approve it and the requester presents the current approval in a signed turn.

```quint
pure val memberInviteBurstWindowMs: int = 86400000
pure val memberInviteBurstPriorCount: int = 2

pure def memberInviteWithinBurstWindow(ageMs: int): bool = ageMs >= 0 and ageMs < memberInviteBurstWindowMs

pure def memberInviteVouchWeak(durationMonths: int, depth: str): bool = durationMonths < 1 or depth == "met_once"

pure def memberInviteBurst(priorCount: int): bool = priorCount >= memberInviteBurstPriorCount

pure def memberInviteNeedsReview(weak: bool, burst: bool, riskLanguage: bool): bool = weak or burst or riskLanguage

pure def lawUnusualMemberInviteRequiresReview(weak: bool, burst: bool, riskLanguage: bool): bool =
  (weak or burst or riskLanguage) implies memberInviteNeedsReview(weak, burst, riskLanguage)

pure def memberInviteHeldLinkMayRelease(signedOwner: bool, currentApproval: bool): bool =
  signedOwner and currentApproval

pure def lawMemberInviteHeldLinkNeedsSignedApproval(signedOwner: bool, currentApproval: bool): bool =
  memberInviteHeldLinkMayRelease(signedOwner, currentApproval) implies (signedOwner and currentApproval)
```

### The link goes to the inviter as a reply

Show the link only to the member who requested it. The member can forward it themselves. The invitee receives no message from this operation. A flagged request waits for staff before it returns a link. The pending reply can show its exact server-generated review reference once. Contact checks can omit only that staged reference or the exact app-owned link from that direct reply. Keep the bearer out of matching state and internal message logs. The signed delivery record keeps the exact private reply for replay while the invitation is current. A pending reply also requires that the referenced request still be pending for its owner and app.

```quint
pure def memberInviteLinkCanBeShared(directMemberReply: bool, issuedLink: bool, appOwnedLink: bool, presentOnce: bool): bool =
  directMemberReply and issuedLink and appOwnedLink and presentOnce

pure def lawMemberInviteLinkNeedsDirectReply(issuedLink: bool, appOwnedLink: bool, presentOnce: bool): bool =
  not(memberInviteLinkCanBeShared(false, issuedLink, appOwnedLink, presentOnce))
```

### A new verified acceptance can be attributed

Attribute a verified first join once when the verified acceptance names the same inviter recorded on the new membership. Start the welcome once. Recover the attribution even if the member writes before projection. Apply [join notice policy](outreachPolicy.md#an-eligible-join-receipt-can-ride-on-a-current-reply) before telling the inviter, including the adult and consent checks.

```quint
pure def memberInviteCanAttribute(freshJoin: bool, trustedAcceptance: bool, inviterMatches: bool): bool =
  freshJoin and trustedAcceptance and inviterMatches

pure def lawOldMemberInviteCannotBeAttributed(trustedAcceptance: bool, inviterMatches: bool): bool =
  not(memberInviteCanAttribute(false, trustedAcceptance, inviterMatches))
```
