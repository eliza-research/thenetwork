# Send one expected member invitation

[Story F1](product/stories.md#story-f1--invite-and-vouch) normally gives the
inviter a link to [forward themselves](memberInvitation.md). This exception
covers one message from the service to a person who expects it. The model
works with authorization facts. It does not store a number, invitation link,
vouch text or invitee profile.

## Story: Send an invitation that the recipient expects

> As a member, I want the service to send a person I can vouch for one invitation they expect, so they can choose whether to join.

### Only a confirmed expected invitation can enter the shared line queue

Require a current direct turn from the eligible inviter and an explicit
confirmation that this exact recipient expects the invitation. The member
must vouch for someone else. Use a private confirmation that expires in
fifteen minutes. The member must already hold their current app's issued
forwarding link. That link has passed ordinary vouch review and used its
allowance. Stage and confirm a private draft only while the configured
carrier accepts first contact and live delivery is approved. If the carrier
cannot send, give the inviter the forwarding option without storing the
recipient or asking for confirmation. A prior prompt can be replayed only
for its current exact owner, link, recipient and unconfirmed draft. Its
expiry and the same carrier checks still apply. Check current recipient
eligibility and suppression at confirmation. A recipient
gets at most one service invitation in the rolling invitation window, even
across apps. Commit the delivery key and recipient binding together with
the existing invitation under the same concurrency controls.
The member sees the same response when private recipient facts prevent
contact. Do not tell the member another person's membership status.

```quint
import memberInvitation as MemberInvite from "./memberInvitation"

type ExpectedInvitePhase = Unissued | Queued | Attempted | Retryable | Delivered | Redeemed | Closed
type ExpectedInvite = { phase: ExpectedInvitePhase, expiresAt: int, deliveries: int }
type ExpectedInviteRequestFacts = {
  direct: bool,
  confirmedExpected: bool,
  exactTarget: bool,
  distinctRecipient: bool,
  issuerCurrent: bool,
  reviewClear: bool,
  recipientAllowed: bool,
  firstContact: bool,
  now: int,
  expiresAt: int
}

pure val initial: ExpectedInvite = { phase: Unissued, expiresAt: 0, deliveries: 0 }
pure val nowValues = Set(-1, 0, 1, 99, 100, 101)
pure val eligibleRequest: ExpectedInviteRequestFacts = {
  direct: true, confirmedExpected: true, exactTarget: true, distinctRecipient: true,
  issuerCurrent: true, reviewClear: true, recipientAllowed: true, firstContact: true,
  now: 0, expiresAt: 100
}
pure val requestValues = Set(eligibleRequest,
  { ...eligibleRequest, direct: false },
  { ...eligibleRequest, confirmedExpected: false },
  { ...eligibleRequest, exactTarget: false },
  { ...eligibleRequest, distinctRecipient: false },
  { ...eligibleRequest, issuerCurrent: false },
  { ...eligibleRequest, reviewClear: false },
  { ...eligibleRequest, recipientAllowed: false },
  { ...eligibleRequest, firstContact: false },
  { ...eligibleRequest, now: 100 })

pure def expectedInviteLive(now: int, expiresAt: int): bool = now >= 0 and now < expiresAt

pure def expectedInviteChallengeCurrent(issuedAt: int, now: int): bool =
  MemberInvite::memberInviteDraftCurrent(now - issuedAt)

pure def expectedInviteTransportAllows(carrierAcceptsFirstContact: bool, liveApproved: bool): bool =
  carrierAcceptsFirstContact and liveApproved

pure def expectedInviteChallengeCanReplay(transportAvailable: bool, awaitingConfirmation: bool,
  exactDraft: bool, issuedAt: int, now: int, expiresAt: int): bool =
  transportAvailable and awaitingConfirmation and exactDraft and
    expectedInviteChallengeCurrent(issuedAt, now) and expectedInviteLive(now, expiresAt)

pure def lawUnavailableTransportCannotReplay(approvalPending: bool, exactDraft: bool, issuedAt: int, now: int, expiresAt: int): bool =
  not(expectedInviteChallengeCanReplay(false, approvalPending, exactDraft, issuedAt, now, expiresAt))

pure def expectedInviteMayStage(request: ExpectedInviteRequestFacts): bool =
  request.direct and request.confirmedExpected and request.exactTarget and request.distinctRecipient and
  request.issuerCurrent and request.reviewClear and request.recipientAllowed and request.firstContact and
  expectedInviteLive(request.now, request.expiresAt)

pure def canStageExpectedInvite(invite: ExpectedInvite, request: ExpectedInviteRequestFacts): bool =
  invite.phase == Unissued and expectedInviteMayStage(request)

pure def stageExpectedInvite(invite: ExpectedInvite, request: ExpectedInviteRequestFacts): ExpectedInvite =
  if (canStageExpectedInvite(invite, request))
    { phase: Queued, expiresAt: request.expiresAt, deliveries: 0 }
  else invite

pure def lawExpectedInviteNeedsExactConfirmation(request: ExpectedInviteRequestFacts): bool =
  expectedInviteMayStage(request) implies
    (request.direct and request.confirmedExpected and request.exactTarget and request.distinctRecipient)

pure def lawExpectedInviteNeedsCurrentReview(request: ExpectedInviteRequestFacts): bool =
  expectedInviteMayStage(request) implies (request.issuerCurrent and request.reviewClear)

pure def lawExpectedInviteNeedsAnEligibleFirstContact(request: ExpectedInviteRequestFacts): bool =
  expectedInviteMayStage(request) implies (request.recipientAllowed and request.firstContact)
```

### One durably claimed dispatch may contact the recipient

Before the queue claims delivery, recheck the inviter, expiry, recipient
eligibility and the exact approved payload. Send through the shared line with
the usual leak, suppression and delivery checks. A leak failure closes the
private payload without keeping it for staff review. The message names the
inviter, identifies The Network, and tells the recipient how to opt out.
Include only the intended app's invitation link. Use the
[outbound receipt rules](outboundReceipt.md) to look up the original delivery
key after an uncertain outcome. Only authoritative
proof that the provider never admitted the original key permits another
attempt with that same key and payload. An unanswered invitation,
restart or uncertain outcome never creates a second delivery key or a
follow-up message.

```quint
type ExpectedInviteDispatchFacts = {
  queued: bool,
  issuerCurrent: bool,
  recipientAllowed: bool,
  exactPayload: bool,
  now: int,
  expiresAt: int
}

pure val eligibleDispatch: ExpectedInviteDispatchFacts = {
  queued: true, issuerCurrent: true, recipientAllowed: true, exactPayload: true, now: 0, expiresAt: 100
}
pure val dispatchValues = Set(eligibleDispatch,
  { ...eligibleDispatch, queued: false },
  { ...eligibleDispatch, issuerCurrent: false },
  { ...eligibleDispatch, recipientAllowed: false },
  { ...eligibleDispatch, exactPayload: false },
  { ...eligibleDispatch, now: 100 })

pure def expectedInviteMayDispatch(dispatch: ExpectedInviteDispatchFacts): bool =
  dispatch.queued and dispatch.issuerCurrent and dispatch.recipientAllowed and dispatch.exactPayload and
  expectedInviteLive(dispatch.now, dispatch.expiresAt)

pure def canDispatchExpectedInvite(invite: ExpectedInvite, now: int, issuerCurrent: bool,
  recipientAllowed: bool, exactPayload: bool): bool =
  expectedInviteMayDispatch({
    queued: invite.phase == Queued or invite.phase == Retryable, issuerCurrent: issuerCurrent,
    recipientAllowed: recipientAllowed, exactPayload: exactPayload,
    now: now, expiresAt: invite.expiresAt
  })

pure def dispatchExpectedInvite(invite: ExpectedInvite, now: int, issuerCurrent: bool,
  recipientAllowed: bool, exactPayload: bool): ExpectedInvite =
  if (canDispatchExpectedInvite(invite, now, issuerCurrent, recipientAllowed, exactPayload))
    { ...invite, phase: Attempted, deliveries: 1 }
  else invite

pure def canRecordExpectedInviteReceipt(invite: ExpectedInvite, exactPositiveReceipt: bool): bool =
  invite.phase == Attempted and exactPositiveReceipt

pure def recordExpectedInviteReceipt(invite: ExpectedInvite, exactPositiveReceipt: bool): ExpectedInvite =
  if (canRecordExpectedInviteReceipt(invite, exactPositiveReceipt))
    { ...invite, phase: Delivered }
  else invite

pure def canRequeueExpectedInvite(invite: ExpectedInvite, neverAdmitted: bool, sameKey: bool): bool =
  invite.phase == Attempted and neverAdmitted and sameKey

pure def requeueExpectedInvite(invite: ExpectedInvite, neverAdmitted: bool, sameKey: bool): ExpectedInvite =
  if (canRequeueExpectedInvite(invite, neverAdmitted, sameKey))
    { ...invite, phase: Retryable }
  else invite

pure def alwaysExpectedInviteDeliveriesAtMostOne(invite: ExpectedInvite): bool =
  invite.deliveries >= 0 and invite.deliveries <= 1

pure def alwaysUnclaimedExpectedInviteHasNoDelivery(invite: ExpectedInvite): bool =
  (invite.phase == Unissued or invite.phase == Queued) implies invite.deliveries == 0

pure def alwaysOnlyAClaimedInviteCanHaveAReceipt(invite: ExpectedInvite): bool =
  (invite.phase == Attempted or invite.phase == Retryable or invite.phase == Delivered or invite.phase == Redeemed)
    implies invite.deliveries == 1

pure def stepExpectedInviteDeliveriesNeverGoBack(before: ExpectedInvite, after: ExpectedInvite): bool =
  after.deliveries >= before.deliveries

pure def lawUnknownExpectedInviteCannotRetry(phase: ExpectedInvitePhase, sameKey: bool): bool =
  not(canRequeueExpectedInvite({ phase: phase, expiresAt: 100, deliveries: 1 }, false, sameKey))

pure def lawSuppressedExpectedInviteCannotDispatch(dispatch: ExpectedInviteDispatchFacts): bool =
  not(dispatch.recipientAllowed) implies not(expectedInviteMayDispatch(dispatch))

pure def sometimesExpectedInviteCanSend(invite: ExpectedInvite): bool = invite.phase == Attempted
pure def sometimesExpectedInviteCanRetry(invite: ExpectedInvite): bool = invite.phase == Retryable
pure def sometimesExpectedInviteFindsReceipt(invite: ExpectedInvite): bool = invite.phase == Delivered
```

### Only the intended verified recipient can accept

Use the ordinary membership, consent and age checks and the invitation's
verified recipient binding. Match the exact app and current verified phone.
The invitation must be unspent, unexpired and already claimed for delivery.
Check the inviter and suppression again. The recipient may have received
the original message before a provider receipt reached the service. A valid
join commits the normal attributed first membership and spends the invitation
once. Other people who have the link get no recipient information.

```quint
type ExpectedInviteAcceptanceFacts = {
  exactApp: bool,
  verifiedRecipient: bool,
  unredeemed: bool,
  issuerCurrent: bool,
  recipientAllowed: bool,
  now: int,
  expiresAt: int
}

pure val eligibleAcceptance: ExpectedInviteAcceptanceFacts = {
  exactApp: true, verifiedRecipient: true, unredeemed: true, issuerCurrent: true,
  recipientAllowed: true, now: 0, expiresAt: 100
}
pure val acceptanceValues = Set(eligibleAcceptance,
  { ...eligibleAcceptance, exactApp: false },
  { ...eligibleAcceptance, verifiedRecipient: false },
  { ...eligibleAcceptance, unredeemed: false },
  { ...eligibleAcceptance, issuerCurrent: false },
  { ...eligibleAcceptance, recipientAllowed: false },
  { ...eligibleAcceptance, now: 100 })

pure def expectedInviteMayAccept(acceptance: ExpectedInviteAcceptanceFacts): bool =
  acceptance.exactApp and acceptance.verifiedRecipient and acceptance.unredeemed and
  acceptance.issuerCurrent and acceptance.recipientAllowed and expectedInviteLive(acceptance.now, acceptance.expiresAt)

pure def canAcceptExpectedInvite(invite: ExpectedInvite, now: int, exactApp: bool,
  verifiedRecipient: bool, issuerCurrent: bool, recipientAllowed: bool): bool =
  expectedInviteMayAccept({
    exactApp: exactApp, verifiedRecipient: verifiedRecipient,
    unredeemed: invite.phase == Attempted or invite.phase == Delivered,
    issuerCurrent: issuerCurrent, recipientAllowed: recipientAllowed,
    now: now, expiresAt: invite.expiresAt
  })

pure def acceptExpectedInvite(invite: ExpectedInvite, now: int, exactApp: bool,
  verifiedRecipient: bool, issuerCurrent: bool, recipientAllowed: bool): ExpectedInvite =
  if (canAcceptExpectedInvite(invite, now, exactApp, verifiedRecipient, issuerCurrent, recipientAllowed))
    { ...invite, phase: Redeemed }
  else invite

pure def lawExpectedInviteAcceptanceRequiresVerifiedRecipient(acceptance: ExpectedInviteAcceptanceFacts): bool =
  expectedInviteMayAccept(acceptance) implies (acceptance.exactApp and acceptance.verifiedRecipient)

pure def sometimesExpectedInviteRedeemed(invite: ExpectedInvite): bool = invite.phase == Redeemed
```

### Decline, suppression and expiry end the invitation

A signed decline from the exact recipient closes their outstanding
invitation. STOP also suppresses every app on the shared line. Expiry or a
change that removes eligibility closes the invitation, revokes the link and
removes stored contact material. A closed invitation cannot dispatch or
accept. Keep a minimal suppression or deduplication record; it supplies no
profile or matching input.

```quint
pure def expectedInviteMayDecline(exactRecipient: bool, contactStarted: bool): bool =
  exactRecipient and contactStarted

pure def expectedInviteContactStarted(phase: ExpectedInvitePhase): bool =
  phase == Attempted or phase == Delivered

pure def canCloseExpectedInvite(invite: ExpectedInvite, now: int, invalidated: bool,
  exactRecipientDeclined: bool): bool =
  (invite.phase == Queued or invite.phase == Retryable or expectedInviteContactStarted(invite.phase)) and
    (invalidated or not(expectedInviteLive(now, invite.expiresAt)) or
      expectedInviteMayDecline(exactRecipientDeclined, expectedInviteContactStarted(invite.phase)))

pure def closeExpectedInvite(invite: ExpectedInvite, now: int, invalidated: bool,
  exactRecipientDeclined: bool): ExpectedInvite =
  if (canCloseExpectedInvite(invite, now, invalidated, exactRecipientDeclined))
    { ...invite, phase: Closed }
  else invite

pure def stepExpectedInviteTerminalStatesStayClosed(before: ExpectedInvite, after: ExpectedInvite): bool =
  (before.phase == Redeemed or before.phase == Closed) implies after == before

pure def sometimesExpectedInviteClosed(invite: ExpectedInvite): bool = invite.phase == Closed
```
