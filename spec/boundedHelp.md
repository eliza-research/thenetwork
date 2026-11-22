# Admit a bounded request for help

[Story F14](product/stories.md#story-f14--ask-for-bounded-help) uses the same
home-entry and high-risk facts for direct requests and the engine's helper
search. The service keeps request text out of matching and safety case records.
The service routes a saved request that identifies a home task through the same
check again before it retries or contacts a helper. When an unfamiliar
singleton needs a second helper, the engine's helper search uses the
small-group format and applies that format's opt-in before it ranks any helper
in the group. The engine marks a qualified home-entry configuration as medium
risk, and the configuration still requires review and each participant's
consent.

## Story: Ask for manageable help without unexpected contact

> As a member, I want the Network to check the safety of my help request
> before it asks another person.

### A direct home-entry request goes to staff before contacting helpers

Classify the request before creating a matching request. Refuse an out-of-scope
high-risk task. Keep a home-entry task in the staff safety queue while the
service has no approved private venue to offer. A repeat request uses the open
case. Only an adult's request opens a case. The case has a reason code and no
address, message text or trust penalty. Ordinary bounded help uses the reviewed member request flow.

```quint
type BoundedHelpRoute = SearchPublicHelp | ReviewHomeEntryHelp | RefuseHighRiskHelp

pure def boundedHelpRoute(highRisk: bool, homeEntry: bool): BoundedHelpRoute =
  if (highRisk) RefuseHighRiskHelp
  else if (homeEntry) ReviewHomeEntryHelp
  else SearchPublicHelp

pure def openHomeHelpCase(adult: bool, hasOpenCase: bool): bool = adult and not(hasOpenCase)

pure def lawHomeHelpNeverUsesPublicSearch(highRisk: bool): bool =
  boundedHelpRoute(highRisk, true) != SearchPublicHelp

pure def lawHighRiskHelpTakesPrecedence(homeEntry: bool): bool =
  boundedHelpRoute(true, homeEntry) == RefuseHighRiskHelp
```

### An unfamiliar helper cannot be the only helper for home entry

A home-entry configuration needs at least two helpers, or one helper already
known to the requester. A home-entry request for one unfamiliar helper needs a
second helper.

```quint
pure def homeHelperSetAllowed(helperCount: int, knownSingleton: bool): bool =
  helperCount >= 2 or (helperCount == 1 and knownSingleton)

pure def needsSecondHomeHelper(homeEntry: bool, requestedHelpers: int, knownSingleton: bool): bool =
  homeEntry and requestedHelpers == 1 and not(knownSingleton)

pure def lawUnfamiliarHomeSingletonIsDisallowed(helperCount: int): bool =
  helperCount < 2 implies not(homeHelperSetAllowed(helperCount, false))
```

## Story: Review a private home-help plan with a fixed roster

> As a member, I want staff to review the exact help I need and who can help before anyone is contacted.

### A moving-help offer comes from its own eligible member

An eligible adult can add or withdraw a moving-help offer in their signed conversation. Only their express choice creates the offer. A skill or a match prediction gives no permission to nominate them.

```quint
pure def homeHelpOfferChangeAllowed(eligibleAdultOwner: bool, explicitChoice: bool): bool = eligibleAdultOwner and explicitChoice
```

### Intake keeps only structured home-help details after considering a service

Record a confirmed task from the supported moving-help vocabulary, a coarse neighborhood, an exact time window, and the estimated minutes of help. The estimated minutes are more than zero and fit in the time window. Record why a service could not solve the task. Store the app, requester, and expiry. Keep street addresses, free text, service links, and messages out of the plan. The review deadline cannot be later than the start of the task.

```quint
type HomeHelpTask = MoveFurniture | CarryBoxes
type HomeHelpAlternative = NoSuitableService | ServiceUnavailable | MemberDeclinedService
type HomeHelpPhase = NotSubmitted | AwaitingHelpers | AwaitingReview | Approved | Closed
type HomeHelpPlan = { phase: HomeHelpPhase, revision: int, expiresAt: int, rosterKey: str }

pure val initial: HomeHelpPlan = { phase: NotSubmitted, revision: 0, expiresAt: 0, rosterKey: "" }

pure def homeHelpTaskKnown(task: str): bool = task == "MoveFurniture" or task == "CarryBoxes"

pure def homeHelpAlternativeKnown(alternative: str): bool =
  alternative == "NoSuitableService" or alternative == "ServiceUnavailable" or alternative == "MemberDeclinedService"

pure def homeHelpDraftAllowed(ownerEligible: bool, detailsConfirmed: bool, knownArea: bool, alternativeChecked: bool,
  now: int, expiresAt: int, startsAt: int, endsAt: int, effortMinutes: int): bool =
  ownerEligible and detailsConfirmed and knownArea and alternativeChecked and now < expiresAt and expiresAt <= startsAt
  and startsAt < endsAt and effortMinutes > 0 and effortMinutes * 60000 <= endsAt - startsAt

pure def canSubmitHomeHelp(plan: HomeHelpPlan, draftAllowed: bool, expiresAt: int): bool =
  plan.phase == NotSubmitted and draftAllowed and expiresAt > 0

pure def submitHomeHelp(plan: HomeHelpPlan, draftAllowed: bool, expiresAt: int): HomeHelpPlan =
  { phase: AwaitingHelpers, revision: 1, expiresAt: expiresAt, rosterKey: "" }

pure def homeHelpOpen(plan: HomeHelpPlan, now: int): bool =
  (plan.phase == AwaitingHelpers or plan.phase == AwaitingReview or plan.phase == Approved) and now < plan.expiresAt

pure def alwaysSubmittedHomeHelpHasDeadline(plan: HomeHelpPlan): bool =
  plan.phase != NotSubmitted implies plan.revision > 0 and plan.expiresAt > 0
```

### Fix the roster before review and recheck it at approval

Before asking a person, save the exact helper roster for staff review. A roster has at most three helpers. The owner and distinct helpers must be eligible for the task, time and format, and a singleton must have met the owner before. Safety staff in this app can approve only the current revision and the exact roster they reviewed. Audit each staff read and decision before returning it. At approval, check the roster again. Replacing a helper or changing the task, time, or area requires a new revision and fresh approval. A revision can shorten the deadline without extending it.

```quint
pure def homeHelpRosterAllowed(helperCount: int, knownSingleton: bool, currentEligibility: bool): bool =
  helperCount <= 3 and homeHelperSetAllowed(helperCount, knownSingleton) and currentEligibility

pure def canSetHomeHelpRoster(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, rosterAllowed: bool): bool =
  homeHelpOpen(plan, now) and revision == plan.revision and rosterAllowed and rosterKey != "" and rosterKey != plan.rosterKey

pure def setHomeHelpRoster(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, rosterAllowed: bool): HomeHelpPlan =
  { ...plan, phase: AwaitingReview, revision: plan.revision + 1, rosterKey: rosterKey }

pure def canReviseHomeHelp(plan: HomeHelpPlan, now: int, revision: int, draftAllowed: bool, expiresAt: int): bool =
  homeHelpOpen(plan, now) and revision == plan.revision and draftAllowed and expiresAt > 0 and now < expiresAt and expiresAt <= plan.expiresAt

pure def reviseHomeHelp(plan: HomeHelpPlan, now: int, revision: int, draftAllowed: bool, expiresAt: int): HomeHelpPlan =
  { phase: AwaitingHelpers, revision: plan.revision + 1, expiresAt: expiresAt, rosterKey: "" }

pure def homeHelpRevisionMatches(plan: HomeHelpPlan, revision: int, rosterKey: str): bool =
  revision == plan.revision and rosterKey != "" and rosterKey == plan.rosterKey

pure def canApproveHomeHelp(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, reviewerAuthorized: bool, rosterAllowed: bool): bool =
  plan.phase == AwaitingReview and homeHelpOpen(plan, now) and reviewerAuthorized and rosterAllowed
  and homeHelpRevisionMatches(plan, revision, rosterKey)

pure def approveHomeHelp(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, reviewerAuthorized: bool, rosterAllowed: bool): HomeHelpPlan =
  { ...plan, phase: Approved }

pure def homeHelpApprovalCurrent(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, rosterAllowed: bool): bool =
  plan.phase == Approved and homeHelpOpen(plan, now) and rosterAllowed and homeHelpRevisionMatches(plan, revision, rosterKey)

pure def lawHomeHelpApprovalNeedsExactRoster(plan: HomeHelpPlan, now: int, revision: int, rosterKey: str, rosterAllowed: bool): bool =
  homeHelpApprovalCurrent(plan, now, revision, rosterKey, rosterAllowed) implies homeHelpRevisionMatches(plan, revision, rosterKey)

pure def stepHomeHelpRevisionClearsApproval(before: HomeHelpPlan, after: HomeHelpPlan): bool =
  after.revision > before.revision implies after.phase != Approved

pure def alwaysHomeHelpReviewHasFixedRoster(plan: HomeHelpPlan): bool =
  (plan.phase == AwaitingReview or plan.phase == Approved) iff plan.rosterKey != ""
```

### Closure and expiry end authority for this plan

Only the owner or an authorized reviewer can close a current revision. Expiry also ends its authority. A closed or expired plan cannot approve or authorize contact. A current approval records a staff decision. It does not contact a person or release a private location.

```quint
pure def canCloseHomeHelp(plan: HomeHelpPlan, now: int, revision: int, authorized: bool): bool =
  homeHelpOpen(plan, now) and revision == plan.revision and authorized

pure def closeHomeHelp(plan: HomeHelpPlan, now: int, revision: int, authorized: bool): HomeHelpPlan =
  { ...plan, phase: Closed, rosterKey: "" }

pure def canExpireHomeHelp(plan: HomeHelpPlan, now: int): bool =
  (plan.phase == AwaitingHelpers or plan.phase == AwaitingReview or plan.phase == Approved) and now >= plan.expiresAt

pure def expireHomeHelp(plan: HomeHelpPlan, now: int): HomeHelpPlan =
  { ...plan, phase: Closed, rosterKey: "" }

pure def lawExpiredHomeHelpHasNoApproval(plan: HomeHelpPlan, revision: int, rosterKey: str, rosterAllowed: bool): bool =
  not(homeHelpApprovalCurrent(plan, plan.expiresAt, revision, rosterKey, rosterAllowed))

pure def stepClosedHomeHelpStaysClosed(before: HomeHelpPlan, after: HomeHelpPlan): bool =
  before.phase == Closed implies after.phase == Closed

pure def sometimesHomeHelpCanReachReview(plan: HomeHelpPlan): bool = plan.phase == AwaitingReview
pure def sometimesHomeHelpCanBeApproved(plan: HomeHelpPlan): bool = plan.phase == Approved
```
