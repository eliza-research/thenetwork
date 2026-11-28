# Carrier consent

The text readers recognize requests at the inbound boundary. The platform uses these rules to read a STOP and resolve the latest app and global events for the same verified phone. The stores choose each latest event before calling the consent rule.

## Story: Stop texts across apps and resume an app

> As a person on the shared line, I want STOP to end messages from every app and START to resume the app I chose.

### Courtesy or urgency can accompany a whole-message STOP command

A whole message can contain STOP, QUIT or END with courtesy or urgency words. PARA, PARAR, ALTO, BASTA, DETENER, NO MÁS and NO MÁS MENSAJES take Spanish courtesy or urgency words. The text reader owns normalization and the courtesy vocabulary. CANCEL, CANCELAR and BAJA can concern another activity and do not take courtesy or urgency words as STOP commands.

```quint
pure def stopWordAllowsCourtesy(word: str): bool =
  word == "STOP" or word == "QUIT" or word == "END" or word == "PARA" or word == "PARAR" or
    word == "ALTO" or word == "BASTA" or word == "DETENER" or word == "NO MAS" or word == "NO MAS MENSAJES"

pure def lawCourtesyCannotTurnAmbiguousCommandsIntoStop(word: str): bool =
  (word == "CANCEL" or word == "CANCELAR" or word == "BAJA") implies not(stopWordAllowsCourtesy(word))
```

### A plain refusal of future texts stops the shared line

The reader accepts a direct whole-clause refusal of messages, such as "I don't want texts anymore" or "I don't want any more texts". A bare message noun needs a permanent ending. The text reader excludes a category, a temporary limit or any other condition from this whole-clause form.

```quint
pure def textRefusalStops(hasDeterminer: bool, permanentEnding: bool): bool =
  hasDeterminer or permanentEnding

pure def lawBareTextRefusalNeedsPermanence(permanentEnding: bool): bool =
  textRefusalStops(false, permanentEnding) == permanentEnding
```

### A refusal bounded by a clock time does not stop the shared line

A direct refusal that names a clock bound, such as "don't text me after 10 pm" or "don't text me before 7 am", limits when texts may arrive. It sets quiet hours and does not stop the shared line. When the bound cannot save as stated, the reply asks the member instead of dropping the refusal. A refusal with no clock bound still stops the line. A separate unbounded refusal in the same message, including a bare "stop", still stops it. The text reader identifies the clock bound and any separate refusal.

```quint
pure def refusalStopsLine(hasRefusal: bool, timeBounded: bool): bool =
  hasRefusal and not(timeBounded)

pure def lawTimeBoundedRefusalCannotStop(hasRefusal: bool): bool =
  not(refusalStopsLine(hasRefusal, true))

pure def lawUnboundedRefusalStillStops(hasRefusal: bool): bool =
  refusalStopsLine(hasRefusal, false) == hasRefusal
```

### Direct repeated and permanent refusals stop the shared line

Recognize a direct first-person repeat such as “I told you to stop” and an explicitly permanent refusal such as “I never want to hear from you again”. The reader checks the whole message and keeps its quote and question markers. A full quotation, a question, a third-person report, a temporary limit, or a named topic or app supplies no global STOP through this rule.

```quint
pure def sharedLineStopStatementStops(direct: bool, repeated: bool, permanent: bool): bool =
  direct and (repeated or permanent)

pure def lawAnIndirectStopStatementCannotStop(repeated: bool, permanent: bool): bool =
  not(sharedLineStopStatementStops(false, repeated, permanent))

pure def lawARecognizedDirectStopStatementStops(repeated: bool, permanent: bool): bool =
  (repeated or permanent) implies sharedLineStopStatementStops(true, repeated, permanent)
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

## Story: Leave the app I name without stopping the other apps

> As a member on the shared line, I want a leave request to recognize the app when I say its domain out loud.

### A spoken domain identifies that one app

An app name can be the exact domain with "dot" spoken or with spaces in place of its dots. In the spaced form, a preceding "the" can make the words refer to something else. An explicit unsubscribe still names the app in that form. The reader preserves the existing exact app, brand and written-domain names. The advisory reader uses the same domain forms when the caller supplies the app's domain.

```quint
pure def matchesSpokenAppDomain(label: str, spaced: str, pronounced: str, ambiguousArticle: bool): bool =
  label == pronounced or (not(ambiguousArticle) and label == spaced)

pure def lawArticleDoesNotTurnSpacedLabelIntoDomain(spaced: str, pronounced: str): bool =
  spaced != pronounced implies not(matchesSpokenAppDomain(spaced, spaced, pronounced, true))
```
