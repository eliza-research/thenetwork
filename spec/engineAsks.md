# Matching information questions

The [matching engine flow model](models/matching_engine.md) follows questions for missing matching information. The engine collects suggestions from the current app pack before it selects proposals. The shell supplies stored question history, profile facts, market membership, and existing eligibility checks. It builds the question text and proposal ranking as before. The service applies its own admission rules when it sends questions.

## Story: Ask for the information needed to find a match

> As a member, I want questions about missing matching information at a reasonable pace.

### An enabled run considers adults in a supported market

Read the pack's question switch once for the run. An active run lets the pack consider adults who are in one of its markets. Each question the pack selects reserves one proactive slot in proposal selection. A pack can select multiple questions for one member. Publishing ends the run.

```quint
type QuestionPhase = AwaitingOptions | PlanningQuestions | QuestionsPublished
type AskRun = { phase: QuestionPhase, counts: str -> int }

pure val initial: AskRun = { phase: AwaitingOptions, counts: Map() }

pure def canSetAvailability(s: AskRun): bool = s.phase == AwaitingOptions
pure def setAvailability(s: AskRun, configured: bool): AskRun =
  { ...s, phase: if (configured) PlanningQuestions else QuestionsPublished }

pure def questionSubjectAllowed(s: AskRun, adult: bool, supportedMarket: bool): bool =
  s.phase == PlanningQuestions and adult and supportedMarket

pure def countReservedQuestions(s: AskRun, memberId: str): int =
  if (s.counts.keys().contains(memberId)) s.counts.get(memberId) else 0

pure def canReserveQuestion(s: AskRun, memberId: str, adult: bool, supportedMarket: bool): bool =
  questionSubjectAllowed(s, adult, supportedMarket)
pure def reserveQuestion(s: AskRun, memberId: str, adult: bool, supportedMarket: bool): AskRun =
  { ...s, counts: s.counts.put(memberId, countReservedQuestions(s, memberId) + 1) }

pure def canPublishQuestions(s: AskRun): bool = s.phase == PlanningQuestions
pure def publishQuestions(s: AskRun): AskRun = { ...s, phase: QuestionsPublished }

pure def countPublishedQuestions(s: AskRun, memberId: str): int =
  if (s.phase == QuestionsPublished) countReservedQuestions(s, memberId) else 0

pure val memberIdValues = Set("a", "b")

pure def stepPublishedQuestionsStayClosed(before: AskRun, after: AskRun): bool =
  before.phase == QuestionsPublished implies after == before

pure def sometimesPublishesQuestions(s: AskRun): bool =
  s.phase == QuestionsPublished and countReservedQuestions(s, "a") > 0
```

### The Network asks for dating preferences once

If the member has a live dating intent with missing preferences, the Network considers the preference question if it has never recorded it before. Check the member's existing dating eligibility before adding the question.

```quint
pure def networkPreferenceQuestion(missingPreferences: bool, activeIntent: bool, previouslyAsked: bool): bool =
  missingPreferences and activeIntent and not(previouslyAsked)
```

### Slop finishes required questions before proposing optional ones

Consider an adult profile with dating opt-in that is active and clear of holds. Ask about missing matching fields, seven days apart per question, while their individual ask count remains below the configured positive cap. Zero disables that cap. The optional questions become eligible after the required fields are complete.

```quint
type SlopQuestionTrack = RequiredQuestions | OptionalQuestions
pure val requiredQuestionWaitMs = 604800000

pure def slopQuestionSubject(adult: bool, optedIn: bool, paused: bool, held: bool): bool =
  adult and optedIn and not(paused) and not(held)

pure def slopQuestionTrack(missingFields: bool): SlopQuestionTrack =
  if (missingFields) RequiredQuestions else OptionalQuestions

pure def requiredQuestionDue(elapsedMs: int, asked: int, cap: int): bool =
  elapsedMs >= requiredQuestionWaitMs and not(cap > 0 and asked >= cap)
```

### Slop can offer a wider radius or ask about compatibility

Offer a wider dating radius once when widening is enabled, the member's pool is small enough, and the current radius is narrower than the offered radius. When compatibility questions are enabled and information is missing, the basics question precedes the type question. Each question waits 21 days before it can be repeated. The type question also needs its own switch.

```quint
pure val compatibilityWaitMs = 1814400000

pure def wideningPoolEligible(wideningEnabled: bool, degree: int, maximumDegree: int): bool =
  wideningEnabled and degree <= maximumDegree

pure def widerRadiusQuestion(radius: int, offeredRadius: int, alreadyAsked: bool): bool =
  radius < offeredRadius and not(alreadyAsked)

pure def compatibilityQuestionDue(elapsedMs: int): bool = elapsedMs >= compatibilityWaitMs
```
