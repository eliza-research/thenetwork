# Network Capital ledger

The Network projects its own events into the private Capital ledger. This module governs which events reach the ledger and which credits count. The shell validates event shape, loads prior records, persists source events, and computes decimals and entries with the existing category multipliers and rounding. The shell marks a member and need pair as used on a qualifying confirmation, before it checks whether an entry can be earned.

## Story: Count what I contributed once and preserve its history

> As a member, I want my verified contributions counted at most once, and I want a correction to preserve the original entry.

### Validate and deduplicate an event before applying it

Validate each event before looking up its ID. A well-formed replay of an event ID has no effect, even after the ledger has advanced. An unseen event must be at or after the last accepted time. Append an admitted event to the configured store before updating the in-memory ledger. Only a successful append moves the event to applying (`recordLedgerAppend`). The shell records the append only after the store accepts it, so after a failed append the event stays in the appending phase and is never applied.

```quint
type CapitalEventPhase =
  CapitalEventStarting | InvalidCapitalEvent | InspectingCapitalEvent | DuplicateCapitalEvent |
  OutOfOrderCapitalEvent | AppendingCapitalEvent | ApplyingCapitalEvent
type CapitalEventFlow = { phase: CapitalEventPhase }
pure val initial: CapitalEventFlow = { phase: CapitalEventStarting }

pure def canValidateLedgerEvent(flow: CapitalEventFlow): bool = flow.phase == CapitalEventStarting
pure def validateLedgerEvent(flow: CapitalEventFlow, valid: bool): CapitalEventFlow =
  { phase: if (valid) InspectingCapitalEvent else InvalidCapitalEvent }

pure def canCheckLedgerSource(flow: CapitalEventFlow): bool = flow.phase == InspectingCapitalEvent
pure def checkLedgerSource(flow: CapitalEventFlow, duplicate: bool, inOrder: bool): CapitalEventFlow =
  { phase: if (duplicate) DuplicateCapitalEvent else if (inOrder) AppendingCapitalEvent else OutOfOrderCapitalEvent }

pure def canRecordLedgerAppend(flow: CapitalEventFlow): bool = flow.phase == AppendingCapitalEvent
pure def recordLedgerAppend(flow: CapitalEventFlow): CapitalEventFlow = { phase: ApplyingCapitalEvent }

pure def stepApplyFollowsLedgerAppend(before: CapitalEventFlow, via: str, after: CapitalEventFlow): bool =
  after.phase == ApplyingCapitalEvent implies (before.phase == AppendingCapitalEvent and via == "recordLedgerAppend")

pure def sometimesAppliesLedgerEvent(flow: CapitalEventFlow): bool = flow.phase == ApplyingCapitalEvent
pure def sometimesSkipsDuplicateLedgerEvent(flow: CapitalEventFlow): bool = flow.phase == DuplicateCapitalEvent
pure def sometimesRejectsTimeOrder(flow: CapitalEventFlow): bool = flow.phase == OutOfOrderCapitalEvent
```

### Participation credit needs eligible members and verified outcomes

A help offer can be recorded once per help ID when the helper and recipient differ. The intended recipient can resolve that record once. Its credit requires that the recipient is eligible and says the help was useful. Attendance resolves a previously accepted plan once. If only counterparts verified attendance, at least one eligible counterpart must be a confirmer. Credits go to eligible members who have not been removed and have a positive base.

```quint
pure def capitalHelpSourceMayStart(sameMember: bool, sourceExists: bool): bool = not(sameMember) and not(sourceExists)
pure def capitalHelpMayResolve(resolved: bool, sameRecipient: bool): bool = not(resolved) and sameRecipient
pure def capitalHelpWasUseful(useful: bool, recipientEligible: bool): bool = useful and recipientEligible

pure def capitalAttendanceMayResolve(accepted: bool, resolved: bool): bool = accepted and not(resolved)

type AttendanceEvidence = AttendanceUnverified | AttendanceByCounterpart | AttendanceIndependentlyVerified
pure def capitalAttendanceEvidence(hasVerification: bool, independentlyVerified: bool): AttendanceEvidence =
  if (not(hasVerification)) AttendanceUnverified
  else if (independentlyVerified) AttendanceIndependentlyVerified
  else AttendanceByCounterpart

pure def acceptsCapitalAttendanceProof(evidence: AttendanceEvidence, hasEligibleConfirmer: bool): bool =
  evidence == AttendanceIndependentlyVerified or (evidence == AttendanceByCounterpart and hasEligibleConfirmer)

pure def mayEarnCapital(eligible: bool, removed: bool, positiveBase: bool): bool =
  eligible and not(removed) and positiveBase
```

### Organizing and needs use their original contribution source

Organizing credit requires a public venue and the configured number of eligible attendees other than the organizer. An organizer and plan pair becomes used when it earns an entry. A need answer needs staff confirmation or an eligible confirmer other than the member, and a member and need pair that is not used yet.

```quint
pure def organizingCapitalSourceOpen(publicVenue: bool, alreadyCredited: bool): bool =
  publicVenue and not(alreadyCredited)

pure def organizingCapitalQuorum(attendees: int, minimum: int): bool = attendees >= minimum

pure def needCapitalSourceOpen(alreadyCredited: bool, selfConfirmed: bool, allowedConfirmer: bool): bool =
  not(alreadyCredited) and not(selfConfirmed) and allowedConfirmer
```

### A reversal adds a new entry for the original owner

The original entry stays in the log. Append the reversal on the original owner's ledger. An entry can be reversed once. Confirmed fraud can reverse a positive credit when a named member confirmed or participated in it, or when the credit depends on another reversal. A successful clawback records the original entry ID.

```quint
pure def mayReverseCapitalEntry(sameOwner: bool, alreadyReversed: bool): bool =
  sameOwner and not(alreadyReversed)

pure def isCapitalFraudCandidate(positiveSign: bool, positiveAmount: bool, alreadyReversed: bool): bool =
  positiveSign and positiveAmount and not(alreadyReversed)

pure def capitalFraudReverses(involved: bool, basisReversed: bool): bool = involved or basisReversed

pure def lawCapitalCannotReverseAgain(sameOwner: bool): bool =
  not(mayReverseCapitalEntry(sameOwner, true))
```

### A removal overturned on review returns the voucher's lost stake

A removal is overturned when a review finds the removal was wrong, for example mistaken identity or an upheld appeal. When a removal for serious abuse is overturned, the ledger returns the voucher's lost stake. The overturn is a new event, `removal_overturned`, for the removed member. The ledger writes one reversal entry (`clawback`) for that member's `vouch_stake` entry, on the voucher's ledger, and only for that stake. Other stakes of the same voucher stay lost. If no stake was taken for that member, the overturn writes nothing: the removal was not for serious abuse, the stake window had passed, or the voucher was ineligible at removal. The reversal follows the same rules as any other reversal: it names the entry it reverses, it is written once for that entry, and it is written only while the stake is still in the vouch rolling period. A stake that is already one period old no longer counts, so there is nothing to return. The overturn does not change the removed member: the member stays removed and earns nothing more. This rule reuses the existing `mayReverseCapitalEntry` and `capitalEntryUsesPeriodCap` decisions, so it adds no new Quint definition and no generated module changes.  

### A reversal restores room only for a credit in the same rolling period

A credit uses the configured rolling period's allowance. A clawback in the period restores room only when the original credit is also in that period. Other penalties do not restore room. An entry at the period boundary is outside it. The ledger subtracts spent credit from the cap using the existing decimal arithmetic, then applies the zero floor. A credit reduced to zero still records its provenance.

```quint
pure def capitalEntryUsesPeriodCap(entryAge: int, period: int, positiveSign: bool, reversesCurrentCredit: bool): bool =
  entryAge < period and (positiveSign or reversesCurrentCredit)

pure def capitalPeriodRoom(remaining: int): int = if (remaining <= 0) 0 else remaining

pure def lawCapitalPeriodRoomIsNonnegative(remaining: int): bool = capitalPeriodRoom(remaining) >= 0
```
