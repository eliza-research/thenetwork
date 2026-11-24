# Change the phone on my account

A member whose number changed tells their own agent. The agent sends the app's one-purpose phone-change link, `https://<domain>/phone`, and never asks for the new number or a code. A member who texts `CHANGE NUMBER` (or "change my number", "update my phone number") on the text line gets the same link in one short reply, on the site origin that the app's other member links use. The `/phone` page is one of the one-purpose pages that each site serves (owner decision 2026-11-22, D7). In the browser, the person signs in on the current number: with a platform code on an OTP site, or with a Cloud phone proof on a Cloud sign-in site. That fresh sign-in is the confirmation from the old number of [Story F25](product/stories.md#story-f25--keep-my-account-when-my-number-changes). The person then enters the new number and the platform code that the OTP service sends to it. The OTP service verifies the new number in both sign-in modes, so the agent and Eliza Cloud never see that code. The link is the only entry point: the sites show no account page, and the agent's own connector grant is not a fresh proof of the current number. A person who no longer holds the current number cannot give that confirmation and writes to help@ntwrk.party for steward recovery. The storage transaction still owns the identity move, consent history, old sessions, pending messages, age floor, grants, and audit record. Changed (owner decision 2026-11-22, D7): nothing on the text line sent the link -> `CHANGE NUMBER` gets it, because one-purpose pages are allowed.

The shell's store move keeps the person's member IDs and history. In the same transaction, it moves the current native connector grants bound to that person. It ends active grants tied to the released number when their authority is sealed to that number or their owner cannot be confirmed. It ends those tokens and audits the revocation. The member can reconnect an affected assistant. The store move ends old phone sessions, including Cloud sessions, ends messages still queued for the old number, and removes the old number's identity, so the old number gets no more messages. The shell routes a person-bound member only through their current verified phone. The [phone identity](models/phone_identity.md) and [identity lifecycle](models/identity_sagas.md) models keep the storage interleavings. Legacy channel aliases apply only to members without a platform person, and a current verified phone takes priority over a legacy alias at the same address.

## Story: Keep my account when my phone changes

> As a member, I want to prove I own the new number and keep my account, history and consents.

### A signed request can return the app's phone change page

The signed conversation accepts CHANGE NUMBER and UPDATE NUMBER as whole requests. It allows an initial PLEASE, the words MY and PHONE before NUMBER, and trailing punctuation. It ignores case and surrounding space. It returns the routed app's plain `/phone` address only to a member whose verified current phone and app membership agree and whose membership and staff hold checks are clear. The reply carries no sign-in authority and starts no challenge. The page still requires a fresh sign-in on the current number and a new-number code.

```quint
pure val phoneChangePagePath: str = "/phone"

pure def phoneChangeLinkAllowed(sameMember: bool, membership: str, reviewClear: bool, staffHeld: bool): bool =
  sameMember and (membership == "active" or membership == "paused" or membership == "onboarding")
    and reviewClear and not(staffHeld)

pure def lawAnUnboundOrHeldMemberGetsNoPhoneChangeLink(sameMember: bool, membership: str, reviewClear: bool, staffHeld: bool): bool =
  (not(sameMember) or not(reviewClear) or staffHeld) implies not(phoneChangeLinkAllowed(sameMember, membership, reviewClear, staffHeld))
```

### The request uses the existing account

A new challenge needs a fresh sign-in on the current number and cannot target the current number. The fresh sign-in is a platform code or a Cloud phone proof from the last ten minutes; both sign-in modes give the same proof of the old number. A Cloud phone proof's time is the Eliza Cloud identity's `issuedAt`: the issue time of the Cloud phone session token that Cloud's `/network/sign-in` page mints after it verifies a new SMS code. This backend cannot tell that token from one that Cloud issued again without a new code, so on a Cloud sign-in site the freshness of the old-number proof depends on Eliza Cloud. Both operations check the current phone, hold and account owner before progressing. The shell checks the account and returns its trusted result. Changed (2026-11-22): the site route checked the fresh sign-in and accepted only a platform code -> this rule checks it and a Cloud phone proof counts, because Cloud sign-in sites refused every change and left Story F25 with no entry point.

```quint
type PhoneChangePhase = Beginning | CheckingStartOwner | CheckingConfirmOwner | CheckingStartPolicy | AwaitingRateLimit | AwaitingCodeSend |
  AwaitingPendingWrite | PendingRecorded | AwaitingPendingRead | AwaitingVerification | AwaitingMovePolicy |
  AwaitingMove | Moved | Refused
type PhoneChangeFailure = NoFailure | StaleSignIn | SameNumber | ReviewNeeded | NoPerson | RateLimited | NoPendingChange | InvalidCode | NumberInUse
type CurrentPhone = OwnedPhone | UnavailablePhone | WrongPerson
type MovePolicy = MoveAllowed | MoveBlocked | NumberTaken
type MoveOutcome = MoveApplied | MoveNumberTaken | MoveMissingPhone | MoveBanned | MoveRequestStale
type PhoneChange = { phase: PhoneChangePhase, failure: PhoneChangeFailure, codeVerified: bool, moveAllowed: bool }

pure val initial: PhoneChange = { phase: Beginning, failure: NoFailure, codeVerified: false, moveAllowed: false }

pure def canRequestChallenge(change: PhoneChange): bool = change.phase == Beginning

pure def requestChallenge(change: PhoneChange, freshSignIn: bool, sameNumber: bool): PhoneChange =
  if (not(freshSignIn)) { ...change, phase: Refused, failure: StaleSignIn }
  else if (sameNumber) { ...change, phase: Refused, failure: SameNumber }
  else { ...change, phase: CheckingStartOwner }

pure def lawStaleSignInCannotStart(change: PhoneChange, sameNumber: bool): bool =
  requestChallenge(change, false, sameNumber).phase == Refused and requestChallenge(change, false, sameNumber).failure == StaleSignIn

pure def sometimesRefusesStaleSignIn(change: PhoneChange): bool = change.failure == StaleSignIn

pure def canBeginConfirmation(change: PhoneChange): bool = change.phase == Beginning

pure def beginConfirmation(change: PhoneChange): PhoneChange =
  { ...change, phase: CheckingConfirmOwner }

pure def canCheckCurrentPhone(change: PhoneChange): bool =
  change.phase == CheckingStartOwner or change.phase == CheckingConfirmOwner

pure def checkCurrentPhone(change: PhoneChange, ownership: CurrentPhone): PhoneChange =
  if (ownership == UnavailablePhone) { ...change, phase: Refused, failure: ReviewNeeded }
  else if (ownership == WrongPerson) { ...change, phase: Refused, failure: NoPerson }
  else { ...change, phase: if (change.phase == CheckingStartOwner) CheckingStartPolicy else AwaitingPendingRead }

pure def canCheckStartPolicy(change: PhoneChange): bool = change.phase == CheckingStartPolicy
pure def checkStartPolicy(change: PhoneChange, oldNumberAllowed: bool): PhoneChange =
  if (oldNumberAllowed) { ...change, phase: AwaitingRateLimit }
  else { ...change, phase: Refused, failure: ReviewNeeded }
```

### A challenge needs a send slot and a persisted request

The account has three start requests per day. The store must grant a slot while the prior count is below three. A start request can continue only when the store grants the slot and the account made fewer than three start requests earlier on that day. A rate-limit response gives the wait in the Retry-After header. Use the remaining time to the next UTC day when the account allowance refuses, or the OTP service's wait when that service refuses. Round up to whole seconds and give at least one second. The pending row is stored after the OTP service accepts the request. The start response never reveals who owns the target number.

```quint
pure val phoneChangesPerDay: int = 3
pure val phoneChangeWindowMs: int = 24 * 60 * 60 * 1000
pure val atValues = Set(-1, 0, 1, 86399999, 86400000, 86400001)
pure def phoneChangeSlotWaitMs(at: int): int =
  phoneChangeWindowMs - at % phoneChangeWindowMs

pure def lawSlotRetryEndsWithTheDay(at: int): bool =
  at >= 0 implies phoneChangeSlotWaitMs(at) > 0 and phoneChangeSlotWaitMs(at) <= phoneChangeWindowMs

pure val waitMsValues = Set(0, 1, 999, 1000, 1001, 30000, 86400000)

pure def phoneChangeRetryAfter(waitMs: int): int =
  if (waitMs <= 0) 1 else (waitMs + 999) / 1000

pure def lawPhoneChangeRetryIsPositive(waitMs: int): bool = phoneChangeRetryAfter(waitMs) >= 1

pure def lawPhoneChangeRetryRoundsUp(waitMs: int): bool =
  waitMs > 0 implies (
    phoneChangeRetryAfter(waitMs) * 1000 >= waitMs and (phoneChangeRetryAfter(waitMs) - 1) * 1000 < waitMs)

pure def phoneChangeSlotOpen(startsBefore: int): bool = 0 <= startsBefore and startsBefore < phoneChangesPerDay
pure def canCheckStartRate(change: PhoneChange): bool = change.phase == AwaitingRateLimit
pure def checkStartRate(change: PhoneChange, slotGranted: bool, startsBefore: int): PhoneChange =
  if (slotGranted and phoneChangeSlotOpen(startsBefore)) { ...change, phase: AwaitingCodeSend }
  else { ...change, phase: Refused, failure: RateLimited }

pure def lawFourthStartIsRefused(change: PhoneChange, startsBefore: int): bool =
  startsBefore >= phoneChangesPerDay implies checkStartRate(change, true, startsBefore).failure == RateLimited
pure def lawDeniedStartSlotIsRefused(change: PhoneChange, startsBefore: int): bool =
  checkStartRate(change, false, startsBefore).failure == RateLimited

pure def canRecordCodeSend(change: PhoneChange): bool = change.phase == AwaitingCodeSend
pure def recordCodeSend(change: PhoneChange, sendAccepted: bool): PhoneChange =
  if (sendAccepted) { ...change, phase: AwaitingPendingWrite }
  else { ...change, phase: Refused, failure: RateLimited }

pure def canRecordPendingWrite(change: PhoneChange): bool = change.phase == AwaitingPendingWrite
pure def recordPendingWrite(change: PhoneChange): PhoneChange = { ...change, phase: PendingRecorded }
```

### A live pending request needs a valid code

Use the current person's pending request. A pending request with a new number is valid through 15 minutes from its request time. The OTP service must verify the code against the stored request's app and new number before target eligibility is checked.

```quint
pure val phoneChangeLifetimeMs: int = 15 * 60 * 1000
pure val elapsedMsValues = Set(-1, 0, 900000, 900001)

pure def pendingWindowOpen(elapsedMs: int): bool = 0 <= elapsedMs and elapsedMs <= phoneChangeLifetimeMs
pure def lawWindowIncludesDeadline(offsetMs: int): bool =
  offsetMs == phoneChangeLifetimeMs implies pendingWindowOpen(offsetMs)
pure def lawWindowExcludesFutureRequest(offsetMs: int): bool =
  offsetMs < 0 implies not(pendingWindowOpen(offsetMs))

pure def canReadPending(change: PhoneChange): bool = change.phase == AwaitingPendingRead
pure def readPending(change: PhoneChange, hasTarget: bool, elapsedMs: int): PhoneChange =
  if (hasTarget and pendingWindowOpen(elapsedMs)) { ...change, phase: AwaitingVerification }
  else { ...change, phase: Refused, failure: NoPendingChange }

pure def canRecordVerification(change: PhoneChange): bool = change.phase == AwaitingVerification
pure def recordVerification(change: PhoneChange, otpVerified: bool): PhoneChange =
  if (otpVerified) { ...change, phase: AwaitingMovePolicy, codeVerified: true }
  else { ...change, phase: Refused, failure: InvalidCode }
```

### The verified request can move only when both numbers allow it

Under the new number's lock, recheck the old and new numbers for a ban and check that the new number has no identity. The transaction locks the person, current phone and pending request. It checks the same target, the request's lifetime and both ban decisions again after verification. A missing, superseded or expired request cannot move and returns the no-pending-change outcome. A ban or missing or held current identity returns review. A number claimed before the move returns the in-use outcome. Only a completed store move permits success.

```quint
pure def canCheckMovePolicy(change: PhoneChange): bool = change.phase == AwaitingMovePolicy and change.codeVerified
pure def checkMovePolicy(change: PhoneChange, policy: MovePolicy): PhoneChange =
  if (policy == MoveBlocked) { ...change, phase: Refused, failure: ReviewNeeded }
  else if (policy == NumberTaken) { ...change, phase: Refused, failure: NumberInUse }
  else { ...change, phase: AwaitingMove, moveAllowed: true }

pure def lockedPhoneMoveAllowed(currentBanned: bool, targetBanned: bool): bool =
  not(currentBanned or targetBanned)

pure def lawBannedPhoneCannotMove(currentBanned: bool, targetBanned: bool): bool =
  (currentBanned or targetBanned) implies not(lockedPhoneMoveAllowed(currentBanned, targetBanned))

pure def canRecordMove(change: PhoneChange): bool =
  change.phase == AwaitingMove and change.codeVerified and change.moveAllowed

pure def recordMove(change: PhoneChange, moveResult: MoveOutcome): PhoneChange =
  if (moveResult == MoveApplied) { ...change, phase: Moved }
  else if (moveResult == MoveNumberTaken) { ...change, phase: Refused, failure: NumberInUse }
  else if (moveResult == MoveRequestStale) { ...change, phase: Refused, failure: NoPendingChange }
  else { ...change, phase: Refused, failure: ReviewNeeded }

pure def lawStaleMoveRemainsUnconfirmed(change: PhoneChange): bool =
  recordMove(change, MoveRequestStale).failure == NoPendingChange
```

### Reporting a move requires both the new code and current move authority

The transition into a completed move requires OTP verification and the move policy. The outer service finishes its existing age-floor and runtime updates before replying. A pending request or a failed move cannot report a completed move.

```quint
pure def alwaysMoveRequiresProof(change: PhoneChange): bool =
  (change.phase == AwaitingMove or change.phase == Moved) implies (change.codeVerified and change.moveAllowed)

pure def sometimesPendingRecorded(change: PhoneChange): bool = change.phase == PendingRecorded
pure def sometimesMoved(change: PhoneChange): bool = change.phase == Moved
pure def sometimesRefusesCode(change: PhoneChange): bool = change.failure == InvalidCode
pure def sometimesRefusesTakenNumber(change: PhoneChange): bool = change.failure == NumberInUse
```

### Direct phone verification is required here

When the app uses a direct phone session, the browser gets a new session for the new number after a verified move. An app that uses Cloud identity refuses these number-change endpoints until the authority can prove a fresh verification of the replacement phone. A new token issue time alone does not prove that verification.


```quint
pure def phoneChangeVerificationAvailable(cloudSignIn: bool): bool = not(cloudSignIn)

pure def lawCloudIdentityAloneCannotChangeANumber(cloudSignIn: bool): bool =
  cloudSignIn implies not(phoneChangeVerificationAvailable(cloudSignIn))
```
