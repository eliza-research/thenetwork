# Slop onboarding prompts

The [matching engine model](models/matching_engine.md) follows answers, profile edits, and later matching. This state machine chooses what the onboarding service does with the current profile. The service keeps the profile, parses each message, persists tags, and sends the generated choice using its existing text. The service adds a prompt to the ask count for its reason only after it sends the prompt. One routing run starts for each opportunity to send an onboarding prompt.

## Story: Review the information used for dating

> As a slop.date member, I want the agent to ask one relevant question at a time and let me confirm or correct the information it uses.

### Keep a match preference separate from self-description

A gender letter before an age range describes a possible match. A letter and
age after an explicit seeking phrase also describe a possible match. Neither
sets the member's own age or gender. A standalone self-description such as
“F 17” still gives the member's age and gender. The reader supplies the
surrounding words and the range boundary.

```quint
pure def slopSelfShorthandAllowed(namesTarget: bool, startsRange: bool): bool =
  not(namesTarget or startsRange)

pure def lawSlopTargetShorthandDoesNotDescribeMember(startsRange: bool): bool =
  not(slopSelfShorthandAllowed(true, startsRange))

pure def lawSlopRangeDoesNotSetOwnAge(namesTarget: bool): bool =
  not(slopSelfShorthandAllowed(namesTarget, true))
```

### Read a spelled distance as the same numeric preference

Spelled numbers that the reader knows, including “one hundred” and “a
hundred,” can give a radius with a distance unit. Use the same distance
context, unit conversion, and existing radius bounds as for a digit.

```quint
pure def slopRadiusContextAllowed(askedDistance: bool, distanceContext: bool, exerciseContext: bool, bareDigitRadius: bool): bool =
  askedDistance or (distanceContext and not(exerciseContext)) or bareDigitRadius

pure def slopRadiusMilesInBounds(miles: int): bool = miles >= 1 and miles <= 200

pure def lawSlopExerciseDistanceNeedsAQueryOrBareRadius(distanceContext: bool): bool =
  not(slopRadiusContextAllowed(false, distanceContext, true, false))

pure def lawSlopRadiusRejectsMilesOutsideBounds(miles: int): bool =
  (miles < 1 or miles > 200) implies not(slopRadiusMilesInBounds(miles))

pure def lawSlopRadiusIncludesBoundaries(upper: bool): bool =
  slopRadiusMilesInBounds(if (upper) 200 else 1)
```

### Age restrictions stop dating onboarding before a prompt

A minor or someone declined at signup receives no dating question or read-back. Otherwise, the router offers a read-back only when the required fields are complete, the profile awaits confirmation, and the read-back is within its ask limit and outside the immediate skip list. In all other cases it searches for a question.

```quint
type PromptPhase = AwaitingProfile | Withheld | ReadbackOffered | QuestionSearch | ReadbackReady | QuestionReady | NoQuestion

type PromptRun = { phase: PromptPhase, reason: str }

pure val initial: PromptRun = { phase: AwaitingProfile, reason: "" }
pure val readbackReason: str = "slop_readback"

pure def canRouteProfile(p: PromptRun): bool = p.phase == AwaitingProfile

pure def readbackEligible(hardComplete: bool, confirmed: bool, skipped: bool, belowAskCap: bool): bool =
  hardComplete and not(confirmed) and not(skipped) and belowAskCap

pure def routeProfile(p: PromptRun, restricted: bool, hardComplete: bool, confirmed: bool, skipped: bool, belowAskCap: bool): PromptRun =
  { ...p, phase: if (restricted) Withheld
    else if (readbackEligible(hardComplete, confirmed, skipped, belowAskCap)) ReadbackOffered
    else QuestionSearch }

pure def canResolveReadback(p: PromptRun): bool = p.phase == ReadbackOffered

pure def resolveReadback(p: PromptRun, textAvailable: bool): PromptRun =
  if (textAvailable) { phase: ReadbackReady, reason: readbackReason }
  else { ...p, phase: QuestionSearch }
```

### Ask the first missing field that can still be requested

The router considers hard fields before soft preferences. It skips a field if it is already known, if its reason was skipped for this turn, or if the reason reached its ask limit. The router asks for the dealbreakers only together with the goal (slop_basics), when both are missing; when only the dealbreakers are missing, it does not ask for them. If no field applies, the router has no question. The shell provides the field facts and looks up the final reason's text.

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

A read-back answer that changes a field clears confirmation. With no changes, the profile becomes confirmed only when the shell read an affirmation from an eligible member. Each recorded prompt adds one to the ask count of its reason.

```quint
pure def confirmationAfterAnswer(changed: bool, affirmative: bool, restricted: bool): bool =
  not(changed) and affirmative and not(restricted)

pure def countAfterPrompt(previous: int): int = previous + 1

pure def lawCorrectionNeedsConfirmation(affirmative: bool, restricted: bool): bool =
  not(confirmationAfterAnswer(true, affirmative, restricted))
```

### Only a plain yes confirms the read-back

The shell reads the member's answer to a read-back with the shared reply parser. It reports whether the parser read a yes, whether it read a no, whether the answer is qualified, and whether the answer is only a short affirmation word that the parser does not know ("right", "perfect"). An answer is qualified when it has a condition or a time limit, a question, or a hedge ("right, maybe", "perfect, if 11211 includes Greenpoint", "right?"). A qualified answer or a no never confirms the profile. A plain yes, or a short affirmation with nothing after it, is an affirmation.

```quint
pure def readbackAffirmed(answeredYes: bool, answeredNo: bool, qualified: bool, bareAffirmation: bool): bool =
  not(qualified) and not(answeredNo) and (answeredYes or bareAffirmation)

pure def lawQualifiedReadbackAnswerNeverConfirms(changed: bool, answeredYes: bool, answeredNo: bool, bareAffirmation: bool, restricted: bool): bool =
  not(confirmationAfterAnswer(changed, readbackAffirmed(answeredYes, answeredNo, true, bareAffirmation), restricted))

pure def lawRefusedReadbackNeverConfirms(changed: bool, answeredYes: bool, qualified: bool, bareAffirmation: bool, restricted: bool): bool =
  not(confirmationAfterAnswer(changed, readbackAffirmed(answeredYes, true, qualified, bareAffirmation), restricted))

pure def lawPlainYesConfirmsUnchangedReadback(answeredNo: bool, restricted: bool): bool =
  confirmationAfterAnswer(false, readbackAffirmed(true, answeredNo, false, false), restricted) iff (not(answeredNo) and not(restricted))
```
