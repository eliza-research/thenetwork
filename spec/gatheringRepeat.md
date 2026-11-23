# Review a gathering pair's next meeting

## Story: Offer a private reviewed follow-up after mutual gathering interest

> As one of two eligible adults who opted into meeting again after a gathering, I want an ordinary private offer with a recorded review and a separate choice about the next meeting.

### A current exact mutual choice can enter review once per gathering pair

The source names the approved event revision, group review instance, exact unordered pair and one version of their affirmative attendance and follow-up receipts. Use only the exact source refreshed by the service. Require local adult eligibility, social one-to-one preferences and the same pair safety and outreach checks as an ordinary repeat. Keep one opportunity for the event and pair across retries, changed receipt versions and restart. Staff cannot replace either participant or supply copy that exposes the private source.

```quint
pure val gatheringRepeatOppPrefix: str = "gathering-repeat:"

pure def gatheringRepeatSourceMatches(sameGathering: bool, sameRevision: bool, sameGroupReview: bool, samePair: bool, sameConsentVersion: bool): bool =
  sameGathering and sameRevision and sameGroupReview and samePair and sameConsentVersion

pure def gatheringRepeatMayStage(rolloutEnabled: bool, currentSource: bool, pairPermitted: bool, alreadyOffered: bool): bool =
  rolloutEnabled and currentSource and pairPermitted and not(alreadyOffered)

pure def lawGatheringRepeatRejectsChangedConsent(sameGathering: bool, sameRevision: bool, sameGroupReview: bool, samePair: bool): bool =
  not(gatheringRepeatSourceMatches(sameGathering, sameRevision, sameGroupReview, samePair, false))

pure def lawGatheringRepeatStagesOnce(rolloutEnabled: bool, currentSource: bool, pairPermitted: bool): bool =
  not(gatheringRepeatMayStage(rolloutEnabled, currentSource, pairPermitted, true))
```

### Review and each new reply are separate from the earlier mutual choice

The exact source must remain current during the ordinary review by the review judge or staff, while opening and answering an anonymous probe, and through the first booking reveal. A missing, expired or changed source closes an unbooked offer without naming anyone or disclosing a private choice. A direct reply can count only after the exact probe or follow-up time question was accepted for delivery. Only a fresh explicit answer applies. Require a fresh yes from each person before booking and use ordinary logistics once the separate consent and initial booking are committed. The approval is a recorded approval by the review judge or, for an item that the judge holds, by a named staff member. Changed (owner decision 2026-11-22, D15 to D17): a named staff member had to approve each gathering pair, and the simulated reviewer was refused; now the judge approves it like every other introduction.

```quint
pure def gatheringRepeatMayAnswer(currentSource: bool, directMember: bool, delivered: bool, answerAt: int, deliveredAt: int): bool =
  currentSource and directMember and delivered and deliveredAt <= answerAt

pure def gatheringRepeatMayBook(currentSource: bool, approved: bool, firstNewYes: bool, secondNewYes: bool): bool =
  currentSource and approved and firstNewYes and secondNewYes

pure def lawGatheringRepeatNeedDeliveredProbe(currentSource: bool, directMember: bool, answerAt: int, deliveredAt: int): bool =
  not(gatheringRepeatMayAnswer(currentSource, directMember, false, answerAt, deliveredAt))

pure def lawGatheringRepeatNeedsSeparateConsent(currentSource: bool, approved: bool, firstNewYes: bool): bool =
  not(gatheringRepeatMayBook(currentSource, approved, firstNewYes, false))
```
