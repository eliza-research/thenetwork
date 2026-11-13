// One "ask, parse JSON, validate, retry" loop for every structured LLM call (engine judge passes,
// evals suites, the judge package). Each call site passes its own budget explicitly: attempts,
// maxTokens, temperature and how the budget grows after a failed attempt. Nothing here changes
// the request a site sends: the ChatOptions object is { maxTokens, temperature?, json: true }.
//
// Note that the core client already doubles the completion budget on empty or length-truncated
// content (llm.ts chatCompletions); `grow` is an additional, per-attempt budget change on top.
import { RealClock, type Clock } from "./clock.ts";
import { deadlineExpired, hasDeadline, initial, isFinalCode, step } from "./generated/chatRetry.ts";
import { LLMError, parseJson, type ChatMessage, type ChatOptions, type LLM } from "./llm.ts";

export interface ChatJsonOptions {
  /** Total attempts (default 2). A thrown parse or validation error, or a failed call, uses one. */
  attempts?: number;
  maxTokens?: number;
  /** Sent only when set (reasoning models ignore it; some sites pin it for older providers). */
  temperature?: number;
  /** Completion budget for the next attempt after a failed one (default: unchanged). */
  grow?: (maxTokens: number) => number;
  /** Called before each attempt. If it throws, the loop stops with that error (e.g. a spend guard). */
  beforeAttempt?: (attempt: number) => void;
  /** Called after each attempt, successful or not (e.g. to collect that attempt's HTTP records). Exceptions are ignored. */
  afterAttempt?: (attempt: number, ok: boolean) => void;
  /** Total wall time over all attempts in ms; each attempt gets what is left as its ChatOptions.deadlineMs. */
  deadlineMs?: number;
  /** Caller cancellation, passed to every attempt. */
  signal?: AbortSignal;
  /** Clock for deadlineMs (default real time). */
  clock?: Clock;
}

/** A client, or a client per attempt (evals give each attempt its own cache scope). */
export type LLMSource = LLM | ((attempt: number) => LLM);

export type ChatJsonResult<T> =
  | { ok: true; value: T; attempts: number }
  /** `attempts` = attempts made; `stopped` = `beforeAttempt` threw, or the deadline, signal or budget ended the loop (its error is `error`). */
  | { ok: false; error: unknown; attempts: number; stopped: boolean };

/**
 * Ask, parse the JSON in the reply, validate with `parse` (throw to reject), retry. Never throws:
 * errors from `afterAttempt` and `grow` are ignored, so a paid, valid reply is never discarded.
 */
export async function tryChatJson<T>(llm: LLMSource, messages: ChatMessage[], parse: (raw: unknown) => T, o: ChatJsonOptions = {}): Promise<ChatJsonResult<T>> {
  const attempts = o.attempts ?? 2;
  const clock = o.clock ?? new RealClock();
  const deadlineMs = o.deadlineMs ?? 0;
  const deadlineAt = hasDeadline(o.deadlineMs !== undefined, deadlineMs) ? clock.now() + deadlineMs : undefined;
  const after = (attempt: number, ok: boolean) => { try { o.afterAttempt?.(attempt, ok); } catch { /* observer errors never discard a result */ } };
  let maxTokens = o.maxTokens;
  let error: unknown;
  // spec/chatRetry.md, "The configured attempt budget limits how many requests start"
  const unbounded = attempts === Infinity;
  const attemptLimit = attempts > 0 && !unbounded ? Math.ceil(attempts) : 0;
  let run = step(initial, { type: "configure", attemptLimit, unbounded });
  while (run.phase === "Ready") {
    const attempt = run.attemptsStarted;
    try { o.beforeAttempt?.(attempt); } catch (e) {
      error = e;
      run = step(run, { type: "stopBeforeAttempt" });
      break;
    }
    // spec/chatRetry.md, "Caller cancellation wins over a deadline"
    const cancelled = o.signal?.aborted === true;
    const left = cancelled || deadlineAt === undefined ? undefined : deadlineAt - clock.now();
    run = step(run, { type: "preflight", cancelled, expired: deadlineExpired(left !== undefined, left ?? 0) });
    if (run.phase === "Aborted") {
      error = new LLMError("aborted", "chatJson aborted by caller");
      break;
    }
    if (run.phase === "Expired") {
      error = new LLMError("deadline", `chatJson deadline of ${o.deadlineMs} ms reached`);
      break;
    }
    let value: T;
    try {
      const client = typeof llm === "function" ? llm(attempt) : llm;
      const opts: ChatOptions = {
        maxTokens, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), json: true,
        ...(left !== undefined ? { deadlineMs: left } : {}), ...(o.signal ? { signal: o.signal } : {}),
      };
      value = parse(parseJson(await client.chat(messages, opts)));
    } catch (e) {
      error = e;
      after(attempt, false);
      // spec/chatRetry.md, "Terminal errors stop the retry loop"
      run = step(run, { type: "rejectReply", terminal: e instanceof LLMError && isFinalCode(e.code) });
      if (run.phase !== "TerminalFailure" && o.grow && maxTokens !== undefined) {
        try { maxTokens = o.grow(maxTokens); } catch { /* keep the current budget */ }
      }
      continue;
    }
    // spec/chatRetry.md, "A validated reply completes the request"
    run = step(run, { type: "acceptReply" });
    after(attempt, true);
    return { ok: true, value, attempts: run.attemptsStarted };
  }
  if (run.phase === "Exhausted") return { ok: false, error, attempts, stopped: false };
  return { ok: false, error, attempts: run.attemptsStarted, stopped: true };
}

/** Like tryChatJson, but returns the value or throws the last error. */
export async function chatJson<T>(llm: LLMSource, messages: ChatMessage[], parse: (raw: unknown) => T, o: ChatJsonOptions = {}): Promise<T> {
  const r = await tryChatJson(llm, messages, parse, o);
  if (r.ok) return r.value;
  throw r.error;
}
