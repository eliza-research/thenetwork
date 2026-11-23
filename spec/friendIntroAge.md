# Friend introductions with a minor

Owner decision 2026-11-22: a person aged 13 to 17 gets a single-player experience and friendship introductions only, never romance. The owner said: "We should only introduce teens to people over 13 and within 2 years of their age, unless they are 18." This module holds the age decisions for such an introduction. Every path that can put two people in touch calls them: the matching engine, the review desk, each send, the relay, the inbox updates and the teen sweep. The [member age](memberAge.md) module gives the birth keys and the age on a day. The [match lane](matchLane.md) module says which app and lane offer teen friendship: friends.help and the Friend lane of The Network on ntwrk.party. The teen introduction stop module (`spec/teenIntroSwitch.md`) holds the staff stop. Teen introductions are on from the start, and the parameter `teenIntros` means that staff have not stopped them. The whole-flow models call this rule `teenFriendAgeRule`.

The safeguards: nobody aged 19 or more is ever introduced to, grouped with, shown to or relayed to a minor. Both people of a teen pair need an exact birth date. The review judge reviews every introduction with the strict rubric, and staff review only an introduction that the judge holds. Romance and work never admit a minor. A minor gets no number relay and no photo relay. A group with a minor is small, keeps every minor within 2 years of everyone in it, and meets at an all-ages public place. While staff have stopped teen introductions, every minor is single-player as before. Changed (owner decisions D1 and D16 of 2026-11-22): teen introductions are on at launch, also run in the ntwrk Friend lane and also come as small groups, the review judge replaces staff review, and one staff stop replaces the staff age confirmation and the two-admin switch.

## Story: Introduce a minor for friendship only to people close in age

> As a person aged 13 to 17, I want friendship introductions only to people close to my age, alone or in a small group at a public all-ages place.

### A teen partner is 13 to 18 on every day of the introduction

A person in a teen introduction is at least 13 on the earliest day of the check and at most 18 on the latest day. The earliest day is the earliest civil date on Earth now. The latest day is the latest civil date on Earth at the later of now and the end of the meeting. So a person who becomes 19 anywhere on Earth before the meeting ends is not a teen partner. Changed (owner decision D1 of 2026-11-22): this rule is new, because the owner allowed friendship introductions to people aged 13 to 18.

```quint
import memberAge as Age from "./memberAge"

pure val teenFriendMinAge: int = 13
pure val teenFriendMaxAge: int = 18

pure def teenPartnerAge(birthKey: int, minDay: int, maxDay: int): bool =
  Age::ageOnDay(birthKey, minDay) >= teenFriendMinAge and Age::ageOnDay(birthKey, maxDay) <= teenFriendMaxAge

pure val birthKeyValues = Set(19950101, 20071122, 20071123, 20080301, 20081123, 20091122, 20100315, 20101122, 20120315, 20120316, 20131122, 20131123)
pure val minDayValues = Set(20261121, 20261122, 20280229)
pure val maxDayValues = Set(20261122, 20261123, 20280301)
```

### Two teen birth dates are at most 2 calendar years apart

The owner's "within 2 years" is read by birth date: the two birth dates are at most 2 calendar years apart. Born 15 March 2010 and 15 March 2012 is allowed. Born 14 March 2010 and 15 March 2012 is not. Changed (owner decision D1 of 2026-11-22): this rule is new; it reads the owner's "within 2 years of their age" as a gap between birth dates, because a gap between ages would change on each birthday.

```quint
pure val teenBirthGap: int = 20000

pure def birthKeysWithinTwoYears(firstKey: int, secondKey: int): bool =
  if (firstKey >= secondKey) firstKey - secondKey <= teenBirthGap else secondKey - firstKey <= teenBirthGap
```

### Only a teen-ready person enters a teen introduction

A person is teen ready when the record has an exact birth date, the age readings do not conflict, no minor signal is open, no report says that the person is a minor or older than stated, and the phone has no teen-pool bar. No staff step is necessary: a person with an exact birth date and no doubt is teen ready. A person with only a typed age, or an unknown age, is never teen ready. An 18-year-old partner needs the same. A conflict bars the phone from the teen pool when the youngest reading gives an age of 18 or less on the latest day. Changed (owner decision 2026-11-22, answers A2 to A5): the staff age confirmation is removed, because the owner chose "On at launch, no extra checks"; every doubt still makes the person unready.

```quint
pure def teenReady(birthExact: bool, ageConflict: bool, minorSignalOpen: bool, minorReported: bool,
    olderReported: bool, barred: bool): bool =
  birthExact and not(ageConflict) and not(minorSignalOpen) and not(minorReported) and not(olderReported) and not(barred)

pure def teenBarOnConflict(conflict: bool, youngestMaxAge: int): bool = conflict and youngestMaxAge <= teenFriendMaxAge

pure def lawTeenReadyNeedsExactBirthDate(ageConflict: bool, minorSignalOpen: bool, minorReported: bool, olderReported: bool, barred: bool): bool =
  not(teenReady(false, ageConflict, minorSignalOpen, minorReported, olderReported, barred))

pure def lawTeenReadyWithoutStaffStep(birthExact: bool): bool =
  birthExact implies teenReady(birthExact, false, false, false, false, false)

pure def lawAnyDoubtMakesUnready(birthExact: bool, ageConflict: bool, minorSignalOpen: bool, minorReported: bool, olderReported: bool, barred: bool): bool =
  teenReady(birthExact, ageConflict, minorSignalOpen, minorReported, olderReported, barred)
    implies not(ageConflict or minorSignalOpen or minorReported or olderReported or barred)
```

### A teen-ready person needs no staff verification on friends.help

On friends.help an adult is matched only after the staff liveness and age checks pass. A teen-ready person needs no such check: the exact birth date and the teen-ready state are the check. Changed (owner decision 2026-11-22, D1): the friends pack refused every person without the staff checks, so a teen-ready minor was never matched in production, because only the staff verify step writes those checks and the owner removed the staff confirm-age step.

```quint
pure def friendsVerifyPasses(teenReady: bool, staffVerified: bool): bool = teenReady or staffVerified

pure def lawTeenReadyNeedsNoStaffVerify(staffVerified: bool): bool = friendsVerifyPasses(true, staffVerified)

pure def lawUnreadyNeedsStaffVerify(staffVerified: bool): bool = friendsVerifyPasses(false, staffVerified) == staffVerified
```

### A pair with a minor needs teen introductions not stopped, a friendship lane and the age rule

Two adults pair as before. A pair in which one person is not an adult is allowed only when staff have not stopped teen introductions (`teenIntros`), the item is in a friendship lane, both people are teen ready, both are 13 to 18 on every day of the introduction, at least one of them is under 18 on the earliest day, and their birth dates are at most 2 years apart. So a 15-year-old can meet a 17-year-old and a 16-year-old can meet an 18-year-old, but nobody aged 19 or more meets a minor. While teen introductions are stopped, the rule is the adult rule. Changed (owner decision D1 of 2026-11-22, "On at launch, no extra checks"): `teenIntros` is now true unless one staff member stopped teen introductions; before, it was true only after two admins turned it on.

```quint
type AgeSide = { adult: bool, ready: bool, birthKey: int }

pure def teenPairAllowed(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstReady: bool, firstKey: int, secondReady: bool, secondKey: int): bool =
  teenIntros and friendshipLane and firstReady and secondReady
    and teenPartnerAge(firstKey, minDay, maxDay) and teenPartnerAge(secondKey, minDay, maxDay)
    and (Age::ageOnDay(firstKey, minDay) < Age::adultAge or Age::ageOnDay(secondKey, minDay) < Age::adultAge)
    and birthKeysWithinTwoYears(firstKey, secondKey)

pure def pairAgeAllowed(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (firstAdult and secondAdult)
    or teenPairAllowed(teenIntros, friendshipLane, minDay, maxDay, firstReady, firstKey, secondReady, secondKey)

pure def sidesAllowed(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, first: AgeSide, second: AgeSide): bool =
  pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, first.adult, first.ready, first.birthKey, second.adult, second.ready, second.birthKey)

pure def lawAdultPairUnchanged(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (firstAdult and secondAdult)
    implies pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)

pure def lawStoppedIsTheAdultRule(friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  pairAgeAllowed(false, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    == (firstAdult and secondAdult)

pure def lawMinorPairOnlyInFriendshipLanes(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    and not(firstAdult and secondAdult)) implies (teenIntros and friendshipLane)

pure def lawMinorPartnerIsThirteenToEighteen(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    and not(firstAdult and secondAdult)) implies (
      Age::ageOnDay(firstKey, minDay) >= 13 and Age::ageOnDay(secondKey, minDay) >= 13
        and Age::ageOnDay(firstKey, maxDay) <= 18 and Age::ageOnDay(secondKey, maxDay) <= 18)

pure def lawNineteenNeverWithAMinor(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (Age::ageOnDay(firstKey, maxDay) >= 19 and not(secondAdult))
    implies not(pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey))

pure def lawMinorPairWithinTwoYears(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    and not(firstAdult and secondAdult)) implies birthKeysWithinTwoYears(firstKey, secondKey)

pure def lawMinorPairNeedsReadySides(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  (pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    and not(firstAdult and secondAdult)) implies (firstReady and secondReady)

pure def lawPairAgeSymmetric(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int,
    firstAdult: bool, firstReady: bool, firstKey: int, secondAdult: bool, secondReady: bool, secondKey: int): bool =
  pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, firstAdult, firstReady, firstKey, secondAdult, secondReady, secondKey)
    == pairAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, secondAdult, secondReady, secondKey, firstAdult, firstReady, firstKey)

pure def lawTeenPairWitness(teenIntros: bool): bool =
  teenIntros implies teenPairAllowed(teenIntros, true, 20261122, 20261122, true, 20100315, true, 20120315)

pure def lawNineteenEdgeRefused(friendshipLane: bool): bool =
  not(teenPairAllowed(true, friendshipLane, 20261121, 20261122, true, 20071122, true, 20091122))

pure val firstKeyValues = Set(19950101, 20071122, 20071123, 20080301, 20081123, 20091122, 20100315, 20101122, 20120315, 20120316, 20131122, 20131123)
pure val secondKeyValues = Set(19950101, 20071122, 20071123, 20080301, 20081123, 20091122, 20100315, 20101122, 20120315, 20120316, 20131122, 20131123)
```

### A group with a minor holds only people who pass the pair rule with every member

The caller passes the whole roster of an introduction: the participants, the alternates and the plan host. This rule admits a roster of one person who passes the pair rule with themself; a roster of one is not an introduction, so every caller also applies the size rule below (`teenRosterSizeAllowed`). The roster is allowed only when every two people in it pass the pair rule, so a group with a minor holds only teen-ready people aged 13 to 18 whose birth dates are within 2 years of each minor's birth date. A warm path, a via or an introducer is never used for a roster with a minor. Changed (owner decision 2026-11-22, answers A2 to A5): the owner allowed small teen groups, so the roster now includes the plan host, the size rule is named, and the sample rosters add two groups of three that the rule refuses and one group of three (two minors and an 18-year-old, all birth dates within 2 years) that the rule accepts, so that each group law is checked on a group that the rule admits.

```quint
pure def sideAllowedWithAll(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, first: AgeSide, members: List[AgeSide]): bool =
  members.every(second => sidesAllowed(teenIntros, friendshipLane, minDay, maxDay, first, second))

pure def groupAgeAllowed(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, members: List[AgeSide]): bool =
  members.every(first => sideAllowedWithAll(teenIntros, friendshipLane, minDay, maxDay, first, members))

pure def rosterHasMinor(members: List[AgeSide]): bool = members.some(side => not(side.adult))

pure def viaAllowedForRoster(members: List[AgeSide]): bool = not(rosterHasMinor(members))

pure def lawGroupWithMinorHoldsOnlyTeenAges(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: List[AgeSide]): bool =
  (groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) and rosterHasMinor(roster))
    implies roster.every(side => side.ready and teenPartnerAge(side.birthKey, minDay, maxDay))

pure def lawGroupStoppedAdultsOnly(friendshipLane: bool, minDay: int, maxDay: int, roster: List[AgeSide]): bool =
  groupAgeAllowed(false, friendshipLane, minDay, maxDay, roster) == roster.every(side => side.adult)

pure def lawViaNeverWithAMinor(roster: List[AgeSide]): bool =
  rosterHasMinor(roster) implies not(viaAllowedForRoster(roster))

pure val rosterValues = Set(
  List(),
  List({ adult: false, ready: true, birthKey: 20100315 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: false, ready: true, birthKey: 20090601 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: true, ready: true, birthKey: 20080601 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: true, ready: true, birthKey: 20071122 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: true, ready: false, birthKey: 19960101 }),
  List({ adult: false, ready: true, birthKey: 20131122 }, { adult: false, ready: true, birthKey: 20100315 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: false, ready: false, birthKey: 20110601 }),
  List({ adult: false, ready: true, birthKey: 20120315 }, { adult: false, ready: true, birthKey: 20110315 }, { adult: false, ready: true, birthKey: 20100314 }),
  List({ adult: true, ready: false, birthKey: 19960101 }, { adult: true, ready: false, birthKey: 19860101 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: true, ready: true, birthKey: 20080601 }, { adult: true, ready: true, birthKey: 20071122 }),
  List({ adult: false, ready: true, birthKey: 20110601 }, { adult: false, ready: true, birthKey: 20100315 }, { adult: true, ready: true, birthKey: 20080601 }),
  List({ adult: false, ready: true, birthKey: 20100315 }, { adult: false, ready: true, birthKey: 20090601 }, { adult: true, ready: true, birthKey: 20080601 }))
```

### A group with a minor holds nobody aged 19 or more and keeps every minor within 2 years of everyone

A group plan, table, crew or circle may hold a minor. In such a group, every person is teen ready and aged 13 to 18 on every day of the introduction, so nobody in it is 19 or more on the latest day, and each minor's birth date is at most 2 calendar years from the birth date of every other person in it. Two 18-year-olds in the group pass as an adult pair whatever their gap, because each of them is still within 2 years of each minor. Changed (owner decision 2026-11-22, answers A2 to A5): this rule is new, because the owner allowed small teen groups ("Also small teen groups").

```quint
pure def teenSideFits(side: AgeSide, minDay: int, maxDay: int): bool = side.ready and teenPartnerAge(side.birthKey, minDay, maxDay)

pure def lawGroupNineteenNeverWithAMinor(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: List[AgeSide]): bool =
  (groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) and rosterHasMinor(roster))
    implies roster.every(side => Age::ageOnDay(side.birthKey, maxDay) <= teenFriendMaxAge)

pure def lawGroupMinorWithinTwoYearsOfEveryone(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: List[AgeSide]): bool =
  (groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) and rosterHasMinor(roster))
    implies roster.every(first => first.adult or roster.every(second => birthKeysWithinTwoYears(first.birthKey, second.birthKey)))

pure def lawGroupWithMinorEverySideFits(teenIntros: bool, friendshipLane: bool, minDay: int, maxDay: int, roster: List[AgeSide]): bool =
  (groupAgeAllowed(teenIntros, friendshipLane, minDay, maxDay, roster) and rosterHasMinor(roster))
    implies roster.every(side => teenSideFits(side, minDay, maxDay))
```

### A teen introduction has the shape of a friendship meeting

An item with a minor is a friendship meeting: it is in a friendship lane, it is one to one or a small group, every person in it (each participant, each alternate and the plan host) has the role peer or guest, it has no via and no introducer, and no event anchors it. A host, a helper, a provider, a connector, a newcomer, an attendee, a seeker or an initiator role is never a teen role, so a contributor item never holds a minor. A person with no stored role makes the item fail. Changed (owner decision 2026-11-22, answers A2 to A5): this rule is new, because teen introductions now also run in the ntwrk Friend lane, where other item shapes exist.

```quint
pure def teenFriendRole(role: str): bool = role == "peer" or role == "guest"

pure def teenFriendFormat(format: str): bool = format == "one_to_one" or format == "small_group"

pure def teenIntroShape(friendshipLane: bool, format: str, everyRoleTeen: bool, hasVia: bool, eventAnchored: bool): bool =
  friendshipLane and teenFriendFormat(format) and everyRoleTeen and not(hasVia) and not(eventAnchored)

pure def lawTeenShapeNeedsFriendshipLane(format: str, everyRoleTeen: bool, hasVia: bool, eventAnchored: bool): bool =
  not(teenIntroShape(false, format, everyRoleTeen, hasVia, eventAnchored))

pure def lawTeenShapeNeverAnEvent(friendshipLane: bool, everyRoleTeen: bool, hasVia: bool, eventAnchored: bool): bool =
  not(teenIntroShape(friendshipLane, "event", everyRoleTeen, hasVia, eventAnchored))
    and not(teenIntroShape(friendshipLane, "small_group", everyRoleTeen, hasVia, true))

pure def lawTeenShapeNeverVia(friendshipLane: bool, format: str, everyRoleTeen: bool, eventAnchored: bool): bool =
  not(teenIntroShape(friendshipLane, format, everyRoleTeen, true, eventAnchored))

pure def lawContributorRolesAreNotTeenRoles(role: str): bool =
  (role == "host" or role == "helper" or role == "provider" or role == "connector" or role == "newcomer"
    or role == "attendee" or role == "seeker" or role == "initiator") implies not(teenFriendRole(role))

pure val roleValues = Set("peer", "guest", "host", "helper", "provider", "connector", "newcomer", "attendee", "seeker", "initiator")
pure val formatValues = Set("one_to_one", "small_group", "event")
```

### A group with a minor is small

A roster with a minor holds 2 to 6 people: the participants, the alternates and the plan host together. 6 is the largest friend circle and table. There is no larger bench of alternates, because an alternate can learn the first name of a minor. A roster with only adults keeps its size rules. Changed (owner decision 2026-11-22, answers A2 to A5): this rule is new, because the owner allowed small teen groups.

```quint
pure val teenRosterMaximum: int = 6

pure def teenRosterSizeAllowed(hasMinor: bool, rosterSize: int): bool =
  not(hasMinor) or (rosterSize >= 2 and rosterSize <= teenRosterMaximum)

pure def lawTeenRosterIsSmall(rosterSize: int): bool =
  teenRosterSizeAllowed(true, rosterSize) implies (rosterSize >= 2 and rosterSize <= teenRosterMaximum)

pure def lawAdultRosterSizeUnchanged(rosterSize: int): bool = teenRosterSizeAllowed(false, rosterSize)

pure val rosterSizeValues = Set(0, 1, 2, 6, 7, 12)
```

### A group with a minor meets at an all-ages place

A group with a minor meets only at a place marked all-ages, and when it has an activity, only for an activity marked all-ages. An all-ages mark is valid only for an entry that opens at 13 or younger, has a low risk class and is not an adult place. An adult place is a bar, a private home, a place that serves alcohol to the group, or a place with an adult door policy. A group with a minor gets only all-ages activities. An adult group gets the activities marked for adult plans, as before. Changed (owner decision 2026-11-22, answers A2 to A5): this rule is new, because the owner allowed small teen groups at all-ages public places ("Also small teen groups").

```quint
pure def teenPlaceAllowed(hasMinor: bool, hasActivity: bool, activityAllAges: bool, venueAllAges: bool): bool =
  not(hasMinor) or (venueAllAges and (not(hasActivity) or activityAllAges))

pure def allAgesMarkValid(allAges: bool, ageMin: int, riskLow: bool, adultPlace: bool): bool =
  not(allAges) or (ageMin <= teenFriendMinAge and riskLow and not(adultPlace))

pure def teenActivityOffered(hasMinor: bool, allAges: bool, adultPlans: bool): bool =
  if (hasMinor) allAges else adultPlans

pure def lawTeenPlaceIsAllAges(hasActivity: bool, activityAllAges: bool, venueAllAges: bool): bool =
  teenPlaceAllowed(true, hasActivity, activityAllAges, venueAllAges) implies (venueAllAges and (not(hasActivity) or activityAllAges))

pure def lawAdultPlaceUnchanged(hasActivity: bool, activityAllAges: bool, venueAllAges: bool): bool =
  teenPlaceAllowed(false, hasActivity, activityAllAges, venueAllAges)

pure def lawAllAgesNeverABarOrHome(ageMin: int, riskLow: bool): bool = not(allAgesMarkValid(true, ageMin, riskLow, true))

pure def lawAllAgesOpensAtThirteen(ageMin: int, riskLow: bool, adultPlace: bool): bool =
  allAgesMarkValid(true, ageMin, riskLow, adultPlace) implies ageMin <= teenFriendMinAge

pure def lawAdultPlansKeepTheirCatalog(allAges: bool, adultPlans: bool): bool = teenActivityOffered(false, allAges, adultPlans) == adultPlans

pure def lawTeenGroupsGetOnlyAllAges(allAges: bool, adultPlans: bool): bool = teenActivityOffered(true, allAges, adultPlans) == allAges

pure val ageMinValues = Set(0, 12, 13, 14, 18, 21)
```

### A minor gets moderated text relay only

Two adults keep every relay kind. A minor gets a text item only, and only inside a teen pair that passes the pair rule at that moment. A phone number, a photo or any other item that is not text is never relayed from or to a minor. Changed (owner decision D1 of 2026-11-22): this rule is new; before, a minor had no relay of any kind, because a minor had no introductions.

```quint
pure def relayKindAllowed(textItem: bool, bothAdults: bool, teenPair: bool): bool = bothAdults or (textItem and teenPair)

pure def lawNoNumberOrPhotoWithAMinor(teenPair: bool): bool = not(relayKindAllowed(false, false, teenPair))

pure def lawAdultRelayUnchanged(textItem: bool, teenPair: bool): bool = relayKindAllowed(textItem, true, teenPair)
```

### A minor stays single-player unless a teen introduction is open to them

A minor is a teen friend candidate only when staff have not stopped teen introductions, the app offers teen friendship, the minor is teen ready, and the minor is 13 to 17 on the earliest day and at most 18 on the latest day. Every other minor is single-player exactly as before. An adult is never single-player because of age. Changed (owner decision D1 of 2026-11-22): `teenIntros` is now true unless staff stopped teen introductions, and `teenApp` is now true on ntwrk.party as well as on friends.help.

```quint
pure def teenFriendCandidate(adult: bool, ready: bool, birthKey: int, minDay: int, maxDay: int, teenIntros: bool, teenApp: bool): bool =
  not(adult) and teenIntros and teenApp and ready and teenPartnerAge(birthKey, minDay, maxDay) and Age::ageOnDay(birthKey, minDay) < Age::adultAge

pure def singlePlayerMember(adult: bool, teenCandidate: bool): bool = not(adult) and not(teenCandidate)

pure def lawStoppedMinorIsSinglePlayer(adult: bool, ready: bool, birthKey: int, minDay: int, maxDay: int, teenApp: bool): bool =
  not(adult) implies singlePlayerMember(adult, teenFriendCandidate(adult, ready, birthKey, minDay, maxDay, false, teenApp))

pure def lawUnreadyMinorIsSinglePlayer(adult: bool, birthKey: int, minDay: int, maxDay: int, teenIntros: bool, teenApp: bool): bool =
  not(adult) implies singlePlayerMember(adult, teenFriendCandidate(adult, false, birthKey, minDay, maxDay, teenIntros, teenApp))

pure def lawAdultIsNeverSinglePlayerByAge(teenCandidate: bool): bool = not(singlePlayerMember(true, teenCandidate))
```

### A statement opens a minor signal only on new evidence

A statement opens a person minor signal when the record does not already know that the person is a minor, or when the person says an age lower than the record. A teen who states the age that the record already holds opens nothing, so the statement does not take the teen out of the teen pool. Changed (owner decision D1 of 2026-11-22): with the staff age confirmation removed, an open signal takes a ready teen out of the teen pool until staff clear it, so this rule keeps a teen who repeats the age on the record in the pool.

```quint
pure def minorSignalOpens(recordKnownMinor: bool, saysYounger: bool): bool = not(recordKnownMinor) or saysYounger

pure def lawAdultRecordOpensOnEvidence(saysYounger: bool): bool = minorSignalOpens(false, saysYounger)

pure def lawAgreeingMinorStatementOpensNothing(recordKnownMinor: bool): bool =
  recordKnownMinor implies not(minorSignalOpens(recordKnownMinor, false))
```
