# Change the phone on my account

A member uses their current app session to request a code for a new number and then confirm the move. The API requires a fresh login to request a code. The OTP service verifies the new number. The storage transaction still owns the identity move, consent history, old sessions, pending messages, age floor, grants, and audit record.

The shell's store move keeps the person's member IDs and history. In the same transaction, it moves the current native connector grants bound to that person and their current same-app signup drafts. It ends active grants tied to the released number when their authority is sealed to that number or their owner cannot be confirmed. It ends those tokens, removes their private drafts and audits the revocation. The member can reconnect an affected assistant. The store move ends old phone sessions. The shell routes a person-bound member only through their current verified phone. Legacy channel aliases apply only to members without a platform person, and a current verified phone takes priority over a legacy alias at the same address.

## Story: Keep my account when my phone changes

> As a member, I want to prove I own the new number and keep my account, history and consents.

### The request uses the existing account

A new challenge cannot target the current number. Both operations check the current phone, hold and account owner before progressing. The shell checks the account and returns its trusted result.

```quint
type PhoneChangePhase = Beginning | CheckingStartOwner | CheckingConfirmOwner | CheckingStartPolicy | AwaitingRateLimit | AwaitingCodeSend |
  AwaitingPendingWrite | PendingRecorded | AwaitingPendingRead | AwaitingVerification | AwaitingMovePolicy |
  AwaitingMove | Moved | Refused
type PhoneChangeFailure = NoFailure | SameNumber | ReviewNeeded | NoPerson | RateLimited | NoPendingChange | InvalidCode | NumberInUse
type CurrentPhone = OwnedPhone | UnavailablePhone | WrongPerson
type MovePolicy = MoveAllowed | MoveBlocked | NumberTaken
type MoveOutcome = MoveApplied | MoveNumberTaken | MoveMissingPhone | MoveBanned | MoveRequestStale
type PhoneChange = { phase: PhoneChangePhase, failure: PhoneChangeFailure, codeVerified: bool, moveAllowed: bool }

pure val initial: PhoneChange = { phase: Beginning, failure: NoFailure, codeVerified: false, moveAllowed: false }

pure def canRequestChallenge(change: PhoneChange): bool = change.phase == Beginning

pure def requestChallenge(change: PhoneChange, sameNumber: bool): PhoneChange =
  if (sameNumber) { ...change, phase: Refused, failure: SameNumber }
  else { ...change, phase: CheckingStartOwner }

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
