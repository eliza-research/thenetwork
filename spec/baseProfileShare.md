# Reuse a limited base profile in another app

A person who joins a second app on the shared line gets a link notice that names no app. A reply of SHARE records a base-profile grant from each other app the person is a live member of into the app they just joined. The platform account service stores the grant under the person's lock and refuses it for a banned phone or a membership that is not live. This module decides what a grant lets the joined app read. The service reads the grant again, reads the source member's facts in the source app, and writes the copies in the joined app. Every other fact stays bound to its own app. See [Story F30](product/stories.md#story-f30--join-the-app-i-asked-for) and the account rules in the [product requirements](product/README.md).

## Story: Reuse my approved basics in a second app

> As a person who uses two apps, I want the app I just joined to reuse the basics I approved, and nothing else.

### A grant is usable only while it is current and both memberships are live

The person granted the source app's base profile to this app and did not revoke it. Both memberships are live: not removed, invited or restricted. The phone is not banned. Leaving either app, a ban or deletion revokes the grant, so a later read finds nothing. New rule: the service stored the grant and nothing read it (audit CRI11).

```quint
pure def baseProfileGrantUsable(granted: bool, revoked: bool, sourceLive: bool, targetLive: bool, banned: bool): bool =
  granted and not(revoked) and sourceLive and targetLive and not(banned)

pure def lawRevokedGrantIsNotUsable(sourceLive: bool, targetLive: bool, banned: bool): bool =
  not(baseProfileGrantUsable(true, true, sourceLive, targetLive, banned))

pure def lawBannedPhoneHasNoUsableGrant(granted: bool, revoked: bool, sourceLive: bool, targetLive: bool): bool =
  not(baseProfileGrantUsable(granted, revoked, sourceLive, targetLive, true))
```

### An interest is shared only when the member confirmed it and it is not private

A source fact is a shareable interest when it is an interest of the source member, the member confirmed it, its privacy scope is matchable or shareable (never agent-private or bound to one opportunity), it carries no sensitive category, it is current, and its text has at most forty UTF-16 code units, the limit of an interest given at signup. The joined app reads at most twenty interests. New rule (audit CRI11).

```quint
pure val baseInterestLimit: int = 20
pure val baseInterestSizeLimit: int = 40

pure def baseInterestShareable(interest: bool, confirmed: bool, privateScope: bool, sensitive: bool, stillValid: bool, textLength: int): bool =
  interest and confirmed and not(privateScope) and not(sensitive) and stillValid and textLength > 0 and textLength <= baseInterestSizeLimit

pure def lawPrivateFactIsNeverShared(interest: bool, confirmed: bool, sensitive: bool, stillValid: bool, textLength: int): bool =
  not(baseInterestShareable(interest, confirmed, true, sensitive, stillValid, textLength))

pure def lawSensitiveFactIsNeverShared(interest: bool, confirmed: bool, privateScope: bool, stillValid: bool, textLength: int): bool =
  not(baseInterestShareable(interest, confirmed, privateScope, true, stillValid, textLength))
```

### A shared value never replaces what the person told this app

The join in this app already asked for the first name, and the home city selects the member's city network, so a grant keeps both as this app has them. A grant adds a shareable interest that this app does not hold yet. A copy keeps the source privacy scope and never widens it. New rule (audit CRI11). Changed on 2026-11-18 (audit CRI11): a SHARE reply now grants interests only and the link notice offers only interests, because the old notice promised a first name and city that no grant can change. The copy is made once, when the person replies SHARE; after that it is this app's fact, which the person can correct or remove here. The stored copy does not name the app it came from, and its id is made from the member and the value only, so nobody can find the source app from it.

```quint
type BaseProfileField = BaseFirstName | BaseCity | BaseInterest
type BaseFieldCopy = KeepAppValue | AddSharedValue | NothingToShare

pure def baseFieldCopy(profileField: BaseProfileField, usable: bool, fieldGranted: bool, sourceHasValue: bool, appHasValue: bool): BaseFieldCopy =
  if (not(usable) or not(fieldGranted) or not(sourceHasValue)) NothingToShare
  else if (profileField != BaseInterest or appHasValue) KeepAppValue
  else AddSharedValue

pure def lawSharedValueNeedsUsableGrant(profileField: BaseProfileField, usable: bool, fieldGranted: bool, sourceHasValue: bool, appHasValue: bool): bool =
  baseFieldCopy(profileField, usable, fieldGranted, sourceHasValue, appHasValue) == AddSharedValue implies
    (usable and fieldGranted and sourceHasValue and not(appHasValue))

pure def lawNameAndCityAreNeverReplaced(usable: bool, fieldGranted: bool, sourceHasValue: bool, appHasValue: bool): bool =
  baseFieldCopy(BaseFirstName, usable, fieldGranted, sourceHasValue, appHasValue) != AddSharedValue and
    baseFieldCopy(BaseCity, usable, fieldGranted, sourceHasValue, appHasValue) != AddSharedValue
```
