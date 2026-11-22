# Slop onboarding prompts

The [matching engine model](models/matching_engine.md) follows answers, profile edits, and later matching. This state machine chooses what the onboarding service does with the current profile. The service keeps the profile, parses each message, persists tags, and sends the generated choice using its existing text. The service adds a prompt to the ask count for its reason only after it sends the prompt. One routing run starts for each opportunity to send an onboarding prompt.

## Story: Review the information used for dating

> As a slop.date member, I want the agent to ask one relevant question at a time and let me confirm or correct the information it uses.

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

Orientation is never inferred ([mutual openness](mutualOpenness.md)). A member who stated an orientation label (bi, pan, queer, gay, lesbian, asexual) and is still unclear about who they seek after the seeking question reached its ask limit gets no default: the router asks them plainly which genders they are open to (slop_seeks_genders). After the hard fields, the router asks every member once whether they are open to trans partners (slop_trans_openness), and asks a nonbinary member whether to also appear to people who seek women or men (slop_shown_to). Each is one question in plain words, and the member may decline to answer: a declined or unanswered trans question is read as not open. An answer of "only trans partners" from a member who did not state trans counts as not given, so the trans question stays missing and is asked again until its ask limit ([mutual openness](mutualOpenness.md), "Only trans partners is available only to a member who stated trans"); while that answer stands the seeking set also counts as not given, so the seeking question is asked again and the member is not matchable. The answer to the shown-to question names only the pools the nonbinary member appears to; the shell never reads it as a new seeking set. The shell reads these answers in packages/engine/src/packs/slop/extract.ts: the words "trans" and "cis" qualify the gender after them and are never filler, so "women but not trans women" seeks women and is not open to trans partners; a list that puts "trans" before only some of its genders gives no seeking set; "no preference" and "doesn't matter" read as open; the shown-to answer is read only when that question was asked. This rule changed with the stated signifiers work (2026-11-22): it adds the plain seeking question, the trans question and the shown-to question, and it takes the straight default away from a member who stated an orientation label, because orientation and openness must be stated by the member and never inferred.

```quint
type QuestionFacts = {
  ageMissing: bool, genderMissing: bool, seeksMissing: bool, orientationStated: bool, ageRangeMissing: bool, distanceMissing: bool,
  locationMissing: bool, unknownZip: bool, transOpennessMissing: bool, shownToMissing: bool, dealbreakersMissing: bool, goalMissing: bool,
  interestsMissing: bool, activitiesMissing: bool, freeMissing: bool,
}

pure val factsValues = Set(
  { ageMissing: true, genderMissing: true, seeksMissing: true, orientationStated: false, ageRangeMissing: true, distanceMissing: true,
    locationMissing: true, unknownZip: false, transOpennessMissing: true, shownToMissing: true, dealbreakersMissing: true, goalMissing: true,
    interestsMissing: true, activitiesMissing: true, freeMissing: true },
  { ageMissing: false, genderMissing: false, seeksMissing: true, orientationStated: true, ageRangeMissing: false, distanceMissing: false,
    locationMissing: false, unknownZip: false, transOpennessMissing: true, shownToMissing: false, dealbreakersMissing: false, goalMissing: false,
    interestsMissing: false, activitiesMissing: false, freeMissing: false },
  { ageMissing: false, genderMissing: false, seeksMissing: false, orientationStated: false, ageRangeMissing: false, distanceMissing: false,
    locationMissing: true, unknownZip: true, transOpennessMissing: true, shownToMissing: true, dealbreakersMissing: false, goalMissing: false,
    interestsMissing: false, activitiesMissing: false, freeMissing: false },
  { ageMissing: false, genderMissing: false, seeksMissing: false, orientationStated: false, ageRangeMissing: false, distanceMissing: false,
    locationMissing: false, unknownZip: false, transOpennessMissing: false, shownToMissing: false, dealbreakersMissing: false, goalMissing: false,
    interestsMissing: false, activitiesMissing: false, freeMissing: false },
)

pure def nextQuestionReason(facts: QuestionFacts, unavailable: List[str]): str =
  if (facts.ageMissing and not(unavailable.includes("slop_age"))) "slop_age"
  else if (facts.genderMissing and facts.seeksMissing and not(unavailable.includes("slop_orientation"))) "slop_orientation"
  else if (facts.seeksMissing and not(unavailable.includes("slop_seeks"))) "slop_seeks"
  else if (facts.seeksMissing and facts.orientationStated and not(unavailable.includes("slop_seeks_genders"))) "slop_seeks_genders"
  else if (facts.genderMissing and not(unavailable.includes("slop_gender"))) "slop_gender"
  else if (facts.ageRangeMissing and not(unavailable.includes("slop_age_range"))) "slop_age_range"
  else if (facts.distanceMissing and not(unavailable.includes("slop_distance"))) "slop_distance"
  else if (facts.locationMissing and facts.unknownZip and not(unavailable.includes("slop_zip"))) "slop_zip"
  else if (facts.locationMissing and not(unavailable.includes("slop_location"))) "slop_location"
  else if (facts.transOpennessMissing and not(unavailable.includes("slop_trans_openness"))) "slop_trans_openness"
  else if (facts.shownToMissing and not(unavailable.includes("slop_shown_to"))) "slop_shown_to"
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

pure def lawStatedLabelIsAskedPlainlyNotDefaulted(facts: QuestionFacts): bool =
  (facts.seeksMissing and facts.orientationStated and not(facts.ageMissing) and not(facts.genderMissing))
    implies nextQuestionReason(facts, List("slop_seeks")) == "slop_seeks_genders"

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
