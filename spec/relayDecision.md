# Relay decision

The [relay flow model](models/relay.md) follows requests from item creation to delivery. The engine owns content checks and classifier calls. This module computes the verdict from their results, decides when the classifier reads a text, chooses the notice for a blocked sender, and checks the time window for item consent.

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

### A refusal or uncertainty cannot authorize a private item

An explicit request for a contact share or photo is valid only when the member does not refuse it or qualify it as uncertain. A contact or photo refusal does not stop an ordinary message that the member explicitly asks the agent to relay. The shell reads the member's text, including refusal phrases such as "will not send" and instructions to proceed such as "will not wait, send it".

A condition on the recipient's assent or a later time leaves the private item unapproved. The reader can recognize a complete quoted body as an explicit text relay. The body then goes through the ordinary relay text checks.

The photo reader reads a photo that the member names in their own words ("the beach one", "photo 3") with the same rules. It puts a plain photo request in the place of the named photo and the recipient, and it reads no photo request when the member asks another person to send the photo, reports what another person said, puts a condition or a later time on it, is not sure, refuses it or takes it back. A photo refusal in a message that also asks to share the member's number does not stop the number share. In a message that asks to share the member's number, the photo reader reads no photo request and no answer to a pending photo proposal, so a "yes" in that message does not confirm the photo. A photo take-back in that message takes the photo back first, and then the number share starts: the turn takes the photo back without an answer and stays open, and the relay request takes the photo back again (this changes nothing) and starts the swap. Changed (merge of develop, 2026-11-23): the photo reader read "tell Ana to send him the beach one" and "send her the beach one if she asks" as a photo request, and a photo refusal took a number share out of the relay -> the reader uses the request rules of the engine, because the third-person, condition and refusal rules applied only to the plain request words; the reader read "Jordan said send Maya the beach one" as a photo request, a "yes" that also asked for the number share confirmed a pending photo and lost the share, and a photo take-back next to a number share lost the take-back -> a reported-speech lead stops a photo request, and both the take-back and the share run, because a member's own take-back must never be lost. Changed (merge of develop, 2026-11-23, second pass): a private request that names a second destination ("send Maya photo 2 to Ana", "send my number to Sam when you can") could go to the selected match -> a private request reads as none when its destination is not complete, and the photo reader applies the same destination rule after the photo and its number (an inline "with" that describes the photo is not a destination), because a named private item goes only to the person named. Changed (merge of develop, 2026-11-23, third pass): a "yes" to a pending photo proposal that named another or an incomplete destination ("yes, send it to Maya Smith", "yes, to Ana") confirmed the photo to the selected match, and "send Maya photo 3 and also to Ana" or "with Ana" proposed the photo to Maya only -> a "yes" that states a destination confirms the photo only when that destination is complete and is the proposal's recipient (or him, her, them, my match), an inline "with" is a photo description only before a word such as "my" or "the", and a second destination after "and" stops the photo request, because a member's yes must not send a photo to a person the member did not name.

```quint
pure def privateRelayRequestAllowed(refused: bool, uncertain: bool): bool =
  not(refused) and not(uncertain)

pure def lawPrivateRelayRequiresUnqualifiedConsent(refused: bool, uncertain: bool): bool =
  (refused or uncertain) implies not(privateRelayRequestAllowed(refused, uncertain))
```

### Only the member's own direct request authorizes a private item

A contact share or photo send counts only when the member asks the agent for it directly: the words before the request in its sentence are empty, a courtesy such as "please" or "can you", or a complete aside such as "I can't believe it,". An instruction for a third party ("tell Ana to send him my number"), reported speech ("Ana said to give him my number", "send him my number, Ana says"), a quotation, or a message that the member asks the agent to relay ("tell them I can send them my number") does not authorize the item. Changed (verification 2026-11-23, relay requests gate): the reader took any "send him my number" inside the text as the member's request -> only a directly addressed request counts, because an instruction to or from someone else is not the member's consent.

```quint
pure def privateRelayRequestAddressed(directLead: bool, reported: bool): bool =
  directLead and not(reported)

pure def lawReportedPrivateRequestIsNotConsent(directLead: bool): bool =
  not(privateRelayRequestAddressed(directLead, true))

pure def lawIndirectPrivateRequestIsNotConsent(reported: bool): bool =
  not(privateRelayRequestAddressed(false, reported))
```

### A member can take back a pending number swap

An instruction to cancel or withhold the member's own contact share withdraws their pending swap. A direct refusal such as "don't send it" also withdraws it while it is pending. A go-ahead such as "don't hesitate" or "no need to wait" leaves the request in place unless the member also refuses it. The shell recognizes these phrases in the member's own message.

```quint
pure def pendingSwapWithdrawn(namesOwnContact: bool, withholdsContact: bool, declinesPendingSend: bool): bool =
  declinesPendingSend or (namesOwnContact and withholdsContact)

pure def lawGoAheadKeepsPendingSwap(namesOwnContact: bool): bool =
  not(pendingSwapWithdrawn(namesOwnContact, false, false))

pure def lawDirectRefusalWithdrawsPendingSwap(namesOwnContact: bool, withholdsContact: bool): bool =
  pendingSwapWithdrawn(namesOwnContact, withholdsContact, true)
```

### A phone exchange must still have consent at dispatch

A withdrawal also marks the prepared shares involving that member. An outbound share must still have a passed record and no rejection or withdrawal. A swap question goes only while the matching request is pending within its consent window. A swap request waits only when its question went to the other member at once. When the send path refuses the question or would hold it (quiet hours, the conversation streak cap, or the same question to that member less than 10 minutes before), no swap waits and the asker hears "I can't swap numbers right now."; a new request 10 minutes or more after the earlier question can wait again. Changed (verification 2026-11-23, SD-138): a swap waited and the asker heard that the other member was asked when the question was refused or held -> only a question that went out makes a swap wait, because the asker was told something that was not true.

```quint
pure def relayRecordMayDispatch(passed: bool, rejected: bool, withdrawn: bool): bool =
  passed and not(rejected) and not(withdrawn)

pure def lawWithdrawnRelayRecordsCannotDispatch(passed: bool, rejected: bool): bool =
  not(relayRecordMayDispatch(passed, rejected, true))
```

## Story: Keep unsafe items from reaching a match

> As a member, I want Eliza to stop items when the relay checks find a reason, and to tell me that my item did not go.

### Any reason from the relay checks blocks the item

The rules, the leak guard and the relay classifier record reasons. An item with a reason is blocked: nothing reaches the other person, and the sender gets a notice at once. A relay verdict is pass only when the checks record no reason. No relayed text waits for a staff decision. Changed (owner decision 2026-11-22, D18): a reason that was not a block reason held the item for a staff decision -> every reason blocks, because the classifier and the rules decide alone.

The shared threat reader keeps a choice of times or activities outside the threat reason. A terminal “or else” or an explicit harmful consequence still gives the threat reason, and the item is blocked.

```quint
type RelayVerdict = Pass | Block

pure def relayVerdict(hasReason: bool): RelayVerdict =
  if (hasReason) Block else Pass

pure def lawARelayPassHasNoReason(hasReason: bool): bool =
  (relayVerdict(hasReason) == Pass) iff not(hasReason)
```

### The classifier reads a text that the rules leave to it

A final reason is one that no classifier answer can change: the parties, the state of the match, consent, a minor party, a canary, a format fault, or a severe reason of the rules. The relay classifier reads a text item that has no final reason and no other reason. In a teen friendship pair it also reads a text that has only reasons that are not final, so that a minor signal in a flagged teen text still reaches the item record. It never reads an item without text. Changed (owner decision 2026-11-22, D18): the engine made this choice in its own code -> this rule makes it, because the shell must not compute a decision.

```quint
pure def relayClassifierReads(hasText: bool, finalReason: bool, anyReason: bool, teenPair: bool): bool =
  hasText and not(finalReason) and (not(anyReason) or teenPair)

pure def lawAFinalReasonIsNeverSentToTheClassifier(hasText: bool, anyReason: bool, teenPair: bool): bool =
  not(relayClassifierReads(hasText, true, anyReason, teenPair))

pure def lawACleanTextIsAlwaysRead(teenPair: bool): bool =
  relayClassifierReads(true, false, false, teenPair)

pure def lawAnAdultFlaggedTextIsNotRead(finalReason: bool): bool =
  not(relayClassifierReads(true, finalReason, true, false))
```

### A classifier that cannot run blocks the text

When the classifier cannot give an answer (an error, a timeout, an answer that does not parse, a cache miss offline, or a service without the Workers AI credentials in any environment), the text gets the reason `classifier:unavailable` and is blocked. It is never sent unchecked. Every relay call has a classifier: without the credentials the service gives the desk a classifier that always cannot run, and only the simulator, the local dev start (`platform:dev`) and the tests give it a classifier that is named as simulated. A text that the classifier reads and does not clear (a flag, a severe flag, or an unsure answer) is blocked too. Changed (owner decision 2026-11-22, D18): a classifier error held the item for staff, and a Clef failure or a missing classifier let a text pass on the rules alone -> every failure and every missing classifier blocks the text, and the relay desk takes the classifier as a required input, because nothing is sent unchecked.

```quint
type ClassifierReading = ReadingClear | ReadingFlagged | ReadingUnavailable

pure def relayClassifierReading(answered: bool, flagged: bool): ClassifierReading =
  if (not(answered)) ReadingUnavailable else if (flagged) ReadingFlagged else ReadingClear

pure def lawAnUnansweredReadIsUnavailable(flagged: bool): bool =
  relayClassifierReading(false, flagged) == ReadingUnavailable

pure def lawOnlyAnAnsweredUnflaggedReadIsClear(answered: bool, flagged: bool): bool =
  (relayClassifierReading(answered, flagged) == ReadingClear) iff (answered and not(flagged))
```

### A blocked sender learns only what is safe to say

The notice tells the sender that the item was not sent. It names a cause only when the cause is in the sender's own words or actions and says nothing about the other person or about the classifier. The order is: a reason about the other person, the match, a leak, a scam, harassment, a classifier flag or a teen-pair rule gives the plain notice; then a consent fault asks the sender to say again that they want it sent; then a looks or rating question; then contact details or a move to another app; then a classifier that could not run ("try again in a few minutes"); then a rate limit ("you sent a lot in a short time"). The notice is fixed text and goes through the leak guard of the send path. Changed (owner decision 2026-11-22, D18): a held item told the sender only that it waited for a check -> the sender learns that the item did not go and, where it is safe, what to change.

```quint
type RelayBlockNotice = NoticePlain | NoticeConsent | NoticeRating | NoticeContact | NoticeRetry | NoticeRate

pure def relayBlockNotice(unsafe: bool, consent: bool, rating: bool, contact: bool, unchecked: bool, rate: bool): RelayBlockNotice =
  if (unsafe) NoticePlain
  else if (consent) NoticeConsent
  else if (rating) NoticeRating
  else if (contact) NoticeContact
  else if (unchecked) NoticeRetry
  else if (rate) NoticeRate
  else NoticePlain

pure def lawAnUnsafeReasonIsNeverExplained(consent: bool, rating: bool, contact: bool, unchecked: bool, rate: bool): bool =
  relayBlockNotice(true, consent, rating, contact, unchecked, rate) == NoticePlain

pure def lawRetryOnlyWhenTheClassifierAloneStoppedIt(unsafe: bool, consent: bool, rating: bool, contact: bool, unchecked: bool, rate: bool): bool =
  relayBlockNotice(unsafe, consent, rating, contact, unchecked, rate) == NoticeRetry implies
    (unchecked and not(unsafe) and not(consent) and not(rating) and not(contact))
```

### A relay text that says the sender is under 18 starts the minors policy

The engine reads the text of each item for a minor's own words ("I'm 16", "I'm still in high school") and records an age signal on the item. The rules read only the first person: an age with "years old" counts after "I'm", "I'm a", before "here", or alone ("16 years old and bored"), but not after a third-person subject ("my son is", "Ben is", "she's", "my daughter,") or after "I was", so "my son is 15 years old" gives no age signal. A `minor_signal` flag of the relay classifier, as a flag or as a severe flag, is also an age signal, and the engine records it on the item, so every caller of the engine gets it. The classifier question asks whether the sender or the recipient is under 18, so a text about the recipient's age or about a third person can also give the sender the age signal and block the text. In a teen friendship pair the sender is a known minor, so `senderMarkedMinor` is the record's known minor. A teen-pair text in which a known minor states their age, in the rules' words or as an age that the desk reads ("I'm 12"), gets the reason `teen:age_talk`, so it is blocked; it is an age signal and opens a minor signal only when `minorSignalOpens` holds, that is, when the stated age is younger than the youngest age on record at the Clock day, because an age that agrees with the record is not a doubt and a younger age can make the pair break the age rule of [friend introductions with a minor](friendIntroAge.md). When the item has an age signal and the sender is not already marked, the desk starts the minors policy before it answers the sender: the Network marks the sender as a minor, gives the minor signal to the person so that the other apps of the person stop matching them, writes a 0-point `relay_age_signal` event in the sender's safety case, writes an `age_review` event for staff on an 18+ app, records the adults whom the sender met, and closes every open opportunity of the sender, including the match of the item. A sender who already has the minor signal gets no second event. The item is blocked, and the desk keeps no text of it. Changed (audit ST-D2 and owner decisions 2026-11-22, D1, A3 and D18): the age signal only decided whether the held desk kept the text, and the desk read the classifier flag again from the reason codes -> the engine record carries the signal, the desk starts the minors policy at once and blocks the item, and a known minor opens a signal only for a younger stated age, because the sender stayed matchable, no relayed text waits for staff, and an age that agrees with the record is not a doubt.

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

### The desk reads the sender's stated age before the engine reads the text

Before the engine reads a text, the Network reads the sender's own words for an age under 18 (`observeSenderAge`, the direct age reader). It reads a teen-pair text only when the text states an age younger than the record. When it finds one, it records the stated age and starts the minors policy as the inbound path does, and the desk blocks the item with the reason `minor:self_stated` and the age signal; the record answers a replay with the same notice. Changed (owner decision 2026-11-22, D1/A3): the desk refused such an item with a false no-open-match notice and kept no record -> it blocks with `minor:self_stated` and records the item, because the notice was false and a replay ran the age reader again.

```quint
pure def relayAgeStatementRead(hasText: bool, teenPair: bool, saysYounger: bool): bool =
  hasText and (not(teenPair) or saysYounger)

pure def relayAgeStatementRefuses(statedMinorAge: bool, teenPair: bool, senderMarkedMinor: bool): bool =
  statedMinorAge and (not(teenPair) or senderMarkedMinor)

pure def lawAnAdultPairTextIsAlwaysRead(saysYounger: bool): bool =
  relayAgeStatementRead(true, false, saysYounger)

pure def lawNoStatedAgeRefusesNothing(teenPair: bool, senderMarkedMinor: bool): bool =
  not(relayAgeStatementRefuses(false, teenPair, senderMarkedMinor))
```

### A block for the sender's severe words reaches the sender's safety case

A severe reason is a threat or a slur that the rules find, or a block flag from the classifier. When the verdict is a block and one of its reasons is severe, the desk writes a 0-point `relay_block` event in the sender's safety case. The event keeps no text and no reason code. A block without a severe reason writes no event. Changed (audit SD-254): a block for the sender's own severe words left no record -> the block writes the event, because the item never reached the safety console.

```quint
pure def relaySevereBlockCaseEvent(verdict: RelayVerdict, severeReason: bool): bool =
  verdict == Block and severeReason

pure def lawABlockWritesACaseEventExactlyForASevereReason(severeReason: bool): bool =
  relaySevereBlockCaseEvent(Block, severeReason) == severeReason

pure def lawAPassWritesNoCaseEvent(severeReason: bool): bool =
  not(relaySevereBlockCaseEvent(Pass, severeReason))

pure def lawNoSevereReasonWritesNoCaseEvent(verdict: RelayVerdict): bool =
  not(relaySevereBlockCaseEvent(verdict, false))

```

## Story: Relay only to the match I named

> As a member with more than one match, I want Eliza to pass my item only to the match I named, and to ask me which one when I did not say.

### A relay names its match when the member has more than one live match

A live match is a two-person match in which both members said yes and that is not closed. The shell counts the member's live matches and checks whether the request named one of them by the active item that the turn's context offered. A named live match is the target. A named match that is not live has no target, and the desk tells the member that this match is closed. Without a name, the only live match is the target; with two or more live matches the desk sends nothing and asks the member to send the message again and say who it is for. The desk keeps no unnamed item: an answer that only names the match ("Sam") is not a relay request, and nothing goes out until the member sends the message again with the match named. Changed (audit SHA38): the desk sent an unnamed item to the newest live match -> it asks which match, because the item could reach the wrong person.

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

A member who asks for a match's number ("can I get her number?") starts a number swap. The shell finds every "<whose> number" in the text and checks that each one is a pronoun or the first name of one of the member's live matches, and that the rest of the text names no other contact detail. With one live match, such an ask opens the turn. With two or more live matches, it also opens the turn, unscored. A number ask is not a relay request, so a relay call for that turn makes no decision and sends nothing; the number swap starts only when the member says "send <name> my number" for one named match, and the desk never guesses. Without a live match, or with a name that is not a live match, or with another contact detail, the text stays contact extraction and is scored. Changed (audit SHA38): with two live matches the usual number ask was scored as abuse -> it opens the turn unscored, because it gave the member a trust risk point.

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

A relay thread is open only while its match is mutual, both members said yes, and neither member gave negative feedback about the other after the meeting. Negative feedback is a check-in answer with negative sentiment that does not say the other person did not come: the same answer that keeps the pair from being matched again. When the thread ends, the match is no longer live in either direction: a turn that opens after the feedback does not offer it, so a relay request of that turn that names it is refused as an item the turn did not offer; only a turn that opened before the feedback and offered the match gets the "match is closed" notice for it; a relay without a name does not count it; and a queued relay item for it fails its final dispatch check. A block or a report is not needed. Changed (audit OPP58): negative feedback only kept the pair from new matches -> it ends the relay thread, because the other member could keep sending relayed texts until the member blocked them.

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
