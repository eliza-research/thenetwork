# Probe reply

## Story: Make a choice about a proposed opportunity

> As a member who receives a probe, I want the Network to respect my actual answer and the times I chose.

### A model reading cannot replace a definite or qualified answer

Use the rule-based reading when it found a yes, a no, a condition, a hedge, a counter-offer, a named time, or a conflicting signal. A named time that matches no offered time, or that matches more than one offered time without a part of the day, is a signal: the member is asked again, and neither reading books a time that was not offered. When it found no signal, a model reading can supply a clear yes or no. If neither reading supplies an answer, the caller keeps the original result.

```quint
type ReplyReading = KeepOffline | HeardYes | HeardNo

pure def probeReplyReading(offlineUnclear: bool, offlineFoundNothing: bool, modelConsent: str): ReplyReading =
  if (offlineUnclear and offlineFoundNothing) {
    if (modelConsent == "yes") HeardYes
    else if (modelConsent == "no") HeardNo
    else KeepOffline
  } else KeepOffline

pure def lawAQualifiedAnswerCannotBeOverridden(modelConsent: str): bool =
  probeReplyReading(true, false, modelConsent) == KeepOffline

pure def lawADefiniteAnswerCannotBeOverridden(offlineFoundNothing: bool, modelConsent: str): bool =
  probeReplyReading(false, offlineFoundNothing, modelConsent) == KeepOffline
```

### A direct request to proceed without the member declines the offer

Read “deal me out” and “go ahead without me” as a refusal when the
member gives the instruction directly. A courtesy or an acknowledgement
before or after the instruction does not change the refusal. Ignore words
inside a quotation or a reported or negated use of the instruction. Keep
a separate current answer. If no separate answer appears, ask again and
keep the qualified reading when a model supplies a different answer.

A standalone “afraid not,” “not a chance,” or “no chance” also refuses the
offer. A courtesy word does not change the refusal. A bare refusal clause
beside another statement leaves the offer open until the member gives a
clear answer. A quotation does not refuse the offer. An independent
current answer outside that quotation still counts.

As a whole answer, “I can't see why not,” “let's do that,” and “that
would work” accept the offer in the usual way. “That wouldn't work”
and “let's not do that” refuse it. A condition attached to the answer
still keeps the offer open. A refusal of a named day, such as “I'm not
around Thursday,” supplies a time constraint. Another suggested day
does not undo that constraint.

```quint
type ParticipationWithdrawal = NoWithdrawalWords | DirectWithdrawal | QualifiedWithdrawal

pure def participationWithdrawalReading(hasWithdrawalWords: bool, direct: bool): ParticipationWithdrawal =
  if (not(hasWithdrawalWords)) NoWithdrawalWords
  else if (direct) DirectWithdrawal
  else QualifiedWithdrawal

pure def lawIndirectWithdrawalNeedsAnAnswer(modelConsent: str): bool =
  participationWithdrawalReading(true, false) == QualifiedWithdrawal and
    probeReplyReading(true, false, modelConsent) == KeepOffline

pure def lawDirectWithdrawalKeepsTheRefusal(modelConsent: str): bool =
  participationWithdrawalReading(true, true) == DirectWithdrawal and
    probeReplyReading(false, false, modelConsent) == KeepOffline
```

### A clear yes uses the chosen times when the member names them

If a model reads a clear yes, use the offered times the person chose. If they gave no preference, keep all offered times. The caller validates model-supplied keys against the offered times first.

```quint
pure def pickedTimes(chosen: List[str], offered: List[str]): List[str] =
  if (chosen.length() > 0) chosen else offered
```

### A yes that refuses the remainder as well does not book it

A yes that refuses named times still books the times that were not refused ("yes, not Sunday though" picks the other two). But when the reply also refuses the remainder itself ("the rest don't work", "the rest are busy"), the refused remainder is never booked: the probe stays open and the member is asked again. A phrase that affirms the remainder ("the rest work", "everything else is fine", "I'm free") still books the times that were not refused.

```quint
pure def yesBooksRefusedRemainder(refusedRemainder: bool, affirmedRemainder: bool): bool =
  not(refusedRemainder) or affirmedRemainder

pure def lawAYesThatRefusesTheRemainderBooksNothing(refusedRemainder: bool): bool =
  refusedRemainder implies not(yesBooksRefusedRemainder(refusedRemainder, false))

pure def lawAnAffirmedRemainderBooksTheRest(refusedRemainder: bool): bool =
  refusedRemainder implies yesBooksRefusedRemainder(refusedRemainder, true)
```

### A direct ordinal selects that position in the offer

Use the order in the member's current message. An affirmative “second works” selects only the second option. A supported series of ordinals can select several positions when it ends with a clear choice. “Last” names the final offered option. A missing position or an unbound phrase such as “later works” leaves the offer open. A statement about the previous meeting does not select the last option.

```quint
pure def probeOrdinalIndex(ordinal: int, optionCount: int): int =
  if (ordinal == -1 and optionCount > 0) optionCount - 1
  else if (ordinal >= 0 and ordinal < optionCount) ordinal
  else -1

pure def lawSelectedOrdinalIsOffered(ordinal: int, optionCount: int): bool =
  probeOrdinalIndex(ordinal, optionCount) >= 0 implies probeOrdinalIndex(ordinal, optionCount) < optionCount
```

### A day group selects only offered slots in that group

A direct choice of weekdays selects Monday through Friday. A weekend choice selects Saturday and Sunday. A weeknight choice also requires the evening part of an offered weekday. When a choice includes a part of the day, apply both restrictions. A day group cannot restore a slot the member excludes. If the group contains no offered choice, ask again before using any other time. A separately selected offered slot can still count.

```quint
pure def probeGroupIncludes(groupWeekend: bool, offeredWeekend: bool, needsEvening: bool, offeredEvening: bool, namesPart: bool, partMatches: bool): bool =
  groupWeekend == offeredWeekend and (not(needsEvening) or offeredEvening) and (not(namesPart) or partMatches)

pure def lawProbeGroupDoesNotCrossWeekBoundary(groupWeekend: bool, offeredWeekend: bool, needsEvening: bool, offeredEvening: bool, namesPart: bool, partMatches: bool): bool =
  probeGroupIncludes(groupWeekend, offeredWeekend, needsEvening, offeredEvening, namesPart, partMatches) implies groupWeekend == offeredWeekend
```

### Remove a named exclusion from the offered alternatives

An answer such as “every day but Saturday” excludes Saturday from the
member's choices. A time-of-day limit still applies to the other options.
“Any morning but Saturday” can use only another offered morning. A
contradiction or an empty selection leaves the offer open. A separate
affirmative choice can identify another offered slot.

```quint
pure def probeExclusionAlternative(needsPart: bool, partMatches: bool, excluded: bool, contradicted: bool): bool =
  not(excluded or contradicted) and (not(needsPart) or partMatches)

pure def lawProbeExclusionNeverRestoresExcludedTime(needsPart: bool, partMatches: bool, contradicted: bool): bool =
  not(probeExclusionAlternative(needsPart, partMatches, true, contradicted))

pure def lawProbeExclusionKeepsTimeOfDay(partMatches: bool, excluded: bool, contradicted: bool): bool =
  probeExclusionAlternative(true, partMatches, excluded, contradicted) implies partMatches
```

### A past time reference leaves the offered time open

A clause that describes a past time or a past option does not select or refuse an offered time. Keep a separate current choice or clear refusal in the same reply. When the reply has only a past time reference and no current choice or clear refusal, ask again. Treat the past time reference as a qualified signal so a model reading cannot select a time for it.

```quint
pure def historicalProbeTimeClause(describesPast: bool, timeReference: bool): bool =
  describesPast and timeReference

pure def lawPresentProbeTimeKeepsItsClause(timeReference: bool): bool =
  not(historicalProbeTimeClause(false, timeReference))
```

### An unresolved offered time needs a time choice

When a timed reply has an unresolved time, ask which offered times work. If the member already received a general clarification, ask for times once. Keep the time question open until the member makes an explicit choice from the current offer, declines the introduction, or says none of those times work. A bare yes does not choose a time in answer to this question. A bare “both” or “either” needs exactly two offered times. The model cannot supply a choice. For an older timed clarification with no recorded kind, ask for times before accepting an unqualified yes. A first reply and a general clarification keep the usual consent rules.

```quint
type ClarifiedTimeReading = KeepProbeAnswer | UseExplicitProbeTimes | AwaitExplicitProbeTimes

pure def probeNeedsExplicitTimeChoice(offeredTimes: bool, timeChoice: bool, legacyClarified: bool, unresolvedTime: bool): bool =
  offeredTimes and (timeChoice or legacyClarified or unresolvedTime)

pure def probeClarificationMayAsk(askForTimes: bool, clarified: bool, timeChoice: bool): bool =
  if (askForTimes) not(timeChoice) else not(clarified)

pure def clarifiedBroadTimeChoiceAllowed(explicitChoice: bool, pairChoice: bool, offeredCount: int): bool =
  explicitChoice and (not(pairChoice) or offeredCount == 2)

pure def clarifiedProbeTimeReading(timeChoice: bool, answer: str, offeredChoices: int, explicitChoices: int): ClarifiedTimeReading =
  if (not(timeChoice) or answer == "no" or (answer == "yes" and offeredChoices == 0)) KeepProbeAnswer
  else if (answer == "yes" and explicitChoices > 0) UseExplicitProbeTimes
  else AwaitExplicitProbeTimes

pure def lawAClarifiedProbeCannotUseAnImplicitTime(offeredChoices: int): bool =
  offeredChoices > 0 implies clarifiedProbeTimeReading(true, "yes", offeredChoices, 0) == AwaitExplicitProbeTimes

pure def lawAClarifiedProbeCanUseExplicitTimes(offeredChoices: int, explicitChoices: int): bool =
  offeredChoices > 0 and explicitChoices > 0 implies
    clarifiedProbeTimeReading(true, "yes", offeredChoices, explicitChoices) == UseExplicitProbeTimes

pure def lawAnUntimedProbeDoesNotNeedATimeChoice(legacyClarified: bool, unresolvedTime: bool): bool =
  not(probeNeedsExplicitTimeChoice(false, true, legacyClarified, unresolvedTime))

pure def lawAProbeTimeQuestionIsAskedOnce(clarified: bool): bool =
  not(probeClarificationMayAsk(true, clarified, true))

pure def lawASecondQuestionCanClarifyTimes(clarified: bool): bool =
  clarified implies probeClarificationMayAsk(true, clarified, false) and not(probeClarificationMayAsk(false, clarified, false))

pure def lawAClarifiedPairNeedsTwoOfferedTimes(offeredCount: int): bool =
  offeredCount != 2 implies not(clarifiedBroadTimeChoiceAllowed(true, true, offeredCount))
```

### A suggested alternative needs a separate yes before asking for new times

A counter-offer alone does not accept the opportunity. A clear yes stated before a request for a different time may lead to a new time offer, when the previous offer included times. It does not accept any of the old times.

```quint
pure def mayRetryCounter(offeredTimes: bool, separateYes: bool): bool =
  offeredTimes and separateYes

pure def lawABareCounterDoesNotAccept(offeredTimes: bool): bool =
  not(mayRetryCounter(offeredTimes, false))

pure def lawAnUntimedProbeNeedsASeparateAnswer(separateYes: bool): bool =
  not(mayRetryCounter(false, separateYes))
```

### A relative time or duration alone cannot choose an offered slot

A relative day, future period, date-less “this afternoon,” or duration does not identify one of the offered slots. A clock time or part of the day that continues the same relative date does not identify a slot either. Ask again unless the member makes a separate clear choice of an offered slot. Treat the unbound time as a qualified answer so a model cannot replace it. A separate yes and counter-offer can still ask for fresh choices under the preceding rule.

```quint
pure def unboundProbeTimeNeedsClarification(unboundTime: bool, independentChoice: bool): bool =
  unboundTime and not(independentChoice)

pure def lawUnboundTimeAloneKeepsTheProbeOpen(modelConsent: str): bool =
  unboundProbeTimeNeedsClarification(true, false) and probeReplyReading(true, false, modelConsent) == KeepOffline
```

### An untimed probe needs an answer to the opportunity

A named time, a choice of position, or rejection of time options keeps an untimed probe open for a clear answer, including when the reply contains affirmative wording. Treat the reply as a qualified time signal and keep it when a model reads it as yes. A clear no to the opportunity still declines it. When the probe offered times, keep the ordinary empty-selection rules.

```quint
pure def untimedProbeTimeRejectionNeedsClarification(offeredTimes: bool, rejectedTimes: bool, otherwiseUnqualified: bool): bool =
  not(offeredTimes) and rejectedTimes and otherwiseUnqualified

pure def lawAnUntimedTimeRejectionKeepsTheProbeOpen(modelConsent: str): bool =
  untimedProbeTimeRejectionNeedsClarification(false, true, true) and probeReplyReading(true, false, modelConsent) == KeepOffline

pure def lawATimedProbeKeepsItsTimeRejectionRules(rejectedTimes: bool, otherwiseUnqualified: bool): bool =
  not(untimedProbeTimeRejectionNeedsClarification(true, rejectedTimes, otherwiseUnqualified))
```

### A short acknowledgement must immediately follow its own probe

A brief acknowledgement such as “OK” or a thumbs-up can answer a regular probe only while it remains the member's latest outgoing question and no other member turn has intervened. Two or more outgoing messages since the member last spoke make the acknowledgement ambiguous. A direct member reply must follow the accepted delivery of that question. A stale or ambiguous acknowledgement keeps the question open. A clear answer or an explicit choice of time uses the ordinary reply rules.

```quint
pure def weakProbeAcknowledgementAllowed(direct: bool, latestProbe: bool, uninterrupted: bool, precedingMessages: int,
  receiptAccepted: bool, acceptedAt: int, receivedAt: int, now: int): bool =
  direct and latestProbe and uninterrupted and precedingMessages < 2 and receiptAccepted and acceptedAt <= receivedAt and receivedAt <= now

pure def lawWeakAcknowledgementNeedsLatestProbe(precedingMessages: int, acceptedAt: int, receivedAt: int, now: int): bool =
  not(weakProbeAcknowledgementAllowed(true, false, true, precedingMessages, true, acceptedAt, receivedAt, now))

pure def lawWeakAcknowledgementNeedsUninterruptedTurn(precedingMessages: int, acceptedAt: int, receivedAt: int, now: int): bool =
  not(weakProbeAcknowledgementAllowed(true, true, false, precedingMessages, true, acceptedAt, receivedAt, now))
```
