# Seed a cohort with staff invitations

[Story F2](product/stories.md#story-f2--seed-a-cohort) uses the ordinary
[enrollment rules](siteEnrollment.md). Staff receive individual links to
forward. This model takes facts from the staff, account, and delivery
boundaries. The raw link, phone number and vouch text remain outside it.

## Story: Create the first cohort's invitations

> As a founding-team operator, I want to create individually attributed invitations for a cohort I can vouch for.

### Only an authorized app admin can issue an attributable batch

An authenticated app admin with a stable operator identity can create
one batch of distinct recipients. Each invitation has a valid recipient
number, an intended supported cohort city, and private vouch evidence.
Accept one to 100 entries per request and one to 500 UTF-8 bytes of
vouch text per entry: the shortest and the longest vouch text of the
batch must both be in that range. Record the exact app and issuing operator. Protect
the private vouch evidence in storage. Use the ordinary invitation
lifetime of 30 days. Return a separate link for each recipient to the
operator. This operation creates invitations and an audit entry.
It sends no message, creates no person or membership, and uses no member
invitation allowance.

```quint
import memberInvitation as MemberInvite from "./memberInvitation"

type SeedInvitationPhase = SeedUnissued | SeedIssued | SeedRedeemed | SeedClosed
type SeedInvitation = { phase: SeedInvitationPhase, issuedAt: int, vouchRetained: bool }
type SeedBatchDecision = IssueSeedBatch | ReplaySeedBatch | RejectSeedBatch
type SeedBatchFacts = {
  appAdmin: bool,
  stableActor: bool,
  validCity: bool,
  validRecipients: bool,
  uniqueRecipients: bool,
  entryCount: int,
  shortestVouchBytes: int,
  longestVouchBytes: int,
  batchNew: bool,
  sameBatch: bool,
  batchLive: bool
}

pure val initial: SeedInvitation = { phase: SeedUnissued, issuedAt: 0, vouchRetained: false }
pure val seedInvitationBatchLimit: int = 100
pure val seedInvitationVouchByteLimit: int = 500
pure val issuedAtValues = Set(-1, 0, 1, 100)
pure val nowValues = Set(-1, 0, 1, 100, 2592000000, 2592000100)
pure val eligibleBatch: SeedBatchFacts = {
  appAdmin: true, stableActor: true, validCity: true, validRecipients: true,
  uniqueRecipients: true, entryCount: 1, shortestVouchBytes: 1, longestVouchBytes: 500,
  batchNew: true, sameBatch: false, batchLive: true
}

pure val batchValues = Set(eligibleBatch,
  { ...eligibleBatch, appAdmin: false },
  { ...eligibleBatch, stableActor: false },
  { ...eligibleBatch, validCity: false },
  { ...eligibleBatch, validRecipients: false },
  { ...eligibleBatch, uniqueRecipients: false },
  { ...eligibleBatch, entryCount: 0 },
  { ...eligibleBatch, entryCount: 101 },
  { ...eligibleBatch, shortestVouchBytes: 0 },
  { ...eligibleBatch, longestVouchBytes: 501 },
  { ...eligibleBatch, batchNew: false, sameBatch: false },
  { ...eligibleBatch, batchNew: false, sameBatch: true },
  { ...eligibleBatch, batchNew: false, sameBatch: true, batchLive: false })

pure def seedInvitationCitySupported(city: str): bool = city == "nyc" or city == "sf"

pure def seedInvitationBatchSizeAllowed(entryCount: int): bool = entryCount >= 1 and entryCount <= seedInvitationBatchLimit

pure def seedInvitationVouchSizeAllowed(bytes: int): bool = bytes >= 1 and bytes <= seedInvitationVouchByteLimit

pure def seedInvitationExpiresAt(issuedAt: int): int = issuedAt + MemberInvite::memberInviteWindowMs

pure def seedInvitationBatchAuthorized(batch: SeedBatchFacts): bool =
  batch.appAdmin and batch.stableActor and batch.validCity and batch.validRecipients
    and batch.uniqueRecipients and seedInvitationBatchSizeAllowed(batch.entryCount)
    and seedInvitationVouchSizeAllowed(batch.shortestVouchBytes)
    and seedInvitationVouchSizeAllowed(batch.longestVouchBytes)

pure def lawSeedInvitationIssueNeedsOperator(batch: SeedBatchFacts): bool =
  seedInvitationBatchAuthorized(batch) implies (batch.appAdmin and batch.stableActor)

pure def lawSeedInvitationBatchStaysInSizeLimits(batch: SeedBatchFacts): bool =
  seedInvitationBatchAuthorized(batch) implies
    (batch.entryCount >= 1 and batch.entryCount <= 100
      and batch.shortestVouchBytes >= 1 and batch.longestVouchBytes <= 500)
```

### A retry can return only the original live batch

Use the app, issuing operator, and normalized input to check the
idempotency key under the same transaction as issuance. A new key
creates the batch once. A repeat acts on the original live batch only
when all inputs agree and the same authorized operator requests it.
A repeat creates no new links and extends no deadline. A reused key
with different contents or an expired batch is unavailable: a repeat
needs the original batch to be live at the time of the request. Keep
recipient account status out of staff responses.

```quint
pure def seedInvitationBatchDecision(batch: SeedBatchFacts): SeedBatchDecision =
  if (not(seedInvitationBatchAuthorized(batch))) RejectSeedBatch
  else if (batch.batchNew) IssueSeedBatch
  else if (batch.sameBatch and batch.batchLive) ReplaySeedBatch
  else RejectSeedBatch

pure def canIssueSeedInvitation(invite: SeedInvitation, batch: SeedBatchFacts, issuedAt: int): bool =
  invite.phase == SeedUnissued and issuedAt >= 0 and seedInvitationBatchDecision(batch) == IssueSeedBatch

pure def issueSeedInvitation(invite: SeedInvitation, batch: SeedBatchFacts, issuedAt: int): SeedInvitation =
  if (canIssueSeedInvitation(invite, batch, issuedAt))
    { phase: SeedIssued, issuedAt: issuedAt, vouchRetained: true }
  else invite

pure def lawExistingSeedInvitationBatchCannotIssue(batch: SeedBatchFacts): bool =
  not(batch.batchNew) implies seedInvitationBatchDecision(batch) != IssueSeedBatch

pure def lawSeedInvitationBatchReplayRequiresExactBatch(batch: SeedBatchFacts): bool =
  (seedInvitationBatchDecision(batch) == ReplaySeedBatch) implies
    (not(batch.batchNew) and batch.sameBatch and batch.batchLive and seedInvitationBatchAuthorized(batch))

pure def sometimesSeedInvitationIssued(invite: SeedInvitation): bool = invite.phase == SeedIssued
```

## Story: Decide whether to join the cohort

> As the recipient, I want to choose whether to join on the app where the invitation was issued.

### Only the verified recipient can spend a current invitation

Verify the recipient's phone through ordinary signup. Match its digest to
the invitation in the same app. Recheck suppression and bans. Check that
the invitation is unused and unexpired. A fresh membership must pass
current app age, account, profile and consent checks. Consume the link and
save provenance with that membership in one transaction. The recipient
chooses their own home city. The cohort city and vouch are provenance,
independent of the recipient's profile, permissions, rank and matching.
An existing membership is neither disclosed to staff nor overwritten.
Redemption clears the private vouch material of the invitation.

```quint
type SeedRecipientFacts = {
  exactApp: bool, verifiedRecipient: bool, recipientAllowed: bool, unredeemed: bool,
  issuedAt: int, now: int
}
type SeedRedemptionFacts = {
  liveBinding: bool, freshJoin: bool, eligibleEnrollment: bool, currentConsent: bool
}
pure val eligibleRecipient: SeedRecipientFacts = {
  exactApp: true, verifiedRecipient: true, recipientAllowed: true, unredeemed: true,
  issuedAt: 0, now: 1
}
pure val recipientValues = Set(eligibleRecipient,
  { ...eligibleRecipient, exactApp: false },
  { ...eligibleRecipient, verifiedRecipient: false },
  { ...eligibleRecipient, recipientAllowed: false },
  { ...eligibleRecipient, unredeemed: false },
  { ...eligibleRecipient, now: 2592000000 })
pure val approvedRedemption: SeedRedemptionFacts = {
  liveBinding: true, freshJoin: true, eligibleEnrollment: true, currentConsent: true
}
pure val redemptionValues = Set(approvedRedemption,
  { ...approvedRedemption, liveBinding: false },
  { ...approvedRedemption, freshJoin: false },
  { ...approvedRedemption, eligibleEnrollment: false },
  { ...approvedRedemption, currentConsent: false })

pure def seedInvitationRecipientCurrent(recipient: SeedRecipientFacts): bool =
  recipient.exactApp and recipient.verifiedRecipient and recipient.recipientAllowed and recipient.unredeemed
    and recipient.issuedAt >= 0 and MemberInvite::memberInviteWithinWindow(recipient.now - recipient.issuedAt)

pure def seedInvitationMayRedeem(redemption: SeedRedemptionFacts): bool =
  redemption.liveBinding and redemption.freshJoin and redemption.eligibleEnrollment and redemption.currentConsent

pure def canRedeemSeedInvitation(invite: SeedInvitation, recipient: SeedRecipientFacts, redemption: SeedRedemptionFacts): bool =
  invite.phase == SeedIssued and invite.issuedAt == recipient.issuedAt and
    seedInvitationRecipientCurrent(recipient) and seedInvitationMayRedeem(redemption)

pure def redeemSeedInvitation(invite: SeedInvitation, recipient: SeedRecipientFacts, redemption: SeedRedemptionFacts): SeedInvitation =
  if (canRedeemSeedInvitation(invite, recipient, redemption))
    { ...invite, phase: SeedRedeemed, vouchRetained: false }
  else invite

pure def lawSeedInvitationRequiresVerifiedAppRecipient(recipient: SeedRecipientFacts): bool =
  seedInvitationRecipientCurrent(recipient) implies
    (recipient.exactApp and recipient.verifiedRecipient and recipient.recipientAllowed and recipient.unredeemed)

pure def lawSeedInvitationCannotResolveAfterExpiry(recipient: SeedRecipientFacts): bool =
  recipient.now >= seedInvitationExpiresAt(recipient.issuedAt) implies not(seedInvitationRecipientCurrent(recipient))

pure def lawSeedInvitationRedemptionRequiresNewEligibleJoin(redemption: SeedRedemptionFacts): bool =
  seedInvitationMayRedeem(redemption) implies (redemption.freshJoin and redemption.eligibleEnrollment and redemption.currentConsent)

pure def sometimesSeedInvitationRedeemed(invite: SeedInvitation): bool = invite.phase == SeedRedeemed
```

### Decline, suppression and expiry end the invitation

The exact confirmed recipient may decline an open invitation. The
shared-line STOP and existing safety controls continue to apply.
A declined, suppressed, banned, or expired recipient cannot use the
invitation. Clear private vouch material when the invitation is declined
or its 30-day retention ends. A suppression or ban alone closes the
invitation but does not clear the vouch material at that time; the
shell's expiry purge deletes it when the retention ends. An issued
invitation keeps its vouch material until it closes or is redeemed. A
terminal invitation cannot issue or redeem again.

```quint
pure def seedInvitationMayDecline(exactRecipient: bool, open: bool): bool = exactRecipient and open

pure def canCloseSeedInvitation(invite: SeedInvitation, now: int, exactDecline: bool, suppressedOrBanned: bool): bool =
  invite.phase == SeedIssued and
    (seedInvitationMayDecline(exactDecline, invite.phase == SeedIssued) or suppressedOrBanned
      or now >= seedInvitationExpiresAt(invite.issuedAt))

pure def seedInvitationCloseClearsVouch(invite: SeedInvitation, now: int, exactDecline: bool): bool =
  seedInvitationMayDecline(exactDecline, invite.phase == SeedIssued) or now >= seedInvitationExpiresAt(invite.issuedAt)

pure def closeSeedInvitation(invite: SeedInvitation, now: int, exactDecline: bool, suppressedOrBanned: bool): SeedInvitation =
  if (canCloseSeedInvitation(invite, now, exactDecline, suppressedOrBanned))
    { ...invite, phase: SeedClosed,
      vouchRetained: invite.vouchRetained and not(seedInvitationCloseClearsVouch(invite, now, exactDecline)) }
  else invite

pure def lawSeedInvitationDeclineOrExpiryClearsVouch(issuedAt: int, now: int, exactDecline: bool, suppressedOrBanned: bool): bool =
  val issuedInvite = { phase: SeedIssued, issuedAt: issuedAt, vouchRetained: true }
  seedInvitationCloseClearsVouch(issuedInvite, now, exactDecline)
    implies not(closeSeedInvitation(issuedInvite, now, exactDecline, suppressedOrBanned).vouchRetained)

pure def alwaysOnlyIssuedOrClosedInvitationKeepsVouch(invite: SeedInvitation): bool =
  invite.vouchRetained implies (invite.phase == SeedIssued or invite.phase == SeedClosed)

pure def alwaysIssuedSeedInvitationKeepsVouch(invite: SeedInvitation): bool =
  invite.phase == SeedIssued implies invite.vouchRetained

pure def alwaysIssuedSeedInvitationHasTimestamp(invite: SeedInvitation): bool =
  invite.phase != SeedUnissued implies invite.issuedAt >= 0

pure def stepTerminalSeedInvitationDoesNotChange(before: SeedInvitation, after: SeedInvitation): bool =
  (before.phase == SeedRedeemed or before.phase == SeedClosed) implies after == before

pure def stepExistingSeedInvitationKeepsIssueTime(before: SeedInvitation, after: SeedInvitation): bool =
  before.phase != SeedUnissued implies after.issuedAt == before.issuedAt

pure def sometimesSeedInvitationClosed(invite: SeedInvitation): bool = invite.phase == SeedClosed
```
