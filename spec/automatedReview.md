# Automated review

Owner decisions of 2026-11-22, D15 ("always on, but we want to remove human review, it should be fully automated"), D16 ("Everything automated") and D17 ("Hold for staff"). Every opportunity, whatever its origin, gets one recorded approval before the Network contacts a member. The review judge (a model, `gpt-6-luna` through `judgeLLM()`) reads a packet with the facts that a staff reviewer saw and approves or holds the item. Staff read only the items that the judge holds. A held item waits in the staff queue as an exception and expires unsent at its review deadline. The age rules, the blocks, the holds, the opt-outs, the caps and the leak guard are code gates: they run before the judge and again at send time. The [opportunity lifecycle](opportunityLifecycle.md) and the [review deadline](reviewDeadline.md) govern the item around this step.

## Story: Contact a member only after a recorded approval

> As a member, I want the Network to contact me about an introduction only after the review judge approved it, or after a named staff member approved an item that the judge held.

### An approval names its approver

A review is open while it waits for the judge or while it is held for staff. An item is approved for contact only when its review is approved and the approval names its approver: the judge or staff. A review is approved or stopped exactly when it names an approver. Changed (owner decision 2026-11-22, D15 to D17): a named staff reviewer approved every item; now the judge approves most items and staff approve only the items that the judge holds, so the record names which of the two approved.

```quint
type JudgeVerdict = JudgeApproves | JudgeFlags | JudgeUndecided | JudgeCannotRun
type VerdictWord = SaidApprove | SaidFlag | SaidCannotDecide | SaidOther
type Rubric = AdultRubric | MinorRubric
type Approver = NoApprover | JudgeApprover | StaffApprover
type ReviewPhase = AwaitingJudge | HeldForStaff | ReviewApproved | ReviewStopped | ReviewRejected | ReviewExpired | ReviewInvalidated
type AutomatedReview = { phase: ReviewPhase, revision: int, approver: Approver }
type JudgeCall = PacketSuspect | PriorFlag | NoProvider | BudgetReached | RequestLimitReached | DeadlineTooClose | CallJudge
type JudgeClaim = ClaimFirst | ClaimAgain | UseStored | WaitForLease | ClaimsSpent
type SimStaffAction = SimStaffApproves | SimStaffRejects | SimStaffWaits

pure val initial: AutomatedReview = { phase: AwaitingJudge, revision: 0, approver: NoApprover }
pure val maxJudgeClaims: int = 2
pure val judgeMinLeadMs: int = 600000
pure val judgeCallDeadlineMs: int = 120000
pure val judgeLeaseMarginMs: int = 60000
pure val judgeLeaseMs: int = 180000
pure val judgeCallsPerRun: int = 4
pure val judgeWaitLimitMs: int = 1800000
pure val reviewJudgmentRetentionMs: int = 7776000000
pure val flaggedPairRetentionMs: int = 7776000000

pure def reviewOpen(r: AutomatedReview): bool = r.phase == AwaitingJudge or r.phase == HeldForStaff

pure def contactApproved(r: AutomatedReview): bool = r.phase == ReviewApproved and r.approver != NoApprover

pure def alwaysApprovalNamesApprover(r: AutomatedReview): bool =
  (r.phase == ReviewApproved or r.phase == ReviewStopped) iff r.approver != NoApprover
```

### The judge decides an awaiting revision once, for the packet it read

A judgment applies only to an item that waits for the judge, and only to the revision that the judge read. A judgment that comes at or after the review deadline expires the item. A judgment for a packet that changed after the judge read it changes nothing, and the judge reads the new packet. When a code gate refuses the item at the time of the judgment, the item closes, whatever the verdict. Only an approval approves; a flag, an undecided reply or a judge that cannot run holds the item for staff. Changed (owner decision 2026-11-22, D15 to D17): a staff reviewer decided each item; now the judge decides it, and every verdict other than an approval holds the item for staff (D17).

```quint
pure def canRecordJudgment(r: AutomatedReview, revision: int): bool = r.phase == AwaitingJudge and revision == r.revision

pure def recordJudgment(r: AutomatedReview, revision: int, verdict: JudgeVerdict, packetCurrent: bool, gatesPass: bool, late: bool): AutomatedReview =
  if (late) { ...r, phase: ReviewExpired }
  else if (not(packetCurrent)) r
  else if (not(gatesPass)) { ...r, phase: ReviewInvalidated }
  else if (verdict == JudgeApproves) { ...r, phase: ReviewApproved, approver: JudgeApprover }
  else { ...r, phase: HeldForStaff }

pure def lawGatesBeatTheJudge(late: bool): bool =
  recordJudgment(initial, 0, JudgeApproves, true, false, late).phase != ReviewApproved

pure def lawOnlyAnApprovalApproves(verdict: JudgeVerdict, packetCurrent: bool, gatesPass: bool, late: bool): bool =
  verdict != JudgeApproves implies recordJudgment(initial, 0, verdict, packetCurrent, gatesPass, late).phase != ReviewApproved

pure def lawChangedPacketNeverApproves(verdict: JudgeVerdict, gatesPass: bool, late: bool): bool =
  recordJudgment(initial, 0, verdict, false, gatesPass, late).phase != ReviewApproved

pure def lawLateJudgmentExpires(verdict: JudgeVerdict, packetCurrent: bool, gatesPass: bool): bool =
  recordJudgment(initial, 0, verdict, packetCurrent, gatesPass, true).phase == ReviewExpired

pure val verdictValues = Set(JudgeApproves, JudgeFlags, JudgeUndecided, JudgeCannotRun)
pure val lateValues = Set(false, true)
pure val packetCurrentValues = Set(false, true)
pure val gatesPassValues = Set(false, true)
```

### A judgment that does not come in time is held for staff

An item that waited for the judge for 30 minutes or more, while matching is on, is held for staff with the reason `judge_overdue`. While matching is paused, nothing is held this way. Changed (owner decision 2026-11-22, D15 to D17): an item waited for a staff reviewer until its deadline; now a judge that does not answer is a judge that cannot run, and D17 holds such an item for staff.

```quint
pure def canHoldUnjudged(r: AutomatedReview, waitedMs: int, matchingOn: bool): bool =
  r.phase == AwaitingJudge and matchingOn and waitedMs >= judgeWaitLimitMs

pure def holdUnjudged(r: AutomatedReview, waitedMs: int, matchingOn: bool): AutomatedReview = { ...r, phase: HeldForStaff }

pure def lawPausedMatchingHoldsNothing(waitedMs: int): bool = not(canHoldUnjudged(initial, waitedMs, false))

pure val waitedMsValues = Set(0, 1799999, 1800000)
pure val matchingOnValues = Set(false, true)
```

### Staff approve only a held item and may reject any open item

A staff decision carries the revision that the staff member saw. Staff approve or edit only an item that the judge held. Staff may reject any open item. A decision at or after the deadline expires the item. An approval that a code gate refuses closes the item. A staff re-roll of a held item before its deadline starts a new revision that waits for the judge, or rejects the item when no replacement is found. A re-roll of an item that the judge flagged keeps the flag on each pair of the members before the swap, so a new revision that keeps such a pair is held for staff and is not sent to the judge; this sentence is new in this revision, because a re-roll must not clear a flag that no staff member approved (owner decision 2026-11-22, D17). Changed (owner decision 2026-11-22, D15 to D17): staff approved every item; now an item that waits for the judge cannot be approved by staff, so a staff member cannot approve before the judge reads the item, and a re-rolled item goes back to the judge.

```quint
pure def canStaffDecide(r: AutomatedReview, revision: int, approve: bool): bool =
  revision == r.revision and (if (approve) r.phase == HeldForStaff else reviewOpen(r))

pure def staffDecide(r: AutomatedReview, revision: int, approve: bool, gatesPass: bool, late: bool): AutomatedReview =
  if (late) { ...r, phase: ReviewExpired }
  else if (not(approve)) { ...r, phase: ReviewRejected }
  else if (not(gatesPass)) { ...r, phase: ReviewInvalidated }
  else { ...r, phase: ReviewApproved, approver: StaffApprover }

pure def canStaffReroll(r: AutomatedReview, revision: int, late: bool): bool =
  r.phase == HeldForStaff and revision == r.revision and not(late)

pure def staffReroll(r: AutomatedReview, revision: int, late: bool, replacementFound: bool): AutomatedReview =
  if (replacementFound) { phase: AwaitingJudge, revision: r.revision + 1, approver: NoApprover }
  else { ...r, phase: ReviewRejected }

pure def lawAwaitingItemNeedsTheJudge(revision: int): bool =
  not(canStaffDecide({ ...initial, revision: revision }, revision, true))

pure def stepHeldItemNeedsStaff(before: AutomatedReview, via: str, after: AutomatedReview): bool =
  (before.phase == HeldForStaff and after.phase == ReviewApproved) implies (after.approver == StaffApprover and via == "staffDecide")

pure def stepRerollStartsNewRevision(before: AutomatedReview, via: str, after: AutomatedReview): bool =
  (via == "staffReroll" and after.phase == AwaitingJudge) implies after.revision == before.revision + 1

pure val revisionValues = Set(0, 1, 2)
pure val approveValues = Set(false, true)
pure val replacementFoundValues = Set(false, true)
```

### Staff can stop an approved item before its reveal

A staff member can stop an approved item while its probes run and before the reveal. A stopped item contacts nobody again. After the reveal, the item cannot be stopped. Changed (owner decision 2026-11-22, D15 to D17): no person reads an approved introduction before the first probe now, so staff need a way to stop one that they find in the judged list.

```quint
pure def canStopApproved(r: AutomatedReview, revealed: bool): bool = contactApproved(r) and not(revealed)

pure def stopApproved(r: AutomatedReview, revealed: bool): AutomatedReview = { ...r, phase: ReviewStopped }

pure def lawRevealedItemCannotBeStopped(revision: int): bool =
  not(canStopApproved({ phase: ReviewApproved, revision: revision, approver: JudgeApprover }, true))

pure def stepStopEndsOnlyAnApproval(before: AutomatedReview, via: str, after: AutomatedReview): bool =
  via == "stopApproved" implies (before.phase == ReviewApproved and after.phase == ReviewStopped)

pure val revealedValues = Set(false, true)
```

### An open review closes unsent

An open review expires at its deadline, and a code gate can close it at any time; both contact nobody. A decided review stays decided, except that staff can stop an approval. Changed (owner decision 2026-11-22, D15 to D17): an item that the judge holds now also expires unsent at its review deadline when no staff member acts (D17).

```quint
pure def canExpireReview(r: AutomatedReview, late: bool): bool = reviewOpen(r) and late

pure def expireReview(r: AutomatedReview, late: bool): AutomatedReview = { ...r, phase: ReviewExpired }

pure def canCloseReview(r: AutomatedReview): bool = reviewOpen(r)

pure def closeReview(r: AutomatedReview): AutomatedReview = { ...r, phase: ReviewInvalidated }

pure def stepDecidedReviewStaysDecided(before: AutomatedReview, via: str, after: AutomatedReview): bool =
  (not(reviewOpen(before)) and not(before.phase == ReviewApproved and via == "stopApproved")) implies after == before

pure def sometimesJudgeApproves(r: AutomatedReview): bool = r.approver == JudgeApprover
pure def sometimesHeldForStaff(r: AutomatedReview): bool = r.phase == HeldForStaff
pure def sometimesStaffApproves(r: AutomatedReview): bool = r.approver == StaffApprover
pure def sometimesExpires(r: AutomatedReview): bool = r.phase == ReviewExpired
pure def sometimesStopped(r: AutomatedReview): bool = r.phase == ReviewStopped
```

### A reply approves only when it is complete and consistent

The shell parses the judge's reply strictly. A reply that does not parse is undecided. An approval counts only when it gives no flag reason, every check passes, and, for the minor rubric, the minor check passes too; any other approval is undecided. A flag counts only with a reason. A reply that cannot decide, or any other word, is undecided. Changed (owner decision 2026-11-22, D15 to D17): a staff reviewer read each item; the model's reply is external input now, so anything that is not a complete and consistent approval holds the item for staff.

```quint
pure def judgeVerdictOf(parsed: bool, said: VerdictWord, reasonGiven: bool, checksClear: bool, rubric: Rubric, minorChecksClear: bool): JudgeVerdict =
  if (not(parsed)) JudgeUndecided
  else match said {
    | SaidApprove => if (not(reasonGiven) and checksClear and (rubric == AdultRubric or minorChecksClear)) JudgeApproves else JudgeUndecided
    | SaidFlag => if (reasonGiven) JudgeFlags else JudgeUndecided
    | SaidCannotDecide => JudgeUndecided
    | SaidOther => JudgeUndecided
  }

pure def lawUnparsedReplyNeverApproves(said: VerdictWord, reasonGiven: bool, checksClear: bool, rubric: Rubric, minorChecksClear: bool): bool =
  judgeVerdictOf(false, said, reasonGiven, checksClear, rubric, minorChecksClear) == JudgeUndecided

pure def lawMinorApprovalNeedsMinorChecks(reasonGiven: bool, checksClear: bool): bool =
  judgeVerdictOf(true, SaidApprove, reasonGiven, checksClear, MinorRubric, false) != JudgeApproves

pure def lawFlagNeedsReason(checksClear: bool, rubric: Rubric, minorChecksClear: bool): bool =
  judgeVerdictOf(true, SaidFlag, false, checksClear, rubric, minorChecksClear) == JudgeUndecided

pure val saidValues = Set(SaidApprove, SaidFlag, SaidCannotDecide, SaidOther)
pure val rubricValues = Set(AdultRubric, MinorRubric)
pure val reasonGivenValues = Set(false, true)
pure val checksClearValues = Set(false, true)
pure val minorChecksClearValues = Set(false, true)
```

### A roster with a minor gets the strict rubric

When any member of the roster (participants, alternates and the plan host) is not a known adult, the judge reads the item with the strict minor rubric. The age rules are code gates that run before the judge; the model never decides an age. Changed (owner decision 2026-11-22, D16): a named staff reviewer approved each item with a minor; the owner chose full automation, so the judge approves such an item only with the strict rubric.

```quint
pure def reviewRubric(rosterHasMinor: bool): Rubric = if (rosterHasMinor) MinorRubric else AdultRubric

pure def lawMinorRosterGetsStrictRubric(rosterHasMinor: bool): bool =
  rosterHasMinor implies reviewRubric(rosterHasMinor) == MinorRubric

pure val rosterHasMinorValues = Set(false, true)
```

### A judge call runs only for a clean packet with no earlier flag, with a provider, inside the limits, before the deadline

The judge is not called for a packet whose text looks like an instruction to a reviewer, for a pair that a judge or staff flagged in the last 90 days, without a model provider, when the day's budget or request limit of the app is spent, or when fewer than 10 minutes are left before the deadline. A suspect packet and an earlier flag are flags; every other refusal is a judge that cannot run. When the judgment is recorded, the packet and the flags are read again: an approval of a packet that is now suspect, or of a pair that was flagged after the judge read it, is a flag. Changed (owner decision 2026-11-22, D15 to D17): no model read the items before; the owner accepted a model judge with spending limits, and every case where it cannot run holds the item for staff (D17). The check at the time of the record is new in this revision, because a staff reject or an expiry of a held item can flag the pair while the judge reads the packet, and D17 holds a flagged item for staff.

```quint
pure def judgeCallDecision(packetClean: bool, priorFlag: bool, providerReady: bool, spentMicros: int, budgetMicros: int, requestsUsed: int, requestLimit: int, msLeft: int): JudgeCall =
  if (not(packetClean)) PacketSuspect
  else if (priorFlag) PriorFlag
  else if (not(providerReady)) NoProvider
  else if (spentMicros >= budgetMicros) BudgetReached
  else if (requestsUsed >= requestLimit) RequestLimitReached
  else if (msLeft < judgeMinLeadMs) DeadlineTooClose
  else CallJudge

pure def uncalledVerdict(call: JudgeCall): JudgeVerdict = match call {
  | PacketSuspect => JudgeFlags
  | PriorFlag => JudgeFlags
  | _ => JudgeCannotRun
}

pure def verdictAtRecord(verdict: JudgeVerdict, packetClean: bool, priorFlag: bool): JudgeVerdict =
  if (verdict == JudgeApproves and (not(packetClean) or priorFlag)) JudgeFlags else verdict

pure def lawFreshFlagBeatsApproval(verdict: JudgeVerdict, packetClean: bool, priorFlag: bool): bool =
  (not(packetClean) or priorFlag) implies verdictAtRecord(verdict, packetClean, priorFlag) != JudgeApproves

pure def lawSuspectPacketNeverApproves(priorFlag: bool, providerReady: bool, spentMicros: int, budgetMicros: int, requestsUsed: int, requestLimit: int, msLeft: int): bool =
  judgeCallDecision(false, priorFlag, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) == PacketSuspect
    and uncalledVerdict(PacketSuspect) == JudgeFlags

pure def lawPriorFlagNeverApproves(packetClean: bool, providerReady: bool, spentMicros: int, budgetMicros: int, requestsUsed: int, requestLimit: int, msLeft: int): bool =
  judgeCallDecision(packetClean, true, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) != CallJudge

pure def lawSpentBudgetNeverCalls(packetClean: bool, priorFlag: bool, spentMicros: int, budgetMicros: int, requestsUsed: int, requestLimit: int, msLeft: int): bool =
  spentMicros >= budgetMicros implies judgeCallDecision(packetClean, priorFlag, true, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) != CallJudge

pure def lawCallHasLeadTime(packetClean: bool, priorFlag: bool, providerReady: bool, spentMicros: int, budgetMicros: int, requestsUsed: int, requestLimit: int, msLeft: int): bool =
  judgeCallDecision(packetClean, priorFlag, providerReady, spentMicros, budgetMicros, requestsUsed, requestLimit, msLeft) == CallJudge
    implies msLeft >= judgeMinLeadMs

pure val packetCleanValues = Set(false, true)
pure val priorFlagValues = Set(false, true)
pure val providerReadyValues = Set(false, true)
pure val spentMicrosValues = Set(0, 4999999, 5000000)
pure val budgetMicrosValues = Set(0, 5000000)
pure val requestsUsedValues = Set(0, 399, 400)
pure val requestLimitValues = Set(0, 400)
pure val msLeftValues = Set(0, 599999, 600000, 43200000)
```

### One judgment per packet for every replica

Replicas share one stored judgment for each packet. A decided judgment is reused. A running judgment is left alone until its lease ends. An expired lease is claimed again at most twice in all; after that the judgment is recorded as a judge that cannot run. The lease outlasts the longest call with a margin. A stored judgment is kept for 90 days, and longer while a member of its roster has an open safety case. A flag on a pair counts for 90 days. Changed (owner decision 2026-11-22, D15 to D17): the review had no model call to share between replicas; now each packet costs at most a bounded number of calls on every replica.

```quint
pure def judgeClaimDecision(rowExists: bool, decided: bool, claims: int, leaseExpired: bool): JudgeClaim =
  if (not(rowExists)) ClaimFirst
  else if (decided) UseStored
  else if (not(leaseExpired)) WaitForLease
  else if (claims < maxJudgeClaims) ClaimAgain
  else ClaimsSpent

pure def lawDecidedRowIsReused(claims: int, leaseExpired: bool): bool = judgeClaimDecision(true, true, claims, leaseExpired) == UseStored

pure def lawClaimsAreBounded(claims: int): bool =
  claims >= maxJudgeClaims implies judgeClaimDecision(true, false, claims, true) == ClaimsSpent

pure def lawLeaseOutlastsCall(callMs: int): bool =
  callMs <= judgeCallDeadlineMs implies callMs + judgeLeaseMarginMs <= judgeLeaseMs

pure def judgmentRetained(ageMs: int, openSafetyCase: bool): bool = openSafetyCase or ageMs < reviewJudgmentRetentionMs

pure def flaggedPairActive(ageMs: int): bool = ageMs < flaggedPairRetentionMs

pure val claimsValues = Set(0, 1, 2, 3)
pure val leaseExpiredValues = Set(false, true)
pure val callMsValues = Set(0, 119999, 120000)
pure val ageMsValues = Set(0, 7775999999, 7776000000)
```

### The simulator uses a deterministic stand-in judge

The simulator never calls a model. Its stand-in judge approves every item, or, in the exception arm, flags, is undecided about, cannot run on, or does not answer a fixed share of the items. The ticket is the first 8 hex digits of `sha256("<oppId>:<revision>")` modulo 100 for the judge, and of `sha256("<oppId>:<revision>:staff")` modulo 100 for the simulated staff member, who approves, rejects or waits. A silent ticket gives no judgment, so the item reaches `judge_overdue`. Reports name these decisions as simulated. Changed (owner decision 2026-11-22, D15 to D17): the simulator approved every item as a simulated reviewer; now it runs the same judge step as production with a stand-in judge and a simulated staff member for the exceptions.

```quint
pure def simulatedJudgeAnswers(ticket: int, withExceptions: bool): bool = not(withExceptions) or ticket < 7 or ticket >= 9

pure def simulatedJudgeVerdict(ticket: int, withExceptions: bool): JudgeVerdict =
  if (not(withExceptions)) JudgeApproves
  else if (ticket < 4) JudgeFlags
  else if (ticket < 6) JudgeUndecided
  else if (ticket < 7) JudgeCannotRun
  else JudgeApproves

pure def simulatedStaffAction(ticket: int): SimStaffAction =
  if (ticket % 3 == 0) SimStaffApproves
  else if (ticket % 3 == 1) SimStaffRejects
  else SimStaffWaits

pure def lawStandInApprovesWithoutExceptions(ticket: int): bool =
  simulatedJudgeAnswers(ticket, false) and simulatedJudgeVerdict(ticket, false) == JudgeApproves

pure def lawStandInHoldsSomeItems(withExceptions: bool): bool =
  withExceptions implies simulatedJudgeVerdict(0, withExceptions) == JudgeFlags

pure def lawStandInIsSilentSometimes(withExceptions: bool): bool =
  withExceptions implies not(simulatedJudgeAnswers(7, withExceptions))

pure val ticketValues = Set(0, 3, 4, 5, 6, 7, 8, 9, 99)
pure val withExceptionsValues = Set(false, true)
```
