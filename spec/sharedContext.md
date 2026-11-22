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

The first name and home city must pass the normal output check. A fact must belong to the member, be shareable, be confirmed, contain no sensitive information, and be current. Check the fact's text before including it. Withhold the entire context when more than fifty facts remain or one exceeds three hundred UTF-16 code units.

```quint
pure val contextFacetLimit: int = 50
pure val contextFacetSizeLimit: int = 300

pure def canCheckLabels(context: SharedContext): bool = context.phase == CheckingLabels
pure def checkLabels(context: SharedContext, labelsSafe: bool): SharedContext =
  { phase: if (labelsSafe) CheckingFacets else Withheld }

pure def contextFacetEligible(own: bool, shareable: bool, confirmed: bool, sensitive: bool, withinValidity: bool): bool =
  own and shareable and confirmed and not(sensitive) and withinValidity

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
