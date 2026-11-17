# Peon seat capacity

The [matching engine model](models/matching_engine.md) follows job postings and candidate-first consent. This machine builds a posting’s current occupancy from persisted introductions and the current open opportunity view. The engine projects remaining openings onto the job seat, then limits the next slate. The service uses booked occupancy alone when deciding whether to close other open items.

## Story: Reserve one opening for each candidate still in the hiring flow

> As a hiring manager, I want the job’s next slate to fit the openings still available while candidates already in review keep their place.

### Only live or successful introductions occupy an opening

The engine includes pending, accepted, and completed interactions and current open opportunities. Declined, expired, cancelled, and no-show interactions do not add occupancy. A candidate with several records on one posting occupies one opening there. Each posting has its own ledger. A booked opportunity counts for the service while it has a meeting and remains open. For the engine view, a booked row with recorded feedback uses that feedback instead of a synthetic acceptance, and a booked row without feedback adds a synthetic acceptance.

```quint
type LedgerPhase = Collecting | Published
type SeatLedger = { phase: LedgerPhase, occupied: Set[str] }

pure val initial: SeatLedger = { phase: Collecting, occupied: Set() }

pure def interactionOccupies(disposition: str): bool =
  disposition == "pending" or disposition == "accepted" or disposition == "completed"

pure def bookedOccupies(hasMeeting: bool, closed: bool): bool = hasMeeting and not(closed)

pure def seatRecordOccupies(openOpportunity: bool, disposition: str): bool =
  openOpportunity or interactionOccupies(disposition)

pure def bookedNeedsSyntheticAcceptance(hasMeeting: bool, closed: bool, hasFeedback: bool): bool =
  bookedOccupies(hasMeeting, closed) and not(hasFeedback)

pure def lawOpenOpportunityOccupies(disposition: str): bool = seatRecordOccupies(true, disposition)
pure def lawEndedInteractionFreesOpening(openOpportunity: bool): bool =
  seatRecordOccupies(openOpportunity, "declined") == openOpportunity
pure def lawFeedbackReplacesSyntheticAcceptance(hasMeeting: bool, closed: bool): bool =
  not(bookedNeedsSyntheticAcceptance(hasMeeting, closed, true))

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
