# On-site meetup arrival coordination

On-site arrival coordination tracks the meetup window, gates adult-only arrival relays, escalates no-shows so nobody waits stranded, and allows a single pivot to a verified backup venue on closure.

## Story: Track arrival phases and gate arrival relays safely

> As a confirmed adult participant arriving at a meeting, I want timely arrival updates only during the active arrival window, with safety and leak checks on every relay and zero arrival relays involving minors.

### Meetup arrival phases open 30 minutes before start and close 45 minutes after start

Before 75 minutes prior to start, the meetup is in `Before`. From 75 minutes before up to 31 minutes before start, it is in `PreBrief`. From 30 minutes before through 45 minutes after start, it is in `ActiveArrival`. Once all participants have met or more than 45 minutes have passed after start, it is `Closed`.

```quint
import memberAge as Age from "./memberAge"

type MeetupPhase = Before | PreBrief | ActiveArrival | Closed

pure val preBriefStartDeltaMin: int = -75
pure val activeArrivalStartDeltaMin: int = -30
pure val activeArrivalEndDeltaMin: int = 45

pure def meetupPhase(deltaMin: int, allMet: bool): MeetupPhase =
  if (allMet or deltaMin > activeArrivalEndDeltaMin) Closed
  else if (deltaMin >= activeArrivalStartDeltaMin) ActiveArrival
  else if (deltaMin >= preBriefStartDeltaMin) PreBrief
  else Before

pure def lawAllMetClosesMeetup(deltaMin: int): bool =
  meetupPhase(deltaMin, true) == Closed

pure def lawPastArrivalWindowClosesMeetup(deltaMin: int, allMet: bool): bool =
  deltaMin > activeArrivalEndDeltaMin implies meetupPhase(deltaMin, allMet) == Closed

pure val deltaMinValues = Set(-90, -75, -31, -30, 0, 15, 45, 46, 60)
```

### Arrival relays require confirmed adults, active arrival phase, and clean safety checks

An arrival update can relay only when both sender and recipient have usable adult ages (18 to 120), both confirmed attendance, neither is blocked or opted out, the meetup is in `ActiveArrival`, the sender has not already met, and both leak and safety checks passed. Minors never participate in arrival relays.

```quint
pure def canRelayArrival(
  senderAge: int,
  recipientAge: int,
  senderConfirmed: bool,
  recipientConfirmed: bool,
  blocked: bool,
  optedOut: bool,
  phase: MeetupPhase,
  senderMet: bool,
  leakClean: bool,
  safetyClean: bool
): bool =
  Age::matchableAge(senderAge)
    and Age::matchableAge(recipientAge)
    and senderConfirmed
    and recipientConfirmed
    and not(blocked)
    and not(optedOut)
    and phase == ActiveArrival
    and not(senderMet)
    and leakClean
    and safetyClean

pure def lawMinorNeverRelaysArrival(
  senderAge: int, recipientAge: int, senderConfirmed: bool, recipientConfirmed: bool,
  blocked: bool, optedOut: bool, phase: MeetupPhase, senderMet: bool,
  leakClean: bool, safetyClean: bool
): bool =
  (senderAge < Age::adultAge or recipientAge < Age::adultAge)
    implies not(canRelayArrival(
      senderAge, recipientAge, senderConfirmed, recipientConfirmed,
      blocked, optedOut, phase, senderMet, leakClean, safetyClean))

pure def lawNoRelayOutsideActiveArrival(
  senderAge: int, recipientAge: int, senderConfirmed: bool, recipientConfirmed: bool,
  blocked: bool, optedOut: bool, phase: MeetupPhase, senderMet: bool,
  leakClean: bool, safetyClean: bool
): bool =
  (phase != ActiveArrival)
    implies not(canRelayArrival(
      senderAge, recipientAge, senderConfirmed, recipientConfirmed,
      blocked, optedOut, phase, senderMet, leakClean, safetyClean))

pure def lawNoRelayWhenBlockedOrOptedOut(
  senderAge: int, recipientAge: int, senderConfirmed: bool, recipientConfirmed: bool,
  blocked: bool, optedOut: bool, phase: MeetupPhase, senderMet: bool,
  leakClean: bool, safetyClean: bool
): bool =
  (blocked or optedOut)
    implies not(canRelayArrival(
      senderAge, recipientAge, senderConfirmed, recipientConfirmed,
      blocked, optedOut, phase, senderMet, leakClean, safetyClean))

pure def lawNoRelayOnLeakOrSafetyFailure(
  senderAge: int, recipientAge: int, senderConfirmed: bool, recipientConfirmed: bool,
  blocked: bool, optedOut: bool, phase: MeetupPhase, senderMet: bool,
  leakClean: bool, safetyClean: bool
): bool =
  (not(leakClean) or not(safetyClean))
    implies not(canRelayArrival(
      senderAge, recipientAge, senderConfirmed, recipientConfirmed,
      blocked, optedOut, phase, senderMet, leakClean, safetyClean))

pure val senderAgeValues = Set(12, 13, 17, 18, 25, 121)
pure val recipientAgeValues = Set(12, 13, 17, 18, 25, 121)
```

### A group arrival update refused by the send path stays pending for that recipient

A group meetup sends arrival updates as a short digest. When the send path refuses the digest for one recipient (for example, the conversation streak cap), the updates stay pending for that recipient and go out with a later digest while the meetup is still in `ActiveArrival`. Other recipients are not sent them twice. The sender is told "I've updated the group" only when no recipient was refused; otherwise the sender is told the update will go to the group shortly. Pending updates end when the meetup closes, is met, or pivots, like every other pending digest update.

## Story: Escalate no-shows and pivot to a verified backup venue

> As an attendee waiting at a meetup, I want timely late check-ins and a clean pivot to a verified backup venue if the primary venue is closed.

### No-show escalation pings at 12 minutes and notifies the waiting attendee at 18 minutes

When the partner has checked in, no escalation runs. Otherwise, at 18 minutes or more after arrival without a waiting notice, the action is `NotifyWaiting`. At 12 minutes or more without a late ping, the action is `PingLate`. Before 12 minutes, or once both actions have fired, the action is `NoAction`.

```quint
type NoShowAction = NoAction | PingLate | NotifyWaiting

pure val noShowPingLateMin: int = 12
pure val noShowNotifyWaitingMin: int = 18

pure def noShowDecision(
  minutesSinceArrival: int,
  partnerCheckedIn: bool,
  pingedLate: bool,
  notifiedWaiting: bool
): NoShowAction =
  if (partnerCheckedIn) NoAction
  else if (minutesSinceArrival >= noShowNotifyWaitingMin and not(notifiedWaiting)) NotifyWaiting
  else if (minutesSinceArrival >= noShowPingLateMin and not(pingedLate)) PingLate
  else NoAction

pure def lawCheckedInPartnerNeedsNoEscalation(
  minutesSinceArrival: int, pingedLate: bool, notifiedWaiting: bool
): bool =
  noShowDecision(minutesSinceArrival, true, pingedLate, notifiedWaiting) == NoAction

pure def lawNoEscalationBeforeTwelveMinutes(
  minutesSinceArrival: int, partnerCheckedIn: bool, pingedLate: bool, notifiedWaiting: bool
): bool =
  minutesSinceArrival < noShowPingLateMin
    implies noShowDecision(minutesSinceArrival, partnerCheckedIn, pingedLate, notifiedWaiting) == NoAction

pure def lawWaitingNotifiedAtEighteenMinutes(
  minutesSinceArrival: int, pingedLate: bool
): bool =
  minutesSinceArrival >= noShowNotifyWaitingMin
    implies noShowDecision(minutesSinceArrival, false, pingedLate, false) == NotifyWaiting

pure val minutesSinceArrivalValues = Set(-5, 0, 11, 12, 15, 17, 18, 25)
```

### Backup venue pivot occurs at most once when closure is reported and a backup is verified

A meetup pivots to its backup venue only when closure is reported, a verified backup venue exists, and the meetup has not already pivoted.

```quint
pure def shouldPivotToBackup(closureReported: bool, hasVerifiedBackup: bool, alreadyPivoted: bool): bool =
  closureReported and hasVerifiedBackup and not(alreadyPivoted)

pure def lawBackupPivotIsOneShot(closureReported: bool, hasVerifiedBackup: bool): bool =
  not(shouldPivotToBackup(closureReported, hasVerifiedBackup, true))

pure def lawBackupPivotRequiresClosureAndBackup(closureReported: bool, hasVerifiedBackup: bool, alreadyPivoted: bool): bool =
  shouldPivotToBackup(closureReported, hasVerifiedBackup, alreadyPivoted) implies (closureReported and hasVerifiedBackup)
```
