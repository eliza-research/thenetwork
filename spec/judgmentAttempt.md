# Matching judgment cache and attempts

The [matching engine flow model](models/matching_engine.md) tracks reuse within the judge cache lifetime. Each of the [judgment passes](judgmentRun.md) runs this decision for each candidate. The app and city runtime keeps one in-memory cache per pass and replaces the set when the lifetime changes.

## Story: Reuse recent judgments and retry failures on a later run

> As a member, I want recent judgments to be reused and a failed call to leave a future judgment possible.

### An expired entry or a backward clock reading forces a request

Reuse a result only for the exact sanitized messages, request settings, provider client, model, pass version, and member, entity, and reference bindings. The engine builds these inputs once per attempt. It stores their fingerprint and the returned verdict, and keeps prompt text out of the cache and run log.

A stored result expires when its elapsed time reaches the configured lifetime. A time earlier than the stored time also forces a request, and leaves the later entry available to later runs. The shell supplies elapsed milliseconds without rounding and removes expired entries. An available cache hit completes the attempt without requesting a new judgment. An empty cache starts a request.

```quint
type AttemptPhase = LookupCache | ReuseVerdict | RequestVerdict | StoreVerdict | NewVerdict | AttemptFailed
type JudgmentAttempt = { phase: AttemptPhase }

pure val initial: JudgmentAttempt = { phase: LookupCache }

pure def cacheEntryExpired(elapsedMs: int, ttlMs: int, rewound: bool): bool = elapsedMs >= ttlMs or rewound

pure def canReadCache(a: JudgmentAttempt): bool = a.phase == LookupCache
pure def readCache(a: JudgmentAttempt, available: bool): JudgmentAttempt =
  { phase: if (available) ReuseVerdict else RequestVerdict }

pure def lawTtlBoundaryExpires(ttlMs: int): bool = cacheEntryExpired(ttlMs, ttlMs, false)
pure def lawRewindExpires(elapsedMs: int, ttlMs: int): bool = cacheEntryExpired(elapsedMs, ttlMs, true)
```

### Only a returned judgment is eligible for storage

After a successful request, write the verdict. A rejected request or failed cache write finishes with no verdict, so the engine can keep its existing fallback. Successful storage returns the verdict and finishes the attempt. A finished attempt stays in its final phase.

```quint
pure def canReceiveVerdict(a: JudgmentAttempt): bool = a.phase == RequestVerdict
pure def receiveVerdict(a: JudgmentAttempt): JudgmentAttempt = { phase: StoreVerdict }

pure def canCompleteWrite(a: JudgmentAttempt): bool = a.phase == StoreVerdict
pure def completeWrite(a: JudgmentAttempt): JudgmentAttempt = { phase: NewVerdict }

pure def canFailAttempt(a: JudgmentAttempt): bool = a.phase == RequestVerdict or a.phase == StoreVerdict
pure def failAttempt(a: JudgmentAttempt): JudgmentAttempt = { phase: AttemptFailed }

pure def stepStorageRequiresResponse(before: JudgmentAttempt, after: JudgmentAttempt): bool =
  (before.phase != StoreVerdict and after.phase == StoreVerdict) implies before.phase == RequestVerdict
pure def stepFinishedAttemptStaysClosed(before: JudgmentAttempt, after: JudgmentAttempt): bool =
  (before.phase == ReuseVerdict or before.phase == NewVerdict or before.phase == AttemptFailed) implies after == before

pure def sometimesReusedVerdict(a: JudgmentAttempt): bool = a.phase == ReuseVerdict
pure def sometimesNewVerdict(a: JudgmentAttempt): bool = a.phase == NewVerdict
pure def sometimesAttemptFailed(a: JudgmentAttempt): bool = a.phase == AttemptFailed
```
