// Minimal OpenAI-compatible chat clients (Surplus Intelligence, OpenAI, Cerebras).
// Default for every use is Surplus Intelligence gpt-6-luna (founder decision 2026-10-05); see
// defaultLLM() / judgeLLM() / recommenderLLM(). Provider "surplus" falls back to OpenAI (same model
// IDs) when SURPLUS_API_KEY is unset or Surplus fails with 408 / 429 / 5xx / timeout / a non-JSON
// body; every fallback logs a warning and calls ClientOptions.onFallback. `fallback: false` (per
// call or per client) keeps a call on the first provider. If neither key is set, a warning is
// logged when this module loads. Cerebras is optional and legacy.
// Every request has a timeout (default 60 s, LLM_TIMEOUT_MS or ClientOptions.timeoutMs) and
// retries are bounded (default 4, with capped, jittered exponential backoff). Each chat() call also
// has a total deadline over all attempts (default 3x the timeout, LLM_DEADLINE_MS or deadlineMs),
// can be cancelled with an AbortSignal, and can share an LLMBudget that stops every HTTP attempt
// once spent. Errors (LLMError) carry hosts, codes and lengths only, never prompts or model output.
// Reasoning models spend hidden tokens: leave room in the completion budget, and read
// message.content for the answer. A reply still cut off at the limit after two budget doublings
// throws LLMError "truncated".
//
// Optional per-client hooks (ClientOptions) let callers such as evals add request params, observe
// usage/cost and supply their own transport (e.g. a response cache) without patching global fetch.
import { RealClock, type Clock } from "./clock.ts";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions {
  maxTokens?: number; temperature?: number; json?: boolean;
  /** Total wall time for this call over all attempts, backoff and fallback, in ms (0 = none). Overrides ClientOptions.deadlineMs. */
  deadlineMs?: number;
  /** Caller cancellation: aborting stops the in-flight request and every later attempt. */
  signal?: AbortSignal;
  /** false: never fall back to a second provider on this call (default: ClientOptions.fallback, else true). */
  fallback?: boolean;
}
export interface LLM {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
}

/** Machine-readable reason a call failed. */
export type LLMErrorCode =
  | "http" | "network" | "timeout" | "deadline" | "aborted" | "budget" | "bad_response" | "truncated" | "no_json";

/**
 * Error thrown by the core client and parseJson. The message carries hosts, status codes, codes and
 * lengths only: never prompt text, model output or provider error bodies (core-12).
 */
export class LLMError extends Error {
  override name = "LLMError";
  /** First 300 chars of the provider's error body, for an HTTP failure. It may echo request text, so it is never in `message`; do not log it by default. */
  declare readonly body?: string;
  constructor(
    readonly code: LLMErrorCode,
    message: string,
    readonly detail: { host?: string; status?: number; length?: number; retries?: number } = {},
    body?: string,
  ) {
    super(message);
    if (body !== undefined) Object.defineProperty(this, "body", { value: body, enumerable: false });
  }
}

/** What `onResponse` receives for every HTTP attempt (including retries and failures). Never contains the API key. */
export interface ResponseInfo {
  model: string;
  /** Endpoint that served this attempt (shows when the Surplus -> OpenAI fallback was used). */
  baseUrl: string;
  /** HTTP status; 0 when the request failed before a response (network error, timeout). */
  status: number;
  ok: boolean;
  latencyMs: number;
  /** 0-based HTTP attempt inside one chat() call (408/429/5xx/bad-body retries, fallbacks and budget regrows). */
  attempt: number;
  /** How many completion-budget doublings (empty or length-truncated replies) preceded this attempt. */
  regrows: number;
  /** The exact JSON request body that was sent (no headers). */
  request: Record<string, unknown>;
  /** Parsed JSON response body when ok. */
  data?: any;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  /** Provider-reported cost in micro-USD (Surplus usage.buyer_cost_micro, or usage.cost in USD * 1e6), else priced from OPENAI_PRICES, else 0. */
  costMicro: number;
  /** false when tokens were used but neither the provider nor OPENAI_PRICES gave a price (costMicro is then 0). */
  costKnown: boolean;
  finishReason?: string;
  headers?: Headers;
  /** Short code and lengths (e.g. "http 503 (body 120 chars)"); for a network failure also the transport's message. */
  error?: string;
  /** First 300 chars of a provider error body. May echo request text: do not log it by default. */
  errorBody?: string;
}

/** What `onFallback` receives each time a call moves to the next provider. */
export interface FallbackInfo { model: string; from: string; to: string; reason: string; attempt: number }

/**
 * A spend limit shared by any number of clients and calls. Every HTTP attempt checks it first and
 * throws LLMError "budget" once it is spent; each attempt counts as a request and each response's
 * cost is charged. Concurrent calls already in flight can overshoot by their own cost.
 */
export class LLMBudget {
  spentMicro = 0;
  requests = 0;
  /** Responses that used tokens but had no known price (charged as 0). */
  unpricedResponses = 0;
  constructor(readonly limits: { maxCostMicro?: number; maxRequests?: number } = {}) {}
  get exhausted(): boolean {
    const { maxCostMicro, maxRequests } = this.limits;
    return (maxCostMicro !== undefined && this.spentMicro >= maxCostMicro) || (maxRequests !== undefined && this.requests >= maxRequests);
  }
  /** Throws LLMError "budget" when spent; otherwise counts one request. */
  take(host = "llm"): void {
    if (this.exhausted) throw new LLMError("budget", `${host} LLM budget spent (${Math.round(this.spentMicro)} micro-USD, ${this.requests} requests)`, { host });
    this.requests++;
  }
  charge(costMicro: number, costKnown = true): void {
    this.spentMicro += costMicro;
    if (!costKnown) this.unpricedResponses++;
  }
}

export interface ClientOptions {
  /** Extra JSON body params merged into every request (e.g. { reasoning_effort: "medium" }). */
  extraBody?: Record<string, unknown>;
  /** Called after every HTTP attempt, successful or not. Exceptions thrown here are ignored. */
  onResponse?: (info: ResponseInfo) => void;
  /** Called on every provider fallback (also logged with console.warn). Exceptions thrown here are ignored. */
  onFallback?: (info: FallbackInfo) => void;
  /** Transport override (defaults to global fetch). Used by evals for a disk cache; never patch globals. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Per-request timeout in ms (default 60 s, or LLM_TIMEOUT_MS; 0 disables). A timeout counts as a retryable error. */
  timeoutMs?: number;
  /** Total wall time per chat() call in ms (default LLM_DEADLINE_MS, else 3x the timeout; 0 disables). */
  deadlineMs?: number;
  /** Cancels every call of this client (combined with a per-call ChatOptions.signal). */
  signal?: AbortSignal;
  /** false: never fall back to a second provider (default true; ChatOptions.fallback overrides per call). */
  fallback?: boolean;
  /** Shared spend limit; once spent, no further HTTP attempt is made by any client holding it. */
  budget?: LLMBudget;
  /** Max retries for 408 / 429 / 5xx / network errors / timeouts / bad bodies on the last endpoint (default 4, or LLM_MAX_RETRIES). */
  maxRetries?: number;
  /** First backoff delay in ms (default 1000); doubles per retry, capped at 30 s, with jitter. */
  retryBaseMs?: number;
  /** Sent as the request `seed` when set (providers that support it sample reproducibly). */
  seed?: number;
  /** Wall clock for deadlines and Retry-After dates (default real time). */
  clock?: Clock;
  /** Jitter source for backoff, in [0, 1) (default Math.random). */
  rand?: () => number;
}

/**
 * OpenAI list prices in USD per 1M tokens (= micro-USD per token), standard tier, short context,
 * from https://developers.openai.com/api/docs/pricing on 2026-10-06. OpenAI responses carry no
 * cost, so it is computed from these. Reasoning tokens are part of completion_tokens (billed as output).
 * Look prices up with priceFor(), which also accepts dated snapshots and "openai/" prefixes.
 */
export const OPENAI_PRICES: Record<string, { input: number; cachedInput: number; cacheWrite: number; output: number }> = {
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 },
  "gpt-6.1-sol": { input: 2.00, cachedInput: 0.10, cacheWrite: 2.50, output: 10.00 },
};

/** Base model id for pricing: lowercased, without a provider prefix or a dated snapshot suffix. */
export function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/^[\w.-]+\//, "").replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, "");
}
export const priceFor = (model: unknown) => (typeof model === "string" ? OPENAI_PRICES[normalizeModelId(model)] : undefined);

/**
 * Usage + cost from an OpenAI-compatible response body (provider-reported cost, else OPENAI_PRICES
 * for the response's model, else for `requestedModel`). `costKnown` is false when tokens were used
 * but no price was found.
 */
export function usageOf(data: any, requestedModel?: string): Pick<ResponseInfo, "usage" | "costMicro" | "costKnown" | "finishReason"> {
  const u = data?.usage ?? {};
  const promptTokens = u.prompt_tokens ?? 0, completionTokens = u.completion_tokens ?? 0;
  const reported = u.buyer_cost_micro ?? (typeof u.cost === "number" ? u.cost * 1e6 : undefined);
  const p = priceFor(data?.model) ?? priceFor(requestedModel);
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0, writes = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  const priced = p ? (promptTokens - cached - writes) * p.input + cached * p.cachedInput + writes * p.cacheWrite + completionTokens * p.output : 0;
  return {
    usage: { promptTokens, completionTokens, reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 },
    costMicro: Number(reported ?? priced) || 0,
    costKnown: reported !== undefined || p !== undefined || (promptTokens === 0 && completionTokens === 0),
    finishReason: data?.choices?.[0]?.finish_reason,
  };
}

type BodyFor = (opts: ChatOptions) => Record<string, unknown>;

/** An OpenAI-compatible endpoint. */
export interface Endpoint { baseUrl: string; apiKey: string }

/**
 * Shared POST to /chat/completions over one or more endpoints, in order. A 408, 429, 5xx, network
 * error, timeout or non-JSON body moves to the next endpoint at once; the last endpoint retries with
 * backoff. Other 4xx errors fail at once (the next provider would reject the same request).
 */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 4;
/** Default total deadline per chat() call, as a multiple of the per-request timeout. */
export const DEFAULT_DEADLINE_TIMEOUTS = 3;
const MAX_BACKOFF_MS = 30_000;
/** Longest Retry-After honoured; the call's deadline still applies. */
const MAX_RETRY_AFTER_MS = 300_000;
/** Budget doublings for empty or length-truncated replies (independent of HTTP retries). */
const MAX_REGROWS = 2;

const envInt = (name: string): number | undefined => {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};
/** Effective per-request timeout: hook, else LLM_TIMEOUT_MS, else 60 s. 0 means no timeout. */
export const timeoutFor = (hooks: ClientOptions): number => hooks.timeoutMs ?? envInt("LLM_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS;
/** Effective total deadline per chat() call: hook, else LLM_DEADLINE_MS, else 3x the timeout. 0 means none. */
export const deadlineFor = (hooks: ClientOptions): number =>
  hooks.deadlineMs ?? envInt("LLM_DEADLINE_MS") ?? DEFAULT_DEADLINE_TIMEOUTS * timeoutFor(hooks);
/**
 * Backoff before retry `n` (0-based): base * 2^n, capped at 30 s, with up to 50% jitter. A
 * Retry-After is honoured (up to 5 min) even when it is longer than the backoff.
 */
export function backoffMs(n: number, baseMs = 1000, retryAfterMs?: number, rand = Math.random): number {
  const exp = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** n);
  const jittered = exp * (0.5 + 0.5 * rand());
  return retryAfterMs !== undefined && retryAfterMs >= 0 ? Math.min(MAX_RETRY_AFTER_MS, Math.max(retryAfterMs, jittered * 0.5)) : jittered;
}
const retryAfterOf = (clock: Clock, h?: Headers): number | undefined => {
  const v = h?.get("retry-after");
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - clock.now()) : undefined;
};
const warned = new Set<string>();
const warnOnce = (key: string, msg: string) => { if (!warned.has(key)) { warned.add(key); console.warn(msg); } };
const realClock = new RealClock();
const RETRYABLE_STATUS = (s: number) => s === 408 || s === 429 || s >= 500;

async function chatCompletions(
  endpoints: Endpoint[], model: string, messages: ChatMessage[], opts: ChatOptions,
  bodyFor: BodyFor, defaultMax: number, maxCap: number, hooks: ClientOptions,
): Promise<string> {
  const doFetch = hooks.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const maxRetries = hooks.maxRetries ?? envInt("LLM_MAX_RETRIES") ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = timeoutFor(hooks);
  const clock = hooks.clock ?? realClock;
  const deadlineMs = opts.deadlineMs ?? deadlineFor(hooks);
  const deadlineAt = deadlineMs > 0 ? clock.now() + deadlineMs : Infinity;
  const callerSignals = [opts.signal, hooks.signal].filter((s): s is AbortSignal => !!s);
  const signal = callerSignals.length > 1 ? AbortSignal.any(callerSignals) : callerSignals[0];
  const eps = (opts.fallback ?? hooks.fallback ?? true) ? endpoints : endpoints.slice(0, 1);
  const emit = (info: ResponseInfo) => { try { hooks.onResponse?.(info); } catch { /* observer errors never break calls */ } };
  const remaining = () => deadlineAt - clock.now();
  const deadlineError = (host: string, why: string) =>
    new LLMError("deadline", `${host} ${why}: call deadline of ${deadlineMs} ms reached (after ${retries} retries)`, { host, retries });
  let e = 0, retries = 0, regrows = 0;
  for (let attempt = 0; ; attempt++) {
    const { baseUrl, apiKey } = eps[e]!;
    const host = new URL(baseUrl).host;
    if (signal?.aborted) throw new LLMError("aborted", `${host} call aborted by caller`, { host, retries });
    if (remaining() <= 0) throw deadlineError(host, "no time left");
    hooks.budget?.take(host);
    const body = { model, messages, ...bodyFor(opts), ...(hooks.seed !== undefined ? { seed: hooks.seed } : {}), ...(hooks.extraBody ?? {}) };
    // Retryable failure: try the next endpoint, else back off on the last one, else give up.
    const retry = async (code: LLMErrorCode, why: string, status?: number, retryAfterMs?: number, errorBody?: string) => {
      if (e < eps.length - 1) {
        const to = new URL(eps[e + 1]!.baseUrl).host;
        console.warn(`[llm] ${host} failed (${why}); falling back to ${to}`);
        try { hooks.onFallback?.({ model, from: host, to, reason: why, attempt }); } catch { /* observer errors never break calls */ }
        e++;
        return;
      }
      if (retries >= maxRetries) throw new LLMError(code, `${host} ${why} (after ${retries} retries)`, { host, status, retries }, errorBody);
      const wait = backoffMs(retries, hooks.retryBaseMs ?? 1000, retryAfterMs, hooks.rand);
      if (wait >= remaining()) throw deadlineError(host, `${why}; next retry in ${Math.round(wait)} ms`);
      retries++;
      await sleep(wait, signal, host);
    };
    const perRequest = Math.min(timeoutMs > 0 ? timeoutMs : Infinity, remaining());
    const signals = [...(Number.isFinite(perRequest) ? [AbortSignal.timeout(Math.max(1, Math.ceil(perRequest)))] : []), ...(signal ? [signal] : [])];
    const t0 = performance.now();
    const failed = (status: number, error: string, extra: Partial<ResponseInfo> = {}) =>
      emit({ model, baseUrl, status, ok: false, latencyMs: performance.now() - t0, attempt, regrows, request: body, ...usageOf(undefined), error, ...extra });
    let res: Response, text: string;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(signals.length ? { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0] } : {}),
      });
      text = await res.text();
    } catch (err) {
      const name = String((err as Error)?.name ?? "Error"), errno = (err as { code?: unknown })?.code;
      const why = name === "TimeoutError" ? "timeout" : `network error (${name}${typeof errno === "string" ? ` ${errno}` : ""})`;
      // The transport's own message (e.g. "socket hang up") goes to observers only, never to thrown errors or logs.
      failed(0, `${why}: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      if (signal?.aborted) throw new LLMError("aborted", `${host} call aborted by caller`, { host, retries });
      if (remaining() <= 0) throw deadlineError(host, why);
      await retry(name === "TimeoutError" ? "timeout" : "network", why);
      continue;
    }
    if (!res.ok) {
      const why = `http ${res.status} (body ${text.length} chars)`;
      const errorBody = text.slice(0, 300);
      failed(res.status, why, { headers: res.headers, errorBody });
      if (!RETRYABLE_STATUS(res.status)) throw new LLMError("http", `${host} ${why}`, { host, status: res.status, length: text.length }, errorBody);
      await retry("http", why, res.status, retryAfterOf(clock, res.headers), errorBody);
      continue;
    }
    let data: any;
    try { data = JSON.parse(text); } catch { data = undefined; }
    if (!data || typeof data !== "object" || !Array.isArray(data.choices)) {
      // A 200 with an HTML gateway page or an error object: observed, then retried like a 5xx.
      const why = `bad response body on ${res.status} (${data === undefined ? "not JSON" : "no choices"}, ${text.length} chars)`;
      failed(res.status, why, { headers: res.headers, ...(data ? { data } : {}) });
      await retry("bad_response", why, res.status);
      continue;
    }
    const u = usageOf(data, model);
    hooks.budget?.charge(u.costMicro, u.costKnown);
    if (!u.costKnown) warnOnce(`unpriced:${data.model ?? model}`, `[llm] no price for model ${data.model ?? model}: its cost is recorded as 0`);
    emit({ model, baseUrl, status: res.status, ok: true, latencyMs: performance.now() - t0, attempt, regrows, request: body, data, ...u, headers: res.headers });
    const choice = data.choices[0];
    const content = String(choice?.message?.content ?? "").trim();
    const truncated = choice?.finish_reason === "length";
    // Reasoning models can spend the whole budget thinking and return nothing usable.
    if ((!content || truncated) && regrows < MAX_REGROWS) {
      regrows++;
      opts = { ...opts, maxTokens: Math.min((opts.maxTokens ?? defaultMax) * 2, maxCap) };
      continue;
    }
    if (truncated) {
      throw new LLMError("truncated", `${host} reply cut off at the completion limit after ${regrows} budget doublings (${content.length} chars)`, { host, length: content.length });
    }
    return content;
  }
}
const sleep = (ms: number, signal: AbortSignal | undefined, host: string) => new Promise<void>((resolve, reject) => {
  const aborted = () => new LLMError("aborted", `${host} call aborted by caller`, { host });
  if (signal?.aborted) return reject(aborted());
  const onAbort = () => { clearTimeout(t); reject(aborted()); };
  const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

/** Optional, legacy provider (not used by default since 2026-10-05). The qwen default is kept for old runs only. */
export class CerebrasLLM implements LLM {
  constructor(
    private apiKey = process.env.CEREBRAS_API_KEY ?? "",
    private model = process.env.CEREBRAS_MODEL ?? "qwen-3.8-27b",
    private baseUrl = process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    private hooks: ClientOptions = {},
  ) { if (!this.apiKey) throw new Error("CEREBRAS_API_KEY missing (see .env.example)"); }
  chat(messages: ChatMessage[], opts: ChatOptions = {}) {
    return chatCompletions([{ baseUrl: this.baseUrl, apiKey: this.apiKey }], this.model, messages, opts, o => ({
      max_tokens: o.maxTokens ?? 2048, temperature: o.temperature ?? 0.7,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }), 2048, 16384, this.hooks);
  }
}

/**
 * Parse the JSON value out of a model reply. A ```json fenced block wins; otherwise <think> blocks
 * are dropped and the first balanced `{...}` that parses is returned (else the first balanced
 * `[...]` that parses). Prose around it, `{placeholders}` and later values are ignored. Errors carry
 * only the reply length, never its text (core-9, core-12).
 */
export function parseJson<T = any>(text: string): T {
  for (const m of text.matchAll(/```json[ \t]*\r?\n?([\s\S]*?)```/gi)) {
    const v = firstJsonValue(m[1]!);
    if (v !== NO_JSON) return v as T;
  }
  const v = firstJsonValue(text.replace(/<think>[\s\S]*?<\/think>/gi, " "));
  if (v === NO_JSON) throw new LLMError("no_json", `no JSON value in model output (${text.length} chars)`, { length: text.length });
  return v as T;
}

const NO_JSON = Symbol("no-json");
/** Bounds the work on adversarial replies (many unmatched brackets). */
const MAX_JSON_CANDIDATES = 64;

/** Index of the bracket closing the one at `start`, skipping string contents; -1 if unbalanced. */
function closingIndex(s: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** First parsing object in `s`, else first parsing array, else NO_JSON. */
function firstJsonValue(s: string): unknown {
  let firstArray: unknown = NO_JSON;
  let tried = 0;
  for (let i = 0; i < s.length && tried < MAX_JSON_CANDIDATES; i++) {
    const c = s[i];
    if (c !== "{" && c !== "[") continue;
    tried++;
    const end = closingIndex(s, i);
    if (end < 0) continue;
    let v: unknown;
    try { v = JSON.parse(s.slice(i, end + 1)); } catch { continue; }
    if (c === "{") return v;
    if (firstArray === NO_JSON) firstArray = v;
    i = end; // values inside a parsed array are not top-level candidates
  }
  return firstArray;
}

/**
 * OpenAI-compatible chat client (OpenAI, Surplus Intelligence). Temperature is not sent (reasoning
 * models ignore it). `fallbacks` are tried in order on 429 / 5xx / network errors.
 */
export class OpenAILLM implements LLM {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY ?? "",
    private model = process.env.JUDGE_MODEL ?? "gpt-6-luna",
    private baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    private hooks: ClientOptions = {},
    private fallbacks: Endpoint[] = [],
  ) { if (!this.apiKey) throw new Error("API key missing for OpenAI-compatible client (see .env.example)"); }
  chat(messages: ChatMessage[], opts: ChatOptions = {}) {
    return chatCompletions([{ baseUrl: this.baseUrl, apiKey: this.apiKey }, ...this.fallbacks], this.model, messages, opts, o => ({
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }), 4096, 32768, this.hooks);
  }
}

export type Provider = "cerebras" | "openai" | "surplus";
export const PROVIDERS: readonly Provider[] = ["surplus", "openai", "cerebras"];

/** Validate a provider name case-insensitively ("Surplus" -> "surplus"). Throws on anything unknown. */
export function parseProvider(name: string | undefined | null): Provider {
  const p = String(name ?? "").trim().toLowerCase();
  if ((PROVIDERS as readonly string[]).includes(p)) return p as Provider;
  throw new Error(`Unknown LLM provider ${JSON.stringify(name)} (expected one of: ${PROVIDERS.join(", ")})`);
}

// Startup check: every default LLM use needs SURPLUS_API_KEY or OPENAI_API_KEY.
if (!process.env.SURPLUS_API_KEY && !process.env.OPENAI_API_KEY)
  console.warn("[llm] Neither SURPLUS_API_KEY nor OPENAI_API_KEY is set: LLM calls will fail (see .env.example).");

/** The project-wide default model (founder decision 2026-10-05: Surplus gpt-6-luna for everything). */
export const DEFAULT_PROVIDER: Provider = "surplus";
export const DEFAULT_MODEL = "gpt-6-luna";

/**
 * Endpoints with a key for a provider, in the order to try them. "surplus" is Surplus, then OpenAI:
 * OpenAI is used alone when SURPLUS_API_KEY is unset, and as the fallback on 429 / 5xx / timeouts.
 * Provider names are
 * validated case-insensitively; unknown names throw.
 */
export function endpointsFor(providerName: Provider | string): Endpoint[] {
  const provider = parseProvider(providerName);
  const env = process.env;
  const surplus = { baseUrl: env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai/v1", apiKey: env.SURPLUS_API_KEY ?? "" };
  const openai = { baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY ?? "" };
  const cerebras = { baseUrl: env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1", apiKey: env.CEREBRAS_API_KEY ?? "" };
  const order = provider === "surplus" ? [surplus, openai] : provider === "openai" ? [openai] : [cerebras];
  return order.filter(e => e.apiKey);
}

/** Any OpenAI-compatible provider by name. `hooks` are optional (extra body params, usage/cost callback, transport). */
export function llmFor(providerName: Provider | string, model: string, hooks: ClientOptions = {}): LLM {
  const provider = parseProvider(providerName);
  const [first, ...fallbacks] = endpointsFor(provider);
  if (!first) {
    throw new Error(provider === "surplus"
      ? "SURPLUS_API_KEY or OPENAI_API_KEY missing (see .env.example)"
      : `${provider.toUpperCase()}_API_KEY missing (see .env.example)`);
  }
  if (provider === "cerebras") return new CerebrasLLM(first.apiKey, model, first.baseUrl, hooks);
  return new OpenAILLM(first.apiKey, model, first.baseUrl, hooks, fallbacks);
}

/** Default LLM for any use per .env (DEFAULT_LLM_PROVIDER / DEFAULT_LLM_MODEL), default Surplus gpt-6-luna. */
export function defaultLLM(hooks: ClientOptions = {}): LLM {
  return llmFor(parseProvider(process.env.DEFAULT_LLM_PROVIDER || DEFAULT_PROVIDER), process.env.DEFAULT_LLM_MODEL ?? DEFAULT_MODEL, hooks);
}

/** Judge LLM per .env (JUDGE_PROVIDER / JUDGE_MODEL), default Surplus gpt-6-luna. */
export function judgeLLM(hooks: ClientOptions = {}): LLM {
  return llmFor(parseProvider(process.env.JUDGE_PROVIDER || DEFAULT_PROVIDER), process.env.JUDGE_MODEL ?? DEFAULT_MODEL, hooks);
}

/** Recommender LLM (engine judge for top-K configurations) per .env (RECOMMENDER_PROVIDER / RECOMMENDER_MODEL), default Surplus gpt-6-luna. */
export function recommenderLLM(hooks: ClientOptions = {}): LLM {
  return llmFor(parseProvider(process.env.RECOMMENDER_PROVIDER || DEFAULT_PROVIDER), process.env.RECOMMENDER_MODEL ?? DEFAULT_MODEL, hooks);
}

/**
 * Live (paid, networked) tests run only with an explicit opt-in: LIVE_TESTS=1. A key in .env is
 * not enough, because Bun auto-loads the repo-root .env (audit P1-15).
 */
export const liveTestsEnabled = (): boolean => /^(1|true|yes)$/i.test(process.env.LIVE_TESTS ?? "");
