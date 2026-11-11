# Audit: quint/chatjson_loop.qnt

Read: quint/chatjson_loop.qnt (335 lines), quint/drift.json entry (hashes only, no drift list),
docs/formal-coverage.md:76-77, docs/research/state-machines/core.md 3.3 and D9,
docs/results/2026-11-09-quint-drift.md (chatjson_loop: fixed_in_model, only location comments),
docs/results/2026-11-08-lemmascript-frontend.md:165-180, packages/core/src/chatJson.ts (87 lines, all),
packages/core/src/chatjson-core.ts (54 lines, all), packages/core/src/llm.ts:195-360 (chatCompletions,
deadlineFor, sleep, parseJson), every production caller of tryChatJson/chatJson.
No findings file exists for this model (docs/research/quint-findings/ has none).

`bun run quint:check quint/chatjson_loop.qnt`: 18 jobs, 0 failures (safety 35 s, 7 witnesses).

## Mutation probes (copies in scratchpad/wave3/cj/, model unchanged)

| mutant | change | `quint run --invariant=safety` (12 steps, 6000 samples) | `quint test` |
|---|---|---|---|
| m1 | `val final = false` (line 227): a final code (aborted, deadline, budget) is retried | **no violation** | fails (clientDeadlineStopsTest) |
| m2 | `attemptGate` ignores `aborted` (line 71) | violation (only through the deadline branch) | - |
| m6 | `"invalid"` treated as valid (line 222) | violation (okOnlyAfterValidation) | - |
| m7 | m2 with `DEADLINE_CHOICES = Set(0)` | **no violation** | fails (abortTest) |

So two rules that the comments say `safety` checks are checked only by one fixed `run` trace each.

## model_error

1. **stoppedIsHonest is weaker than its rule (line 143-148).** The comment says "a final LLMError ...
   ends the loop at once". The invariant only says `r.attempts <= started`. Mutant m1 (final codes
   retried) passes `safety`. Fix: add a ghost `finalSeen: bool` set when a call returns a final code, and
   `finalSeen implies (result != Pending and started == attemptsAtFinal)`, or "no call starts after a
   final outcome".
2. **No invariant for the caller signal.** Mutant m7 (gate ignores the signal, no loop deadline) passes
   `safety`. The rule "Caller cancellation, passed to every attempt" (chatJson.ts:26-27) and
   "aborting stops ... every later attempt" (llm.ts:26) have no invariant. Fix: ghost `startedAfterAbort`
   (a call started while `aborted`), invariant `not(startedAfterAbort)`.
3. **callTimeBounded cannot fail (line 141).** With `deadlineAt == NO_DEADLINE`, `hasDl` is false,
   `callDl = CLIENT_DL` and the step itself requires `d <= callDl` (line 213). The invariant restates the
   step assumption; no mutation of a code-mapped decision can break it. Its bound comes from llm.ts,
   which this model does not contain.
4. **The client honours its deadline by assumption (line 213, header 17-23, 42-43).** `d <= callDl`
   is what makes `deadlineStopsLoop.callEndMax <= deadlineAt` true. The real `LLM` is an interface:
   any implementation (engine `appearance.ts:114` style clients, test doubles, scripts/sim/conformance.ts:40)
   can ignore `ChatOptions.deadlineMs` and `signal`. Only `OpenAILLM` (llm.ts:408) honours them. The
   invariant is a property of the OpenAILLM client, not of tryChatJson. Fix: let `d` exceed `callDl`
   when a nondeterministic `honours: bool` is false and keep the end-time half of deadlineStopsLoop
   conditional on it (or state the assumption as an explicit `assume`).
5. **CLIENT_DL > 0 hides an unbounded call (line 54, header 39-41).** `LLM_TIMEOUT_MS=0` also makes the
   default deadline 0 = none (llm.ts:212-215; core.md D9). Then one call without a loop deadline is not
   bounded at all, and a hung provider hangs the loop forever. The model fixes CLIENT_DL=3, so the only
   unbounded configuration is out of the model. Fix: add `CLIENT_DL` choice "none" and a witness that
   `callTime` exceeds `started * 3`; or (code) refuse `LLM_TIMEOUT_MS=0` without `LLM_DEADLINE_MS`.
6. **okOnlyAfterValidation is close to a tautology (line 117-120).** `validated: true` is still a
   literal (line 223), and `lastOutcome' = code` is set in the same branch `code == "valid"`. m6 shows it
   has force only against a mutation of that one branch condition. It does not model `parse` at all.
7. **Single clock.** The loop deadline uses `o.clock` (chatJson.ts:46-47, 55); the client recomputes
   its own deadline from `hooks.clock ?? realClock` (llm.ts:245-247). With an injected SimClock in
   ChatJsonOptions and a RealClock client, `left` is in sim ms and the client counts real ms. The model
   has one `now`. No caller sets `clock` today.
8. **The gate time and the call time are the same instant in the model.** The shell reads the clock at
   chatJson.ts:55, then runs `llm(attempt)` (a factory, line 61) and builds opts; the client reads its
   clock again at llm.ts:247 and adds `left` again. The real absolute end is t(247) + left, later than
   deadlineAt by the factory time. The header (42-43) covers only the AbortSignal.timeout rounding.

## model_gap

1. **`afterAttempt` and `grow` throwing (chatJson.ts:48, 72).** The doc rule "Never throws ... a paid,
   valid reply is never discarded" (chatJson.ts:41-42) has no action and no invariant. Removing either
   try/catch would not fail any check. Adding a nondeterministic `callbackThrows` and the invariant
   "a valid outcome gives Ok" would not break current invariants; it would give the rule force.
2. **`grow` placement.** `grown` is a counter with no invariant. The code runs `grow` on "exhausted"
   before `break` (chatJson.ts:72-73) and never after "stop". A mutant that grows after "stop" or not at
   all passes. Low risk (maxTokens only).
3. **The LLM factory `llm(attempt)` can throw (chatJson.ts:61).** It is inside the try, a non-LLMError,
   so it is retried like "invalid". The model's "invalid" means only the validator. Same path; add the
   comment.
4. **`parse` can throw an LLMError (chatJson.ts:66, 70).** A validator that throws an LLMError with a
   final code stops the loop; the model fixes "invalid" as never final (line 227). No production
   validator does this (validateUnderstood, validateSlopReading, parseVerdict...). Adding it cannot
   break an invariant (it maps to the existing stop branch).
5. **Abort during a call with a non-aborted outcome.** `aborted'` is set only on code "aborted"
   (line 220). In the code a 400 or a valid reply can arrive and then the signal aborts. `abortSignal`
   after the step is equivalent for all non-terminal outcomes, so no invariant changes.
6. **Client-level signal (hooks.signal, llm.ts:248-249).** A client signal abort gives "aborted" while
   the caller signal is not aborted. Final code, so the loop stops; the gate state differs but no
   invariant depends on it.
7. **Number edge cases (header 38).** `attempts: -1` returns `{attempts: -1}` (chatJson.ts:79) while the
   type doc says "attempts made"; `attempts: NaN` runs nothing; `attempts: 1.5` runs two calls
   (`0 < 1.5`, `1 < 1.5`) and `afterFailure(_,0,1.5)` says retry. ATTEMPT_CHOICES (line 56) excludes
   all three. No caller passes a non-literal; harmless today.
8. **Requests per loop.** `started` counts client.chat calls, not HTTP requests. One call can make up to
   (1 + LLM_MAX_RETRIES + fallbacks) x (1 + MAX_REGROWS) requests and each `budget.take`
   (llm.ts:261). runtime_ops models the llm-call; nothing composes the two bounds (attempts x per-call
   requests). Wall time without a loop deadline: 2 x 180 s = 360 s (core.md 3.3).
9. **Concurrency and the shared budget.** Many engine judge passes share one LLMBudget
   (service.ts:368-385). The model is one loop; the budget is an oracle outcome. core.md 3.3 says merge
   with llm-call; not done.
10. **Retry-After deadline** (llm.ts:274): a 429 with a long Retry-After throws "deadline" at once, which
   is final here, so the loop stops with attempts left. Inside the "deadline" outcome; by design.

## open_carveout

1. **attempts = 0 throws undefined** (chatJson.ts:79, 86; core.md D9; frontend report :180; SD-306
   refuted: no production caller). The model keeps it as `zeroAttemptsTest`. Fixable in scope as a
   small reproduced bug: return `error ?? new LLMError("bad_response", "chatJson ran no attempt")`, or
   clamp attempts >= 1; needs an integration case, not a unit test (docs/tests-policy.md), so low value.
2. **deadlineMs 0 means different things** (ChatJsonOptions 0 = none = client default; ChatOptions 0 =
   no deadline at all; core.md D9). Out of the model (header 39-41). Fixable by a doc line; no caller.
3. **LLM_DEADLINE_MS=0 / LLM_TIMEOUT_MS=0** unbounded call (model_error 5). Fix in llm.ts (refuse 0 for
   both) or in boot config; in scope as a security/ops fix.
4. **Loop deadline, signal, beforeAttempt, afterAttempt, clock are dead options in production.** No
   caller passes them (judgeCommon.ts:31, extract.ts:123, slop/extract.ts:1025, sim and scripts). Most
   of the model's paths (gate, beforeAttempt, abort) are therefore not on a production path; the
   production machine is "2 attempts, client deadline, budget stop". The model is still correct for
   them.
5. **drift.json has no drift list** for chatjson_loop; the 2026-11-09 review fixed only location
   comments. No unfixed finding.
6. **formal-coverage row 76 is self-contradictory**: the note says "no Quint module models it" while the
   Quint column names chatjson_loop, and both columns cite branch [claude/lemmascript-frontend]. core.md
   3.3 cites chatJson.ts:46-77 (now 44-80). Doc fix only.

## suspected_defect

No new code defect with a production trigger. Latent items:

- If `understand` (llmUnderstand, network/src/extract.ts:120-125) is wired into the service inbound
  path (cost.ts:208 already describes the hooks), one turn can wait 2 x 180 s for tryChatJson while
  `/internal/turn` must answer in 8 s. Trigger: wire `understand: llmUnderstand(defaultLLM(...))`,
  provider hangs. Prevention: pass `deadlineMs` (the modeled loop deadline) from that caller. Today
  service.ts does not wire it, so no trigger.
- A loop `deadlineMs` longer than the client deadline replaces it (chatJson.ts:64, llm.ts:246), so a
  caller who sets deadlineMs to loosen nothing can give one call more than LLM_DEADLINE_MS. Documented
  in the model (line 139-140); by design per ChatJsonOptions doc.
