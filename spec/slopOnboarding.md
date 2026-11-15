# Slop onboarding prompts

The [matching engine model](models/matching_engine.md) follows answers, profile edits, and later matching. This state machine chooses what the onboarding service does with the current profile. The service keeps the profile, parses each message, persists tags, and sends the generated choice using its existing text. One routing run starts for each opportunity to send an onboarding prompt.

## Story: Review the information used for dating

> As a slop.date member, I want the agent to ask one relevant question at a time and let me confirm or correct the information it uses.

### Age restrictions stop dating onboarding before a prompt

A minor or someone declined at signup receives no dating question or read-back. Otherwise, the router considers a read-back when the required fields are complete, the profile awaits confirmation, and the read-back is within its ask limit and outside the immediate skip list.

```quint
type PromptPhase = AwaitingProfile | Withheld | ReadbackOffered | QuestionSearch | ReadbackReady | QuestionReady | NoQuestion

type PromptRun = { phase: PromptPhase, reason: str }

pure val initial: PromptRun = { phase: AwaitingProfile, reason: "" }
pure val readbackReason: str = "slop_readback"

pure def canRouteProfile(p: PromptRun): bool = p.phase == AwaitingProfile

pure def routeProfile(p: PromptRun, restricted: bool, wantsReadback: bool): PromptRun =
  { ...p, phase: if (restricted) Withheld else if (wantsReadback) ReadbackOffered else QuestionSearch }

pure def readbackEligible(hardComplete: bool, confirmed: bool, skipped: bool, belowAskCap: bool): bool =
  hardComplete and not(confirmed) and not(skipped) and belowAskCap

pure def canResolveReadback(p: PromptRun): bool = p.phase == ReadbackOffered

pure def resolveReadback(p: PromptRun, textAvailable: bool): PromptRun =
  if (textAvailable) { phase: ReadbackReady, reason: readbackReason }
  else { ...p, phase: QuestionSearch }
```

### Ask the first missing field that can still be requested

The router considers hard fields before soft preferences. It skips a field if it is already known, if its reason was skipped for this turn, or if the reason reached its ask limit. If none applies, the router has no question. The shell provides the field facts and looks up the final reason's text.

```quint
type QuestionFacts = {
  ageMissing: bool, genderMissing: bool, seeksMissing: bool, ageRangeMissing: bool, distanceMissing: bool,
  locationMissing: bool, unknownZip: bool, dealbreakersMissing: bool, goalMissing: bool,
  interestsMissing: bool, activitiesMissing: bool, freeMissing: bool,
}

pure val factsValues = Set(
  { ageMissing: true, genderMissing: true, seeksMissing: true, ageRangeMissing: true, distanceMissing: true,
    locationMissing: true, unknownZip: false, dealbreakersMissing: true, goalMissing: true,
    interestsMissing: true, activitiesMissing: true, freeMissing: true },
  { ageMissing: false, genderMissing: false, seeksMissing: false, ageRangeMissing: false, distanceMissing: false,
    locationMissing: true, unknownZip: true, dealbreakersMissing: false, goalMissing: false,
    interestsMissing: false, activitiesMissing: false, freeMissing: false },
  { ageMissing: false, genderMissing: false, seeksMissing: false, ageRangeMissing: false, distanceMissing: false,
    locationMissing: false, unknownZip: false, dealbreakersMissing: false, goalMissing: false,
    interestsMissing: false, activitiesMissing: false, freeMissing: false },
)

pure def nextQuestionReason(facts: QuestionFacts, unavailable: List[str]): str =
  if (facts.ageMissing and not(unavailable.includes("slop_age"))) "slop_age"
  else if (facts.genderMissing and facts.seeksMissing and not(unavailable.includes("slop_orientation"))) "slop_orientation"
  else if (facts.seeksMissing and not(unavailable.includes("slop_seeks"))) "slop_seeks"
  else if (facts.genderMissing and not(unavailable.includes("slop_gender"))) "slop_gender"
  else if (facts.ageRangeMissing and not(unavailable.includes("slop_age_range"))) "slop_age_range"
  else if (facts.distanceMissing and not(unavailable.includes("slop_distance"))) "slop_distance"
  else if (facts.locationMissing and facts.unknownZip and not(unavailable.includes("slop_zip"))) "slop_zip"
  else if (facts.locationMissing and not(unavailable.includes("slop_location"))) "slop_location"
  else if (facts.dealbreakersMissing and facts.goalMissing and not(unavailable.includes("slop_basics"))) "slop_basics"
  else if (facts.goalMissing and not(unavailable.includes("slop_goal"))) "slop_goal"
  else if (facts.interestsMissing and not(unavailable.includes("slop_interests"))) "slop_interests"
  else if (facts.activitiesMissing and not(unavailable.includes("slop_activities"))) "slop_activities"
  else if (facts.freeMissing and not(unavailable.includes("slop_free"))) "slop_free"
  else ""

pure def canChooseQuestion(p: PromptRun): bool = p.phase == QuestionSearch

pure def chooseQuestion(p: PromptRun, facts: QuestionFacts, unavailable: List[str]): PromptRun =
  val reason = nextQuestionReason(facts, unavailable)
  { phase: if (reason == "") NoQuestion else QuestionReady, reason: reason }

pure def alwaysReadyHasReason(p: PromptRun): bool =
  (p.phase == ReadbackReady or p.phase == QuestionReady) iff p.reason != ""

pure def stepRestrictedStaysWithheld(before: PromptRun, after: PromptRun): bool =
  before.phase == Withheld implies after.phase == Withheld

pure def sometimesReadback(p: PromptRun): bool = p.phase == ReadbackReady
pure def sometimesQuestion(p: PromptRun): bool = p.phase == QuestionReady
```

### A correction needs another confirmation

A read-back answer that changes a field clears confirmation. With no changes, the profile becomes confirmed only when the shell read an affirmation from an eligible member. An unanswered prompt is counted only after the service sends it.

```quint
pure def confirmationAfterAnswer(changed: bool, affirmative: bool, restricted: bool): bool =
  not(changed) and affirmative and not(restricted)

pure def countAfterPrompt(previous: int): int = previous + 1

pure def lawCorrectionNeedsConfirmation(affirmative: bool, restricted: bool): bool =
  not(confirmationAfterAnswer(true, affirmative, restricted))
```
