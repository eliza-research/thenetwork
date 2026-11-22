# Join through the shared text line

The service parses the sender's text, reads the app and pending records and applies the effective age policy. The generated transitions select the routing, join and enrollment actions. The service retains its phone lock, database writes, consent events and send controls. A first-contact notice writes no membership: the service runs the normal join flow after it. The service records the one-time notice key for a phone only when it commits a completed response that contains the notice.

## Story: Text the Network to join an app

> As a person starting a conversation, I want my app choice, age and pending answers to reach the correct app.

### Dedicated lines and explicit app choices take priority

An explicit routing override or registered receiving line selects its own app. On the shared line an explicit saved-profile read takes priority over an invitation feedback reply, which takes priority over an app keyword. Otherwise inspect any pending join and current memberships.

```quint
type RoutePhase = AwaitingExplicitRoute | AwaitingFallbackRoute | DedicatedRoute | ProfileRoute | SurveyRoute | KeywordRoute |
  SafetyRoute | PendingJoinRoute | OpenItemRoute | RecentAppRoute | DefaultNetworkRoute
type TextRoute = { phase: RoutePhase }
type ExplicitFacts = { dedicated: bool, profileApp: bool, surveyApp: bool, appKeyword: bool }
pure val initialRoute: TextRoute = { phase: AwaitingExplicitRoute }

pure def checkExplicitRoute(routing: TextRoute, explicitFacts: ExplicitFacts): TextRoute =
  if (routing.phase != AwaitingExplicitRoute) routing
  else if (explicitFacts.dedicated) { phase: DedicatedRoute }
  else if (explicitFacts.profileApp) { phase: ProfileRoute }
  else if (explicitFacts.surveyApp) { phase: SurveyRoute }
  else if (explicitFacts.appKeyword) { phase: KeywordRoute }
  else { phase: AwaitingFallbackRoute }

pure def lawDedicatedLineTakesPrecedence(profileApp: bool, surveyApp: bool, appKeyword: bool): bool =
  checkExplicitRoute(initialRoute, { dedicated: true, profileApp: profileApp, surveyApp: surveyApp, appKeyword: appKeyword }).phase == DedicatedRoute

pure def lawProfileReadTakesPrecedence(surveyApp: bool, appKeyword: bool): bool =
  checkExplicitRoute(initialRoute, { dedicated: false, profileApp: true, surveyApp: surveyApp, appKeyword: appKeyword }).phase == ProfileRoute

pure def lawSurveyReplyTakesPrecedence(appKeyword: bool): bool =
  checkExplicitRoute(initialRoute, { dedicated: false, profileApp: false, surveyApp: true, appKeyword: appKeyword }).phase == SurveyRoute
```

### A prepared Peon signup names its app on a separate first line

The Peon skill's one prepared text starts with exactly `join peon` on its own line, followed by the approved profile. The shared line takes this as an explicit Peon choice when the text has a profile after the first line. The message still goes through normal text enrollment and consent checks. A Peon mention elsewhere in a message does not select the app. Existing standalone keywords and dedicated lines keep their routing rules.

```quint
pure val preparedPeonTextHeader = "join peon"
pure val headerValues = Set(preparedPeonTextHeader, "peon", "I plan to join peon", "")

pure def preparedPeonTextNamesApp(header: str, profilePresent: bool): bool =
  header == preparedPeonTextHeader and profilePresent

pure def lawPreparedPeonTextRequiresExplicitHeader(header: str, profilePresent: bool): bool =
  preparedPeonTextNamesApp(header, profilePresent) iff (header == preparedPeonTextHeader and profilePresent)
```

### A pending join routes only a possible join answer

After a safety claim, use a pending join for an app the sender has yet to join when the sender belongs to no app or the answer has an age. Otherwise use the newest open item, then the last app to contact the sender, then The Network. The shell parses the answer for an age only when the sender has a pending join for an app they have yet to join and already belongs to an app, and it parses the answer before it asks for a safety claim, so that a join answer with an age is never taken as an answer to "Who do you mean?". Use only pending fields from the routed app. Changed on 2026-11-22 (review of SD-250): the safety claim is now its own rule below, and the age reading comes first, because a short join answer such as "Kit, 29" for a third app went to a waiting "Who do you mean?" question.

```quint
type FallbackFacts = { safetyClaim: bool, hasPendingJoin: bool, alreadyInPendingApp: bool, hasMembership: bool, answerHasAge: bool, hasOpenItem: bool }
pure def shouldReadPendingAnswer(hasPendingJoin: bool, alreadyInPendingApp: bool, hasMembership: bool): bool =
  hasPendingJoin and not(alreadyInPendingApp) and hasMembership
pure def checkFallbackRoute(routing: TextRoute, fallbackFacts: FallbackFacts): TextRoute =
  if (routing.phase != AwaitingFallbackRoute) routing
  else if (fallbackFacts.safetyClaim) { phase: SafetyRoute }
  else if (fallbackFacts.hasPendingJoin and not(fallbackFacts.alreadyInPendingApp) and
           (not(fallbackFacts.hasMembership) or fallbackFacts.answerHasAge)) { phase: PendingJoinRoute }
  else if (fallbackFacts.hasOpenItem) { phase: OpenItemRoute }
  else if (fallbackFacts.hasMembership) { phase: RecentAppRoute }
  else { phase: DefaultNetworkRoute }

pure def pendingMatchesApp(pendingApp: str, routedApp: str): bool = pendingApp == routedApp
```

### A safety claim routes before every other fallback

A block, a report or an answer to "Who do you mean?" that an app claims under the [shared-line routing](lineRouting.md) rule goes to that app, before a pending join, an open item or the last app to contact the sender. A dedicated line, a profile read, a survey reply and an app keyword still come first. Changed on 2026-11-22 (audit SD-250 and W3-220): before, there was no safety claim, so a report went to the app with the newest open item and found nobody when the member met the person in another app; the claim now has its own rule so that each rule checks one thing.

```quint
pure def lawSafetyClaimRoutesFirst(hasPendingJoin: bool, alreadyInPendingApp: bool, hasMembership: bool, answerHasAge: bool,
    hasOpenItem: bool): bool =
  checkFallbackRoute({ phase: AwaitingFallbackRoute }, { safetyClaim: true, hasPendingJoin: hasPendingJoin,
    alreadyInPendingApp: alreadyInPendingApp, hasMembership: hasMembership, answerHasAge: answerHasAge,
    hasOpenItem: hasOpenItem }).phase == SafetyRoute

pure def lawExplicitRouteKeepsSafetyClaimOut(dedicated: bool, profileApp: bool, surveyApp: bool, appKeyword: bool): bool =
  (dedicated or profileApp or surveyApp or appKeyword) implies
    checkFallbackRoute(checkExplicitRoute(initialRoute, { dedicated: dedicated, profileApp: profileApp, surveyApp: surveyApp,
      appKeyword: appKeyword }), { safetyClaim: true, hasPendingJoin: false, alreadyInPendingApp: false, hasMembership: true,
      answerHasAge: false, hasOpenItem: false }).phase != SafetyRoute
```

### A join needs permission to enter this app

A banned number or person cannot join. An invite-only app requires an invitation except The Network's shared-line intake. Other join modes may proceed. An answer refused for want of an invitation stores nothing for this app, but an age it states is still recorded at once on the number's age floor and on the person, if any, before the invite-only reply, because age is a person-level fact and the lowest stated age wins. Changed on 2026-11-21 (review of audit JA-1): before, "Sam 15" sent to an invite-only app was not recorded, so a later "Sam 25" to an open app joined a minor as an adult.

```quint
type JoinPhase = AwaitingBan | JoinHeld | AwaitingInvite | InviteRequired | AwaitingAnswer | AskForAge | AskForHome |
  AwaitingJoinAge | RefuseAge | AskForName | AwaitingMember | AwaitingWelcome | JoinedWaitlist | JoinedWithShare |
  JoinedWithLookingFor | JoinedWithoutFollowUp | AwaitingAgeRecord | AwaitingInviteAgeRecord
type TextJoin = { phase: JoinPhase, ageAllowed: bool, hasName: bool, invalidHome: bool, hasAge: bool, ageRecorded: bool,
  floorRefused: bool }
pure val initial: TextJoin = { phase: AwaitingBan, ageAllowed: false, hasName: false, invalidHome: false, hasAge: false,
  ageRecorded: false, floorRefused: false }

pure def canCheckJoinBan(joining: TextJoin): bool = joining.phase == AwaitingBan
pure def checkJoinBan(joining: TextJoin, banned: bool): TextJoin =
  { ...joining, phase: if (banned) JoinHeld else AwaitingInvite }

pure def canCheckInvitation(joining: TextJoin): bool = joining.phase == AwaitingInvite
pure def checkInvitation(joining: TextJoin, inviteOnly: bool, invited: bool, sharedNetwork: bool, hasAge: bool): TextJoin =
  if (inviteOnly and not(invited) and not(sharedNetwork))
    { ...joining, hasAge: hasAge, phase: if (hasAge) AwaitingInviteAgeRecord else InviteRequired }
  else { ...joining, phase: AwaitingAnswer }

pure def alwaysInviteRefusalKeepsStatedAge(joining: TextJoin): bool =
  (joining.phase == InviteRequired and joining.hasAge) implies joining.ageRecorded

pure def sometimesInviteRefusalRecordsAge(joining: TextJoin): bool =
  joining.phase == InviteRequired and joining.ageRecorded
```

### Confirm age before creating a member

Combine the new reply with the same app's pending fields. When an age is present, record it at once on the number's age floor and on the person, if any, before any other step, so that a missing name, an unsupported home or an expired pending join never loses it. Then apply the existing lowest-age rule before asking for name or home. When no age is present and the number's recorded lowest age is under this app's join age, decline kindly and drop the pending join. Otherwise ask for age, or request a corrected home when the answer supplied an unsupported one. A failed age, stated or recorded, also declines and drops the pending join. Name and a supported or omitted home are needed before writing the membership. Changed on 2026-11-21 (audit JA-1, JA-2 and JA-7): before, an age sent without a name was kept only on the pending join, which expires after a day, and an allowed age sent with an unsupported home was not kept at all, so a later older age joined a minor as an adult; a number with a recorded age under 13 that sent no age stored a pending join and was asked its age again.

```quint
type JoinAnswerFacts = { hasAge: bool, hasName: bool, invalidHome: bool, floorRefused: bool }
pure val completedAnswer: JoinAnswerFacts = { hasAge: true, hasName: true, invalidHome: false, floorRefused: false }
pure val answerFactsValues = Set(
  completedAnswer, { ...completedAnswer, hasAge: false }, { ...completedAnswer, hasName: false },
  { ...completedAnswer, invalidHome: true }, { ...completedAnswer, hasAge: false, invalidHome: true },
  { ...completedAnswer, floorRefused: true }, { ...completedAnswer, hasAge: false, floorRefused: true },
  { ...completedAnswer, hasAge: false, hasName: false, invalidHome: true, floorRefused: true },
)
pure def canReadJoinAnswer(joining: TextJoin): bool = joining.phase == AwaitingAnswer
pure def readJoinAnswer(joining: TextJoin, answerFacts: JoinAnswerFacts): TextJoin =
  { ...joining, hasName: answerFacts.hasName, invalidHome: answerFacts.invalidHome, hasAge: answerFacts.hasAge,
    floorRefused: answerFacts.floorRefused,
    phase: if (answerFacts.hasAge) AwaitingAgeRecord else if (answerFacts.floorRefused) RefuseAge
      else if (answerFacts.invalidHome) AskForHome else AskForAge }

pure def canRecordStatedAge(joining: TextJoin): bool =
  joining.phase == AwaitingAgeRecord or joining.phase == AwaitingInviteAgeRecord
pure def recordStatedAge(joining: TextJoin): TextJoin =
  { ...joining, ageRecorded: true, phase: if (joining.phase == AwaitingInviteAgeRecord) InviteRequired else AwaitingJoinAge }

pure def canCheckTextJoinAge(joining: TextJoin): bool = joining.phase == AwaitingJoinAge
pure def checkTextJoinAge(joining: TextJoin, ageAllowed: bool): TextJoin =
  { ...joining, ageAllowed: ageAllowed,
    phase: if (not(ageAllowed) or joining.floorRefused) RefuseAge else if (joining.invalidHome) AskForHome
      else if (joining.hasName) AwaitingMember else AskForName }

pure def joinAnswerSettled(phase: JoinPhase): bool =
  phase == AwaitingJoinAge or phase == RefuseAge or phase == AskForAge or phase == AskForHome or phase == AskForName or
  phase == AwaitingMember or phase == AwaitingWelcome or phase == JoinedWaitlist or phase == JoinedWithShare or
  phase == JoinedWithLookingFor or phase == JoinedWithoutFollowUp

pure def alwaysStatedAgeRecordedFirst(joining: TextJoin): bool =
  (joining.hasAge and joinAnswerSettled(joining.phase)) implies joining.ageRecorded

pure def alwaysRefusedFloorOnlyDeclines(joining: TextJoin): bool =
  (joining.floorRefused and joinAnswerSettled(joining.phase)) implies
    (joining.phase == RefuseAge or joining.phase == AwaitingJoinAge)

pure def sometimesRecordsStatedAge(joining: TextJoin): bool = joining.phase == AwaitingAgeRecord
pure def sometimesDeclinesRecordedFloor(joining: TextJoin): bool =
  joining.phase == RefuseAge and joining.floorRefused and not(joining.hasAge)
```

### A text join keeps the member id of a membership that is not removed

A text join for a person whose membership of the app is invited or live keeps that membership's member id. Only a person with no membership, or a removed one, gets a new member id. The rule takes the membership's state itself, so each of the four cases is checked. Changed on 2026-11-21 (audit JA-6): before, only an invited membership kept its id, so a join that ran again after an earlier join stopped before the network member was made gave the live membership a new member id.

```quint
type JoinMembership = NoMembership | InvitedMembership | LiveMembership | RemovedMembership

pure def textJoinKeepsMemberId(membership: JoinMembership): bool =
  membership == InvitedMembership or membership == LiveMembership

pure def lawNoMembershipGetsNewMemberId(membership: JoinMembership): bool =
  membership == NoMembership implies not(textJoinKeepsMemberId(membership))

pure def lawRemovedMembershipGetsNewMemberId(membership: JoinMembership): bool =
  membership == RemovedMembership implies not(textJoinKeepsMemberId(membership))

pure def lawLiveMembershipKeepsItsMemberId(membership: JoinMembership): bool =
  membership == LiveMembership implies textJoinKeepsMemberId(membership)

pure def lawInvitedMembershipKeepsItsMemberId(membership: JoinMembership): bool =
  membership == InvitedMembership implies textJoinKeepsMemberId(membership)
```

### A recorded-age decline without a stated age is sent at most once a day

When a join answer states an age that fails the join age check, the kind decline is always sent. When the answer states no age and only the number's recorded lowest age refuses the join, the decline is sent at most once a day for each number and app, counted together with the stated-age declines. New rule on 2026-11-21 (review of audit JA-7): before, a number with a recorded age under the join age got the decline for every message it sent, with no limit.

```quint
pure def sendAgeDecline(statedAge: bool, declinedInLastDay: bool): bool = statedAge or not(declinedInLastDay)

pure def lawStatedAgeDeclineIsAlwaysSent(declinedInLastDay: bool): bool = sendAgeDecline(true, declinedInLastDay)

pure def lawRecordedAgeDeclineAtMostOnceADay(statedAge: bool): bool =
  not(statedAge) implies not(sendAgeDecline(statedAge, true))
```

### An active membership gets its welcome and at most one follow-up

The service writes app consent and membership before it creates the runtime member. A waitlist ends after the membership write. An active member gets the normal welcome. If the person has another app, offer limited base-profile sharing without naming that app. Otherwise an uninvited shared-line Network join asks what the member is looking for. The follow-up is a reply to the member's join answer, so a signed turn returns it with the welcome. Changed on 2026-11-17 (audit SHA39): before, the follow-up was queued as a separate transactional text, and a dry-run backend never sent it.

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

The notice is available only in the signed turn for a number without a current or older runtime membership and with no applicable ban. A known underage floor or refused age prevents the notice. The service can collect the reply while the turn is running. It records the one-time notice key only when it commits a completed response containing the notice. A failed or abandoned turn leaves the notice available to the next eligible turn. A join refused for age discards any collected notice. Normal enrollment separately checks age and consent.

```quint
pure def firstContactMayCheckAge(signedTurn: bool, nonMember: bool, banned: bool): bool =
  signedTurn and nonMember and not(banned)

pure def firstContactNoticeAllowed(signedTurn: bool, nonMember: bool, banned: bool,
    joinAgeAllowed: bool, ageFloorAllowed: bool): bool =
  firstContactMayCheckAge(signedTurn, nonMember, banned) and joinAgeAllowed and ageFloorAllowed

pure def lawFirstContactNoticeRequiresEligibleNumber(signedTurn: bool, nonMember: bool, banned: bool,
    joinAgeAllowed: bool, ageFloorAllowed: bool): bool =
  firstContactNoticeAllowed(signedTurn, nonMember, banned, joinAgeAllowed, ageFloorAllowed)
    implies (signedTurn and nonMember and not(banned) and joinAgeAllowed and ageFloorAllowed)

pure def lawMemberOrBannedGetsNoNotice(signedTurn: bool, nonMember: bool, banned: bool,
    joinAgeAllowed: bool, ageFloorAllowed: bool): bool =
  (not(nonMember) or banned or not(signedTurn)) implies
    not(firstContactNoticeAllowed(signedTurn, nonMember, banned, joinAgeAllowed, ageFloorAllowed))
```
