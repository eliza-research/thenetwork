# Project a member's context for their agent

The [signed turn model](models/turn_consent.md) covers the gateway and current consent. This module decides when a network runtime can provide a member's context. The runtime keeps its store lock, refreshes the snapshot, reads canonical membership, and checks outgoing text for leaks.

## Story: Let my agent read the safe context for my current account

> As a member, I want my conversation agent to use the current participation state and only the facts I approved for sharing.

### Only the canonical member of the requested app can receive context

Require a current phone address and an account service. Check that the active membership belongs to the requested member. The refreshed snapshot and canonical row must both contain that member. An active participation window supplies its state and bounds. Otherwise map normal, open, or receiving to open, quiet to busy, and paused to paused. Context is unavailable for an unsupported state.

```quint
type ContextPhase = CheckingAccount | CheckingMembership | CheckingMember | CheckingLabels | CheckingFacets | ContextReady | Withheld
type SharedContext = { phase: ContextPhase }
type ContextMode = ModeOpen | ModeBusy | ModeTraveling | ModePaused | ModeUnavailable

pure val initial: SharedContext = { phase: CheckingAccount }

pure def contextMode(windowActive: bool, windowMode: str, baseMode: str): ContextMode =
  if (windowActive) {
    if (windowMode == "open") ModeOpen
    else if (windowMode == "busy") ModeBusy
    else if (windowMode == "traveling") ModeTraveling
    else if (windowMode == "paused") ModePaused
    else ModeUnavailable
  } else if (baseMode == "normal" or baseMode == "open" or baseMode == "receiving") ModeOpen
  else if (baseMode == "quiet") ModeBusy
  else if (baseMode == "paused") ModePaused
  else ModeUnavailable

pure def canCheckAccount(context: SharedContext): bool = context.phase == CheckingAccount
pure def checkAccount(context: SharedContext, canReadAccount: bool): SharedContext =
  { phase: if (canReadAccount) CheckingMembership else Withheld }

pure def canCheckMembership(context: SharedContext): bool = context.phase == CheckingMembership
pure def checkMembership(context: SharedContext, exactMember: bool): SharedContext =
  { phase: if (exactMember) CheckingMember else Withheld }

pure def canCheckMember(context: SharedContext): bool = context.phase == CheckingMember
pure def checkMember(context: SharedContext, memberAndModeExist: bool): SharedContext =
  { phase: if (memberAndModeExist) CheckingLabels else Withheld }
```

### Check the public labels and each confirmed shareable fact

The first name and home city must pass the normal output check. A fact must belong to the member, be shareable, be confirmed, contain no sensitive information, and be current. Check the fact's text before including it. Leave out a fact longer than three hundred UTF-16 code units and never truncate a fact. Of the facts that remain, keep the fifty newest (by observation time, then valid-from time, then ID). The facet check withholds the context only if the kept facts still break a limit. Changed on 2026-11-17 (audit SHA40): before, more than fifty facts or one long fact withheld the whole context, and a member with many job postings got no answer on the shared line.

```quint
pure val contextFacetLimit: int = 50
pure val contextFacetSizeLimit: int = 300

pure def canCheckLabels(context: SharedContext): bool = context.phase == CheckingLabels
pure def checkLabels(context: SharedContext, labelsSafe: bool): SharedContext =
  { phase: if (labelsSafe) CheckingFacets else Withheld }

pure def contextFacetEligible(own: bool, shareable: bool, confirmed: bool, sensitive: bool, withinValidity: bool): bool =
  own and shareable and confirmed and not(sensitive) and withinValidity

pure def contextFacetKept(rank: int, textSize: int): bool =
  rank >= 0 and rank < contextFacetLimit and textSize <= contextFacetSizeLimit

pure def lawKeptFactsFitTheLimits(rank: int, textSize: int): bool =
  contextFacetKept(rank, textSize) implies (rank < contextFacetLimit and textSize <= contextFacetSizeLimit)

pure def canCheckFacets(context: SharedContext): bool = context.phase == CheckingFacets
pure def checkFacets(context: SharedContext, facetCount: int, oversized: bool): SharedContext =
  { phase: if (facetCount <= contextFacetLimit and not(oversized)) ContextReady else Withheld }

pure def stepContextRequiresFacetChecks(before: SharedContext, via: str, after: SharedContext): bool =
  after.phase == ContextReady implies (before.phase == CheckingFacets and via == "checkFacets")

pure def sometimesCanReturnContext(context: SharedContext): bool = context.phase == ContextReady
```

### Matching context requires local presence and eligible age

Use single-player context if the member is away from the city for this matching window or is ineligible by their lowest known age. The runtime supplies the existing presence and age checks.

```quint
pure def contextSinglePlayer(present: bool, ageEligible: bool): bool = not(present and ageEligible)

pure def lawIneligibleAgeIsSinglePlayer(present: bool): bool = contextSinglePlayer(present, false)
```

### Active items list only the member's live matches with a safe summary

An active item is one live match of the member: a two-person match in which both members said yes and that is not closed. Offer it only while the member is eligible to be matched by their lowest known age, and only when its summary passes the output check. The summary names only the other member's first name, which both members learn after the mutual yes. Offer at most twenty items, newest first. With no item to offer, the context has no list. New rule: the context never offered active items, so a relay could not name its match (audit SHA38).

```quint
pure val contextActiveItemLimit: int = 20

pure def contextMatchItemShown(liveMatch: bool, ageEligible: bool, summarySafe: bool): bool =
  liveMatch and ageEligible and summarySafe

pure def contextActiveItemCount(shownMatches: int): int =
  if (shownMatches < 0) 0 else if (shownMatches > contextActiveItemLimit) contextActiveItemLimit else shownMatches

pure def lawActiveItemsAtMostTwenty(shownMatches: int): bool =
  contextActiveItemCount(shownMatches) >= 0 and contextActiveItemCount(shownMatches) <= contextActiveItemLimit

pure def lawIneligibleAgeGetsNoActiveItem(liveMatch: bool, summarySafe: bool): bool =
  not(contextMatchItemShown(liveMatch, false, summarySafe))
```

### Active item summaries are distinct

Two offered items never carry the same summary, so the agent never has to guess between two matches. The shell counts, among the member's live matches, the matches whose other member has the same first name, and the matches that also have the same day label. The day label is "meeting" and the day of the planned meeting, or "introduced" and the day of the introduction when no meeting is planned, in New York time (every network is in New York); both members know it. A first name that no other live match has is the whole summary. A shared first name adds the day label. When the first name and the day label are both shared, the shell leaves those items out, and a relay without an item gets the "which match" question. New rule: two live matches with the same first name got the same summary, so the agent could pick the wrong match (review of audit SHA38).

```quint
type ContextItemLabel = ItemLabelName | ItemLabelNameAndDay | ItemLabelLeftOut

pure def contextItemLabel(sameName: int, sameNameAndDay: int): ContextItemLabel =
  if (sameName <= 1) ItemLabelName
  else if (sameNameAndDay <= 1) ItemLabelNameAndDay
  else ItemLabelLeftOut

pure def lawNameAloneOnlyWhenTheNameIsUnique(sameName: int, sameNameAndDay: int): bool =
  contextItemLabel(sameName, sameNameAndDay) == ItemLabelName implies sameName <= 1

pure def lawDayLabelOnlyWhenNameAndDayAreUnique(sameName: int, sameNameAndDay: int): bool =
  contextItemLabel(sameName, sameNameAndDay) == ItemLabelNameAndDay implies (sameName > 1 and sameNameAndDay <= 1)
```

### A member whose context is unavailable still gets an answer

When a member's message would open a conversation but their context is unavailable, the turn answers as handled with one fixed reply that says the Network cannot help with that right now. The shared line never stays silent for a member. Added on 2026-11-17 (audit SHA40): before, the turn answered handled with no reply and the gateway called no model.

```quint
type OpenTurnAnswer = AnswerOpen | AnswerUnavailable

pure def openTurnAnswer(contextAvailable: bool): OpenTurnAnswer =
  if (contextAvailable) AnswerOpen else AnswerUnavailable

pure def lawUnavailableContextStillAnswers(contextAvailable: bool): bool =
  (openTurnAnswer(contextAvailable) == AnswerUnavailable) == not(contextAvailable)
```
