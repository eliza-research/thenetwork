# Matching judgment cache and attempts

The [matching engine flow model](models/matching_engine.md) tracks reuse within the judge cache lifetime. Each of the [judgment passes](judgmentRun.md) runs this decision for each candidate. The engine computes the existing profile and prompt cache key, runs the model call, and keeps a deterministic log order.

## Story: Reuse recent judgments and retry failures on a later run

> As a member, I want recent judgments to be reused and a failed call to leave a future judgment possible.

### An expired entry or a backward clock reading forces a request

A stored result is stale when its elapsed time reaches the configured lifetime, or when the current time is earlier than the stored time. The shell supplies elapsed milliseconds without rounding and removes a stale entry. An available cache hit completes the attempt without requesting a new judgment. An empty cache starts a request.

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
