# Member request journey

This journey follows an adult member who asks for an introduction to a climbing partner. The [member request rules](memberRequest.md) govern admission, withdrawal, and retry. The fixture starts with no candidate and can add one eligible adult at the next daily search window. Its other messages arrive within the re-search interval. Review stays on throughout the journey: review by the judge, or by staff for an exception. In this journey no judgment arrives, so a proposal stays pending review. Changed (owner decision 2026-11-22, D15 to D17): human review was replaced by the review judge, and staff review only the items that the judge holds.

## Story: Keep control of my request for an introduction

> As a member, I want a repeat ask to keep my existing search, a new candidate to wait for review, and my withdrawal to stop the request.

### A repeat ask keeps the current request

An ask with no open request starts one search. With no candidate the request waits. When an eligible candidate already exists, the first proposal goes to review. A repeat ask before the permitted retry time keeps the same request and its attempt count. No action in this journey sends a probe or reveals a participant before review.

```quint
import memberRequest as Requests from "./memberRequest"

type RequestView = NoRequest | WaitingForCandidate | PendingReview | WithdrawnRequest
type MemberRequestJourney = { candidateAvailable: bool, request: RequestView, requestCount: int, attempts: int }
type RequestEffect = ReviewQueued | ReviewCleared | ParticipantContacted
type RequestUpdate = { state: MemberRequestJourney, out: List[RequestEffect] }

pure val initial: MemberRequestJourney = { candidateAvailable: false, request: NoRequest, requestCount: 0, attempts: 0 }

pure def offerFor(candidateAvailable: bool): RequestView = if (candidateAvailable) PendingReview else WaitingForCandidate
pure def effectsFor(candidateAvailable: bool): List[RequestEffect] = if (candidateAvailable) List(ReviewQueued) else List()

pure def canTextRequest(s: MemberRequestJourney): bool = true
pure def textRequest(s: MemberRequestJourney): RequestUpdate =
  if (s.request == WaitingForCandidate or s.request == PendingReview) { state: s, out: List() }
  else { state: { ...s, request: offerFor(s.candidateAvailable), requestCount: s.requestCount + 1, attempts: 1 },
    out: effectsFor(s.candidateAvailable) }

pure def stepNoParticipantContactedBeforeReview(before: MemberRequestJourney, after: MemberRequestJourney, out: List[RequestEffect]): bool =
  not(out.some(effect => effect == ParticipantContacted))

pure def sometimesWaits(s: MemberRequestJourney): bool = s.request == WaitingForCandidate
pure def sometimesRequestsReview(s: MemberRequestJourney): bool = s.request == PendingReview
```

### A newly available candidate can take the waiting search to review

When the eligible candidate joins, the next daily search can retry a waiting request. Record the attempt on that same request and send the proposal to review. A withdrawn request stays closed. A second arrival report for the same candidate does not add another candidate or advance the clock.

```quint
pure def canCandidateArrives(s: MemberRequestJourney): bool = true
pure def candidateArrives(s: MemberRequestJourney): RequestUpdate =
  if (s.candidateAvailable) { state: s, out: List() }
  else if (s.request == WaitingForCandidate)
    { state: { ...s, candidateAvailable: true, request: PendingReview, attempts: s.attempts + 1 }, out: List(ReviewQueued) }
  else { state: { ...s, candidateAvailable: true }, out: List() }

pure def sometimesRetriesExistingRequest(s: MemberRequestJourney): bool = s.request == PendingReview and s.requestCount == 1 and s.attempts == 2
```

### Withdrawal clears a waiting review and remains closed after restart

A withdrawal closes the current waiting request or its pending review. Repeating a withdrawal leaves it closed. Restoring saved state keeps the request and review outcome. The member can start a new request afterward.

```quint
pure def canTextWithdrawal(s: MemberRequestJourney): bool = true
pure def textWithdrawal(s: MemberRequestJourney): RequestUpdate =
  val status = if (s.request == PendingReview) "probing" else "none"
  val matched = Requests::memberRequestWithdrawable(true, s.request != NoRequest, true, s.request == WithdrawnRequest, status)
  { state: if (matched) { ...s, request: WithdrawnRequest } else s,
    out: if (s.request == PendingReview) List(ReviewCleared) else List() }

pure def canRestartJourney(s: MemberRequestJourney): bool = true
pure def restartJourney(s: MemberRequestJourney): RequestUpdate = { state: s, out: List() }

pure def sometimesWithdrawsRequest(s: MemberRequestJourney): bool = s.request == WithdrawnRequest
pure def sometimesWithdrawsAfterRetry(s: MemberRequestJourney): bool = s.request == WithdrawnRequest and s.attempts == 2
pure def sometimesReopensSearch(s: MemberRequestJourney): bool = s.requestCount > 1 and s.request == PendingReview

pure def stepAWithdrawnRequestNeedsNewAsk(before: MemberRequestJourney, via: str, after: MemberRequestJourney): bool =
  (before.request == WithdrawnRequest and after.request != WithdrawnRequest) implies via == "textRequest"
```
