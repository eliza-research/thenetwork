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

### A clear yes uses the chosen times when the member names them

If a model reads a clear yes, use the offered times the person chose. If they gave no preference, keep all offered times. The caller validates model-supplied keys against the offered times first.

```quint
pure def pickedTimes(chosen: List[str], offered: List[str]): List[str] =
  if (chosen.length() > 0) chosen else offered
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
