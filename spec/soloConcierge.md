# Solo event recommendations

[Story F10](product/stories.md#story-f10--get-concierge-value) asks for useful ideas before anyone else needs to be involved. The [published event catalog](publicEventCatalog.md) supplies current NYC Parks listings. A direct member request chooses the solo event format. Event introductions follow [F13](product/stories.md#story-f13--meet-at-an-event).

## Story: Get ideas for my own time

> As a member, I want up to three public events that fit the time I requested and my own location and interests.

### A current request can use only listings safe for the member's age and location

Use the lowest known age of the active member in this app and only a fresh, future, allowed listing. A member under eighteen needs an explicit all-ages label. A listing's higher stated minimum age applies to adults too. The full event must fit the requested window, the member's presence in the city and any saved availability. Use the saved travel tolerance if both the member's area and the event's area are known. A trip away takes precedence over home city. An optional detail the member never supplied does not mean they are unavailable.

```quint
import memberAge as Age from "./memberAge"

pure def soloEventAgeAllowed(age: int, minimum: int, allAges: bool): bool =
  Age::joinableAge(age) and age >= minimum and (Age::matchableAge(age) or allAges)

pure def soloEventCityAllowed(home: bool, visiting: bool, away: bool): bool =
  not(away) and (home or visiting)

pure def soloEventEligible(freshListed: bool, fitsRequest: bool, present: bool, hasAvailability: bool, fitsAvailability: bool, hasTripLimit: bool, travelMinutes: int, limit: int): bool =
  freshListed and fitsRequest and present and (not(hasAvailability) or fitsAvailability)
    and (not(hasTripLimit) or travelMinutes <= limit)

pure def lawYoungSoloListingsNeedAllAges(age: int, minimum: int): bool =
  age < Age::adultAge implies not(soloEventAgeAllowed(age, minimum, false))

pure def lawTripAwayPreventsLocalSuggestion(home: bool, visiting: bool): bool =
  not(soloEventCityAllowed(home, visiting, true))
```

### Reply with at most three public events and a reason for each

Rank eligible events by matching saved interests, estimated travel, then the earliest start. Use a stable listing order when all three are equal. Give the title, local time, venue, official link, and a reason that includes no member information. The exact links for listings selected for this reply may pass its contact check. All private facts and other contact text still pass the leak checks. If nothing fits, say so. A catalog read failure does not establish that no event fits. The reply neither contacts anyone else nor creates a booking or matching request. A stored reply can replay only while the same member would receive the same current answer.

```quint
pure val maxSoloEventOptions = 3

pure def soloEventPrecedes(fit: int, minutes: int, start: int, otherFit: int, otherMinutes: int, otherStart: int): bool =
  fit > otherFit or (fit == otherFit and (minutes < otherMinutes or (minutes == otherMinutes and start < otherStart)))

pure def soloReplyReplayAllowed(authorized: bool, sameLiveReply: bool): bool =
  authorized and sameLiveReply

pure def lawChangedSoloReplyCannotReplay(authorized: bool): bool =
  not(soloReplyReplayAllowed(authorized, false))
```
