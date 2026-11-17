# Standing intent freshness

[Story F9](product/stories.md#story-f9--keep-a-standing-intent) asks the Network to keep looking until the member stops or the intent expires. The [profile learning](models/profile_learning.md) and [matching engine](models/matching_engine.md) models describe the surrounding flows. The shell supplies the stored status and computes the deadline from the member's recorded statement and its horizon. The shell keeps the statement time of a learned desire when a matching run reads that desire again; only a fresh statement by the member sets a new time. The shell removes a desire that the member withdraws from the learned desires, so that a withdrawn desire stays out of learned matching evidence.

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

After the daily run, recheck live standing intents on the next normal matching tick when usable evidence or supply changes. A new eligible member, a changed usable facet, a fresh intent, or a current event in the matching input can change that evidence. Use the same app and city, and keep the last searched evidence with the matching state so a retry or restart does not repeat a completed search. A private facet cannot start a search. The daily run and any rechecks share the same daily proposal limit.

```quint
pure def standingIntentFacetEvidence(scope: str, fresh: bool): bool =
  fresh and (scope == "matchable" or scope == "shareable")

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
