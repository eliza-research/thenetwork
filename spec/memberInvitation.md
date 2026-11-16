# Member invitation

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

### The link goes to the inviter as a reply

Show the link only to the member who requested it. The member can forward it themselves. The invitee receives no message from this operation. A flagged request waits for staff before it returns a link. Grant an exception to the contact-link check only for the exact, app-owned link provided by the trusted issuer, once in that reply. Keep the bearer out of matching state and internal message logs. The signed delivery record keeps the exact private reply for replay while the invitation is current.

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
