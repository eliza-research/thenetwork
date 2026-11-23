# Teen introduction stop

Owner decision 2026-11-22: a person aged 13 to 17 may get friendship introductions to people close in age. The age rule is in [friend introductions with a minor](friendIntroAge.md). This module holds the staff controls around that rule: the stop per network, the review rubric, the teen sweep, the meeting place and time, the facts that a teen roster may use, and the relay hold. Teen introductions are on from the start in every network whose app offers them (friends.help and the Friend lane of The Network on ntwrk.party). The stop is stored network state. It is not an environment flag and not a construction option. While staff have stopped teen introductions, every minor is single-player as before. Changed (owner decision 2026-11-22, answers A2 to A5): the switch was off by default and needed two admins and a decision reference to turn on; the owner chose "on at launch, no extra checks", so it is on by default and one staff member can stop it.

## Story: Stop teen introductions at once

> As the owner, I want teen introductions on from the start, and one staff member able to stop them at once on every app that offers them and turn them on again, with an audit row each time.

### Teen introductions are on unless a stop is recorded

A network whose app offers teen friendship has teen introductions on until a staff member records a stop. A recorded stop turns them off at once, and the teen sweep closes every open teen item. A stop is recorded when the stored key `teenStop` is present, in any shape, `null` included, so a damaged record fails closed. To turn them on again, a staff member deletes the stop; no path stores `null`. One staff member acts alone: a stop needs the `admin` or `safety` role and a resume needs the `admin` role. One call acts on every network whose app offers teen friendship, and each network gets its own audit row. When the staff member does not hold the role on each of these networks, or no network offers teen friendship, the call acts on none of them, answers with a refusal, and writes a refused audit row for each network that it could not reach. Changed (owner decision 2026-11-22, A3, refix): the call acted only on the networks where the staff member held the role and answered ok, also when it stopped nothing, so staff could think that teen introductions were stopped while they still ran. Changed (owner decision 2026-11-22, answers A2 to A5): the default was off, and a second admin confirmed a request within 24 hours with a decision reference; the owner removed the default-off state and the two-admin step.

```quint
pure def teenIntrosStoredOn(appOffersTeenLane: bool, stopRecorded: bool): bool = appOffersTeenLane and not(stopRecorded)

pure def lawOnByDefault(appOffersTeenLane: bool): bool = teenIntrosStoredOn(appOffersTeenLane, false) == appOffersTeenLane

pure def lawStopRecordTurnsItOff(appOffersTeenLane: bool): bool = not(teenIntrosStoredOn(appOffersTeenLane, true))
```

### The switch turns on only in an app that offers teen friendship

Teen introductions can be on only in a network whose app offers teen friendship (friends.help and ntwrk). A request to turn them on anywhere else is refused and audited. Changed (owner decision 2026-11-22, answers A2 to A5): the owner added the Friend lane of The Network, so ntwrk offers teen friendship too.

```quint
pure def teenIntroSwitchAllowed(on: bool, appOffersTeenLane: bool): bool = not(on) or appOffersTeenLane

pure def lawSwitchOnOnlyWhereOffered(on: bool): bool = teenIntroSwitchAllowed(on, false) == not(on)
```

## Story: Stop each teen item that no longer passes the rule

> As a person aged 13 to 17, I want an introduction to stop as soon as the switch goes off or the age rule stops holding for its roster.

### A teen item continues only while the switch is on and the rule holds

An open item or relay thread whose roster has a minor continues only while the switch is on and the age rule holds for its whole roster up to the end of its meeting. The teen sweep runs this check on every network tick. An item without a minor ignores the switch. A relay thread of a teen item that is no longer open (after the meeting, or closed) passes nothing: the relay desk, the queue admission and the dispatch check all refuse it, so the thread is closed on every path. When the sweep sees a new teen-pool bar or age conflict for a member of an open teen item, it treats the member as older than stated: it closes all their teen items, places the report hold, and opens an `adult_after_teen_contact` case for each minor who shared a roster with them. A member report that says a teen-pool member lied (for example about their age) is filed as `older_than_stated`, an urgent report that holds the member for staff. A `minor` report about a known minor closes all their teen items and opens an `adult_after_teen_contact` case for each minor who shared a roster with them; it places no bar (a staff teen doubt clear can return the member to the pool). Changed (owner decision 2026-11-22, answer Q22): before, a `minor` report about a known minor closed their teen items but opened no case for the other minors on those rosters. Changed (owner decision 2026-11-22, review of the first build): an older-than-stated finding closed the items and barred the phone but placed no report hold, and a bar or conflict seen in the stored ages opened no case. An open teen item that fails any part of the rule (the stop, the age rule for the whole roster, the friendship shape, the size of a group, or the all-ages place of a plan) closes as a whole with a notice that names nobody; no member is dropped and no replacement or fallback is offered, because the probe told each member the place. Changed (owner decision 2026-11-22, answers A2 to A5): the owner allowed small teen groups, so a group item that stops passing the rule closes for everyone instead of continuing with fewer people.

```quint
pure def teenItemContinues(switchOn: bool, rosterHasMinor: bool, ruleHolds: bool): bool =
  not(rosterHasMinor) or (switchOn and ruleHolds)

pure def lawSwitchOffEndsTeenItems(rosterHasMinor: bool, ruleHolds: bool): bool =
  teenItemContinues(false, rosterHasMinor, ruleHolds) == not(rosterHasMinor)

pure def lawAdultItemsIgnoreTheSwitch(switchOn: bool, ruleHolds: bool): bool = teenItemContinues(switchOn, false, ruleHolds)
```

## Story: Judge each teen introduction with the strict rubric

> As a person aged 13 to 17, I want each introduction that includes me to be approved only by the review judge with the strict rubric, or by a named staff member when the judge holds it.

### A teen item is approved by the judge with the strict rubric or by staff

An item whose final roster has a minor, alternates and plan host included, is read by the review judge with the strict minor rubric ([automated review](automatedReview.md) `reviewRubric`). The judge approves it, or holds it for staff; a named staff member in the normal reviewer role approves or edits only an item that the judge held. The age rules of [friend introductions with a minor](friendIntroAge.md) are code gates that run before the judge and again at send time; the model never decides an age. Changed (owner decision 2026-11-22, D16, "Everything automated"): a named person in the normal reviewer role approved each teen item and no automatic review approved one; the owner chose full automation, so the judge approves a teen item with the strict rubric and staff see it only when the judge holds it. Changed (owner decision 2026-11-22, answers A2 to A5): an explicit safety grant was needed, and a reviewer who turned the switch on was refused; the owner chose "no extra checks".

```quint
import automatedReview as Review from "./automatedReview"

pure def lawTeenRosterIsJudgedStrictly(rosterHasMinor: bool): bool =
  rosterHasMinor implies Review::reviewRubric(rosterHasMinor) == Review::MinorRubric

pure val rosterHasMinorValues = Set(false, true)
```

## Story: Meet only in public in the daytime

> As a person aged 13 to 17, I want a teen introduction to meet only at a public place in the daytime.

### A teen meeting is at a meeting spot between 10:00 and 19:00

A meeting whose roster has a minor uses a public meeting spot of the place catalog, never a venue from an app pack hook or an event listing. It starts at 10:00 or later and ends at 19:00 or earlier, New York time (minutes 600 and 1140 of the day). No open scheduled item with a person aged 19 or more is at the same venue within 2 hours. Otherwise no common time is found and the item closes. A teen plan of friends.help meets at its place of the plan catalog (`PLAN_VENUES`), which counts as a public meeting spot and not as a pack venue. An adult booking also skips a slot at a venue where a scheduled teen item meets within 2 hours. Changed (owner decision 2026-11-22, answers A2 to A5): small teen groups meet at all-ages places of the plan catalog, and the nearby check now runs both ways.

```quint
pure val teenMeetingFirstMinute: int = 600
pure val teenMeetingLastMinute: int = 1140

pure def teenMeetingAllowed(rosterHasMinor: bool, packVenue: bool, startMinute: int, endMinute: int, adultSessionNearby: bool): bool =
  not(rosterHasMinor) or (not(packVenue) and startMinute >= teenMeetingFirstMinute and endMinute <= teenMeetingLastMinute and not(adultSessionNearby))

pure def lawTeenMeetingIsDaytimePublic(packVenue: bool, startMinute: int, endMinute: int, adultSessionNearby: bool): bool =
  teenMeetingAllowed(true, packVenue, startMinute, endMinute, adultSessionNearby)
    implies (not(packVenue) and startMinute >= 600 and endMinute <= 1140 and not(adultSessionNearby))

pure val startMinuteValues = Set(599, 600, 1140, 1141)
pure val endMinuteValues = Set(599, 600, 1140, 1141)
```

## Story: Share only interests in a teen introduction

> As a person aged 13 to 17, I want an introduction to use only my interests and boundaries, never a fact about my life or my schedule.

### A teen roster uses interest and boundary facets only

The matching input of a teen-ready member who is not an adult holds only interest and boundary facets. A probe or an explanation for a roster with a minor names only facet tags and the borough: no free facet text, home zone, travel time or schedule.

```quint
pure def teenFacetAllowed(kind: str): bool = kind == "interest" or kind == "boundary"

pure def lawTeenFacetsAreInterestsOnly(kind: str): bool = teenFacetAllowed(kind) implies (kind == "interest" or kind == "boundary")

pure val kindValues = Set("interest", "boundary", "fact", "availability_pattern")
```

## Story: Hold each teen relay text that does not pass cleanly

> As a person aged 13 to 17, I want each relayed text that the rules or the classifier do not pass cleanly to stay unsent.

### A teen-pair text that does not pass cleanly is held

In a teen pair, a text that the relay rules or the classifier do not pass cleanly, or that no classifier read, is not sent: `teenRelayHeld` is true for it, the engine gives it a reason, and the relay desk blocks it and tells the sender at once ([relay decision](relayDecision.md)). Texts between adults keep the existing relay policy. A minor's own words about their age in a teen-pair text open a minor signal only when they state an age younger than the record. Changed (owner decision 2026-11-22, D18, "Automate relay holds too"): such a text was held for a staff reviewer, and a staff release ran the age rule again; now no relayed text waits for staff, so the text is blocked, and the function keeps its name and meaning (the text did not pass cleanly). Changed (owner decision 2026-11-22, answers A2 to A5): the text was held for a reviewer with the safety role, and every minor signal in teen text closed the sender's items; the owner removed the extra safety role, and an age that matches the record is not a doubt.

```quint
pure def teenRelayHeld(teenPair: bool, cleanPass: bool): bool = teenPair and not(cleanPass)

pure def lawTeenRelayHoldsUnclean(cleanPass: bool): bool = teenRelayHeld(true, cleanPass) == not(cleanPass)
```
