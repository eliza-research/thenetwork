# Cofounder introduction authority

[The lane table](matchLane.md) assigns Cofounder to The Network and Peon. General professional participation, employment, a connected source, or an assistant's inference cannot opt a person into this lane.

## Story: Both peers still want a cofounder

> As a member, I want a cofounder introduction only while both of us want one in the same app.

### Exact current consent belongs to the same app

Use an active, unexpired professional intent created by the member for the Cofounder lane in the current app. Use the intent's exact identifier from the reviewed proposal. A different intent, including a new cofounder request after closure, does not replace that identifier in an earlier proposal.

```quint
import cofounderIntent as Intake from "./cofounderIntent"

pure val cofounderConsentMarker = Intake::cofounderIntentDetails

pure def cofounderIntentEligible(app: str, expectedApp: str, category: str, details: str, intentLive: bool): bool =
  (expectedApp == "ntwrk" or expectedApp == "peon") and app == expectedApp and category == "professional"
    and details == cofounderConsentMarker and intentLive

pure def lawCofounderIntentRejectsAnotherApp(app: str, expectedApp: str, category: str, details: str, intentLive: bool): bool =
  (app == expectedApp) or not(cofounderIntentEligible(app, expectedApp, category, details, intentLive))

pure def lawCofounderIntentRejectsInactive(app: str, expectedApp: str, category: str, details: str): bool =
  not(cofounderIntentEligible(app, expectedApp, category, details, false))
```

### A review, probe and reveal require both exact intents

A cofounder proposal binds two distinct adult peers and both intent IDs. Both bindings and both peers' ordinary matching eligibility must still hold at review, before a probe, and before a reveal. Review is required before contact. Reveal requires both peers to accept the exact introduction.

```quint
pure val cofounderDeliveryIdPrefix = "cofounder-intro:"

pure def cofounderPairCurrent(distinctPeers: bool, firstIntent: bool, secondIntent: bool, peersEligible: bool): bool =
  distinctPeers and firstIntent and secondIntent and peersEligible

pure def cofounderDeliveryAllowed(pairCurrent: bool, reviewed: bool, revealing: bool, bothAccepted: bool): bool =
  pairCurrent and reviewed and (not(revealing) or bothAccepted)

pure def lawCofounderDeliveryNeedsReview(pairCurrent: bool, revealing: bool, bothAccepted: bool): bool =
  not(cofounderDeliveryAllowed(pairCurrent, false, revealing, bothAccepted))

pure def lawCofounderRevealNeedsBoth(pairCurrent: bool, reviewed: bool): bool =
  not(cofounderDeliveryAllowed(pairCurrent, reviewed, true, false))
```
