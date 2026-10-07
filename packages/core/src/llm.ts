// Minimal OpenAI-compatible chat clients (Surplus Intelligence, OpenAI, Cerebras).
// Default for every use is Surplus Intelligence gpt-6-luna (founder decision 2026-10-05); see
// defaultLLM() / judgeLLM() / recommenderLLM(). Provider "surplus" falls back to OpenAI (same model
// IDs) when SURPLUS_API_KEY is unset or Surplus fails with 429 / 5xx / timeout; each fallback logs a
// warning. If neither key is set, a warning is logged when this module loads. Cerebras is optional and legacy.
// Every request has a timeout (default 60 s, LLM_TIMEOUT_MS or ClientOptions.timeoutMs) and
// retries are bounded (default 4, with capped, jittered exponential backoff).
// Reasoning models spend hidden tokens: leave room in the completion budget, and read
// message.content for the answer.
//
// Optional per-client hooks (ClientOptions) let callers such as evals add request params, observe
// usage/cost and supply their own transport (e.g. a response cache) without patching global fetch.
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions { maxTokens?: number; temperature?: number; json?: boolean }
export interface LLM {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
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
  /** 0-based HTTP attempt inside one chat() call (429/5xx/empty-content retries). */
  attempt: number;
  /** The exact JSON request body that was sent (no headers). */
  request: Record<string, unknown>;
  /** Parsed JSON response body when ok. */
  data?: any;
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number };
  /** Provider-reported cost in micro-USD (Surplus usage.buyer_cost_micro, or usage.cost in USD * 1e6), else 0. */
  costMicro: number;
  finishReason?: string;
  headers?: Headers;
  error?: string;
}

export interface ClientOptions {
  /** Extra JSON body params merged into every request (e.g. { reasoning_effort: "medium" }). */
  extraBody?: Record<string, unknown>;
  /** Called after every HTTP attempt, successful or not. Exceptions thrown here are ignored. */
  onResponse?: (info: ResponseInfo) => void;
  /** Transport override (defaults to global fetch). Used by evals for a disk cache; never patch globals. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Per-request timeout in ms (default 60 s, or LLM_TIMEOUT_MS; 0 disables). A timeout counts as a retryable error. */
  timeoutMs?: number;
  /** Max retries for 429 / 5xx / network errors / timeouts on the last endpoint (default 4, or LLM_MAX_RETRIES). */
  maxRetries?: number;
  /** First backoff delay in ms (default 1000); doubles per retry, capped at 30 s, with jitter. */
  retryBaseMs?: number;
}

/**
 * OpenAI list prices in USD per 1M tokens (= micro-USD per token), standard tier, short context,
 * from https://developers.openai.com/api/docs/pricing on 2026-10-06. OpenAI responses carry no
 * cost, so it is computed from these. Reasoning tokens are part of completion_tokens (billed as output).
 */
export const OPENAI_PRICES: Record<string, { input: number; cachedInput: number; cacheWrite: number; output: number }> = {
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, cacheWrite: 0.125, output: 0.50 },
  "gpt-6.1-sol": { input: 2.00, cachedInput: 0.10, cacheWrite: 2.50, output: 10.00 },
};

/** Usage + cost from an OpenAI-compatible response body (provider-reported cost, else OPENAI_PRICES). */
export function usageOf(data: any): Pick<ResponseInfo, "usage" | "costMicro" | "finishReason"> {
  const u = data?.usage ?? {};
  const promptTokens = u.prompt_tokens ?? 0, completionTokens = u.completion_tokens ?? 0;
  const reported = u.buyer_cost_micro ?? (typeof u.cost === "number" ? u.cost * 1e6 : undefined);
  const p = OPENAI_PRICES[data?.model];
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0, writes = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  const priced = p ? (promptTokens - cached - writes) * p.input + cached * p.cachedInput + writes * p.cacheWrite + completionTokens * p.output : 0;
  return {
    usage: { promptTokens, completionTokens, reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0 },
    costMicro: Number(reported ?? priced) || 0,
    finishReason: data?.choices?.[0]?.finish_reason,
  };
}

type BodyFor = (opts: ChatOptions) => Record<string, unknown>;

/** An OpenAI-compatible endpoint. */
export interface Endpoint { baseUrl: string; apiKey: string }

/**
 * Shared POST to /chat/completions over one or more endpoints, in order. A 429, 5xx or network
 * error moves to the next endpoint at once; the last endpoint retries with backoff. Other 4xx
 * errors fail at once (the next provider would reject the same request).
 */
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 30_000;

const envInt = (name: string): number | undefined => {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};
/** Effective per-request timeout: hook, else LLM_TIMEOUT_MS, else 60 s. 0 means no timeout. */
export const timeoutFor = (hooks: ClientOptions): number => hooks.timeoutMs ?? envInt("LLM_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS;
/** Backoff before retry `n` (0-based): base * 2^n, capped at 30 s, with up to 50% jitter; honours a shorter Retry-After. */
export function backoffMs(n: number, baseMs = 1000, retryAfterMs?: number, rand = Math.random): number {
  const exp = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** n);
  const jittered = exp * (0.5 + 0.5 * rand());
  return retryAfterMs !== undefined && retryAfterMs >= 0 ? Math.min(MAX_BACKOFF_MS, Math.max(retryAfterMs, jittered * 0.5)) : jittered;
}
const retryAfterOf = (h?: Headers): number | undefined => {
  const v = h?.get("retry-after");
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
};
const warned = new Set<string>();
const warnOnce = (key: string, msg: string) => { if (!warned.has(key)) { warned.add(key); console.warn(msg); } };

async function chatCompletions(
  endpoints: Endpoint[], model: string, messages: ChatMessage[], opts: ChatOptions,
  bodyFor: BodyFor, defaultMax: number, maxCap: number, hooks: ClientOptions,
): Promise<string> {
  const doFetch = hooks.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const maxRetries = hooks.maxRetries ?? envInt("LLM_MAX_RETRIES") ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = timeoutFor(hooks);
  const emit = (info: ResponseInfo) => { try { hooks.onResponse?.(info); } catch { /* observer errors never break calls */ } };
  let e = 0, retries = 0;
  for (let attempt = 0; ; attempt++) {
    const { baseUrl, apiKey } = endpoints[e]!;
    const label = new URL(baseUrl).host;
    const body = { model, messages, ...bodyFor(opts), ...(hooks.extraBody ?? {}) };
    // Retryable failure: try the next endpoint, else back off on the last one, else give up.
    const retry = async (error: string, retryAfterMs?: number) => {
      if (e < endpoints.length - 1) {
        warnOnce(`fallback:${label}`, `[llm] ${label} failed (${error.slice(0, 80)}); falling back to ${new URL(endpoints[e + 1]!.baseUrl).host}`);
        e++;
      } else if (retries < maxRetries) await sleep(backoffMs(retries++, hooks.retryBaseMs ?? 1000, retryAfterMs));
      else throw new Error(`${label} ${error} (after ${retries} retries)`);
    };
    const t0 = performance.now();
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (err) {
      const error = String((err as Error)?.message ?? err).slice(0, 200);
      emit({ model, baseUrl, status: 0, ok: false, latencyMs: performance.now() - t0, attempt, request: body, ...usageOf(undefined), error });
      await retry(`network error: ${error}`);
      continue;
    }
    const latencyMs = performance.now() - t0;
    if (!res.ok) {
      const text = await res.text();
      emit({ model, baseUrl, status: res.status, ok: false, latencyMs, attempt, request: body, ...usageOf(undefined), headers: res.headers, error: text.slice(0, 300) });
      if (res.status !== 429 && res.status < 500) throw new Error(`${label} ${res.status}: ${text.slice(0, 500)}`);
      await retry(`${res.status}: ${text.slice(0, 500)}`, retryAfterOf(res.headers));
      continue;
    }
    const data: any = await res.json();
    emit({ model, baseUrl, status: res.status, ok: true, latencyMs, attempt, request: body, data, ...usageOf(data), headers: res.headers });
    const choice = data.choices?.[0];
    const content = (choice?.message?.content ?? "").trim();
    // Reasoning models can spend the whole budget thinking and return nothing usable.
    if ((!content || choice?.finish_reason === "length") && attempt < 2) {
      opts = { ...opts, maxTokens: Math.min((opts.maxTokens ?? defaultMax) * 2, maxCap) };
      continue;
    }
    return content;
  }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

/** Parse a JSON object out of a model reply (tolerates code fences / prose). */
export function parseJson<T = any>(text: string): T {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error(`no JSON in model output: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
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
