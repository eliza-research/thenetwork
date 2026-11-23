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

After a safety claim, use a pending join for an app the sender has yet to join when the sender belongs to no app or the answer has an age. Otherwise use the newest open item, then the last app to contact the sender, then The Network. The shell parses the answer for an age only when the sender has a pending join for an app they have yet to join and already belongs to an app, and it parses the answer before it asks for a safety claim, so that a join answer with an age is never taken as an answer to "Who do you mean?". Use only pending fields from the routed app. Changed (audit SD-250): the safety claim came before the age reading -> the age reading comes first and the claim is its own rule below, because a short join answer such as "Kit, 29" for a third app went to a waiting "Who do you mean?" question.

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

A block, a report or an answer to "Who do you mean?" that an app claims under the [shared-line routing](lineRouting.md) rule goes to that app, before a pending join, an open item or the last app to contact the sender. A dedicated line, a profile read, a survey reply and an app keyword still come first. Changed (audits SD-250 and W3-220): a report went to the app with the newest open item -> the safety claim picks the app, because the report found nobody when the member met the person in another app.

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

A banned number or person cannot join. An invite-only app requires an invitation except The Network's shared-line intake. Other join modes may proceed. An answer refused for want of an invitation stores nothing for this app, but an age it states is still recorded at once on the number's age floor and on the person, if any, before the invite-only reply, because age is a person-level fact and the lowest stated age wins. Changed (audit JA-1): an age in an answer refused for want of an invitation was not recorded -> it is recorded, because "Sam 15" to an invite-only app and then "Sam 25" to an open app joined a minor as an adult.

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

Combine the new reply with the same app's pending fields. When an age is present, record it at once on the number's age floor and on the person, if any, before any other step, so that a missing name, an unsupported home or an expired pending join never loses it. Then apply the existing lowest-age rule before asking for name or home. When no age is present and the number's recorded lowest age is under this app's join age, decline kindly and drop the pending join. Otherwise ask for age, or request a corrected home when the answer supplied an unsupported one. A failed age, stated or recorded, also declines and drops the pending join. Name and a supported or omitted home are needed before writing the membership. The question asks for the birthday (month, day and year); an answer can be a birthday or an age, a birthday counts as the age it gives on the earliest civil date on Earth now, and the pending join keeps the birthday. Changed (audits JA-1, JA-2 and JA-7 and owner decision 2026-11-22, D1): an age was kept only on the pending join or not at all, an under-13 record was asked again, and the question asked for an age -> the age is recorded at once on the floor and the person, an under-13 record declines, and the question asks for the birthday, because a later older age joined a minor as an adult and the owner wants the age to rise on each birthday.

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

A text join for a person whose membership of the app is invited or live keeps that membership's member id. Only a person with no membership, or a removed one, gets a new member id. The rule takes the membership's state itself, so each of the four cases is checked. Changed (audit JA-6): only an invited membership kept its id -> every membership keeps it, because a join that ran again after an earlier join stopped before the network member was made gave the live membership a new member id.

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

When a join answer states an age that fails the join age check, the kind decline is always sent. When the answer states no age and only the number's recorded lowest age refuses the join, the decline is sent at most once a day for each number and app, counted together with the stated-age declines. Changed (audit JA-7): a number with a recorded age under the join age got the decline for every message it sent -> at most once a day, because the decline had no limit.

```quint
pure def sendAgeDecline(statedAge: bool, declinedInLastDay: bool): bool = statedAge or not(declinedInLastDay)

pure def lawStatedAgeDeclineIsAlwaysSent(declinedInLastDay: bool): bool = sendAgeDecline(true, declinedInLastDay)

pure def lawRecordedAgeDeclineAtMostOnceADay(statedAge: bool): bool =
  not(statedAge) implies not(sendAgeDecline(statedAge, true))
```

### An active membership gets its welcome and at most one follow-up

The service writes app consent and membership before it creates the runtime member. A waitlist ends after the membership write. An active member gets the normal welcome. If the person has another app, offer limited base-profile sharing without naming that app. Otherwise an uninvited shared-line Network join asks what the member is looking for. The follow-up is a reply to the member's join answer, so a signed turn returns it with the welcome. Changed (audit SHA39): the follow-up was queued as a separate transactional text -> it is a reply to the join answer, because a dry-run backend never sent it. Changed (verification 2026-11-23): the welcome had no example path -> the spec gives the seven-step join that the text join in production takes to the looking-for question, because the recorded-age step and the many new laws of the teen rules put the welcome beyond the random search.

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

pure val eval_witness_sometimesAsksWhatTheyWant = (
  ("checkJoinBan", false),
  ("checkInvitation", false, false, true, true),
  ("readJoinAnswer", completedAnswer),
  "recordStatedAge",
  ("checkTextJoinAge", true),
  ("recordTextMembership", true),
  ("recordWelcome", false, true, false)
)
```

## Story: Choose other apps from The Network

> As a Network member, I want the shared agent to enroll me only in the apps I name and can join.

### A current Network member's answer controls other-app enrollment

Handle an eligible answer to the pending question only if it names a running app other than The Network. Recheck the person, Network membership and ban before acting. Process each named app separately. Slop and peon require adult eligibility in this path even if an underage member could join them directly, so a member under 18 is enrolled only in friends.help. An existing membership can be acknowledged. Otherwise enforce that app's join age before writing the app membership and its own consent. Changed (owner decision 2026-11-22, answers A2 to A5): before, a member under 18 could enroll in peon.biz from this answer; the owner chose "Friends only" for a minor, so the question offers a minor friends only and the answer enrolls a minor in no work or dating app.

```quint
type OtherAppOutcome = SkipOtherApp | KeepOtherApp | CreateOtherApp
pure def shouldReadLookingFor(hasKeyword: bool, profileRead: bool, isNetwork: bool): bool =
  not(hasKeyword or profileRead) and isNetwork
pure def namedOtherApp(appName: str, running: bool): bool = appName != "ntwrk" and running
pure def networkEnrollmentAllowed(hasPerson: bool, hasNetworkMembership: bool, banned: bool): bool =
  hasPerson and hasNetworkMembership and not(banned)
pure def otherAppAllowed(appName: str, adult: bool): bool = adult or (appName != "slop" and appName != "peon")
pure def otherAppEnrollment(existingMember: bool, ageEligible: bool): OtherAppOutcome =
  if (existingMember) KeepOtherApp else if (ageEligible) CreateOtherApp else SkipOtherApp
pure def lawSlopEnrollmentRequiresAdult(adult: bool): bool =
  otherAppAllowed("slop", adult) implies adult
pure val appNameValues = Set("ntwrk", "slop", "friends", "peon")
pure def lawMinorEnrollsOnlyInFriendApps(appName: str): bool =
  otherAppAllowed(appName, false) implies (appName != "slop" and appName != "peon")
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

## Story: Tell a teen what the text line does with their age

> As a person aged 13 to 17 who texts the line, I want my birthday to set my age, and I want to know which introductions I can get.

The person minor signal follows `minorSignalOpens` of the [friend introduction age rule](friendIntroAge.md) directly, and the network minor signal of a member that the record already knows as a minor follows the same rule: a statement that agrees with the record, or a cue such as school words, opens neither. The network minor signal of a minor whose own join answer says they are a minor also opens only by this rule. Changed (owner decision 2026-11-22, A2 to A5): the text line had its own copy of the rule and opened a signal for every new minor -> it calls `minorSignalOpens`, because a teen who states their true age must stay teen ready.

### A birthday is kept only for a person who can join

A birthday answer gives the age on the earliest civil date on Earth now. The shell records the exact birth date only when that age is at least 13. A birthday that gives an age under 13 is recorded as a typed age only, so the birth date of a person who is refused is never stored. Changed (owner decision 2026-11-22, D1): the line asked only for an age -> it asks for the birthday, because the age must rise on each birthday.

```quint
import memberAge as Age from "./memberAge"

pure def birthdayRecorded(birthKey: int, minDay: int): bool = Age::joinableAge(Age::ageOnDay(birthKey, minDay))

pure val birthKeyValues = Set(19900101, 20100315, 20131122, 20131123, 20261122)
pure val minDayValues = Set(20261121, 20261122, 20271122)

pure def lawUnderThirteenBirthdayIsNotRecorded(birthKey: int, minDay: int): bool =
  (Age::ageOnDay(birthKey, minDay) < Age::minMemberAge) implies not(birthdayRecorded(birthKey, minDay))

pure def lawThirteenBirthdayIsRecorded(minDay: int): bool =
  birthdayRecorded(minDay - 13 * Age::dayKeyYear, minDay)
```

### A typed age rises only on the anniversary of the day it was stated

A typed age is aged from the day it was stated: it rises by one year on each anniversary of that day, never earlier, so the stored age is never older than the statement allows. The network replaces its stored typed age only with a lower age than this aged value. Changed (owner decision 2026-11-22, D1): a typed age stayed as stated -> it rises on each anniversary of the statement, because the owner wants ages that rise with time and a typed age has no birthday.

```quint
pure val selfAgeValues = Set(-1, 0, 12, 13, 16, 17, 18, 19, 24)
pure val statedDayValues = Set(20241122, 20261122)

pure def statedAgeNow(selfAge: int, statedDay: int, minDay: int): int =
  Age::ageOnDay(Age::statedAgeUpper(selfAge, statedDay), minDay)

pure def lawStatedAgeNeverFallsBelowTheStatement(selfAge: int, statedDay: int, minDay: int): bool =
  (selfAge >= 0 and minDay >= statedDay) implies statedAgeNow(selfAge, statedDay, minDay) >= selfAge
```

### A numeric birthday is read only when its month is clear

A numeric birthday with the year last ("3/15/2010") is read month first. When its first two numbers are both 1 to 12 and differ ("01/12/2009"), the month is not clear: the line stores no birth date from it. When it is the answer to the birthday question or a join answer, and both readings are possible birth dates, the line asks which of the two dates it is, with the months as words. Equal numbers ("1/1/2009") and a second number above 12 ("3/15/2010") are clear. Changed (owner decision 2026-11-22, D1): a day-first answer such as 01/12/2009 (1 December 2009) was stored as 12 January 2009 -> such an answer stores no birth date and the line asks which date it is, because a teen read as 18 eleven months early and got adult matching on every app.

```quint
pure val firstNumberValues = Set(0, 1, 3, 12, 13, 15, 31)
pure val secondNumberValues = Set(0, 1, 3, 12, 13, 15, 31)

pure def numericDateAmbiguous(firstNumber: int, secondNumber: int): bool =
  firstNumber >= 1 and firstNumber <= 12 and secondNumber >= 1 and secondNumber <= 12 and firstNumber != secondNumber

pure def lawSameNumbersAreClear(firstNumber: int): bool =
  not(numericDateAmbiguous(firstNumber, firstNumber))

pure def lawDayAfterTwelveIsClear(firstNumber: int, secondNumber: int): bool =
  (secondNumber > 12) implies not(numericDateAmbiguous(firstNumber, secondNumber))

pure def lawSwappedNumbersAreAlsoAmbiguous(firstNumber: int, secondNumber: int): bool =
  numericDateAmbiguous(firstNumber, secondNumber) == numericDateAmbiguous(secondNumber, firstNumber)

pure def lawJanuaryTwelfthIsAmbiguous(firstNumber: int): bool =
  (firstNumber == 1) implies numericDateAmbiguous(firstNumber, 12)
```

### A join answer keeps its birthday only when nothing else in it contradicts it

A join answer can hold a birthday and a typed age. When it holds a typed age, the line keeps the birthday only when the typed age and the age that the birthday gives differ by at most one year. When it holds no typed age, the line keeps the birthday only when no other number is left in the answer. Otherwise the date is probably not the birthday ("Sam, 29, moved here 3/15/2024" or "Sam, moved here 3/15/2024, 29"), and the line keeps no birth date from the answer. Changed (owner decision 2026-11-22, D1): any past date in a join answer counted as the birthday -> the line keeps the date only when the typed age agrees or no other number is left, because a date of a move gave an age of 2, an under-13 decline and a phone age floor of 2 that cannot be undone.

```quint
pure val typedAgeValues = Set(2, 12, 13, 15, 16, 17, 29)
pure val birthAgeValues = Set(2, 12, 14, 15, 16, 17, 29)

pure def joinBirthDateKept(hasTypedAge: bool, typedAge: int, birthAge: int, otherNumber: bool): bool =
  if (hasTypedAge) (typedAge - birthAge <= 1 and birthAge - typedAge <= 1) else not(otherNumber)

pure def lawBirthdayAloneIsKept(typedAge: int, birthAge: int): bool =
  joinBirthDateKept(false, typedAge, birthAge, false)

pure def lawBirthdayBesideAnotherNumberIsDropped(typedAge: int, birthAge: int): bool =
  not(joinBirthDateKept(false, typedAge, birthAge, true))

pure def lawAgreeingTypedAgeKeepsTheBirthday(typedAge: int, otherNumber: bool): bool =
  joinBirthDateKept(true, typedAge, typedAge, otherNumber) and joinBirthDateKept(true, typedAge, typedAge + 1, otherNumber)

pure def lawFarTypedAgeDropsTheBirthday(typedAge: int, birthAge: int, otherNumber: bool): bool =
  (typedAge - birthAge > 1 or birthAge - typedAge > 1) implies not(joinBirthDateKept(true, typedAge, birthAge, otherNumber))
```

### A join answer keeps a contradicted typed age only when it is under 13

When a typed age and a birthday in one join answer differ by more than one year, the line also drops the typed age, so the answer has no age and the line asks again. A typed age under 13 is kept, so a child who states their age is still declined. Changed (owner decision 2026-11-22, D1): the typed age was kept when the birthday was dropped -> the line asks again, because the typed age could make a person older than the date they sent.

```quint
pure def joinTypedAgeKept(hasBirthAge: bool, typedAge: int, birthAge: int): bool =
  not(hasBirthAge) or joinBirthDateKept(true, typedAge, birthAge, true) or not(Age::joinableAge(typedAge))

pure def lawTypedAgeAloneIsKept(typedAge: int, birthAge: int): bool =
  joinTypedAgeKept(false, typedAge, birthAge)

pure def lawTypedChildAgeIsKept(hasBirthAge: bool, birthAge: int): bool =
  joinTypedAgeKept(hasBirthAge, 12, birthAge)

pure def lawFarJoinableTypedAgeIsDropped(typedAge: int): bool =
  Age::joinableAge(typedAge) implies not(joinTypedAgeKept(true, typedAge, typedAge + 2))
```

### An older age from a teen with a birth date is a contradiction

A member whose record has an exact birth date that gives 13 to 18 on every day now contradicts it when they state an age about themselves that is 19 or more, or that is more than one year above the age that the birth date gives on the latest civil date on Earth now. This applies in any form the line reads as their own age, on any message, open turns included, and also to a birth date stated in the same message. The shell then calls the network's older-than-stated step once per member, which bars the phone from the teen pool and closes the member's teen items. A typed age alone, a birth date that gives 19 or more, and an age at most one year above the birth-date age are no contradiction. One year above is allowed, because a teen who rounds up to the next age is honest. An age that is not below the age that the birth date gives, from the same message or from the stored exact birth date, is not stored as a new age reading, because it can only make the readings conflict, and a conflict bars the teen pool: the older-than-stated step is the only path from such an age to a bar. Changed (owner decision 2026-11-22, D1): no stated age contradicted a teen birth date -> an age of 19 or more, or more than one year above, bars the teen pool, because an adult who typed a teen birth date must lose that access when they say their real age. Changed (verification 2026-11-23): an age one year above a stored exact teen birth date was stored as a reading, so the readings conflicted and the honest teen lost the teen pool -> such an age is not stored, because this rule allows one year above.

```quint
import friendIntroAge as FriendAge from "./friendIntroAge"

pure val maxDayValues = Set(20261122, 20261123, 20271122)

pure def teenBirthDateContradicted(birthExact: bool, birthKey: int, minDay: int, maxDay: int, selfAge: int): bool =
  birthExact and FriendAge::teenPartnerAge(birthKey, minDay, maxDay)
    and (selfAge > FriendAge::teenFriendMaxAge or selfAge > Age::ageOnDay(birthKey, maxDay) + 1)

pure def lawAdultStatementContradictsATeenBirthDate(selfAge: int): bool =
  (selfAge > FriendAge::teenFriendMaxAge) implies teenBirthDateContradicted(true, 20100315, 20261122, 20261122, selfAge)

pure def lawTwoYearsOlderContradictsATeenBirthDate(selfAge: int): bool =
  (selfAge >= 18) implies teenBirthDateContradicted(true, 20100315, 20261122, 20261122, selfAge)

pure def lawOneYearOlderIsNoContradiction(birthExact: bool): bool =
  not(teenBirthDateContradicted(birthExact, 20100315, 20261122, 20261122, 17))

pure def lawCloseTeenStatementIsNoContradiction(birthExact: bool, birthKey: int, minDay: int, maxDay: int, selfAge: int): bool =
  (selfAge <= FriendAge::teenFriendMaxAge and selfAge <= Age::ageOnDay(birthKey, maxDay) + 1)
    implies not(teenBirthDateContradicted(birthExact, birthKey, minDay, maxDay, selfAge))

pure def lawTypedAgeIsNoContradiction(birthKey: int, minDay: int, maxDay: int, selfAge: int): bool =
  not(teenBirthDateContradicted(false, birthKey, minDay, maxDay, selfAge))
```

### A minor hears which introductions the app makes

A member under 18 hears one notice when the line learns that they are under 18, and the welcome of a member who joins under 18 says the same thing. On slop.date the notice says that slop.date matches nobody under 18 for dates; on peon.biz it says that peon.biz matches nobody under 18 for work and that the agent still helps them itself; both say that friendship introductions under 18 happen on friends.help and ntwrk.party. slop.date and peon.biz always give their own notice, also to a member with a stored doubt about their age. On friends.help and ntwrk.party, a member with a stored doubt about their age (an open minor signal, a minor report, an age conflict or a bar) hears the single-player notice, which promises no friendship introductions. On friends.help and ntwrk.party, while staff have not stopped teen introductions, a teen-ready member hears that they are introduced only for friendship, to people aged 13 to 18 born within 2 years of them, and that every introduction is checked before anyone hears about it; a member with no exact birth date also hears that a birthday lets the line look for friends close to their age. In every other case the member hears the single-player notice. Changed (owner decision 2026-11-22, D1 and D2): a teen heard only the single-player notice -> the slop.date and peon.biz notices say what the app does for a minor, friends.help and ntwrk.party promise friendship introductions only to a teen-ready member, and the notice says that each introduction is checked before contact with no claim that a person checks it, because the owner allowed teen friendship introductions on those two apps and the review judge approves every introduction.

```quint
import matchLane as Lane from "./matchLane"

type MinorNotice = MinorSinglePlayerNotice | MinorBirthdayNotice | MinorTeenFriendNotice | MinorSlopNotice | MinorPeonNotice

pure val appValues = Set("ntwrk", "slop", "friends", "peon")

pure def minorNoticeFor(app: str, teenIntros: bool, teenReady: bool, birthExact: bool, doubtStored: bool): MinorNotice =
  if (app == "slop") MinorSlopNotice
  else if (app == "peon") MinorPeonNotice
  else if (doubtStored) MinorSinglePlayerNotice
  else if (Lane::teenFriendApp(app) and teenIntros and teenReady) MinorTeenFriendNotice
  else if (Lane::teenFriendApp(app) and teenIntros and not(birthExact)) MinorBirthdayNotice
  else MinorSinglePlayerNotice

pure def lawSlopMinorHearsNoDates(teenIntros: bool, teenReady: bool, birthExact: bool, doubtStored: bool): bool =
  minorNoticeFor("slop", teenIntros, teenReady, birthExact, doubtStored) == MinorSlopNotice

pure def lawPeonMinorHearsNoWork(teenIntros: bool, teenReady: bool, birthExact: bool, doubtStored: bool): bool =
  minorNoticeFor("peon", teenIntros, teenReady, birthExact, doubtStored) == MinorPeonNotice

pure def lawSwitchOffKeepsTheMinorNotice(app: str, teenReady: bool, birthExact: bool, doubtStored: bool): bool =
  (app != "slop" and app != "peon") implies minorNoticeFor(app, false, teenReady, birthExact, doubtStored) == MinorSinglePlayerNotice

pure def lawNoFriendPromiseWithDoubt(app: str, teenIntros: bool, teenReady: bool, birthExact: bool): bool =
  minorNoticeFor(app, teenIntros, teenReady, birthExact, true) != MinorBirthdayNotice
    and minorNoticeFor(app, teenIntros, teenReady, birthExact, true) != MinorTeenFriendNotice

pure def lawTeenFriendNoticeNeedsAReadyTeen(app: str, teenIntros: bool, teenReady: bool, birthExact: bool, doubtStored: bool): bool =
  (minorNoticeFor(app, teenIntros, teenReady, birthExact, doubtStored) == MinorTeenFriendNotice) implies
    (Lane::teenFriendApp(app) and teenIntros and teenReady and not(doubtStored))
```

### A minor on slop.date or peon.biz hears once what they get

A member who is under 18 on slop.date or peon.biz stays a member and gets help from the agent alone. The line tells such a member once what they get: the welcome of a new minor member says it, and a member who is already in hears it with their next message after the line knows they are under 18. The line keeps the time it told them and never tells them again. An adult hears no such notice, and a member of friends.help or ntwrk.party hears the notice of the rule above instead. When the line tells them with a message that it would otherwise leave to the shared agent, the notice is the answer to that message and the turn is handled, because a turn that goes to the shared agent cannot carry a reply from the line. Changed (owner decision 2026-11-22, A2 to A5): a minor on slop.date or peon.biz heard nothing, and the turn that carried the notice gave a wrong reason -> the member stays with solo help and is told once in a handled turn, because the owner chose "Friends only" for a minor.

```quint
pure def soloTeenApp(app: str): bool = app == "slop" or app == "peon"

pure def minorScopeNoticeDue(minorNow: bool, soloApp: bool, alreadyTold: bool): bool =
  minorNow and soloApp and not(alreadyTold)

pure def lawScopeNoticeOnce(minorNow: bool, soloApp: bool): bool =
  not(minorScopeNoticeDue(minorNow, soloApp, true))

pure def lawAdultHearsNoScopeNotice(soloApp: bool, alreadyTold: bool): bool =
  not(minorScopeNoticeDue(false, soloApp, alreadyTold))

pure def scopeNoticeTurnOpens(turnOpen: bool, toldThisTurn: bool): bool =
  turnOpen and not(toldThisTurn)

pure def lawScopeNoticeAnswersTheTurn(turnOpen: bool): bool =
  not(scopeNoticeTurnOpens(turnOpen, true))

pure def lawFriendAppsAreNotSolo(app: str): bool =
  Lane::teenFriendApp(app) implies not(soloTeenApp(app))
```
