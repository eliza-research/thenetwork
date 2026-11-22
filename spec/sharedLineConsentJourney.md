# Shared-line consent journey

An existing adult member starts with consent in slop and friends. The
[carrier-consent rules](carrierConsent.md) govern the STOP wording and
the phone's permission in each app. This journey observes both decisions from the stored ledger
and the consent update the signed turn returns to Eliza. It uses a new
message ID for each text and advances the service clock for each receipt.
A delayed START can carry the same receipt time as the most recent STOP.

## Story: Stop the shared line and resume one app

> As a member of several apps, I want STOP to stop the shared line and
> START to resume only the app I choose.

### STOP on the shared line withdraws every app's permission

The turn returns a global opt-out for the gateway. The normal send fence
then refuses both apps. START later can change one app's consent.
STOP ALL covers every app on any line. Plain STOP on a dedicated line
follows that line's configured scope. A direct request to stop texts
alongside a separate request to keep calls has the same effect as STOP.
The whole-message forms "QUIT NOW" and "END PLEASE" also act as STOP.

```quint
import carrierConsent as Carrier from "./carrierConsent"

type AppUnderObservation = Slop | Friends
type StopWording = StopKeyword | StopTextsKeepCalls | QuitNow | EndPlease
type ConsentUpdate = AllOptedOut | SlopOptedIn | FriendsOptedIn
type LineConsent = { slopMayText: bool, friendsMayText: bool }
type Turn = { state: LineConsent, out: List[ConsentUpdate] }

pure val initial: LineConsent = { slopMayText: true, friendsMayText: true }

pure def stopCoversEveryApp(explicitAll: bool, sharedLine: bool, dedicatedLineGlobal: bool): bool =
  explicitAll or sharedLine or dedicatedLineGlobal

pure def canTextStop(s: LineConsent, wording: StopWording): bool = true
pure def textStop(s: LineConsent, wording: StopWording): Turn =
  { state: { slopMayText: false, friendsMayText: false }, out: List(AllOptedOut) }

pure def sometimesBothAppsStop(s: LineConsent): bool =
  not(s.slopMayText) and not(s.friendsMayText)
```

### An ambiguous message leaves shared-line consent unchanged

A negation that covers both verbs, an app named in an unsubscribe clause,
and "cancel please" do not count as a STOP for the shared line. The text
reader does not treat a mention of unsubscribing as a STOP command.

```quint
type OtherWording = CoordinatedNegation | AppNamedInClause | ReportedUnsubscribe | CancelPlease

pure def textOther(s: LineConsent, other: OtherWording): Turn =
  { state: s, out: List() }
```

### A new START permits texts in the chosen app only

START received after STOP can permit texts from the chosen app. START
with the same receipt time as STOP cannot restore a stopped app. If that
app already has a later opt-in, its permission stays in place and the
gateway still gets an app-scoped opt-in with the event's original time.
The driver compares the update's scope and checks its time against the
signed request.

```quint
pure def mayTextAfterStart(alreadyAllowed: bool, sentWithLastStop: bool): bool =
  alreadyAllowed or Carrier::appMayText(true, true, if (sentWithLastStop) 0 else 1, 0)

pure def canTextStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: bool): bool = true
pure def textStart(s: LineConsent, app: AppUnderObservation, sentWithLastStop: bool): Turn =
  val allowed = mayTextAfterStart(if (app == Slop) s.slopMayText else s.friendsMayText, sentWithLastStop)
  { state: if (app == Slop) { ...s, slopMayText: allowed } else { ...s, friendsMayText: allowed },
    out: if (allowed) List(if (app == Slop) SlopOptedIn else FriendsOptedIn) else List() }

pure def sometimesOnlySlopResumes(s: LineConsent): bool = s.slopMayText and not(s.friendsMayText)
pure def sometimesOnlyFriendsResumes(s: LineConsent): bool = s.friendsMayText and not(s.slopMayText)

pure def stepOneTextCannotRestoreBoth(before: LineConsent, after: LineConsent): bool =
  (not(before.slopMayText) and not(before.friendsMayText)) implies not(after.slopMayText and after.friendsMayText)
```
