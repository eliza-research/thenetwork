# Member request lifecycle

A classified people request can reuse a standing request, start a new one, or wait for another search. The shell owns the member and request records, clock, current eligibility, candidate ranking, message copy, write ordering, and opportunity review.

## Story: Ask to meet someone and change my mind while the search is open

> As a member, I want the Network to keep one search for the same current request, stop a request I withdraw, and check with me when a proposed introduction needs my confirmation.

### A direct request can interrupt the initial interview

Learn a profile statement as an interview answer when initial onboarding has a pending question. A direct request from the member for people or plans can start work before the optional interview is finished. A profile submitted by an assistant is still profile evidence.

```quint
pure def learnDuringRequestIntake(interviewPending: bool, initialOnboarding: bool, directRequest: bool): bool =
  interviewPending and initialOnboarding and not(directRequest)

pure def lawDirectRequestPassesInterview(interviewPending: bool, initialOnboarding: bool): bool =
  not(learnDuringRequestIntake(interviewPending, initialOnboarding, true))
```

### A repeat ask keeps the newest matching request

Use the newest unwithdrawn people request for the same person and desire, or the same category when there is no desire ID. A booked or fulfilled request is outside this lookup. Reuse a request while it is probing or while it is inside the member's configured re-search interval. A quiet repeat ends with no other step. A repeat of a probing request tells the member that the search continues. When matching is paused, a repeat keeps its request waiting. Otherwise a repeat goes to the immediate retry check. A new request requires a category that the app supports. When matching is paused, a new request waits. A member who is not eligible for a search, because of a hold or a report, has the new request put on hold. A member who already has an open opportunity is busy, and the new request waits. Otherwise the new request starts a search.

```quint
type MemberRequestPhase =
  RequestStarting | RequestRepeated | RequestAdmitted | RequestOutOfScope |
  RequestQuietRepeat | RequestAlreadyProbing | RequestMatchingPaused | CheckingImmediateRetry |
  RequestOnHold | RequestMemberBusy | CheckingScheduledMember | RequestDeferred | RequestSearching |
  RequestAwaitingReview | RequestWithoutCandidate | RequestWithdrawn | RequestKept
type MemberRequestFlow = { phase: MemberRequestPhase }
pure val initial: MemberRequestFlow = { phase: RequestStarting }

pure def sameStandingRequest(sameMember: bool, people: bool, sameWant: bool, withdrawn: bool, status: str): bool =
  sameMember and people and sameWant and not(withdrawn) and status != "booked" and status != "fulfilled"

pure def requestInReuseWindow(probing: bool, age: int, interval: int): bool =
  probing or age < interval

pure def canCheckRequestAdmission(flow: MemberRequestFlow): bool = flow.phase == RequestStarting
pure def checkRequestAdmission(flow: MemberRequestFlow, repeat: bool, categoryAllowed: bool): MemberRequestFlow =
  { phase: if (repeat) RequestRepeated else if (categoryAllowed) RequestAdmitted else RequestOutOfScope }

pure def canRouteRepeatedRequest(flow: MemberRequestFlow): bool = flow.phase == RequestRepeated
pure def routeRepeatedRequest(flow: MemberRequestFlow, quiet: bool, probing: bool, matching: bool): MemberRequestFlow =
  { phase: if (quiet) RequestQuietRepeat else if (probing) RequestAlreadyProbing
    else if (not(matching)) RequestMatchingPaused else CheckingImmediateRetry }

pure def canRouteNewRequest(flow: MemberRequestFlow): bool = flow.phase == RequestAdmitted
pure def routeNewRequest(flow: MemberRequestFlow, matching: bool, eligible: bool, busy: bool): MemberRequestFlow =
  { phase: if (not(matching)) RequestMatchingPaused else if (not(eligible)) RequestOnHold
    else if (busy) RequestMemberBusy else RequestSearching }
```

### Only the member's pending request for a withdrawn desire closes

A withdrawal affects that member's waiting or probing people request when it has the withdrawn desire. Close a linked opportunity only in review or probing, then mark the request closed and withdrawn. A later explicit ask can start a new request.

```quint
pure def memberRequestWithdrawable(sameMember: bool, people: bool, desireMatches: bool, withdrawn: bool, status: str): bool =
  sameMember and people and desireMatches and not(withdrawn) and (status == "none" or status == "probing")

pure def closeOpportunityForRequestWithdrawal(stage: str): bool = stage == "review" or stage == "probing"

pure def canApplyRequestWithdrawal(flow: MemberRequestFlow): bool = flow.phase == RequestStarting
pure def applyRequestWithdrawal(flow: MemberRequestFlow, matched: bool): MemberRequestFlow =
  { phase: if (matched) RequestWithdrawn else RequestKept }
```

### A standing request waits for its next search window

An immediate repeat can search an open waiting request only when the member is eligible for this search and free. Otherwise the request waits for a later search. More than one hour must have passed since a recorded attempt. A scheduled retry checks only open, waiting people requests through seven days from creation and waits at least twenty hours after an earlier attempt. Both routes wait at least seventy-two hours after a requester confirmation question. A scheduled attempt still requires a currently eligible, free member.

```quint
pure val immediateRetryMs: int = 3600000
pure val scheduledRetryMs: int = 72000000
pure val requesterConfirmCooldownMs: int = 259200000
pure val scheduledRequestLifetimeMs: int = 604800000

pure def waitingMemberRequest(status: str, closed: bool): bool = status == "none" and not(closed)

pure def requesterConfirmationAllowsRetry(asked: bool, elapsed: int): bool =
  not(asked and elapsed < requesterConfirmCooldownMs)

pure def immediateRequestRetryReady(attempted: bool, attemptAge: int, asked: bool, confirmAge: int): bool =
  (not(attempted) or attemptAge > immediateRetryMs) and requesterConfirmationAllowsRetry(asked, confirmAge)

pure def immediateRequestSearchAllowed(waiting: bool, eligible: bool, busy: bool,
    attempted: bool, attemptAge: int, asked: bool, confirmAge: int): bool =
  waiting and eligible and not(busy) and immediateRequestRetryReady(attempted, attemptAge, asked, confirmAge)

pure def lawImmediateSearchNeedsFreeEligibleWaitingRequest(waiting: bool, eligible: bool, busy: bool,
    attempted: bool, attemptAge: int, asked: bool, confirmAge: int): bool =
  immediateRequestSearchAllowed(waiting, eligible, busy, attempted, attemptAge, asked, confirmAge)
    implies (waiting and eligible and not(busy))

pure def scheduledRequestRetryReady(people: bool, waiting: bool, age: int, attempted: bool, attemptAge: int, asked: bool, confirmAge: int): bool =
  people and waiting and not(age > scheduledRequestLifetimeMs) and
    not(attempted and attemptAge < scheduledRetryMs) and requesterConfirmationAllowsRetry(asked, confirmAge)

pure def canRouteImmediateRequestRetry(flow: MemberRequestFlow): bool = flow.phase == CheckingImmediateRetry
pure def routeImmediateRequestRetry(flow: MemberRequestFlow, ready: bool): MemberRequestFlow =
  { phase: if (ready) RequestSearching else RequestDeferred }

pure def canConsiderScheduledRequestRetry(flow: MemberRequestFlow): bool = flow.phase == RequestStarting
pure def considerScheduledRequestRetry(flow: MemberRequestFlow, due: bool): MemberRequestFlow =
  { phase: if (due) CheckingScheduledMember else RequestDeferred }

pure def canRouteScheduledRequestRetry(flow: MemberRequestFlow): bool = flow.phase == CheckingScheduledMember
pure def routeScheduledRequestRetry(flow: MemberRequestFlow, eligible: bool, busy: bool): MemberRequestFlow =
  { phase: if (eligible and not(busy)) RequestSearching else RequestDeferred }
```

### A candidate proceeds to review with prior interest only when appropriate

Record each permitted attempt. With no candidate the request stays waiting. When a candidate is found, send the proposed opportunity to review. A strong fit, or a match in a non-selective search, can use the member's existing ask as interest only when there is no withdrawn desire. The shell assesses the strong-fit threshold of 0.8 from the existing decimal score. A previously closed desire counts as withdrawn when there is no active statement of it.

```quint
pure def requestDesireWithdrawn(closedIntent: bool, activeIntent: bool): bool = closedIntent and not(activeIntent)
pure def primeMemberRequest(withdrawnIntent: bool, strongFit: bool, selective: bool): bool =
  not(withdrawnIntent) and (strongFit or not(selective))

pure def canReadRequestCandidates(flow: MemberRequestFlow): bool = flow.phase == RequestSearching
pure def readRequestCandidates(flow: MemberRequestFlow, anyCandidate: bool): MemberRequestFlow =
  { phase: if (anyCandidate) RequestAwaitingReview else RequestWithoutCandidate }

pure def lawWithdrawalPreventsRequestPriming(strongFit: bool, selective: bool): bool =
  not(primeMemberRequest(true, strongFit, selective))

pure def stepRequestReviewFollowsSearch(before: MemberRequestFlow, via: str, after: MemberRequestFlow): bool =
  after.phase == RequestAwaitingReview implies (before.phase == RequestSearching and via == "readRequestCandidates")

pure def sometimesReviewsMemberRequest(flow: MemberRequestFlow): bool = flow.phase == RequestAwaitingReview
pure def sometimesFindsNoRequestCandidate(flow: MemberRequestFlow): bool = flow.phase == RequestWithoutCandidate
pure def sometimesWithdrawsMemberRequest(flow: MemberRequestFlow): bool = flow.phase == RequestWithdrawn
```
