# Structured model calls

## Story: Structured model calls

A caller needs a validated response or a failure within the attempt and time budgets.

### Safety rules and reachability

Check retries, deadlines, successful validation, and the distinction between exhaustion and early stop. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/chatjson_loop.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=12 max-samples=6000
//
// chatjson_loop: the "ask, parse, validate, retry" loop of every structured LLM call
// (tryChatJson in packages/core/src/chatJson.ts; machine "chatjson-loop", core.md section 3.3 of
// docs/research/state-machines on branch claude/quint-state-machines).
//
// WHAT THIS MODELS
//   One call of tryChatJson. Each loop pass is one action (loopPass): beforeAttempt (it can throw),
//   the gate before the attempt, the awaited client.chat call with its time, the JSON parse and the
//   validation, and the decision after a failure. The decisions are the pure defs below with the same
//   names as the LemmaScript core packages/core/src/chatjson-core.ts: hasDeadline, attemptGate,
//   isFinalCode, afterFailure. The shell (chatJson.ts) calls them and does not decide again.
//   The environment can abort the caller signal and let time pass between two passes (callbacks,
//   the event loop).
//
// TIME AND THE CLIENT DEADLINE (LLM_DEADLINE_MS semantics, packages/core/src/llm.ts:197-298)
//   Time is an integer tick. A client.chat call gets ChatOptions.deadlineMs = the time that is left
//   when the loop has a deadline; it then overrides the client deadline (llm.ts:246). Without it, the
//   call uses the client deadline CLIENT_DL (LLM_DEADLINE_MS, else 3x the timeout). In both cases the
//   client caps each request at the time that is left (llm.ts:278 perRequest) and throws "deadline"
//   when no time is left, so one call ends within its own deadline. The model gives each call a
//   nondeterministic duration from 0 to that deadline and a nondeterministic outcome.
//
// OUTCOMES OF ONE ATTEMPT (oracles: the model, the network, the validator)
//   "valid"     the reply has JSON and `parse` accepts it.
//   "invalid"   `parse` throws an error that is not an LLMError (the validator rejects the value).
//   "no_json", "http", "timeout", "network", "bad_response", "truncated": an LLMError that can be retried.
//   "aborted"   the caller signal aborted during the call (the model sets the signal too).
//   "deadline"  the client deadline ended the call.
//   "budget"    the spend guard (hooks.budget.take) refused the request.
//
// OUTSIDE THE MODEL
//   - The ChatOptions body (maxTokens, temperature, json). `grow` is a counter only.
//   - afterAttempt: its errors are ignored and it decides nothing.
//   - The retries and the fallback inside one client.chat call (llm.ts). They are inside the call
//     duration here.
//   - Number edge cases (NaN or fractional attempts). LemmaScript has ideal integers too.
//   - LLM_DEADLINE_MS=0 (or a client deadlineMs of 0) means "no client deadline" (llm.ts deadlineFor,
//     deadlineAt = Infinity). Then a call without a loop deadline is not bounded by time, and
//     callTimeBounded does not apply. The model uses a client deadline more than 0.
//   - The client enforces its deadline at its check points and with AbortSignal.timeout(ceil(ms)),
//     so a real call can end a little after its deadline. The model treats the deadline as exact.
//
// RUN (from the repository root; quint 0.33.1)
//   quint typecheck quint/chatjson_loop.qnt
//   quint test quint/chatjson_loop.qnt --main chatjson_loop
//   quint run quint/chatjson_loop.qnt --main chatjson_loop --invariant=safety --max-steps=12 --max-samples=6000
//   Each witness_<name> must be VIOLATED (the state is reachable).
module chatjson_loop {

  // ---------------------------------------------------------------- constants
  pure val NO_DEADLINE = -1
  pure val CLIENT_DL = 3                       // the client deadline of one chat() call, in ticks
  pure val MAX_D = 6                           // the longest call duration the step tries
  pure val ATTEMPT_CHOICES = Set(0, 1, 2, 3)   // ChatJsonOptions.attempts (default 2)
  pure val DEADLINE_CHOICES = Set(0, 2, 4, 6)  // ChatJsonOptions.deadlineMs (0 or unset = none)
  pure val OUTCOMES = Set("valid", "invalid", "no_json", "http", "timeout", "network",
                          "bad_response", "truncated", "aborted", "deadline", "budget")

  // ---------------------------------------------------------------- types
  type OkR = { validated: bool, attempts: int }
  type FailR = { stopped: bool, attempts: int, errorSet: bool, why: str }
  type Result = Pending | Ok(OkR) | Fail(FailR)
  type GateInput = { aborted: bool, hasDeadline: bool, left: int }

  // ---------------------------------------------------------------- the core (chatjson-core.ts)
  pure def hasDeadline(isSet: bool, deadlineMs: int): bool = isSet and deadlineMs > 0

  pure def attemptGate(g: GateInput): str =
    if (g.aborted) "aborted"
    else if (g.hasDeadline and g.left <= 0) "deadline"
    else "go"

  pure def isFinalCode(code: str): bool = code == "aborted" or code == "deadline" or code == "budget"

  pure def afterFailure(final: bool, attempt: int, attempts: int): str =
    if (final) "stop"
    else if (attempt + 1 < attempts) "retry"
    else "exhausted"

  pure def min(a: int, b: int): int = if (a < b) a else b
  pure def max(a: int, b: int): int = if (a > b) a else b

  // ---------------------------------------------------------------- state
  var cfgAttempts: int
  var cfgDeadline: int
  var deadlineAt: int       // NO_DEADLINE when hasDeadline is false (chatJson.ts deadlineAt undefined)
  var now: int
  var aborted: bool         // AbortSignal.aborted of the caller signal
  var attempt: int          // the loop variable
  var errorSet: bool        // the `error` variable of the loop is set
  var grown: int            // how many times `grow` ran
  var started: int          // client.chat calls started
  var lateStart: bool       // a call started when the loop deadline had passed
  var callEndMax: int       // the latest end time of a call
  var callTime: int         // the sum of all call durations
  var lastOutcome: str     // the outcome of the last client.chat call and parse ("none" before the first)
  var result: Result

  // ---------------------------------------------------------------- invariants
  // Rule: "attempts: Total attempts. A thrown parse or validation error, or a failed call, uses one"
  // (chatJson.ts ChatJsonOptions.attempts). The loop starts at most `attempts` calls, and a result
  // never counts more (chatJson.ts:51 loop guard; chatjson-core.ts afterFailure).
  val retriesBounded = and {
    started <= max(cfgAttempts, 0),
    match result {
      | Pending => true
      | Ok(r) => r.attempts == started and r.attempts <= cfgAttempts
      | Fail(r) => r.attempts <= max(cfgAttempts, 0)
    },
  }

  // Rule: "validate with `parse` (throw to reject)" (chatJson.ts tryChatJson doc). The loop returns a
  // value only when `parse` returned it in the same attempt (chatJson.ts:66 and 77): the outcome of the
  // last attempt is "valid", not only a field that the step sets.
  val okOnlyAfterValidation = match result {
    | Ok(r) => r.validated and lastOutcome == "valid"
    | _ => true
  }

  // Rule: "Like tryChatJson, but returns the value or throws the last error" (chatJson.ts chatJson).
  // When the attempts are used up, the result is a failure that is not "stopped", it counts all
  // attempts, and it carries the last error when at least one attempt ran (chatJson.ts:79).
  // A failure never carries a value (the Fail type has none).
  val exhaustionIsFailure = match result {
    | Fail(r) => not(r.stopped) implies (r.attempts == cfgAttempts and started == max(cfgAttempts, 0)
                                         and (started > 0 implies r.errorSet) and r.why == "exhausted")
    | _ => true
  }

  // Rule: "Total wall time over all attempts in ms; each attempt gets what is left as its
  // ChatOptions.deadlineMs" (chatJson.ts ChatJsonOptions.deadlineMs) and LLM_DEADLINE_MS (llm.ts:213-215 deadlineFor).
  // With a loop deadline: no call starts at or after it, and every call ends by it
  // (chatJson.ts:56-58 gate; llm.ts:246-278 per-call deadline).
  val deadlineStopsLoop = deadlineAt != NO_DEADLINE implies (not(lateStart) and callEndMax <= deadlineAt)

  // Without a loop deadline, each call is bounded by the client deadline, so the loop spends at most
  // attempts x LLM_DEADLINE_MS in calls. With one, a call can get more than the client deadline
  // (ChatOptions.deadlineMs overrides it), but deadlineStopsLoop bounds the total (core.md 3.3: no caller outside core sets deadlineMs).
  val callTimeBounded = deadlineAt == NO_DEADLINE implies callTime <= started * CLIENT_DL

  // A final LLMError (aborted, deadline, budget) ends the loop at once (chatJson.ts FINAL codes,
  // chatjson-core.ts isFinalCode). A stopped failure never counts more attempts than were started.
  val stoppedIsHonest = match result {
    | Fail(r) => r.stopped implies r.attempts <= started
    | _ => true
  }

  val safety = and {
    retriesBounded,
    okOnlyAfterValidation,
    exhaustionIsFailure,
    deadlineStopsLoop,
    callTimeBounded,
    stoppedIsHonest,
  }

  // ---------------------------------------------------------------- actions
  action initWith(a: int, d: int): bool = all {
    cfgAttempts' = a,
    cfgDeadline' = d,
    deadlineAt' = if (hasDeadline(true, d)) d else NO_DEADLINE,
    now' = 0,
    aborted' = false,
    attempt' = 0,
    errorSet' = false,
    grown' = 0,
    started' = 0,
    lateStart' = false,
    callEndMax' = 0,
    callTime' = 0,
    lastOutcome' = "none",
    result' = Pending,
  }

  action init = {
    nondet a = ATTEMPT_CHOICES.oneOf()
    nondet d = DEADLINE_CHOICES.oneOf()
    initWith(a, d)
  }

  // A result ends the loop; the other variables keep their values.
  action finish(r: Result): bool = all {
    result' = r,
    cfgAttempts' = cfgAttempts, cfgDeadline' = cfgDeadline, deadlineAt' = deadlineAt, now' = now,
    aborted' = aborted, attempt' = attempt, errorSet' = errorSet, grown' = grown, started' = started,
    lateStart' = lateStart, callEndMax' = callEndMax, callTime' = callTime, lastOutcome' = lastOutcome,
  }

  // One pass of the for loop of tryChatJson. beforeThrows: beforeAttempt throws. d: the call
  // duration. code: the outcome of the attempt.
  action loopPass(beforeThrows: bool, d: int, code: str): bool = all {
    result == Pending,
    if (not(attempt < cfgAttempts))
      // The loop guard: no pass is left (attempts <= 0, or after the last retry).
      finish(Fail({ stopped: false, attempts: cfgAttempts, errorSet: errorSet, why: "exhausted" }))
    else if (beforeThrows)
      finish(Fail({ stopped: true, attempts: attempt, errorSet: true, why: "beforeAttempt" }))
    else {
      // The shell reads the clock only when the signal is not aborted.
      val hasDl = not(aborted) and deadlineAt != NO_DEADLINE
      val left = if (hasDl) deadlineAt - now else 0
      val gate = attemptGate({ aborted: aborted, hasDeadline: hasDl, left: left })
      if (gate == "aborted")
        finish(Fail({ stopped: true, attempts: attempt, errorSet: true, why: "aborted" }))
      else if (gate == "deadline")
        finish(Fail({ stopped: true, attempts: attempt, errorSet: true, why: "deadline" }))
      else {
        // The call. Its deadline is the time that is left, else the client deadline.
        val callDl = if (hasDl) left else CLIENT_DL
        all {
          d >= 0, d <= callDl,
          now' = now + d,
          started' = started + 1,
          lateStart' = (lateStart or (deadlineAt != NO_DEADLINE and now >= deadlineAt)),
          callEndMax' = max(callEndMax, now + d),
          callTime' = callTime + d,
          lastOutcome' = code,
          aborted' = (aborted or code == "aborted"),
          cfgAttempts' = cfgAttempts, cfgDeadline' = cfgDeadline, deadlineAt' = deadlineAt,
          if (code == "valid") all {
            result' = Ok({ validated: true, attempts: attempt + 1 }),
            attempt' = attempt, errorSet' = errorSet, grown' = grown,
          } else {
            // A non-LLMError (the validator) is never final.
            val final = code != "invalid" and isFinalCode(code)
            val after = afterFailure(final, attempt, cfgAttempts)
            all {
              errorSet' = true,
              if (after == "stop") all {
                result' = Fail({ stopped: true, attempts: attempt + 1, errorSet: true, why: code }),
                attempt' = attempt, grown' = grown,
              } else if (after == "exhausted") all {
                // grow runs, then break; the shell returns the configured attempts (chatJson.ts:73 and 79).
                result' = Fail({ stopped: false, attempts: cfgAttempts, errorSet: true, why: "exhausted" }),
                attempt' = attempt, grown' = grown + 1,
              } else all {
                result' = Pending,
                attempt' = attempt + 1, grown' = grown + 1,
              },
            }
          },
        }
      }
    }
  }

  // The environment: the caller aborts the signal between two passes.
  action abortSignal: bool = all {
    result == Pending,
    aborted' = true,
    cfgAttempts' = cfgAttempts, cfgDeadline' = cfgDeadline, deadlineAt' = deadlineAt, now' = now,
    attempt' = attempt, errorSet' = errorSet, grown' = grown, started' = started,
    lateStart' = lateStart, callEndMax' = callEndMax, callTime' = callTime, lastOutcome' = lastOutcome, result' = result,
  }

  // The environment: time passes between two passes (callbacks, the event loop).
  action tick: bool = all {
    result == Pending,
    now' = now + 1,
    cfgAttempts' = cfgAttempts, cfgDeadline' = cfgDeadline, deadlineAt' = deadlineAt, aborted' = aborted,
    attempt' = attempt, errorSet' = errorSet, grown' = grown, started' = started,
    lateStart' = lateStart, callEndMax' = callEndMax, callTime' = callTime, lastOutcome' = lastOutcome, result' = result,
  }

  action done: bool = all {
    result != Pending,
    cfgAttempts' = cfgAttempts, cfgDeadline' = cfgDeadline, deadlineAt' = deadlineAt, now' = now,
    aborted' = aborted, attempt' = attempt, errorSet' = errorSet, grown' = grown, started' = started,
    lateStart' = lateStart, callEndMax' = callEndMax, callTime' = callTime, lastOutcome' = lastOutcome, result' = result,
  }

  action step = any {
    nondet b = Set(true, false).oneOf()
    nondet d = 0.to(MAX_D).oneOf()
    nondet c = OUTCOMES.oneOf()
    loopPass(b, d, c),
    abortSignal,
    tick,
    done,
  }

  // ---------------------------------------------------------------- reachability witnesses
  // Each must be VIOLATED by `quint run`: the state is reachable, so a pass above is not vacuous.
  pure def failWhy(r: Result, w: str): bool = match r { | Fail(f) => f.why == w | _ => false }
  val witness_okAfterRetry = not(match result { | Ok(r) => r.attempts >= 2 | _ => false })
  val witness_exhausted = not(started >= 2 and failWhy(result, "exhausted"))
  val witness_deadlineGate = not(started >= 1 and failWhy(result, "deadline") and deadlineAt != NO_DEADLINE)
  val witness_abortedGate = not(failWhy(result, "aborted") and started >= 1)
  val witness_budgetStop = not(failWhy(result, "budget"))
  val witness_beforeAttemptStop = not(failWhy(result, "beforeAttempt"))
  val witness_zeroAttempts = not(cfgAttempts == 0 and failWhy(result, "exhausted"))

  // ---------------------------------------------------------------- replayed traces
  // Two attempts: the validator rejects the first reply, the second is valid.
  run retryThenOkTest = initWith(2, 0)
    .then(loopPass(false, 1, "invalid"))
    .then(all { assert(result == Pending and attempt == 1 and grown == 1), tick })
    .then(loopPass(false, 1, "valid"))
    .then(all { assert(result == Ok({ validated: true, attempts: 2 }) and started == 2), done })

  // Two attempts, both replies have no JSON: a failure that is not stopped, with the last error.
  run exhaustedTest = initWith(2, 0)
    .then(loopPass(false, 2, "no_json"))
    .then(loopPass(false, 3, "http"))
    .then(all { assert(result == Fail({ stopped: false, attempts: 2, errorSet: true, why: "exhausted" })
                       and callTime == 5), done })

  // A deadline of 4 ticks: the first call uses 4 ticks and fails; the gate stops the loop before
  // a second call starts.
  run deadlineGateTest = initWith(3, 4)
    .then(loopPass(false, 4, "timeout"))
    .then(loopPass(false, 0, "valid"))
    .then(all { assert(result == Fail({ stopped: true, attempts: 1, errorSet: true, why: "deadline" })
                       and started == 1), done })

  // The client deadline is a final code: the loop stops after one attempt of three.
  run clientDeadlineStopsTest = initWith(3, 0)
    .then(loopPass(false, 3, "deadline"))
    .then(all { assert(result == Fail({ stopped: true, attempts: 1, errorSet: true, why: "deadline" })), done })

  // The caller aborts between two attempts.
  run abortTest = initWith(3, 0)
    .then(loopPass(false, 1, "bad_response"))
    .then(abortSignal)
    .then(loopPass(false, 1, "valid"))
    .then(all { assert(result == Fail({ stopped: true, attempts: 1, errorSet: true, why: "aborted" })), done })

  // attempts = 0: no call, a failure with no error (chatJson then throws undefined).
  run zeroAttemptsTest = initWith(0, 0)
    .then(loopPass(false, 0, "valid"))
    .then(all { assert(result == Fail({ stopped: false, attempts: 0, errorSet: false, why: "exhausted" })
                       and started == 0), done })
}
```
