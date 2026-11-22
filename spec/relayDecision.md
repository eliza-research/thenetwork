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

### A relay text that says the sender is under 18 starts the minors policy

The engine reads the text of each item for a minor's own words ("I'm 16", "I'm still in high school") and records an age signal on the item. The desk also reads a `minor_signal` flag of the relay classifier as an age signal, because the engine keeps only the age signal of its rules. When the item has an age signal and the Network has not already marked the sender with a minor signal, the desk starts the minors policy before it answers the sender. The Network marks the sender as a minor, writes a 0-point `relay_age_signal` event in the sender's safety case, records the adults whom the sender met, and closes every open opportunity of the sender, including the match of the item. A sender who already has the minor signal gets no second event. The rules above still block the item, or hold it without its text. New rule: the age signal only decided whether the held desk kept the text, so the sender stayed matchable (audit ST-D2). The laws use fixed inputs, because the first law only restated the definition. The Network also gives the minor signal to the person, so the other apps of the person stop matching them, and on an 18+ app it writes an `age_review` event for staff, as the inbound path does.

```quint
pure def relayStartsMinorPolicy(ageSignal: bool, senderMarkedMinor: bool): bool =
  ageSignal and not(senderMarkedMinor)

pure def lawAnUnmarkedSenderStartsTheMinorsPolicyExactlyOnAnAgeSignal(ageSignal: bool): bool =
  relayStartsMinorPolicy(ageSignal, false) == ageSignal

pure def lawAMarkedSenderGetsNoSecondMinorsPolicy(ageSignal: bool): bool =
  not(relayStartsMinorPolicy(ageSignal, true))

pure def lawNoAgeSignalStartsNoMinorsPolicy(senderMarkedMinor: bool): bool =
  not(relayStartsMinorPolicy(false, senderMarkedMinor))
```

### A block for the sender's severe words reaches the sender's safety case

A severe reason is a threat or a slur that the rules find, or a block flag from the classifier. When the verdict is a block and one of its reasons is severe, the desk writes a 0-point `relay_block` event in the sender's safety case. The event keeps no text and no reason code. A hold, or a block without a severe reason, writes no event. New rule: a block for the sender's own severe words left no record, so the item never reached the safety console (audit SD-254). The laws use fixed inputs, because the first law only restated the definition.

```quint
pure def relaySevereBlockCaseEvent(verdict: RelayVerdict, severeReason: bool): bool =
  verdict == Block and severeReason

pure def lawABlockWritesACaseEventExactlyForASevereReason(severeReason: bool): bool =
  relaySevereBlockCaseEvent(Block, severeReason) == severeReason

pure def lawAPassWritesNoCaseEvent(severeReason: bool): bool =
  not(relaySevereBlockCaseEvent(Pass, severeReason))

pure def lawNoSevereReasonWritesNoCaseEvent(verdict: RelayVerdict): bool =
  not(relaySevereBlockCaseEvent(verdict, false))

pure def lawAHeldItemWritesNoCaseEvent(severeReason: bool): bool =
  not(relaySevereBlockCaseEvent(Hold, severeReason))
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

## Story: End the thread after a bad meeting

> As a member who had a bad meeting, I want the other person to stop reaching me through Eliza without my having to block or report them.

### Negative feedback after a meeting ends the relay thread

A relay thread is open only while its match is mutual, both members said yes, and neither member gave negative feedback about the other after the meeting. Negative feedback is a check-in answer with negative sentiment that does not say the other person did not come: the same answer that keeps the pair from being matched again. When the thread ends, the match is no longer live in either direction: a turn that opens after the feedback does not offer it, so a relay request of that turn that names it is refused as an item the turn did not offer; only a turn that opened before the feedback and offered the match gets the "match is closed" notice for it; a relay without a name does not count it; a staff release of a held item for it delivers nothing; and a queued relay item for it fails its final dispatch check. A block or a report is not needed. New rule: negative feedback only kept the pair from new matches, and the other member could keep sending relayed texts until the member blocked them (audit OPP58). Changed 2026-11-22: the second law only restated the definition, so it is now two laws. One checks the safety property at fixed inputs: a match that is not mutual, or that has no yes from both members, has no open thread. The other ties the ended thread to `relayTarget`: when negative feedback ends the only match's thread, a relay without a name has no match, and a relay that names it is never sent to it (`RelayNamedNotLive`). Changed: this rule said that every relay request that names the closed match gets the "match is closed" notice, but the endpoint refuses an item that the turn did not offer, and a staff release looked the match up without the thread check and could deliver a held item after the thread ended (audit RELAY-spec-closed-notice, RELAY-release-closed).

```quint
pure def relayThreadOpen(mutual: bool, bothSaidYes: bool, negativeFeedback: bool): bool =
  mutual and bothSaidYes and not(negativeFeedback)

pure def lawNegativeFeedbackEndsTheThread(mutual: bool, bothSaidYes: bool): bool =
  not(relayThreadOpen(mutual, bothSaidYes, true))

pure def lawNoThreadWithoutMutualYes(bothSaidYes: bool, negativeFeedback: bool): bool =
  not(relayThreadOpen(false, bothSaidYes, negativeFeedback)) and not(relayThreadOpen(true, false, negativeFeedback))

pure def lawEndedOnlyThreadHasNoRelayTarget(mutual: bool, bothSaidYes: bool, named: bool): bool =
  relayTarget(if (relayThreadOpen(mutual, bothSaidYes, true)) 1 else 0, named, relayThreadOpen(mutual, bothSaidYes, true)) == (if (named) RelayNamedNotLive else RelayToNoMatch)
```
