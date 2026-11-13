# Probe reply

## Story: Make a choice about a proposed opportunity

> As a member who receives a probe, I want the Network to respect my actual answer and the times I chose.

### A model reading cannot replace a definite or qualified answer

Use the rule-based reading when it found a yes, a no, a condition, a hedge, or a conflicting signal. When it found no signal, a model reading can supply a clear yes or no. If neither reading supplies an answer, the caller keeps the original result.

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
