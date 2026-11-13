# Join through the shared text line

The service parses the sender's text, reads the app and pending records and applies the effective age policy. The generated transitions select the routing, join and enrollment actions. The service retains its phone lock, database writes, consent events and send controls.

## Story: Text the Network to join an app

> As a person starting a conversation, I want my app choice, age and pending answers to reach the correct app.

### Dedicated lines and explicit app choices take priority

An explicit routing override or registered receiving line selects its own app. On the shared line an explicit saved-profile read for an app takes priority over an app keyword. Otherwise inspect pending join and current memberships.

```quint
type RoutePhase = AwaitingExplicitRoute | AwaitingFallbackRoute | DedicatedRoute | ExplicitRoute | PendingJoinRoute | OpenItemRoute | RecentAppRoute | DefaultNetworkRoute
type TextRoute = { phase: RoutePhase }
type ExplicitFacts = { dedicated: bool, profileApp: bool, appKeyword: bool }
pure val initialRoute: TextRoute = { phase: AwaitingExplicitRoute }

pure def checkExplicitRoute(routing: TextRoute, explicitFacts: ExplicitFacts): TextRoute =
  if (routing.phase != AwaitingExplicitRoute) routing
  else if (explicitFacts.dedicated) { phase: DedicatedRoute }
  else if (explicitFacts.profileApp or explicitFacts.appKeyword) { phase: ExplicitRoute }
  else { phase: AwaitingFallbackRoute }
```

### A pending join routes only a possible join answer

Use a pending join for an app the sender has yet to join when the sender belongs to no app or the answer has an age. Otherwise use the newest open item, then the last app to contact the sender, then The Network. Use only pending fields from the routed app.

```quint
type FallbackFacts = { hasPendingJoin: bool, alreadyInPendingApp: bool, hasMembership: bool, answerHasAge: bool, hasOpenItem: bool }
pure def shouldReadPendingAnswer(hasPendingJoin: bool, alreadyInPendingApp: bool, hasMembership: bool): bool =
  hasPendingJoin and not(alreadyInPendingApp) and hasMembership
pure def checkFallbackRoute(routing: TextRoute, fallbackFacts: FallbackFacts): TextRoute =
  if (routing.phase != AwaitingFallbackRoute) routing
  else if (fallbackFacts.hasPendingJoin and not(fallbackFacts.alreadyInPendingApp) and
           (not(fallbackFacts.hasMembership) or fallbackFacts.answerHasAge)) { phase: PendingJoinRoute }
  else if (fallbackFacts.hasOpenItem) { phase: OpenItemRoute }
  else if (fallbackFacts.hasMembership) { phase: RecentAppRoute }
  else { phase: DefaultNetworkRoute }

pure def pendingMatchesApp(pendingApp: str, routedApp: str): bool = pendingApp == routedApp
```

### A join needs permission to enter this app

A banned number or person cannot join. An invite-only app requires an invitation except The Network's shared-line intake. Other join modes may proceed.

```quint
type JoinPhase = AwaitingBan | JoinHeld | AwaitingInvite | InviteRequired | AwaitingAnswer | AskForAge | AskForHome |
  AwaitingJoinAge | RefuseAge | AskForName | AwaitingMember | AwaitingWelcome | JoinedWaitlist | JoinedWithShare |
  JoinedWithLookingFor | JoinedWithoutFollowUp
type TextJoin = { phase: JoinPhase, ageAllowed: bool, hasName: bool, invalidHome: bool }
pure val initial: TextJoin = { phase: AwaitingBan, ageAllowed: false, hasName: false, invalidHome: false }

pure def canCheckJoinBan(joining: TextJoin): bool = joining.phase == AwaitingBan
pure def checkJoinBan(joining: TextJoin, banned: bool): TextJoin =
  { ...joining, phase: if (banned) JoinHeld else AwaitingInvite }

pure def canCheckInvitation(joining: TextJoin): bool = joining.phase == AwaitingInvite
pure def checkInvitation(joining: TextJoin, inviteOnly: bool, invited: bool, sharedNetwork: bool): TextJoin =
  { ...joining, phase: if (inviteOnly and not(invited) and not(sharedNetwork)) InviteRequired else AwaitingAnswer }
```

### Confirm age before creating a member

Combine the new reply with the same app's pending fields. Ask for age when it is absent, and request a corrected home when the answer supplied an unsupported one. When the age is present, apply the existing lowest-age rule before asking for name or home. A failed age records the age floor and drops the pending join. Name and a supported or omitted home are needed before writing the membership.

```quint
type JoinAnswerFacts = { hasAge: bool, hasName: bool, invalidHome: bool }
pure val completedAnswer: JoinAnswerFacts = { hasAge: true, hasName: true, invalidHome: false }
pure val answerFactsValues = Set(
  completedAnswer, { ...completedAnswer, hasAge: false }, { ...completedAnswer, hasName: false },
  { ...completedAnswer, invalidHome: true }, { ...completedAnswer, hasAge: false, invalidHome: true },
)
pure def canReadJoinAnswer(joining: TextJoin): bool = joining.phase == AwaitingAnswer
pure def readJoinAnswer(joining: TextJoin, answerFacts: JoinAnswerFacts): TextJoin =
  { ...joining, hasName: answerFacts.hasName, invalidHome: answerFacts.invalidHome,
    phase: if (answerFacts.hasAge) AwaitingJoinAge else if (answerFacts.invalidHome) AskForHome else AskForAge }

pure def canCheckTextJoinAge(joining: TextJoin): bool = joining.phase == AwaitingJoinAge
pure def checkTextJoinAge(joining: TextJoin, ageAllowed: bool): TextJoin =
  { ...joining, ageAllowed: ageAllowed,
    phase: if (not(ageAllowed)) RefuseAge else if (joining.invalidHome) AskForHome else if (joining.hasName) AwaitingMember else AskForName }
```

### An active membership gets its welcome and at most one follow-up

The service writes app consent and membership before it creates the runtime member. A waitlist ends after the membership write. An active member gets the normal welcome. If the person has another app, offer limited base-profile sharing without naming that app. Otherwise an uninvited shared-line Network join asks what the member is looking for.

```quint
pure def canRecordTextMembership(joining: TextJoin): bool =
  joining.phase == AwaitingMember and joining.ageAllowed and joining.hasName and not(joining.invalidHome)
pure def recordTextMembership(joining: TextJoin, membershipActive: bool): TextJoin =
  { ...joining, phase: if (membershipActive) AwaitingWelcome else JoinedWaitlist }

pure def canRecordWelcome(joining: TextJoin): bool =
  joining.phase == AwaitingWelcome and joining.ageAllowed and joining.hasName and not(joining.invalidHome)
pure def recordWelcome(joining: TextJoin, hasOtherApp: bool, sharedNetwork: bool, invited: bool): TextJoin =
  { ...joining, phase: if (hasOtherApp) JoinedWithShare
             else if (sharedNetwork and not(invited)) JoinedWithLookingFor
             else JoinedWithoutFollowUp }

pure def alwaysMembershipRequiresCompletedEligibleAnswer(joining: TextJoin): bool =
  (joining.phase == AwaitingMember or joining.phase == AwaitingWelcome or joining.phase == JoinedWaitlist or
   joining.phase == JoinedWithShare or joining.phase == JoinedWithLookingFor or joining.phase == JoinedWithoutFollowUp) implies
    (joining.ageAllowed and joining.hasName and not(joining.invalidHome))

pure def sometimesAsksAge(joining: TextJoin): bool = joining.phase == AskForAge
pure def sometimesRefusesAge(joining: TextJoin): bool = joining.phase == RefuseAge
pure def sometimesAsksWhatTheyWant(joining: TextJoin): bool = joining.phase == JoinedWithLookingFor
```

## Story: Choose other apps from The Network

> As a Network member, I want the shared agent to enroll me only in the apps I name and can join.

### A current Network member's answer controls other-app enrollment

Handle an eligible answer to the pending question only if it names a running app other than The Network. Recheck the person, Network membership and ban before acting. Process each named app separately. Slop requires adult eligibility in this path even if an underage member could join it directly. An existing membership can be acknowledged. Otherwise enforce that app's join age before writing the app membership and its own consent.

```quint
type OtherAppOutcome = SkipOtherApp | KeepOtherApp | CreateOtherApp
pure def shouldReadLookingFor(hasKeyword: bool, profileRead: bool, isNetwork: bool): bool =
  not(hasKeyword or profileRead) and isNetwork
pure def namedOtherApp(appName: str, running: bool): bool = appName != "ntwrk" and running
pure def networkEnrollmentAllowed(hasPerson: bool, hasNetworkMembership: bool, banned: bool): bool =
  hasPerson and hasNetworkMembership and not(banned)
pure def otherAppAllowed(appName: str, adult: bool): bool = appName != "slop" or adult
pure def otherAppEnrollment(existingMember: bool, ageEligible: bool): OtherAppOutcome =
  if (existingMember) KeepOtherApp else if (ageEligible) CreateOtherApp else SkipOtherApp
pure def lawSlopEnrollmentRequiresAdult(adult: bool): bool =
  otherAppAllowed("slop", adult) implies adult
```

### A first-contact notice cannot substitute for enrollment

The notice is available only in the signed turn for a nonmember number that is not banned. A known underage floor or refused age prevents the notice. The existing unique write allows at most one notice per phone and the failure handler removes a notice that could not complete.

```quint
pure def noticeAllowed(joinAgeAllowed: bool, ageFloorAllowed: bool): bool =
  joinAgeAllowed and ageFloorAllowed
```
