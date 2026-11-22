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

### A past time reference leaves the offered time open

A clause that describes a past time or a past option does not select or refuse an offered time. Keep a separate current choice or clear refusal in the same reply. When the reply has only a past time reference and no current choice or clear refusal, ask again. Treat the past time reference as a qualified signal so a model reading cannot select a time for it.

```quint
pure def historicalProbeTimeClause(describesPast: bool, timeReference: bool): bool =
  describesPast and timeReference

pure def lawPresentProbeTimeKeepsItsClause(timeReference: bool): bool =
  not(historicalProbeTimeClause(false, timeReference))
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
