# Member age

Age policy shared by the platform, matching engine, network service, and staff console. This library classifies an age after the caller validates that it is numeric. The comparisons have the same boundaries for fractional ages accepted by the existing TypeScript API.

## Story: Join at the eligible age

> As a person aged 13 or older, I want to join an app and use Eliza within the limits for my age.

### Age data outside the human range is unusable

A recorded age is usable between 0 and 120 years, inclusive. Callers treat absent and non-numeric values as unknown.

```quint
pure val maxAge: int = 120

pure def ageInRange(age: int): bool =
  age >= 0 and age <= maxAge
```

### Joining requires a usable age of at least 13

Someone under 13, or whose age is unknown, cannot join. Each app may also apply its configured join threshold to the person's effective age.

```quint
pure val minMemberAge: int = 13

pure def joinableAge(age: int): bool =
  ageInRange(age) and age >= minMemberAge

pure def lawJoiningNeedsUsableAge(age: int): bool =
  joinableAge(age) implies (age >= minMemberAge and age <= maxAge)
```

## Story: Take part in adult matching

> As a member, I want only adults to take part in introductions and matches.

### Matching requires a usable age of at least 18

Members aged 13 through 17 can use Eliza for themselves. A known adult age is necessary for matching. App and opportunity rules can require more.

```quint
pure val adultAge: int = 18

pure def matchableAge(age: int): bool =
  ageInRange(age) and age >= adultAge

pure def lawMatchingNeedsAdultAge(age: int): bool =
  matchableAge(age) implies (age >= adultAge and joinableAge(age))
```

### Commit a stated age before projecting it across apps

Commit the age to the verified person's record and phone age floor in the same transaction as the conversation that read it. An under-age statement that leads to staff review keeps the app's minimum join age. A confirmed refusal keeps the stated age. Another app uses the lower age even when later cleanup fails.

If the signed relay action extracts the member's text from an open turn, check that text for the sender's own direct minor age. This includes clear numeric replies and age-and-sex shorthand with no space between the number and letter. An upcoming birthday can block the item without becoming a durable relay age. A distant future age does not give a current age. Commit that age in the same transaction as the relay refusal. Stop participation through the ordinary minor transition. Other people's ages, quoted words, school estimates and moderation flags cannot lower the sender's durable age.

```quint
pure def recordedChatAge(age: int, appMinimum: int, declined: bool): int =
  if (declined or age >= appMinimum) age else appMinimum

pure def confirmedUnderage(age: int): bool = ageInRange(age) and not(joinableAge(age))

pure def lawDeclineKeepsStatedAge(age: int, appMinimum: int): bool =
  recordedChatAge(age, appMinimum, true) == age
```

### Project a committed age using its original owner

Use the person identified by the write transaction for cross-app cleanup. For phone-scoped signup cleanup, read the current stored floor and check ownership again under the phone age guard. Skip this cleanup when the phone now belongs to another person. A legacy member's observation applies to an unbound number. Moving a number carries its floor to the new binding. Projection never writes either age.

```quint
pure def recordedAgeFloorApplies(recordedOwner: str, currentOwner: str): bool =
  recordedOwner == currentOwner

pure def lawPhoneReassignmentEndsAgeProjection(recordedOwner: str, currentOwner: str): bool =
  (recordedOwner != currentOwner) implies not(recordedAgeFloorApplies(recordedOwner, currentOwner))
```

### Resume a confirmed refusal from the durable age

A known person below the global join age cannot start another membership. When any membership still holds data, reapply the cross-app cleanup from the stored age. Opt out each affected app on the current verified phone, remove pending text, then remove member data and close the membership. A retry uses the same consent reference. The age floor remains after cleanup.

```quint
pure def underageCleanupRequired(age: int, membershipLive: bool): bool =
  confirmedUnderage(age) and membershipLive

pure def lawUnderageCleanupNeedsAConfirmedAge(age: int, membershipLive: bool): bool =
  underageCleanupRequired(age, membershipLive) implies confirmedUnderage(age)
```

### A confirmed refusal applies before every app finishes cleanup

An existing membership cannot authorize ordinary conversation once the person or phone has a confirmed age below the join minimum. START cannot opt that phone back in, even if an app has already removed the membership. Read the durable age again inside the identity lock before writing a START event. STOP, HELP, and an app leave remain available.

```quint
pure def textUseAllowedAtAge(age: int, complianceOrLeave: bool): bool =
  not(confirmedUnderage(age)) or complianceOrLeave

pure def lawConfirmedUnderageCannotRestart(age: int): bool =
  confirmedUnderage(age) implies not(textUseAllowedAtAge(age, false))
```

### A near birthday gives an estimate for the present age

The Network and Slop accept a current age qualified by words such as “still” or “currently,” including ages written with “y.o.” If a direct self-age clause names the age of a near birthday, use one year less in onboarding and conversation. Treat the result as an estimate. It can keep someone out of matching but does not confirm an under-13 refusal. The direct-only relay check does not commit an estimate. Keep a following birthday qualifier with an age written as “y.o.” The qualifier stays with the age for a near or a distant birthday. A distant birthday does not give a current age. Quoted, reported, or hypothetical wording does not supply a direct current age.

```quint
pure def precedingBirthdayAge(nextAge: int): int =
  nextAge - 1

pure def ageQualifierFollows(nearBirthday: bool, distantBirthday: bool): bool =
  nearBirthday or distantBirthday

pure def lawDistantBirthdayQualifiesTheAge(nearBirthday: bool): bool =
  ageQualifierFollows(nearBirthday, true)

pure def lawBeforeAnEighteenthBirthdayIsNotAdult(nextAge: int): bool =
  nextAge <= adultAge implies not(matchableAge(precedingBirthdayAge(nextAge)))
```

### A half age needs age wording to confirm an under-13 refusal

Use the whole number in a current age stated as a decimal half, a slash half, or “and a half.” When the words “years old” or an accepted equivalent follow the half, the reading is explicit. A standalone half age or one followed by a separate clause can supply an age without confirming an under-13 refusal. A measurement or a future milestone supplies no current age. A small number used as a sports score or record supplies no age. A first-person birthday before a sports clause supplies the stated age. A team result can follow a self-age of 10 or older. For a lower age in a team result clause, require direct birthday or age wording. An under-13 conjunction reading needs explicit age wording before it can confirm a refusal. An attested adult's under-13 contradiction goes to staff and keeps the member's data.

```quint
type HalfAgeEvidence = HalfAgeUnknown | HalfAgeLoose | HalfAgeExplicit

pure def halfAgeEvidence(writtenAsAge: bool, atClauseEnd: bool, future: bool): HalfAgeEvidence =
  if (future) HalfAgeUnknown
  else if (writtenAsAge) HalfAgeExplicit
  else if (atClauseEnd) HalfAgeLoose
  else HalfAgeUnknown

pure val minLooseTeamAge: int = 10

pure def ageConjunctionAllowed(age: int, statedBirthday: bool, sportsRecord: bool, teamResult: bool): bool =
  statedBirthday or age >= minMemberAge or (not(sportsRecord) and (not(teamResult) or age >= minLooseTeamAge))

pure def lawAnUpcomingHalfAgeSuppliesNoCurrentAge(writtenAsAge: bool, atClauseEnd: bool): bool =
  halfAgeEvidence(writtenAsAge, atClauseEnd, true) == HalfAgeUnknown

pure def lawAHalfAgeNeedsAgeWordsToBeExplicit(atClauseEnd: bool, future: bool): bool =
  halfAgeEvidence(false, atClauseEnd, future) != HalfAgeExplicit

pure def lawSmallSportsRecordsDoNotSupplyAge(age: int): bool =
  age < minMemberAge implies not(ageConjunctionAllowed(age, false, true, false))

pure def lawSmallTeamResultsDoNotSupplyAge(age: int): bool =
  age < minLooseTeamAge implies not(ageConjunctionAllowed(age, false, false, true))

pure def lawStatedBirthdaySurvivesSportsContext(age: int): bool =
  ageConjunctionAllowed(age, true, true, true)
```

### An older age cannot raise the effective age

After validating both ages, the caller keeps the lower one. Missing and invalid observations do not replace a usable observation. The platform applies this rule across apps.

```quint
pure def lowerAge(firstAge: int, secondAge: int): int =
  if (firstAge <= secondAge) firstAge else secondAge

pure def lawEffectiveAgeCannotRise(firstAge: int, secondAge: int): bool =
  lowerAge(firstAge, secondAge) <= firstAge and lowerAge(firstAge, secondAge) <= secondAge
```
