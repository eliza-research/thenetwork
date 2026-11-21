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

A live match is a two-person match in which both members said yes and that is not closed. The shell counts the member's live matches and checks whether the request named one of them by the active item that the turn's context offered. A named live match is the target. A named match that is not live has no target, and the desk tells the member that this match is closed. Without a name, the only live match is the target; with two or more live matches the desk sends nothing and asks the member to send the message again and say who it is for. The desk keeps no unnamed item: an answer that only names the match ("Sam") is not a relay request, and nothing goes out until the member sends the message again with the match named. New rule: the desk sent an unnamed item to the newest live match, which could reach the wrong person (audit SHA38). Changed after review: the question promised to pass on the first message after the answer, which the desk cannot do, and a closed named match got the "no open match" notice.

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


### A number ask with several live matches is never scored as abuse

A member who asks for a match's number ("can I get her number?") starts a number swap. The shell finds every "<whose> number" in the text and checks that each one is a pronoun or the first name of one of the member's live matches, and that the rest of the text names no other contact detail. With one live match, such an ask opens the turn as before. With two or more live matches, it also opens the turn, unscored. A number ask is not a relay request, so a relay call for that turn makes no decision and sends nothing; the number swap starts only when the member says "send <name> my number" for one named match, and the desk never guesses. Changed after review: this prose said the relay call gets the "which match" question, which the code does not do. Without a live match, or with a name that is not a live match, or with another contact detail, the text stays contact extraction and is scored. New rule: with two live matches, the desk found no single match, so the usual number ask was scored as abuse and gave the member a trust risk point (review of audit SHA38).

```quint
type NumberAskChoice = NumberAskOpens | NumberAskScored

pure def numberAsk(liveMatches: int, asks: bool, everyAskNamesLiveMatch: bool, otherContact: bool): NumberAskChoice =
  if (liveMatches >= 1 and asks and everyAskNamesLiveMatch and not(otherContact)) NumberAskOpens
  else NumberAskScored

pure def lawNumberAskNeedsALiveMatch(liveMatches: int, asks: bool, everyAskNamesLiveMatch: bool, otherContact: bool): bool =
  numberAsk(liveMatches, asks, everyAskNamesLiveMatch, otherContact) == NumberAskOpens implies (liveMatches >= 1 and asks and everyAskNamesLiveMatch and not(otherContact))

pure def lawSeveralMatchesAreNotAbuse(liveMatches: int): bool =
  liveMatches > 1 implies numberAsk(liveMatches, true, true, false) == NumberAskOpens
```
