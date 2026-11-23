# Peon seat capacity

The [matching engine model](models/matching_engine.md) follows job postings and candidate-first consent. This machine builds a posting’s current occupancy from persisted introductions and the current open opportunity view. The engine projects remaining openings onto the job seat, then limits the next slate. The service uses booked occupancy alone when deciding whether to close other open items.

## Story: Reserve one opening for each candidate still in the hiring flow

> As a hiring manager, I want the job’s next slate to fit the openings still available while candidates already in review keep their place.

### Only live or successful introductions occupy an opening

The engine includes pending, accepted, and completed interactions and current open opportunities. Declined, expired, cancelled, and no-show interactions do not add occupancy. A candidate with several records on one posting occupies one opening there. Each posting has its own ledger. The service uses the accepted and completed records from the same projection to decide whether another introduction can stay in review. A meeting that has not closed adds a synthetic acceptance until it has recorded feedback. A recorded no-show without a completion frees the opening for a replacement that still needs staff review.

```quint
type LedgerPhase = Collecting | Published
type SeatLedger = { phase: LedgerPhase, occupied: Set[str] }

pure val initial: SeatLedger = { phase: Collecting, occupied: Set() }

pure def bookedRecordOccupies(disposition: str): bool =
  disposition == "accepted" or disposition == "completed"

pure def interactionOccupies(disposition: str): bool =
  disposition == "pending" or bookedRecordOccupies(disposition)

pure def bookedOccupies(hasMeeting: bool, closed: bool): bool = hasMeeting and not(closed)

pure def bookedNeedsSyntheticAcceptance(hasMeeting: bool, closed: bool, hasFeedback: bool): bool =
  bookedOccupies(hasMeeting, closed) and not(hasFeedback)

pure def lawFeedbackReplacesSyntheticAcceptance(hasMeeting: bool, closed: bool): bool =
  not(bookedNeedsSyntheticAcceptance(hasMeeting, closed, true))

pure def seatRecordOccupies(openOpportunity: bool, disposition: str): bool =
  openOpportunity or interactionOccupies(disposition)

pure def lawOpenOpportunityOccupies(disposition: str): bool = seatRecordOccupies(true, disposition)
pure def lawEndedInteractionFreesOpening(openOpportunity: bool): bool =
  seatRecordOccupies(openOpportunity, "declined") == openOpportunity

pure def lawMissedInterviewDoesNotFillOpening(openOpportunity: bool): bool =
  not(bookedRecordOccupies("no_show")) and (seatRecordOccupies(openOpportunity, "no_show") == openOpportunity)

pure def lawPendingReviewDoesNotFillOpening(openOpportunity: bool): bool =
  not(bookedRecordOccupies("pending")) and seatRecordOccupies(openOpportunity, "pending")

pure def canObserveCandidate(l: SeatLedger, candidate: str, occupies: bool): bool =
  l.phase == Collecting and occupies and not(l.occupied.contains(candidate))

pure def observeCandidate(l: SeatLedger, candidate: str, occupies: bool): SeatLedger =
  { ...l, occupied: l.occupied.union(Set(candidate)) }

pure def canPublishLedger(l: SeatLedger): bool = l.phase == Collecting
pure def publishLedger(l: SeatLedger): SeatLedger = { ...l, phase: Published }

pure def stepPublishedOccupancyStaysFixed(before: SeatLedger, after: SeatLedger): bool =
  before.phase == Published implies (after.phase == Published and before.occupied.size() == after.occupied.size())

pure def sometimesPublishedWithCandidate(l: SeatLedger): bool = l.phase == Published and l.occupied.size() > 0
```

### Record the time both sides accept a job introduction

When both sides' valid answers commit a reviewed introduction, record that time in the booking. Use it in the accepted interaction so that the engine can read the response before the interview. A restart uses the saved time. For an older booking with no saved acceptance time, use the earliest confirmed receipt for an original introduction notice if it predates the interview. If that evidence is unavailable, use the planned interview time.

```quint
pure def peonAcceptedHistoryAt(acceptedAt: int, legacyReceiptAt: int, interviewAt: int): int =
  if (acceptedAt >= 0) acceptedAt
  else if (legacyReceiptAt >= 0 and legacyReceiptAt < interviewAt) legacyReceiptAt
  else interviewAt

pure def lawPeonAcceptanceHistoryKeepsRecordedTime(acceptedAt: int, legacyReceiptAt: int, interviewAt: int): bool =
  acceptedAt >= 0 implies peonAcceptedHistoryAt(acceptedAt, legacyReceiptAt, interviewAt) == acceptedAt
```

### Interview feedback keeps the application's recorded answers

When feedback replaces the accepted interaction, keep the booked introduction's acceptance time on its first matching attendance record. Both members must belong to the recorded booking and the record must come from a participant's check-in for that booking. Preserve the feedback receipt time and its disposition. Later feedback supplies no second application answer. A completed or missed interview can end the active introduction without returning an employer who answered to probation. Use the same acceptance time and legacy fallback as for the accepted interaction.

```quint
pure def peonFeedbackRetainsAcceptance(interviewDone: bool, matchingRoster: bool, ownFeedback: bool): bool =
  interviewDone and matchingRoster and ownFeedback

pure def peonApplicationAnswered(acceptedAt: int, now: int, candidateAccepted: bool, employerAnswered: bool): bool =
  (acceptedAt >= 0 and acceptedAt <= now) or (candidateAccepted and employerAnswered)

pure def lawUnboundPeonFeedbackKeepsNoAcceptance(interviewDone: bool, matchingRoster: bool): bool =
  not(peonFeedbackRetainsAcceptance(interviewDone, matchingRoster, false))

pure def lawPeonAcceptanceIsVisibleAtItsRecordedTime(acceptedAt: int, now: int): bool =
  peonApplicationAnswered(acceptedAt, now, false, false) == (acceptedAt >= 0 and now >= acceptedAt)
```

### The next slate stays within remaining openings

Remaining openings are the posted count minus occupied openings, with a minimum of zero. The engine uses the lower of the planned slate and remaining openings when the snapshot supplies a seat limit. The service closes unbooked items when the posting closes or booked occupancy reaches the posted count. Current booked introductions continue.

```quint
pure def remainingOpenings(posted: int, occupied: int): int =
  if (posted - occupied < 0) 0 else posted - occupied

pure def capSlate(planned: int, remaining: int): int =
  val room = if (remaining < 0) 0 else remaining
  if (planned < room) planned else room

pure def bookedCapacityReached(posted: int, occupied: int): bool = occupied >= posted

pure def closeUnbookedItems(postingClosed: bool, posted: int, occupied: int): bool =
  postingClosed or bookedCapacityReached(posted, occupied)

pure def lawClosedPostingClosesUnbookedItems(posted: int, occupied: int): bool =
  closeUnbookedItems(true, posted, occupied)

pure def lawRemainingNeverNegative(posted: int, occupied: int): bool = remainingOpenings(posted, occupied) >= 0
pure def lawSlateRespectsRemaining(planned: int, remaining: int): bool =
  remaining >= 0 implies capSlate(planned, remaining) <= remaining
```

### Trusted postings can use their opening slate

A normal hiring manager's synthetic job seat uses the open budget. The manager's
member record and each candidate keep their own participation state. Quiet,
receiving, and paused seats keep their manager's state. The open budget also
leaves the posting's opening limit and required staff review in force.

Before the company has answered an application, count sent proposals in the
seven-day budget window across its job seats. Count seats already reserved in
the current match run. Use the lower of the posting's slate, its share of the
company cap, and the company's remaining cap. Apply the existing higher cap
only to a verified urgent posting. When a confirmed company ID is unavailable,
use the posting owner for that company's budget.

```quint
pure def normalJobSeatUsesOpenBudget(participation: str): bool = participation == "normal"

pure def peonProbationRemaining(limit: int, sent: int, reserved: int): int =
  remainingOpenings(limit, sent + reserved)

pure def lawPeonJobSeatKeepsOtherBudgets(participation: str): bool =
  participation != "normal" implies not(normalJobSeatUsesOpenBudget(participation))

pure def lawPeonProbationCountsPriorAndReserved(limit: int, sent: int, reserved: int): bool =
  reserved >= 0 and sent + reserved >= limit implies peonProbationRemaining(limit, sent, reserved) == 0
```
