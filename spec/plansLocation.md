# Location for public recommendations

[Story F10](product/stories.md#story-f10--get-concierge-value) lets a member ask for public ideas in a specific area.

## Story: Use the place I asked about

> As a member, I want public recommendations for the place I name, even if it differs from home.

### Resolve the stated place before using the member's location

A direct place reference uses the catalog's known neighborhood or venue.
Read accepted aliases without regard to letter case or separator variants.
A full venue name takes priority over a shorter name where both match.
An unsupported place asks for a neighborhood without quoting the member's
text or creating a match. Time phrases and a person's name in a companion
phrase do not supply a place. With no place request, use the existing
location and availability rules. A separate location for this request
does not change the member's saved location or travel limit.
The signed public-event reply uses listings in the requested neighborhood.

```quint
type RecommendationLocation = UseNamedArea | AskForArea | UseMemberLocation

pure def recommendationLocation(known: bool, mentioned: bool): RecommendationLocation =
  if (known) UseNamedArea
  else if (mentioned) AskForArea
  else UseMemberLocation

pure def lawUnsupportedLocationNeverUsesHome(known: bool): bool =
  recommendationLocation(known, true) != UseMemberLocation

pure def requestedAreaAllowsEvent(namedArea: bool, eventInArea: bool): bool =
  not(namedArea) or eventInArea

pure def lawNamedAreaDoesNotShowUnrelatedListings(namedArea: bool): bool =
  namedArea implies not(requestedAreaAllowsEvent(namedArea, false))
```
