# Structured model requests

The [reference flow model](models/chatjson_loop.md) includes elapsed time and the client’s own deadline. This state machine is used by `tryChatJson` in `packages/core/src/chatJson.ts`. The shell owns the clock, the client, JSON parsing, validation, callbacks, and the returned value or error. It reports what happened as events to the state machine.

## Story: Finish a structured request within its budget

> As a caller, I want a validated result or a failure, with cancellation and deadlines checked before a new request starts.

### The configured attempt budget limits how many requests start

Each request starts unconfigured. The shell supplies the limit of attempts that can start, or marks it unbounded for a caller that passes positive infinity. A finite limit of zero exhausts the request without calling the client. The shell retains the original configured value for the public exhaustion result, including fractional limits.

```quint
type RetryPhase = Unconfigured | Ready | Requesting | Accepted | CallbackStopped | Aborted | Expired | TerminalFailure | Exhausted
type RetryRun = { phase: RetryPhase, attemptLimit: int, unbounded: bool, attemptsStarted: int }

pure val initial: RetryRun = { phase: Unconfigured, attemptLimit: 0, unbounded: false, attemptsStarted: 0 }

pure def canConfigure(r: RetryRun, attemptLimit: int): bool =
  r.phase == Unconfigured and attemptLimit >= 0

pure def configure(r: RetryRun, attemptLimit: int, unbounded: bool): RetryRun =
  { ...r, attemptLimit: attemptLimit, unbounded: unbounded,
    phase: if (unbounded or attemptLimit > 0) Ready else Exhausted }

pure def alwaysRetriesBounded(r: RetryRun): bool = and {
  r.attemptsStarted >= 0,
  r.attemptLimit >= 0,
  r.unbounded or r.attemptsStarted <= r.attemptLimit,
  r.phase == Unconfigured implies r.attemptsStarted == 0,
  r.phase == Ready implies (r.unbounded or r.attemptsStarted < r.attemptLimit),
}
```

### Only a positive configured timeout sets a deadline

The caller can omit the total timeout or set it to zero to use the client’s own request limits. A positive timeout sets an absolute deadline once. The shell reads the clock and supplies the remaining time to the client.

```quint
pure def hasDeadline(isSet: bool, deadlineMs: int): bool = isSet and deadlineMs > 0
pure def deadlineExpired(hasLimit: bool, left: int): bool = hasLimit and left <= 0
```

### Caller cancellation wins over a deadline

The callback before an attempt can stop the request by throwing. Once it returns, the shell checks the signal before reading the clock. If the signal is cancelled or the deadline has passed, no attempt starts. Otherwise the attempt starts and uses one slot.

```quint
pure def canStopBeforeAttempt(r: RetryRun): bool = r.phase == Ready
pure def stopBeforeAttempt(r: RetryRun): RetryRun = { ...r, phase: CallbackStopped }

pure def canPreflight(r: RetryRun): bool = r.phase == Ready
pure def preflight(r: RetryRun, cancelled: bool, expired: bool): RetryRun =
  if (cancelled) { ...r, phase: Aborted }
  else if (expired) { ...r, phase: Expired }
  else { ...r, phase: Requesting, attemptsStarted: r.attemptsStarted + 1 }

pure def stepOnlyStartConsumesAnAttempt(before: RetryRun, via: str, after: RetryRun): bool =
  if (via == "preflight" and after.phase == Requesting) after.attemptsStarted == before.attemptsStarted + 1
  else after.attemptsStarted == before.attemptsStarted
```

### A validated reply completes the request

The shell sends the acceptance event when both JSON parsing and validation return a value. Only a request in progress can accept a reply.

```quint
pure def canAcceptReply(r: RetryRun): bool = r.phase == Requesting
pure def acceptReply(r: RetryRun): RetryRun = { ...r, phase: Accepted }

pure def stepOkOnlyAfterValidation(before: RetryRun, via: str, after: RetryRun): bool =
  (after.phase == Accepted and before.phase != Accepted) implies
    (before.phase == Requesting and via == "acceptReply")

pure def sometimesValidated(r: RetryRun): bool = r.phase == Accepted
```

### Terminal errors stop the retry loop

The shell reports whether the client, parser, or validator raised a cancellation, deadline, or budget error from the LLM client. The request stops on any of these terminal errors. Any other failure retries while there is budget left, and otherwise exhausts the request. The shell reports the error and calls the optional budget-growth function after each non-terminal failure, including the last failed attempt.

```quint
pure def isFinalCode(code: str): bool = code == "aborted" or code == "deadline" or code == "budget"

pure def canRejectReply(r: RetryRun): bool = r.phase == Requesting
pure def rejectReply(r: RetryRun, terminal: bool): RetryRun =
  { ...r, phase: if (terminal) TerminalFailure
    else if (r.unbounded or r.attemptsStarted < r.attemptLimit) Ready else Exhausted }

pure def alwaysExhaustionUsesBudget(r: RetryRun): bool =
  r.phase == Exhausted implies (not(r.unbounded) and r.attemptsStarted == r.attemptLimit)

pure def stepTerminalPhasesStayClosed(before: RetryRun, after: RetryRun): bool =
  (before.phase != Unconfigured and before.phase != Ready and before.phase != Requesting) implies
    after.phase == before.phase

pure def sometimesRetry(r: RetryRun): bool = r.phase == Ready and r.attemptsStarted > 0
pure def sometimesExhaustedAfterRequest(r: RetryRun): bool = r.phase == Exhausted and r.attemptsStarted > 0
```
