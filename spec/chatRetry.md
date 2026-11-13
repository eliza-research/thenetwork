# Structured model requests

The [flow model](models/chatjson_loop.md) covers time passing, callbacks, the awaited request, validation, and the retry loop. This specification defines the decisions used by `tryChatJson` in `packages/core/src/chatJson.ts`.

## Story: Finish a structured request within its budget

> As a caller, I want a validated result or a failure, with cancellation and deadlines checked before a new request starts.

### Only a positive configured timeout sets a deadline

The caller can omit the total timeout or set it to zero to use the client's own request limits. A positive timeout sets an absolute deadline once. The shell reads the clock and supplies the remaining time for each attempt.

```quint
pure def hasDeadline(isSet: bool, deadlineMs: int): bool = isSet and deadlineMs > 0
```

### Caller cancellation wins over a deadline

After the attempt callback runs, the loop checks the caller signal before it reads the clock. A cancelled attempt returns an abort. With an active deadline and no time left, the loop returns a deadline failure. Otherwise it can request a reply.

```quint
type GateInput = { aborted: bool, hasDeadline: bool, left: int }

pure def attemptGate(g: GateInput): str =
  if (g.aborted) "aborted"
  else if (g.hasDeadline and g.left <= 0) "deadline"
  else "go"

pure def lawCancelledAttemptStops(hasLimit: bool, left: int): bool =
  attemptGate({ aborted: true, hasDeadline: hasLimit, left: left }) == "aborted"

pure def lawExpiredAttemptStops(left: int): bool =
  left <= 0 implies attemptGate({ aborted: false, hasDeadline: true, left: left }) == "deadline"
```

### Terminal errors stop the retry loop

An LLM error for cancellation, deadline, or budget stops immediately. Other failed requests, parse errors, or rejected values use an attempt and permit another attempt if one remains. The shell reports the error and calls the optional budget-growth function after each non-terminal failure, including the last failed attempt.

```quint
pure def isFinalCode(code: str): bool = code == "aborted" or code == "deadline" or code == "budget"

pure def afterFailure(final: bool, attempt: int, attempts: int): str =
  if (final) "stop"
  else if (attempt + 1 < attempts) "retry"
  else "exhausted"

pure def lawFinalErrorStopsRetry(attempt: int, attempts: int): bool =
  afterFailure(true, attempt, attempts) == "stop"

pure def lawRetryNeedsAnotherAttempt(attempt: int, attempts: int): bool =
  (afterFailure(false, attempt, attempts) == "retry") iff (attempt + 1 < attempts)
```
