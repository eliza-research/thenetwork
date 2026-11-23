# Carrier consent

The text readers recognize requests at the inbound boundary. The platform uses these rules to read a STOP and resolve the latest app and global events for the same verified phone. The stores choose each latest event before calling the consent rule.

## Story: Stop texts across apps and resume an app

> As a person on the shared line, I want STOP to end messages from every app and START to resume the app I chose.

### Courtesy and urgency can accompany STOP, QUIT or END

A whole message can contain STOP, QUIT or END with courtesy or urgency words. The text reader owns normalization and the list of courtesy and urgency words. A word that asks to cancel a date or another activity does not become a STOP when followed by a courtesy or urgency word.

```quint
pure def stopWordAllowsCourtesy(word: str): bool =
  word == "STOP" or word == "QUIT" or word == "END"

pure def lawCourtesyCannotTurnCancelIntoStop(word: str): bool =
  (word == "CANCEL") implies not(stopWordAllowsCourtesy(word))
```

### An independent STOP joined to a negation still takes effect

The text reader can recognize a direct global STOP after a complete negative clause, or before a separate negative clause. An incomplete negative clause, such as "I don't want you to stop", does not make a following verb into a separate request. The text reader identifies the clauses. At the inbound boundary, the platform excludes a request that specifies a single app from global STOP.

```quint
type StopConjunct = ExplicitStop | CompleteNegation | IncompleteNegation | OtherClause
type CoordinatedStop = FirstStops | LastStops | NeitherStops

pure def coordinatedStopClause(leftClause: StopConjunct, rightClause: StopConjunct): CoordinatedStop =
  if (leftClause == CompleteNegation and rightClause == ExplicitStop) LastStops
  else if (leftClause == ExplicitStop and (rightClause == CompleteNegation or rightClause == IncompleteNegation)) FirstStops
  else NeitherStops

pure def lawIncompleteNegationDoesNotMakeASeparateStop(rightClause: StopConjunct): bool =
  coordinatedStopClause(IncompleteNegation, rightClause) == NeitherStops
```

### A global STOP beats an older or simultaneous app opt-in

After a global STOP, only an app opt-in strictly later than STOP permits this app to text. The opt-in has no effect on other apps.

```quint
pure def appOptInBeatsStop(appAt: int, stopAt: int): bool =
  appAt > stopAt

pure def lawStopWinsATie(at: int): bool =
  not(appOptInBeatsStop(at, at))
```

### An app with no opt-in has no permission to send

An app's current event must be an opt-in. When a global STOP is present, the newer app opt-in rule also applies. An absent event or app opt-out cannot supply permission.

```quint
pure def appMayText(appOptedIn: bool, globalOptedOut: bool, appAt: int, globalAt: int): bool =
  appOptedIn and (not(globalOptedOut) or appOptInBeatsStop(appAt, globalAt))

pure def lawNoAppOptInMeansNoPermission(globalOptedOut: bool, appAt: int, globalAt: int): bool =
  not(appMayText(false, globalOptedOut, appAt, globalAt))
```
