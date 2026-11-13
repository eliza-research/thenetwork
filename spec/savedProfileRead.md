# Saved profile reads

The shared line can answer an explicit request for the sender's own saved profile. A read uses existing membership and consent. It never saves profile fields or advances onboarding. The shell recognizes text, resolves the app and current membership, and renders the authorized result. The model receives only the facts needed to decide.

## Story: Read my saved profile

> As a member, I want to read what I already saved in this app without restarting onboarding.

### An ordinary turn starts without a profile read

Carrier keywords and assistant turns use their existing path. The shared-line shell classifies an eligible turn before it looks up profile read authority.

```quint
type ReadIntent = OrdinaryTurn | OwnRead | NamedRead | UnclearRead | OtherProfile
type ReadPhase = Unclassified | AwaitingAuthority | UseConversation | StaySilent | AskWhichApp | RefuseOtherProfile | DifferentAppLine | ShowOwnProfile
type ReadFacts = {
  readForm: bool,
  namesProfile: bool,
  asksChange: bool,
  ownSubject: bool,
  endsWithProfile: bool,
  hasAppName: bool,
  appKnown: bool,
}
type ProfileRead = {
  phase: ReadPhase,
  intent: ReadIntent,
  sameMember: bool,
  optedOut: bool,
  requestedAppMatches: bool,
}

pure val initial: ProfileRead = {
  phase: Unclassified, intent: OrdinaryTurn, sameMember: false, optedOut: false, requestedAppMatches: false,
}
```

### Only explicit read requests enter the read path

A message that lacks a profile-read form, lacks the word profile, or asks for a change continues the normal turn. A read of another profile enters the refusal path. An incomplete own-profile request or an unrecognized app name needs clarification. An explicit recognized app is available for routing on the shared line. A dedicated line still keeps its own app.

```quint
pure def readIntent(facts: ReadFacts): ReadIntent =
  if (not(facts.readForm) or not(facts.namesProfile) or facts.asksChange) OrdinaryTurn
  else if (not(facts.ownSubject)) OtherProfile
  else if (not(facts.endsWithProfile)) UnclearRead
  else if (not(facts.hasAppName)) OwnRead
  else if (facts.appKnown) NamedRead
  else UnclearRead

pure def canClassifyRead(request: ProfileRead): bool = request.phase == Unclassified

pure def classifyRead(request: ProfileRead, facts: ReadFacts): ProfileRead =
  val intent = readIntent(facts)
  { ...request, intent: intent, phase: if (intent == OrdinaryTurn) UseConversation else AwaitingAuthority }

pure def lawAChangeIsAnOrdinaryTurn(facts: ReadFacts): bool =
  facts.asksChange implies readIntent(facts) == OrdinaryTurn
```

### Simulation covers the distinct read forms

Use representative cases for an ordinary turn, an explicit change, an own profile, a known app, an unknown app, an incomplete read and another person's profile.

```quint
pure val ownProfileFacts: ReadFacts = {
  readForm: true, namesProfile: true, asksChange: false, ownSubject: true,
  endsWithProfile: true, hasAppName: false, appKnown: false,
}
pure val factsValues = Set(
  ownProfileFacts,
  { ...ownProfileFacts, readForm: false },
  { ...ownProfileFacts, namesProfile: false },
  { ...ownProfileFacts, asksChange: true },
  { ...ownProfileFacts, hasAppName: true, appKnown: true },
  { ...ownProfileFacts, hasAppName: true },
  { ...ownProfileFacts, endsWithProfile: false },
  { ...ownProfileFacts, ownSubject: false },
)
```

### Current membership and consent authorize a reply

Recheck authority inside the routed member unit. A reply requires that the sender has an active membership with the member ID of that unit and has not opted out. Without that authority the read is handled silently. An authorized request for another profile receives a refusal, an ambiguous request gets a clarification, and a named request for another app on a dedicated line gets the line's app notice. Only an authorized, unambiguous read of this app may show saved fields.

```quint
pure def canResolveRead(request: ProfileRead): bool = request.phase == AwaitingAuthority

pure def resolveRead(request: ProfileRead, sameMember: bool, optedOut: bool, requestedAppMatches: bool): ProfileRead =
  val phase =
    if (not(sameMember) or optedOut) StaySilent
    else if (request.intent == OtherProfile) RefuseOtherProfile
    else if (request.intent == UnclearRead) AskWhichApp
    else if (request.intent == OwnRead) ShowOwnProfile
    else if (request.intent == NamedRead) (if (requestedAppMatches) ShowOwnProfile else DifferentAppLine)
    else StaySilent
  { ...request, phase: phase, sameMember: sameMember, optedOut: optedOut, requestedAppMatches: requestedAppMatches }
```

### Only the sender's saved profile for the routed app is shown

Showing saved fields requires a current match between the sender's active member and the member unit. It also requires active messaging permission and either an unnamed own read or an explicit read of the routed app.

```quint
pure def alwaysOnlyOwnProfileShown(request: ProfileRead): bool =
  request.phase == ShowOwnProfile implies
    (request.sameMember and not(request.optedOut) and
      (request.intent == OwnRead or (request.intent == NamedRead and request.requestedAppMatches)))

pure def alwaysNoReadReplyWithoutAuthority(request: ProfileRead): bool =
  (request.phase == ShowOwnProfile or request.phase == AskWhichApp or
    request.phase == RefuseOtherProfile or request.phase == DifferentAppLine) implies
    (request.sameMember and not(request.optedOut))
```

### The read can complete, refuse, clarify or remain silent

An authorized member can get their own profile. An unclear request can receive a clarification, a different person's profile gets a refusal, a different app on a dedicated line gets the line notice, and a stopped or unknown member remains silent.

```quint
pure def sometimesShowsOwnProfile(request: ProfileRead): bool = request.phase == ShowOwnProfile
pure def sometimesAsksWhichApp(request: ProfileRead): bool = request.phase == AskWhichApp
pure def sometimesRefusesOtherProfile(request: ProfileRead): bool = request.phase == RefuseOtherProfile
pure def sometimesIdentifiesDifferentLine(request: ProfileRead): bool = request.phase == DifferentAppLine
pure def sometimesStaysSilent(request: ProfileRead): bool = request.phase == StaySilent
```
