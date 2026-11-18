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

Commit the age to the verified person's record and phone age floor in the same transaction as the conversation that read it. An under-age statement that leads to staff review keeps the app's minimum join age. A confirmed refusal keeps the stated age. Another app uses the lower age even when later cleanup fails. Project the committed age across apps for the person that the write transaction identified, so a later change of phone number does not move the projection to another person. Moving a number carries its floor to the new binding. Projection never writes either age. Changed: this rule now holds the projection sentences of the removed rule "Project a committed age using its original owner"; that rule's phone-scoped cleanup had no consumer after the signup draft store was removed (audit MCP16 review), so its decision `recordedAgeFloorApplies` is gone with it.

```quint
pure def recordedChatAge(age: int, appMinimum: int, declined: bool): int =
  if (declined or age >= appMinimum) age else appMinimum

pure def confirmedUnderage(age: int): bool = ageInRange(age) and not(joinableAge(age))

pure def lawDeclineKeepsStatedAge(age: int, appMinimum: int): bool =
  recordedChatAge(age, appMinimum, true) == age
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

### An older age cannot raise the effective age

After validating both ages, the caller keeps the lower one. Missing and invalid observations do not replace a usable observation. The platform applies this rule across apps.

```quint
pure def lowerAge(firstAge: int, secondAge: int): int =
  if (firstAge <= secondAge) firstAge else secondAge

pure def lawEffectiveAgeCannotRise(firstAge: int, secondAge: int): bool =
  lowerAge(firstAge, secondAge) <= firstAge and lowerAge(firstAge, secondAge) <= secondAge
```
