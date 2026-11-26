# Work introduction hand-off channels

Work introductions use double-opted-in digital hand-off channels for adults only. The channel set excludes in-person venues, group SMS, and cold three-way calls.

## Story: Hand off a work introduction over the right digital channel

> As a candidate or hiring manager, I want an introduction only after we both opt in, defaulting to warm email and scheduling video only when we both confirm a time slot.

### Work introductions select only WarmEmail, ScheduledVideo, RelayShare, or NoChannel

Both candidate and manager must have usable adult ages (18 to 120) and both must opt in; otherwise the decision is `NoChannel`. When both have email addresses and they have not both confirmed a requested video slot, the channel is `WarmEmail`. When a mutual video slot is confirmed (either because they want video or lack email), the channel is `ScheduledVideo`. Otherwise, the channel falls back to `RelayShare`.

```quint
import memberAge as Age from "./memberAge"

type WorkIntroChannel = NoChannel | WarmEmail | ScheduledVideo | RelayShare

pure def chooseWorkIntroChannel(
  candAge: int,
  mgrAge: int,
  candOptedIn: bool,
  mgrOptedIn: bool,
  candHasEmail: bool,
  mgrHasEmail: bool,
  mutualSlotConfirmed: bool,
  wantsVideo: bool
): WorkIntroChannel =
  if (not(Age::matchableAge(candAge)) or not(Age::matchableAge(mgrAge)) or not(candOptedIn) or not(mgrOptedIn)) NoChannel
  else if (candHasEmail and mgrHasEmail and not(wantsVideo and mutualSlotConfirmed)) WarmEmail
  else if (mutualSlotConfirmed) ScheduledVideo
  else RelayShare

pure def lawWorkIntroRequiresDoubleOptIn(
  candAge: int, mgrAge: int, candOptedIn: bool, mgrOptedIn: bool,
  candHasEmail: bool, mgrHasEmail: bool, mutualSlotConfirmed: bool, wantsVideo: bool
): bool =
  (not(candOptedIn) or not(mgrOptedIn))
    implies chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) == NoChannel

pure def lawWorkIntroAdultsOnly(
  candAge: int, mgrAge: int, candOptedIn: bool, mgrOptedIn: bool,
  candHasEmail: bool, mgrHasEmail: bool, mutualSlotConfirmed: bool, wantsVideo: bool
): bool =
  (candAge < Age::adultAge or mgrAge < Age::adultAge)
    implies chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) == NoChannel

pure def lawNoScheduledVideoWithoutConfirmedSlot(
  candAge: int, mgrAge: int, candOptedIn: bool, mgrOptedIn: bool,
  candHasEmail: bool, mgrHasEmail: bool, wantsVideo: bool
): bool =
  chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, false, wantsVideo) != ScheduledVideo

pure def lawWarmEmailDefaultWhenBothHaveEmail(
  candAge: int, mgrAge: int, candOptedIn: bool, mgrOptedIn: bool, mutualSlotConfirmed: bool
): bool =
  (Age::matchableAge(candAge) and Age::matchableAge(mgrAge) and candOptedIn and mgrOptedIn)
    implies chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, true, true, mutualSlotConfirmed, false) == WarmEmail

pure def lawWarmEmailRequiresBothEmails(
  candAge: int, mgrAge: int, candOptedIn: bool, mgrOptedIn: bool,
  candHasEmail: bool, mgrHasEmail: bool, mutualSlotConfirmed: bool, wantsVideo: bool
): bool =
  (chooseWorkIntroChannel(candAge, mgrAge, candOptedIn, mgrOptedIn, candHasEmail, mgrHasEmail, mutualSlotConfirmed, wantsVideo) == WarmEmail)
    implies (candHasEmail and mgrHasEmail)

pure val candAgeValues = Set(12, 13, 17, 18, 30, 121)
pure val mgrAgeValues = Set(12, 13, 17, 18, 35, 121)
```
