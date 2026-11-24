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

> As a member, I want only adults to take part in introductions and matches, except the friendship introductions for minors, which are on unless staff stop them.

### Matching requires a usable age of at least 18

Members aged 13 through 17 can use Eliza for themselves. A known adult age is necessary for matching. App and opportunity rules can require more. The romance item gates of the ntwrk and slop packs and the peon job seat gate call this rule through `canBeMatched`. A person aged 13 to 17 can also get a friendship introduction, but only when every rule of [friend introductions with a minor](friendIntroAge.md) holds; this rule decides every other match. Changed (owner decision D1 of 2026-11-22): the friendship exception for minors is new, and the pack gates now call this rule because they compared the age with 18 and let an age above 120 through.

```quint
pure val adultAge: int = 18

pure def matchableAge(age: int): bool =
  ageInRange(age) and age >= adultAge

pure def lawMatchingNeedsAdultAge(age: int): bool =
  matchableAge(age) implies (age >= adultAge and joinableAge(age))
```

### Commit a stated age before projecting it across apps

Commit the age to the verified person's record and phone age floor in the same transaction as the conversation that read it. An under-age statement that leads to staff review keeps the app's minimum join age. A confirmed refusal keeps the stated age. Another app uses the lower age even when later cleanup fails. Project the committed age across apps for the person that the write transaction identified, so a later change of phone number does not move the projection to another person. Moving a number carries its floor to the new binding. Projection never writes either age. Changed: this rule now holds the projection sentences of the removed rule "Project a committed age using its original owner", and its decision `recordedAgeFloorApplies` is removed, because the signup draft applies its own age check ("A recorded age that the app does not allow deletes the draft at once" in [the signup draft](mcpSignupDraft.md)) and the phone-scoped cleanup had no other consumer.

If the signed relay action extracts the member's text from an open turn, check that text for the sender's own direct minor age. This includes clear numeric replies and age-and-sex shorthand with no space between the number and letter. An upcoming birthday can block the item without becoming a durable relay age. A distant future age does not give a current age. Commit that age in the same transaction as the relay refusal. Stop participation through the ordinary minor transition. Other people's ages, quoted words, school estimates and moderation flags cannot lower the sender's durable age.

```quint
pure def recordedChatAge(age: int, appMinimum: int, declined: bool): int =
  if (declined or age >= appMinimum) age else appMinimum

pure def confirmedUnderage(age: int): bool = ageInRange(age) and not(joinableAge(age))

pure def lawDeclineKeepsStatedAge(age: int, appMinimum: int): bool =
  recordedChatAge(age, appMinimum, true) == age
```

### Quoted age evidence does not change the sender

Use the speaker's own unquoted words for age and youth cues. Preserve
quote scope across sentence punctuation and check the cue itself when
surrounding words extend outside the quote. Quoted school, underage, and
numeric age evidence from another speaker cannot restrict the sender or
change their age. A direct cue outside the quote still counts. A sender
can repeat their own youth disclosure. A stray opening quote in casual
text and an apostrophe in a contraction do not hide a youth cue. A quote
introduced as reported speech remains attributable even without a
closing mark. A separate report about another person follows its own
reporting rules.

```quint
pure def ownAgeEvidenceAllowed(quoted: bool): bool =
  not(quoted)

pure def lawQuotedWordsDoNotSetSenderAge(quoted: bool): bool =
  quoted implies not(ownAgeEvidenceAllowed(quoted))

pure def ownYouthCueAllowed(quoted: bool, ownAttribution: bool, unfinishedCasual: bool): bool =
  not(quoted) or ownAttribution or unfinishedCasual

pure def lawAnotherSpeakersYouthCueCannotRestrictSender(quoted: bool): bool =
  quoted implies not(ownYouthCueAllowed(quoted, false, false))
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

Use the whole years in a current age stated with a half, a quarter, or up to eleven additional months. “Years old” and its accepted equivalents mark the reading as explicit. “Old” after the months or quarters also marks it as explicit. A bare decimal or slash half below eight can be a height. Require explicit age words for that reading. Require explicit age words for a month or quarter reading below 13. A half age at the end of a clause can supply an age without confirming an under-13 refusal. A measurement or a future milestone supplies no current age.

A small number used as a sports score or record supplies no age. A first-person birthday before a sports clause supplies the stated age. A team result can follow a self-age of 10 or older. For a lower age in a team result clause, require direct birthday or age wording. An under-13 conjunction reading needs explicit age wording before it can confirm a refusal. An attested adult's under-13 contradiction goes to staff and keeps the member's data.

```quint
type FractionalAgeEvidence = FractionalAgeUnknown | FractionalAgeLoose | FractionalAgeExplicit

pure val minLooseHeightAge: int = 8

pure def fractionalAgeEvidence(age: int, possibleHeight: bool, monthsOrQuarter: bool, writtenAsAge: bool, atClauseEnd: bool, atAgeTail: bool, future: bool): FractionalAgeEvidence =
  if (future) FractionalAgeUnknown
  else if (writtenAsAge) FractionalAgeExplicit
  else if (possibleHeight and age < minLooseHeightAge) FractionalAgeUnknown
  else if ((not(monthsOrQuarter) and atClauseEnd) or (joinableAge(age) and atAgeTail)) FractionalAgeLoose
  else FractionalAgeUnknown

pure val minLooseTeamAge: int = 10

pure def ageConjunctionAllowed(age: int, statedBirthday: bool, sportsRecord: bool, teamResult: bool): bool =
  statedBirthday or age >= minMemberAge or (not(sportsRecord) and (not(teamResult) or age >= minLooseTeamAge))

pure def lawAnUpcomingFractionalAgeSuppliesNoCurrentAge(age: int, possibleHeight: bool, monthsOrQuarter: bool, writtenAsAge: bool, atClauseEnd: bool, atAgeTail: bool): bool =
  fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, writtenAsAge, atClauseEnd, atAgeTail, true) == FractionalAgeUnknown

pure def lawAFractionalAgeNeedsAgeWordsToBeExplicit(age: int, possibleHeight: bool, monthsOrQuarter: bool, atClauseEnd: bool, atAgeTail: bool, future: bool): bool =
  fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, false, atClauseEnd, atAgeTail, future) != FractionalAgeExplicit

pure def lawPossibleHeightRequiresAgeWords(age: int, atClauseEnd: bool, atAgeTail: bool): bool =
  age < minLooseHeightAge implies fractionalAgeEvidence(age, true, false, false, atClauseEnd, atAgeTail, false) == FractionalAgeUnknown

pure def lawExplicitCurrentFractionalAgeIsAccepted(age: int, possibleHeight: bool, monthsOrQuarter: bool, atClauseEnd: bool, atAgeTail: bool): bool =
  fractionalAgeEvidence(age, possibleHeight, monthsOrQuarter, true, atClauseEnd, atAgeTail, false) == FractionalAgeExplicit

pure def lawUnderageMonthOrQuarterNeedsAgeWords(age: int, atClauseEnd: bool, atAgeTail: bool): bool =
  age < minMemberAge implies fractionalAgeEvidence(age, false, true, false, atClauseEnd, atAgeTail, false) == FractionalAgeUnknown

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

## Story: Track age from a birth date

> As a member, I want The Network to know my birthday, so that my age goes up on my birthday and the limits for my age follow it.

Owner decision 2026-11-22: ask for the birthday, not only the age, so that the record knows when the person becomes one year older. A civil date is one integer key `yyyymmdd`: 15 March 2010 is `20100315`. The order of the keys is the order of the dates. The shell gives two keys for one Clock instant: the earliest civil date on Earth at that instant (UTC minus 12 hours) and the latest civil date (UTC plus 14 hours). A test that an age is at least a minimum uses the earliest key. A test that an age is at most a maximum uses the latest key. The shell parses a stated birth date and makes sure that it is a real calendar date. A key that the rules calculate from a typed age can be a date that does not exist, such as `20130229`. Such a key is correct for comparison and is never shown.

### A birth date gives an age on each day

The age on a day is the number of whole years from the birth key to the day key. The age goes up by one on the birthday. A person born on 29 February becomes one year older on 1 March in a year that has no 29 February. A day before the birth gives the age -1, which is not a usable age. A birth key is usable when it is on or after 1 January 1900, not after the day, and gives a usable age on that day.

```quint
pure val dayKeyYear: int = 10000
pure val earliestBirthKey: int = 19000101

pure def ageOnDay(birthKey: int, dayKey: int): int =
  if (dayKey >= birthKey) (dayKey - birthKey) / dayKeyYear else -1

pure def birthKeyUsable(birthKey: int, dayKey: int): bool =
  birthKey >= earliestBirthKey and birthKey <= dayKey and ageInRange(ageOnDay(birthKey, dayKey))

pure def lawBirthdayAddsOneYear(birthKey: int, dayKey: int): bool =
  (dayKey >= birthKey) implies ageOnDay(birthKey, dayKey + dayKeyYear) == ageOnDay(birthKey, dayKey) + 1

pure def lawLeapDayBirthdayCountsFromMarchFirst(birthYear: int, year: int): bool =
  (year > birthYear) implies (
    ageOnDay(birthYear * dayKeyYear + 229, year * dayKeyYear + 228) == year - birthYear - 1
      and ageOnDay(birthYear * dayKeyYear + 229, year * dayKeyYear + 301) == year - birthYear)

pure def lawBirthKeyUsableIsHuman(birthKey: int, dayKey: int): bool =
  birthKeyUsable(birthKey, dayKey) implies ageInRange(ageOnDay(birthKey, dayKey))

pure val birthKeyValues = Set(19000101, 18991231, 19950101, 20071122, 20071123, 20080229, 20080301, 20100315, 20101122, 20120315, 20120316, 20131122, 20131123)
pure val dayKeyValues = Set(20261121, 20261122, 20260228, 20260301, 20280229)
pure val birthYearValues = Set(2008, 2010, 2012)
pure val yearValues = Set(2025, 2026, 2028)
```

### Each age statement is a range of possible birth dates

A reading is a range of possible birth keys: above the lower key, and at or below the upper key. A stated birth date `B` is the range from `B - 1` (not included) to `B`. A typed age `a` on day `T` is the range from `T - (a + 1)` years (not included) to `T - a` years, so every birth key in it gives the age `a` on day `T`. For an age that a person stated before birth dates were kept (`statedAgeBeforeBirthDates`), the range starts from the day the person record was made and ends at the day of the migration, because the person could have typed the age on any day between the two.

```quint
type BirthReadings = { lower: int, upper: int, youngest: int }

pure def statedAgeLower(age: int, dayKey: int): int = dayKey - (age + 1) * dayKeyYear

pure def statedAgeUpper(age: int, dayKey: int): int = dayKey - age * dayKeyYear

pure def birthDateLower(birthKey: int): int = birthKey - 1

pure def statedAgeBeforeBirthDates(age: int, createdDay: int, migrationDay: int): BirthReadings =
  { lower: statedAgeLower(age, createdDay), upper: statedAgeUpper(age, migrationDay), youngest: statedAgeUpper(age, migrationDay) }

pure def lawStatedAgeReadsBack(age: int, dayKey: int): bool =
  (age >= 0) implies (
    ageOnDay(statedAgeUpper(age, dayKey), dayKey) == age
      and ageOnDay(statedAgeLower(age, dayKey) + 1, dayKey) == age
      and ageOnDay(statedAgeLower(age, dayKey), dayKey) == age + 1)

pure val ageValues = Set(-1, 0, 12, 13, 15, 16, 17, 18, 19)
```

### The youngest reading wins and an older claim never unlocks more

A person keeps the merged readings: the largest lower key, the smallest upper key, and the youngest key, which is the latest upper key ever stated. The readings conflict when the lower key is not below the upper key. Then no single birth date agrees with every statement. The effective birth key is the upper key when the readings agree, and the youngest key when they conflict. So a lower stated age wins over a birth date, a later birth date wins over an earlier one, and a conflict never clears by itself. A new reading never makes the effective birth key earlier than the key just after the lower key that the person had before, so a later claim to be older never makes a person an adult. The birth date is exact only when a birth date was stated, the readings agree, and the upper key is that birth date. A typed age that agrees with the birth date keeps the birth date exact. A minor recorded before birth dates were kept, and a phone with an age floor of 12, stay at their age when they later type an adult birth date. When a person has no readings, the lowest stored integer age decides, by the rule "An older age cannot raise the effective age"; the shell does not call `effectiveAge` then. Changed (owner decision 2026-11-22): this rule adds birth dates to "An older age cannot raise the effective age", which still holds for the integer ages.

```quint
pure def laterBirthKey(firstKey: int, secondKey: int): int = if (firstKey >= secondKey) firstKey else secondKey

pure def mergeReading(hasEarlier: bool, earlier: BirthReadings, lower: int, upper: int): BirthReadings =
  if (not(hasEarlier)) { lower: lower, upper: upper, youngest: upper }
  else {
    lower: if (earlier.lower >= lower) earlier.lower else lower,
    upper: if (earlier.upper <= upper) earlier.upper else upper,
    youngest: laterBirthKey(earlier.youngest, upper)
  }

pure def readingsConflict(readings: BirthReadings): bool = readings.lower >= readings.upper

pure def effectiveBirthKey(readings: BirthReadings): int =
  if (readingsConflict(readings)) readings.youngest else readings.upper

pure def birthDateExact(hasBirthDate: bool, birthDate: int, readings: BirthReadings): bool =
  hasBirthDate and not(readingsConflict(readings)) and readings.upper == birthDate

pure def effectiveAge(readings: BirthReadings, dayKey: int): int =
  ageOnDay(effectiveBirthKey(readings), dayKey)

pure def lawLowerStatedAgeWins(birthKey: int, age: int, dayKey: int): bool =
  val known = { lower: birthDateLower(birthKey), upper: birthKey, youngest: birthKey }
  val merged = mergeReading(true, known, statedAgeLower(age, dayKey), statedAgeUpper(age, dayKey))
  (dayKey >= birthKey and age >= 0 and age < ageOnDay(birthKey, dayKey)) implies ageOnDay(effectiveBirthKey(merged), dayKey) == age

pure def lawLaterBirthDateWins(firstKey: int, secondKey: int): bool =
  val known = { lower: birthDateLower(firstKey), upper: firstKey, youngest: firstKey }
  (firstKey < secondKey) implies effectiveBirthKey(mergeReading(true, known, birthDateLower(secondKey), secondKey)) == secondKey

pure def lawAgreeingAgeKeepsTheBirthDateExact(birthKey: int, dayKey: int): bool =
  val known = { lower: birthDateLower(birthKey), upper: birthKey, youngest: birthKey }
  val age = ageOnDay(birthKey, dayKey)
  (dayKey >= birthKey) implies birthDateExact(true, birthKey, mergeReading(true, known, statedAgeLower(age, dayKey), statedAgeUpper(age, dayKey)))

pure def lawConflictIsPermanent(earlier: BirthReadings, lower: int, upper: int): bool =
  readingsConflict(earlier) implies readingsConflict(mergeReading(true, earlier, lower, upper))

pure def lawMergeKeepsYoungest(hasEarlier: bool, earlier: BirthReadings, lower: int, upper: int): bool =
  val merged = mergeReading(hasEarlier, earlier, lower, upper)
  merged.youngest >= upper and (hasEarlier implies merged.youngest >= earlier.youngest)

pure def lawMergeKeepsWellFormed(hasEarlier: bool, earlier: BirthReadings, lower: int, upper: int): bool =
  val merged = mergeReading(hasEarlier, earlier, lower, upper)
  ((not(hasEarlier) or earlier.youngest > earlier.lower) and lower < upper) implies merged.youngest > merged.lower

pure def lawOlderClaimNeverUnlocksAdult(earlier: BirthReadings, lower: int, upper: int, dayKey: int): bool =
  (earlier.youngest > earlier.lower and lower < upper) implies
    ageOnDay(effectiveBirthKey(mergeReading(true, earlier, lower, upper)), dayKey) <= ageOnDay(earlier.lower + 1, dayKey)

pure def lawMinorBeforeBirthDatesKeepsMinorAge(adultBirthKey: int): bool =
  val before = statedAgeBeforeBirthDates(15, 20260101, 20261122)
  (adultBirthKey <= before.lower) implies
    ageOnDay(effectiveBirthKey(mergeReading(true, before, birthDateLower(adultBirthKey), adultBirthKey)), 20261122) == 15

pure def lawFloorTwelveRefusesAdultBirthDate(adultBirthKey: int): bool =
  val floor = { lower: statedAgeLower(12, 20260601), upper: statedAgeUpper(12, 20260601), youngest: statedAgeUpper(12, 20260601) }
  (adultBirthKey <= floor.lower) implies
    not(joinableAge(ageOnDay(effectiveBirthKey(mergeReading(true, floor, birthDateLower(adultBirthKey), adultBirthKey)), 20261122)))

pure val earlierValues = Set(
  { lower: 20100314, upper: 20100315, youngest: 20100315 },
  { lower: 20091122, upper: 20101122, youngest: 20101122 },
  { lower: 20120314, upper: 20100315, youngest: 20120315 },
  { lower: 20100101, upper: 20111122, youngest: 20111122 },
  { lower: 5, upper: 5, youngest: 5 })
pure val lowerValues = Set(19891231, 20071121, 20100314, 20111122, 20120314, 20131121)
pure val upperValues = Set(19900101, 20071122, 20100315, 20111122, 20120315, 20131122)
pure val firstKeyValues = Set(19900101, 20080229, 20100315, 20120315)
pure val secondKeyValues = Set(19900101, 20080301, 20100315, 20120316)
pure val adultBirthKeyValues = Set(19000101, 19900101, 20071122, 20100101, 20130601, 20130602)
```

## Story: Move from private signup eligibility to adult access

> As a member who entered my birthday on a verified signup form, I want my age limits to update when I turn 18 while the date stays private.

### A private signup date can end a birthday-only minor restriction

A successful signup from a verified browser can keep the initial minor age and the date when that member turns 18. The person can also keep an exact private birth reading from this signup when the age on the Clock date is 13 through 18. This reading makes an otherwise eligible person ready for the teen friendship age check. It follows the same younger and conflicting age rules as a birth date from text. A browser request keeps this reading only after enrollment succeeds and the app and phone still identify the member. A refusal records no exact date. A person aged 19 or more gives only the numeric age on this path. Raw dates and ranges are available only to the trusted runtime, never in a member profile, a model packet or staff output. This date stays with the verified person, separate from app profiles, staff data, and age statements heard elsewhere. Before that date, the signup observation supplies its initial age. When the Clock reaches that date, it supplies 18. A lower independent age still applies on every app. An older cached signup age can stop restricting the member only when the new effective age is an adult age and no other youth statement, signal, report or conflict keeps it restricted. An unresolved age stays restricted. If the person later gives a second accepted date, use the later date and the lower initial minor age. Deleting the account removes the date. The existing safety rule for a retained numeric age remains in force.

```quint
pure def verifiedBrowserBirthMayBeKept(enrollmentVerified: bool, age: int): bool =
  enrollmentVerified and joinableAge(age) and age <= adultAge

pure def lawBrowserBirthNeedsEligibleVerifiedEnrollment(enrollmentVerified: bool, age: int): bool =
  verifiedBrowserBirthMayBeKept(enrollmentVerified, age) implies
    (enrollmentVerified and age >= minMemberAge and age <= adultAge)

pure def signupAgeAt(initialMinorAge: int, eligibleAt: int, now: int): int =
  if (now >= eligibleAt) adultAge else initialMinorAge

pure def lawSignupAgeDoesNotAdvanceEarly(initialMinorAge: int, eligibleAt: int, now: int): bool =
  now < eligibleAt implies signupAgeAt(initialMinorAge, eligibleAt, now) == initialMinorAge

pure def lawSignupAgeAdvancesAtEligibility(initialMinorAge: int, eligibleAt: int): bool =
  signupAgeAt(initialMinorAge, eligibleAt, eligibleAt) == adultAge

pure def lawSignupAgeKeepsAnIndependentFloor(initialMinorAge: int, eligibleAt: int, now: int, independentAge: int): bool =
  lowerAge(independentAge, signupAgeAt(initialMinorAge, eligibleAt, now)) <= independentAge

pure def mayClearMaturedSignupMinor(maturedSignup: bool, currentAdult: bool, otherYouthEvidence: bool): bool =
  maturedSignup and currentAdult and not(otherYouthEvidence)

pure def lawOtherYouthEvidenceKeepsMinorRestricted(maturedSignup: bool, currentAdult: bool): bool =
  not(mayClearMaturedSignupMinor(maturedSignup, currentAdult, true))

pure def keepLaterEligibilityDate(first: int, second: int): int = if (first >= second) first else second

pure def lawAnotherSignupCannotAdvanceEligibility(first: int, second: int): bool =
  keepLaterEligibilityDate(first, second) >= first and keepLaterEligibilityDate(first, second) >= second
```
