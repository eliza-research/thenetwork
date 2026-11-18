# Relay decision

The [relay flow model](models/relay.md) follows requests from item creation to delivery. The engine owns content checks and classifier calls. This module computes the verdict from their results and checks the time window for item consent.

## Story: Share only the item I approved

> As a member in a match, I want Eliza to share my selected item only while my permission for it is valid.

### Consent cannot come from the future or outlive the item window

The consent must name the sender and the exact item. The shell checks those bindings. The consent timestamp cannot be after the item, and the elapsed time cannot exceed the configured lifetime.

```quint
pure def relayConsentStale(consentAt: int, itemAt: int, lifetime: int): bool =
  consentAt > itemAt or itemAt - consentAt > lifetime

pure def lawFutureConsentIsStale(consentAt: int, itemAt: int, lifetime: int): bool =
  consentAt > itemAt implies relayConsentStale(consentAt, itemAt, lifetime)
```

## Story: Keep unsafe items from reaching a match

> As a member, I want Eliza to stop or hold items when the relay checks find a reason.

### A blocking reason takes precedence over a hold

A blocking reason blocks delivery. Other reasons hold the item. A relay verdict is pass only when the checks record no reason.

```quint
type RelayVerdict = Pass | Hold | Block

pure def relayVerdict(hasBlock: bool, hasReason: bool): RelayVerdict =
  if (hasBlock) Block else if (hasReason) Hold else Pass

pure def lawARelayPassHasNoReason(hasBlock: bool, hasReason: bool): bool =
  relayVerdict(hasBlock, hasReason) == Pass implies (not(hasBlock) and not(hasReason))
```

## Story: Relay only to the match I named

> As a member with more than one match, I want Eliza to pass my item only to the match I named, and to ask me which one when I did not say.

### A relay names its match when the member has more than one live match

A live match is a two-person match in which both members said yes and that is not closed. The shell counts the member's live matches and checks whether the request named one of them by the active item that the turn's context offered. A named live match is the target. A named match that is not live has no target. Without a name, the only live match is the target; with two or more live matches the desk asks which one and sends nothing. New rule: the desk sent an unnamed item to the newest live match, which could reach the wrong person (audit SHA38).

```quint
type RelayTargetChoice = RelayToNoMatch | RelayAskWhichMatch | RelayToNamedMatch | RelayToOnlyMatch | RelayNamedNotLive

pure def relayTarget(liveMatches: int, named: bool, namedLive: bool): RelayTargetChoice =
  if (named) { if (namedLive) RelayToNamedMatch else RelayNamedNotLive }
  else if (liveMatches == 1) RelayToOnlyMatch
  else if (liveMatches > 1) RelayAskWhichMatch
  else RelayToNoMatch

pure def lawNeverGuessBetweenMatches(liveMatches: int, namedLive: bool): bool =
  liveMatches > 1 implies relayTarget(liveMatches, false, namedLive) == RelayAskWhichMatch

pure def lawNamedTargetIsLive(liveMatches: int, named: bool, namedLive: bool): bool =
  relayTarget(liveMatches, named, namedLive) == RelayToNamedMatch implies (named and namedLive)
```

