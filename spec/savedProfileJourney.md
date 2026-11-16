# Read a saved profile after leaving an app

A member begins with separate memberships and saved details in slop and
friends. The [saved profile rules](savedProfileRead.md) authorize each
read. The [account privacy rules](accountPrivacy.md) handle leaving. This
journey observes the stored memberships and saved fields returned through
the shared line.

## Story: See only my saved profile for the app I use

> As a member, I want to read what I saved and keep the profile in my
> other app when I leave one.

### A read returns only this member's current profile for the requested app

A named own-profile text can include fields from the named app while
the person remains a member there. A request for another person's
profile or a different app on a dedicated line carries no saved fields.
A read changes neither membership.

```quint
type ProfileApp = Slop | Friends
type ProfileReadKind = ReadOwn | ReadSomeoneElse | ReadOnOtherLine
type ProfileShown = SlopProfile | FriendsProfile
type ProfileMemberships = { inSlop: bool, inFriends: bool }
type ProfileTurn = { state: ProfileMemberships, out: List[ProfileShown] }

pure val initial: ProfileMemberships = { inSlop: true, inFriends: true }

pure def canReadProfile(s: ProfileMemberships, app: ProfileApp, kind: ProfileReadKind): bool = true
pure def readProfile(s: ProfileMemberships, app: ProfileApp, kind: ProfileReadKind): ProfileTurn =
  val hasMembership = if (app == Slop) s.inSlop else s.inFriends
  { state: s, out: if (kind == ReadOwn and hasMembership)
    List(if (app == Slop) SlopProfile else FriendsProfile) else List() }

pure def stepReadingKeepsMemberships(before: ProfileMemberships, via: str, after: ProfileMemberships): bool =
  via == "readProfile" implies after == before
```

### An app leave removes that app's profile from later reads

A leave removes the chosen membership and preserves the other app.
Later reads from the removed app disclose no saved fields.

```quint
pure def canLeaveProfileApp(s: ProfileMemberships, app: ProfileApp): bool = true
pure def leaveProfileApp(s: ProfileMemberships, app: ProfileApp): ProfileTurn =
  { state: if (app == Slop) { ...s, inSlop: false } else { ...s, inFriends: false }, out: List() }

pure def sometimesKeepsOnlySlop(s: ProfileMemberships): bool = s.inSlop and not(s.inFriends)
pure def sometimesKeepsOnlyFriends(s: ProfileMemberships): bool = s.inFriends and not(s.inSlop)
pure def sometimesLeavesBothApps(s: ProfileMemberships): bool = not(s.inFriends) and not(s.inSlop)
```

### A displayed profile uses the saved location and the signed-turn size limit

Use a saved neighborhood when it has text. Otherwise show the label for
a supported home city. Omit the location when neither is known. A
display longer than 1,600 UTF-16 units gets the existing length notice
so the service never truncates a saved profile.

```quint
type LocationLabel = NeighborhoodLabel | BayAreaLabel | NewYorkLabel | NoLocationLabel
pure def savedProfileLocation(hasNeighborhood: bool, homeCity: str): LocationLabel =
  if (hasNeighborhood) NeighborhoodLabel
  else if (homeCity == "sf") BayAreaLabel
  else if (homeCity == "nyc") NewYorkLabel
  else NoLocationLabel

pure val savedProfileReplyLimit: int = 1600
pure def savedProfileFitsReply(units: int): bool = units <= savedProfileReplyLimit
```
