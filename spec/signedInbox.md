# Claim and settle a signed inbound turn

The [signed turn model](models/turn_consent.md) follows the consent ledger and the gateway across actors. This module owns the signed inbox decisions. The service supplies the authenticated request, claims the sender and row in Postgres, and runs the member's turn only after the claim commits.

## Story: Handle each signed message once without delaying consent

> As a member, I want a repeated gateway request to recover my turn's result and a consent command to pass an earlier unfinished ordinary turn.

### A worker runs only a committed claim

Hold the sender's transaction lock and recheck the admission deadline before making a claim. Run a turn only after an open admission inserts the claim under that lock. Otherwise read the prior row. A worker renews its lease every thirty seconds by default. An inactive processing row becomes unresolved after the two-minute lease. The unresolved row holds up ordinary messages for at most ten minutes. An ordinary pending row also holds up a new ordinary turn. Compliance skips those two wait conditions. A processing row still prevents a second concurrent claim for the same sender.

```quint
pure val processingLeaseMs: int = 120000
pure val leaseRenewMs: int = 30000
pure val unresolvedBlockMs: int = 600000

type ClaimPhase = Claiming | CheckingPrior | RunningTurn | CheckingRescue | PreservingCompliance | ReleasingClaim |
  Finished | Replayed | Busy | Conflict | Unresolved | RetryCompliance
type SignedInbox = { phase: ClaimPhase }

pure val initial: SignedInbox = { phase: Claiming }

pure def signedAdmissionOpen(deadlineSet: bool, at: int, deadline: int): bool =
  not(deadlineSet) or at < deadline

pure def mayStartClaimWrite(senderLock: bool, admissionOpen: bool): bool = senderLock and admissionOpen

pure def ordinaryTurnMustWait(compliance: bool): bool = not(compliance)

pure def canRecordClaim(turn: SignedInbox): bool = turn.phase == Claiming
pure def recordClaim(turn: SignedInbox, inserted: bool, senderLock: bool, admissionOpen: bool): SignedInbox =
  { phase: if (inserted and mayStartClaimWrite(senderLock, admissionOpen)) RunningTurn else CheckingPrior }

pure def lawOnlyOpenClaimCanRun(inserted: bool, senderLock: bool, admissionOpen: bool): bool =
  recordClaim(initial, inserted, senderLock, admissionOpen).phase == RunningTurn
    implies (inserted and senderLock and admissionOpen)
```

### A replay must match a stored request

When no write was made, an existing request with a different hash conflicts. A finished turn with a stored response returns that response. A processing turn or blocked request without a row can retry. An unresolved or otherwise incomplete row with the same hash returns an unresolved result.

```quint
pure def canReadPrior(turn: SignedInbox): bool = turn.phase == CheckingPrior
pure def readPrior(turn: SignedInbox, rowPresent: bool, sameRequest: bool, responseAvailable: bool, processing: bool): SignedInbox =
  if (not(rowPresent)) { phase: Busy }
  else if (not(sameRequest)) { phase: Conflict }
  else if (responseAvailable) { phase: Replayed }
  else { phase: if (processing) Busy else Unresolved }

pure def lawChangedRequestConflicts(responseAvailable: bool, processing: bool): bool =
  readPrior({ phase: CheckingPrior }, true, false, responseAvailable, processing).phase == Conflict
```

### Completion and compliance recovery depend on the stored row

A worker returns its response only if the processing row was still claimable for completion. A failed ordinary turn goes unresolved. A failed compliance turn may preserve a committed consent event or reply if the row is still processing. If nothing committed, release the claim and allow a retry. A recovery write that fails leaves the turn unresolved. The shell clears the lease timer when processing exits. It records the first-contact notice key in the same write as the completed reply that includes that exact notice.

```quint
pure def canRecordCompletion(turn: SignedInbox): bool = turn.phase == RunningTurn
pure def recordCompletion(turn: SignedInbox, saved: bool): SignedInbox =
  if (saved) { phase: Finished } else turn

pure def firstContactNoticeInResponse(exactReplyIncluded: bool, underageDecline: bool): bool =
  exactReplyIncluded and not(underageDecline)

pure def lawDeclineCannotSpendFirstContactNotice(exactReplyIncluded: bool): bool =
  not(firstContactNoticeInResponse(exactReplyIncluded, true))

pure def canHandleFailure(turn: SignedInbox): bool = turn.phase == RunningTurn
pure def handleFailure(turn: SignedInbox, compliance: bool): SignedInbox =
  { phase: if (compliance) CheckingRescue else Unresolved }

pure def canCheckRescue(turn: SignedInbox): bool = turn.phase == CheckingRescue
pure def checkRescue(turn: SignedInbox, processing: bool, effectCommitted: bool): SignedInbox =
  if (not(processing)) { phase: Unresolved }
  else { phase: if (effectCommitted) PreservingCompliance else ReleasingClaim }

pure def canRecordRescue(turn: SignedInbox): bool = turn.phase == PreservingCompliance or turn.phase == ReleasingClaim
pure def recordRescue(turn: SignedInbox, changed: bool): SignedInbox =
  if (not(changed)) { phase: Unresolved }
  else { phase: if (turn.phase == PreservingCompliance) Finished else RetryCompliance }

pure def stepRetryNeedsReleasedClaim(before: SignedInbox, via: str, after: SignedInbox): bool =
  after.phase == RetryCompliance implies (before.phase == ReleasingClaim and via == "recordRescue")

pure def sometimesCanReplay(turn: SignedInbox): bool = turn.phase == Replayed
pure def sometimesCanRetryCompliance(turn: SignedInbox): bool = turn.phase == RetryCompliance
```

### A member command commits its result and its exact reply together

When a member command requires an atomic reply, the service must collect exactly one direct reply of the required kind. If that reply is unavailable, roll back the command's writes. Once the reply and result commit, a subsequent runtime failure leaves the completed response available for an authorized replay. The shell binds the reply to the verified sender and applies each command's current replay policy.

```quint
pure def atomicMemberReplyMatches(expected: str, actual: str, count: int, directReply: bool): bool =
  expected == actual and count == 1 and directReply

pure def lawAtomicMemberReplyNeedsExactKind(expected: str, actual: str, count: int, directReply: bool): bool =
  atomicMemberReplyMatches(expected, actual, count, directReply) implies (expected == actual and count == 1 and directReply)
```

### A stored ordinary reply goes out only while the number stays admitted

Before the service answers a handled turn, the first time or on a replay, it checks the turn's app again. If the turn holds a reply that is not a compliance text and the number is now opted out of that app, held, or banned, the service refuses the answer as a final `turn_context_changed`. A compliance confirmation and a turn without an ordinary reply still replay. Changed (audit SHA36): a replay after a later STOP or leave returned the stored ordinary replies -> the service refuses it, because the turn consent model forbids an ordinary reply after STOP.

```quint
pure def storedReplyAdmitted(ordinaryReply: bool, optedOut: bool, held: bool, banned: bool): bool =
  not(ordinaryReply) or not(optedOut or held or banned)

pure def lawOptedOutNumberGetsNoOrdinaryReply(held: bool, banned: bool): bool =
  not(storedReplyAdmitted(true, true, held, banned))

pure def lawComplianceAlwaysReplays(optedOut: bool, held: bool, banned: bool): bool =
  storedReplyAdmitted(false, optedOut, held, banned)
```

### A direct reply in a turn is collected only when consent allows it

A fixed direct text to the sender of a signed turn is collected only if it is a compliance text or the number is not opted out of the routed app. The service drops any other direct text, as the send queue refuses it on a live line. Changed (audit SHA36): a turn after STOP collected an ordinary reply -> the service drops it, because the replay check then refused it with the stop hint.

```quint
pure def directReplyCollectable(compliance: bool, optedOut: bool): bool = compliance or not(optedOut)

pure def lawNoDirectOrdinaryReplyAfterOptOut(compliance: bool): bool =
  directReplyCollectable(compliance, true) implies compliance
```

### A replayed open turn answers with the current context

A replay of an open turn answers open again with the member's current context, not the stored one. It does so only while the number is admitted to the app, the active membership is still the same member, and the context is available. When the number is admitted and the membership is the same member but the context is now unavailable, the replay answers handled with the fixed reply of the [shared context](sharedContext.md) rule, through the collected leak guard. The stored answer of the turn then becomes that handled answer, so a later replay and the turn receipt read it. Otherwise the replay is a final `turn_context_changed`. Changed (audits SHA37, sharedLineReplay-r39-1 and SHA40-replay): any change to the context, and a context that became unavailable, gave a final 409 -> the replay answers with the current context or the fixed reply, because the member's message got no answer.

```quint
type OpenReplayAnswer = ReplayCurrentContext | ReplayFixedReply | ReplayRefused

pure def openReplayAnswer(admitted: bool, sameMember: bool, contextAvailable: bool): OpenReplayAnswer =
  if (not(admitted) or not(sameMember)) ReplayRefused
  else if (contextAvailable) ReplayCurrentContext
  else ReplayFixedReply

pure def lawOpenReplayNeedsAdmission(sameMember: bool, contextAvailable: bool): bool =
  openReplayAnswer(false, sameMember, contextAvailable) == ReplayRefused

pure def lawAnotherMemberIsRefused(admitted: bool, contextAvailable: bool): bool =
  openReplayAnswer(admitted, false, contextAvailable) == ReplayRefused

pure def lawAdmittedMemberReplayIsNeverRefused(contextAvailable: bool): bool =
  openReplayAnswer(true, true, contextAvailable) != ReplayRefused
```

### Every collected reply passes the line's leak guard

Every reply that a turn collects for the gateway passes the line queue's leak guard and thread check, and joins the line's thread history, whatever channel sends the runtime's other messages. A dry-run backend uses a line queue that never sends. A reply with any leak reason is not collected. The STOP or leave confirmation that a retried turn adds after the member's unit already committed passes the same guard. The rescue of a compliance turn that failed after its consent change adds only the fixed confirmation copy of the app. A direct reply (a reply to a number that is not a member here, the fixed STOP or leave confirmation and the under-age decline) passes the guard but does not join the thread history, because the history belongs to a member, a leave can have deleted that member, and the fixed copy names nobody and carries no member data. Only the fixed reply for an unavailable context joins the history, and only when a member binds the turn. Changed (audits SHA42, sharedLineReplay-r39-2 and SHA-confirmation-guard): a dry-run backend skipped the guard and the history, and a retried turn's STOP or leave confirmation skipped the guard -> every collected reply passes the guard, and only member replies join the history, because the gateway still delivered those replies.

```quint
pure def collectedReplyMayLeave(leakReasons: int): bool = leakReasons == 0

pure def lawLeakingReplyIsNotCollected(leakReasons: int): bool =
  leakReasons > 0 implies not(collectedReplyMayLeave(leakReasons))
```

### A completed signed row is later scrubbed and then removed

The retention job removes the completed signed row's response and identifying data before it removes the tombstone. Keep the tombstone for the configured purge window plus thirty days. A signed turn that did not finish keeps its sender key until staff resolve it, and the retention job never removes a row that still holds a sender key. A signed turn that did not finish keeps its sender key only until staff resolve it or the person's account is erased: account erasure removes the sender key, the response and the identifying data of every signed row of that number, stuck rows included, so the key never outlives the person. Changed (audit SHA-turnwatch-purge): the job removed a stuck turn that staff had not resolved -> it keeps the sender key until staff resolve the turn or the account is erased, because the alert for a possible STOP cleared with no staff action.

```quint
pure val turnTombstoneKeepMs: int = 30 * 24 * 60 * 60000
```
