# Standing intent freshness

[Story F9](product/stories.md#story-f9--keep-a-standing-intent) asks the Network to keep looking until the member stops or the intent expires. The [profile learning](models/profile_learning.md) and [matching engine](models/matching_engine.md) models describe the surrounding flows. The shell supplies the stored status and computes the deadline from the member's recorded statement and its horizon. The shell keeps the statement time of a learned desire when a matching run reads that desire again; only a fresh statement by the member sets a new time. A pause or a close of a learned want keeps the desire and its statement time and records the control in member state, so that a paused or closed want stays out of learned matching evidence and an UNDO can restore it. Changed (owner decision 2026-11-22): before, a withdrawal deleted the learned desire, so it could not be undone.

## Story: Match only on a current standing intent

> As a member, I want the Network to keep looking for what I asked for while that request is still current.

### A standing intent expires at its recorded deadline

An active row contributes evidence until the deadline. At the deadline it expires. Only a live row supplies evidence. An expired, paused, closed or unknown-status row supplies neither matching evidence nor a derived participation preference. The same rule applies to matching, probe order, and judgment views. Explicit participation preferences come from the member record. Rebuild a cached matching profile when the first intent used in it expires.

```quint
type StandingIntentPhase = IntentLive | IntentExpired | IntentPaused | IntentClosed | IntentInactive

pure def classifyStandingIntent(status: str, expiresAt: int, asOf: int): StandingIntentPhase =
  if (status == "active") (if (expiresAt > asOf) IntentLive else IntentExpired)
  else if (status == "paused") IntentPaused
  else if (status == "closed") IntentClosed
  else IntentInactive

pure def standingIntentSuppliesEvidence(phase: StandingIntentPhase): bool = phase == IntentLive

pure def cachedStandingIntentsCurrent(firstExpiry: int, asOf: int): bool = firstExpiry > asOf

pure def lawDeadlineEndsAnActiveIntent(expiresAt: int): bool =
  classifyStandingIntent("active", expiresAt, expiresAt) == IntentExpired

pure def lawPausedOrClosedSuppliesNoEvidence(expiresAt: int, asOf: int): bool =
  not(standingIntentSuppliesEvidence(classifyStandingIntent("paused", expiresAt, asOf)))
    and not(standingIntentSuppliesEvidence(classifyStandingIntent("closed", expiresAt, asOf)))
```

### A fresh statement can replace an expired copy

A learned desire has sixty days from the member's statement. A learned copy projects only while it is live and no record of the same desire blocks it. A live, paused, or closed record of the same desire takes precedence over a learned copy, and so does a record with an unknown status. An expired active row lets a fresh statement through. When checking a withdrawal, an active row supersedes a matching closed record only while it supplies evidence, so its expiry ends that ability.

```quint
pure val learnedIntentDays = 60

pure def learnedIntentMayProject(phase: StandingIntentPhase, blockingRecord: bool): bool =
  phase == IntentLive and not(blockingRecord)

pure def standingIntentBlocksLearnedCopy(phase: StandingIntentPhase): bool = phase != IntentExpired

pure def lawBlockingRecordPreventsLearnedProjection(phase: StandingIntentPhase): bool =
  not(learnedIntentMayProject(phase, true))

pure def lawOnlyExpiredRecordLetsLearnedCopyThrough(status: str, expiresAt: int, asOf: int): bool =
  standingIntentBlocksLearnedCopy(classifyStandingIntent(status, expiresAt, asOf)) iff not(status == "active" and expiresAt <= asOf)

pure def lawExpiredActiveRowStopsSuperseding(expiresAt: int, asOf: int): bool =
  asOf >= expiresAt implies not(standingIntentSuppliesEvidence(classifyStandingIntent("active", expiresAt, asOf)))
```

### Changed matching evidence starts another standing intent search

After the daily run, recheck live standing intents on the next normal matching tick when usable evidence or supply changes. A new eligible member, a changed usable facet, a fresh intent, or a current event in the matching input can change that evidence. Include current and future presence of those members. A trip that changes, begins, or ends changes the evidence for the existing market, even when the trip is to a different city. Exclude invalid and ended windows. Use the same app and city, and keep the last searched evidence with the matching state so a retry or restart does not repeat a completed search. A private facet cannot start a search. The daily run and any rechecks share the same daily proposal limit.

```quint
pure def standingIntentFacetEvidence(scope: str, fresh: bool): bool =
  fresh and (scope == "matchable" or scope == "shareable")

type StandingPresencePhase = IgnorePresence | FuturePresence | CurrentPresence

pure def standingPresencePhase(eligibleMember: bool, hasStart: bool, startsAt: int, hasEnd: bool, endsAt: int, asOf: int): StandingPresencePhase =
  if (not(eligibleMember) or (hasStart and hasEnd and startsAt >= endsAt) or (hasEnd and endsAt <= asOf)) IgnorePresence
  else if (hasStart and asOf < startsAt) FuturePresence
  else CurrentPresence

pure def lawEndedPresenceDoesNotContribute(eligibleMember: bool, hasStart: bool, startsAt: int, endsAt: int): bool =
  standingPresencePhase(eligibleMember, hasStart, startsAt, true, endsAt, endsAt) == IgnorePresence

pure def lawStartingTripChangesEvidence(startsAt: int, endsAt: int): bool =
  startsAt < endsAt implies
    (standingPresencePhase(true, true, startsAt, true, endsAt, startsAt - 1) == FuturePresence and
      standingPresencePhase(true, true, startsAt, true, endsAt, startsAt) == CurrentPresence)

pure def canQueueEngineOpportunity(queuedToday: int, dailyCap: int): bool =
  queuedToday < dailyCap

pure def standingIntentRecheckDue(previous: str, evidence: str, liveIntents: int, queuedToday: int, dailyCap: int): bool =
  previous != evidence and liveIntents > 0 and canQueueEngineOpportunity(queuedToday, dailyCap)

pure def lawUnchangedEvidenceDoesNotRecheck(evidence: str, liveIntents: int, queuedToday: int, dailyCap: int): bool =
  not(standingIntentRecheckDue(evidence, evidence, liveIntents, queuedToday, dailyCap))
```

### Another search can queue only opportunities that serve a live intent

An extra search considers opportunities anchored to a live standing intent and events in the same category as a participant's live standing intent. It uses the engine's existing eligibility gates and the Network's normal review path. It does not send profiling questions or update the regular run's exposure balance.

```quint
pure def standingIntentCandidateInScope(scoped: bool, matchesIntent: bool, eventFitsIntent: bool): bool =
  not(scoped) or matchesIntent or eventFitsIntent
```

### One renewal question before a searched want lapses

Seven days or less before the deadline of a live learned want that the Network is searching for, ask the member once whether they are still looking. The Network is searching for the want when a people request of the member for that want is not withdrawn and not closed, and the member can be matched. Ask at most once for each deadline, inside the daily limit of proactive messages. A send that the daily limit or another send rule refused waits one day before the next try. A KEEP reply is a fresh statement by the member and starts a new sixty-day deadline; the same open request still counts as the search, so the new deadline gets its own one question. With no answer the want lapses at its deadline as before; expiry stops new work only. A paused or closed want is not asked about. Job postings and stored intents get no renewal question. Changed (owner decision 2026-11-22): before, a want lapsed with no word to the member. Changed again (owner decision 2026-11-22, review of the withdrawal wave): a refused send waits a day, because before it was tried again at every tick; and the search no longer needs a request made after the statement, because before a KEEP moved the statement past the open request and the next deadline got no question.

```quint
pure val renewalAskDays: int = 7
pure val renewalRetryMs: int = 86400000

pure def standingRenewalAskDue(live: bool, searching: bool, daysLeft: int, askedThisDeadline: bool, refusedAgoMs: int): bool =
  live and searching and daysLeft > 0 and daysLeft <= renewalAskDays and not(askedThisDeadline)
    and (refusedAgoMs < 0 or refusedAgoMs >= renewalRetryMs)

pure val daysLeftValues = Set(0, 1, 7, 8)
pure val refusedAgoMsValues = Set(-1, 0, 86399999, 86400000)

pure def lawOneRenewalAskPerDeadline(live: bool, searching: bool, daysLeft: int, refusedAgoMs: int): bool =
  not(standingRenewalAskDue(live, searching, daysLeft, true, refusedAgoMs))

pure def lawNoRenewalAskEarly(live: bool, searching: bool, askedThisDeadline: bool, refusedAgoMs: int): bool =
  not(standingRenewalAskDue(live, searching, renewalAskDays + 1, askedThisDeadline, refusedAgoMs))

pure def lawPausedOrClosedIsNotAsked(searching: bool, daysLeft: int, askedThisDeadline: bool, refusedAgoMs: int): bool =
  not(standingRenewalAskDue(false, searching, daysLeft, askedThisDeadline, refusedAgoMs))

pure def lawRefusedAskWaitsADay(live: bool, searching: bool, daysLeft: int, askedThisDeadline: bool): bool =
  not(standingRenewalAskDue(live, searching, daysLeft, askedThisDeadline, 0))
    and not(standingRenewalAskDue(live, searching, daysLeft, askedThisDeadline, renewalRetryMs - 1))
```
