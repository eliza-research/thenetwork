# Publish current public event supply

[Stories F9 and F13](product/stories.md#story-f9--keep-a-standing-intent) use public listings as matching evidence. The pilot catalog reads the [NYC Parks public events dataset](https://data.cityofnewyork.us/City-Government/NYC-Parks-Public-Events-Upcoming-14-Days/w3wp-dpdi). A separate ingest role writes the catalog. The app and Observatory read it. A catalog row never represents a member, private calendar, or guest list.

## Story: Find a current public event

> As a member, I want the Network to use a real public listing when it looks for something to do.

### Use only an upcoming event from the allowed in-person supply

Use the Parks listing when the link names the official Parks event, the time and location are known, and the feed does not label the event online or aimed at children. The listing is in the next fourteen days. Keep the title, venue, location, date, categories and source link. The shell rejects ambiguous local times and leaves out descriptions, contact details and registration information.

```quint
pure val publicEventHorizonDays = 14

pure def publicEventWindowUsable(asOf: int, startsAt: int, endsAt: int): bool =
  startsAt > asOf and startsAt <= asOf + publicEventHorizonDays * 86400000 and endsAt > startsAt

pure def publicEventAllowed(officialLink: bool, publicPlace: bool, online: bool, youth: bool, asOf: int, startsAt: int, endsAt: int): bool =
  officialLink and publicPlace and not(online) and not(youth) and publicEventWindowUsable(asOf, startsAt, endsAt)
```

### A successful complete scan replaces the previous source and expires if refresh stops

Publish a complete scan atomically, with one row per source id. A scan started earlier cannot replace a newer scan. A failure leaves the last scan in place. The daily source is usable for two days after a successful scan. The shell reads only the requested city's current published listings. Republishing identical events does not change matching evidence.

```quint
pure val publicEventFreshDays = 2

pure def publicEventPublicationNewer(seen: bool, checkedAt: int, incomingAt: int): bool =
  not(seen) or incomingAt > checkedAt

pure def publicEventCatalogFresh(checkedAt: int, asOf: int): bool =
  checkedAt <= asOf and checkedAt + publicEventFreshDays * 86400000 > asOf

pure def lawCatalogExpiresAtLimit(checkedAt: int): bool =
  not(publicEventCatalogFresh(checkedAt, checkedAt + publicEventFreshDays * 86400000))
```

### A contact or booking uses the same current listing that entered review

A change to the listed event, venue or time invalidates a pending opportunity. Recheck the bound listing and each participant's adult eligibility, category choice and event format before reviewer approval, while sending invitations, and before booking. Use that listing's venue, time and official link when confirming a co-attendance. A solo event suggestion can include the same public link. Independent consent and the usual review and dispatch rules still apply.

```quint
pure def publicEventRevisionMatches(bound: str, available: str): bool = bound != "" and bound == available

pure def publicEventMemberAllowsMatch(adult: bool, categoryAllowed: bool, eventFormatAllowed: bool): bool =
  adult and categoryAllowed and eventFormatAllowed
```

### A closed event opportunity without contact does not use a matching slot

After an unsent public event opportunity closes, it is no longer an active duplicate or a charged introduction. A corrected listing can become a new opportunity that needs its own review. The existing limits still apply to a review rejection and to recorded contacts.

```quint
pure def closedPublicEventIsUnsent(bound: bool, closed: bool, contacted: bool): bool =
  bound and closed and not(contacted)
```

### The send guard allows the exact official link in a booked confirmation

The contact check may allow the current listing's exact official link once, as the last line of a confirmation for that booked opportunity, to a participant who consented. Private facts, canaries and all other contact details still go through the normal checks.

```quint
pure def publicBookedEventLinkAllowed(booked: bool, consenting: bool, exactFinalLine: bool): bool =
  booked and consenting and exactFinalLine
```
