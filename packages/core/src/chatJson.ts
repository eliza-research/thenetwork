// One "ask, parse JSON, validate, retry" loop for every structured LLM call (engine judge passes,
// evals suites, the judge package). Each call site passes its own budget explicitly: attempts,
// maxTokens, temperature and how the budget grows after a failed attempt. Nothing here changes
// the request a site sends: the ChatOptions object is { maxTokens, temperature?, json: true }.
//
// Note that the core client already doubles the completion budget on empty or length-truncated
// content (llm.ts chatCompletions); `grow` is an additional, per-attempt budget change on top.
import { parseJson, type ChatMessage, type ChatOptions, type LLM } from "./llm.ts";

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
  /** Called after each attempt, successful or not (e.g. to collect that attempt's HTTP records). */
  afterAttempt?: (attempt: number, ok: boolean) => void;
}

/** A client, or a client per attempt (evals give each attempt its own cache scope). */
export type LLMSource = LLM | ((attempt: number) => LLM);

export type ChatJsonResult<T> =
  | { ok: true; value: T; attempts: number }
  /** `attempts` = attempts made; `stopped` = `beforeAttempt` threw (its error is `error`). */
  | { ok: false; error: unknown; attempts: number; stopped: boolean };

/** Ask, parse the JSON in the reply, validate with `parse` (throw to reject), retry. Never throws. */
export async function tryChatJson<T>(llm: LLMSource, messages: ChatMessage[], parse: (raw: unknown) => T, o: ChatJsonOptions = {}): Promise<ChatJsonResult<T>> {
  const attempts = o.attempts ?? 2;
  let maxTokens = o.maxTokens;
  let error: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { o.beforeAttempt?.(attempt); } catch (e) { return { ok: false, error: e, attempts: attempt, stopped: true }; }
    try {
      const client = typeof llm === "function" ? llm(attempt) : llm;
      const opts: ChatOptions = { maxTokens, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), json: true };
      const value = parse(parseJson(await client.chat(messages, opts)));
      o.afterAttempt?.(attempt, true);
      return { ok: true, value, attempts: attempt + 1 };
    } catch (e) {
      error = e;
      o.afterAttempt?.(attempt, false);
      if (o.grow && maxTokens !== undefined) maxTokens = o.grow(maxTokens);
    }
  }
  return { ok: false, error, attempts, stopped: false };
}

/** Like tryChatJson, but returns the value or throws the last error. */
export async function chatJson<T>(llm: LLMSource, messages: ChatMessage[], parse: (raw: unknown) => T, o: ChatJsonOptions = {}): Promise<T> {
  const r = await tryChatJson(llm, messages, parse, o);
  if (r.ok) return r.value;
  throw r.error;
}
