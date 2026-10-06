// Minimal OpenAI-compatible chat clients (Surplus Intelligence, OpenAI, Cerebras).
// Default for every use is Surplus Intelligence gpt-6-luna (founder decision 2026-10-05); see
// defaultLLM() / judgeLLM() / recommenderLLM(). Reasoning models spend hidden tokens: leave room
// in the completion budget, and read message.content for the answer.
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
  /** Per-request timeout in ms (default: none). */
  timeoutMs?: number;
  /** Max retries for 429 / 5xx / network errors (default 4). */
  maxRetries?: number;
}

/** Usage + cost from an OpenAI-compatible response body. */
export function usageOf(data: any): Pick<ResponseInfo, "usage" | "costMicro" | "finishReason"> {
  const u = data?.usage ?? {};
  return {
    usage: {
      promptTokens: u.prompt_tokens ?? 0, completionTokens: u.completion_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    costMicro: Number(u.buyer_cost_micro ?? (typeof u.cost === "number" ? u.cost * 1e6 : 0)) || 0,
    finishReason: data?.choices?.[0]?.finish_reason,
  };
}

type BodyFor = (opts: ChatOptions) => Record<string, unknown>;

/** Shared retrying POST to /chat/completions. */
async function chatCompletions(
  label: string, baseUrl: string, apiKey: string, model: string, messages: ChatMessage[], opts: ChatOptions,
  bodyFor: BodyFor, defaultMax: number, maxCap: number, hooks: ClientOptions,
): Promise<string> {
  const doFetch = hooks.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const maxRetries = hooks.maxRetries ?? 4;
  const emit = (info: ResponseInfo) => { try { hooks.onResponse?.(info); } catch { /* observer errors never break calls */ } };
  for (let attempt = 0; ; attempt++) {
    const body = { model, messages, ...bodyFor(opts), ...(hooks.extraBody ?? {}) };
    const t0 = performance.now();
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(hooks.timeoutMs ? { signal: AbortSignal.timeout(hooks.timeoutMs) } : {}),
      });
    } catch (e) {
      const error = String((e as Error)?.message ?? e).slice(0, 200);
      emit({ model, status: 0, ok: false, latencyMs: performance.now() - t0, attempt, request: body, ...usageOf(undefined), error });
      if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new Error(`${label} network error: ${error}`);
    }
    const latencyMs = performance.now() - t0;
    if (!res.ok) {
      const text = await res.text();
      emit({ model, status: res.status, ok: false, latencyMs, attempt, request: body, ...usageOf(undefined), headers: res.headers, error: text.slice(0, 300) });
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new Error(`${label} ${res.status}: ${text.slice(0, 500)}`);
    }
    const data: any = await res.json();
    emit({ model, status: res.status, ok: true, latencyMs, attempt, request: body, data, ...usageOf(data), headers: res.headers });
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

export class CerebrasLLM implements LLM {
  constructor(
    private apiKey = process.env.CEREBRAS_API_KEY ?? "",
    private model = process.env.CEREBRAS_MODEL ?? "qwen-3.8-27b",
    private baseUrl = process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
    private hooks: ClientOptions = {},
  ) { if (!this.apiKey) throw new Error("CEREBRAS_API_KEY missing (see .env.example)"); }
  chat(messages: ChatMessage[], opts: ChatOptions = {}) {
    return chatCompletions("Cerebras", this.baseUrl, this.apiKey, this.model, messages, opts, o => ({
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

/** OpenAI-compatible chat client (OpenAI, Surplus Intelligence). Temperature is not sent (reasoning models ignore it). */
export class OpenAILLM implements LLM {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY ?? "",
    private model = process.env.JUDGE_MODEL ?? "gpt-6-luna",
    private baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    private hooks: ClientOptions = {},
  ) { if (!this.apiKey) throw new Error("API key missing for OpenAI-compatible client (see .env.example)"); }
  chat(messages: ChatMessage[], opts: ChatOptions = {}) {
    return chatCompletions("OpenAI", this.baseUrl, this.apiKey, this.model, messages, opts, o => ({
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }), 4096, 32768, this.hooks);
  }
}

export type Provider = "cerebras" | "openai" | "surplus";

/** The project-wide default model (founder decision 2026-10-05: Surplus gpt-6-luna for everything). */
export const DEFAULT_PROVIDER: Provider = "surplus";
export const DEFAULT_MODEL = "gpt-6-luna";

/** Any OpenAI-compatible provider by name. `hooks` are optional (extra body params, usage/cost callback, transport). */
export function llmFor(provider: Provider, model: string, hooks: ClientOptions = {}): LLM {
  if (provider === "cerebras") return new CerebrasLLM(undefined, model, undefined, hooks);
  if (provider === "surplus")
    return new OpenAILLM(process.env.SURPLUS_API_KEY ?? "", model, process.env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai/v1", hooks);
  return new OpenAILLM(undefined, model, undefined, hooks);
}

/** Default LLM for any use per .env (DEFAULT_LLM_PROVIDER / DEFAULT_LLM_MODEL), default Surplus gpt-6-luna. */
export function defaultLLM(hooks: ClientOptions = {}): LLM {
  return llmFor((process.env.DEFAULT_LLM_PROVIDER ?? DEFAULT_PROVIDER) as Provider, process.env.DEFAULT_LLM_MODEL ?? DEFAULT_MODEL, hooks);
}

/** Judge LLM per .env (JUDGE_PROVIDER / JUDGE_MODEL), default Surplus gpt-6-luna. */
export function judgeLLM(hooks: ClientOptions = {}): LLM {
  return llmFor((process.env.JUDGE_PROVIDER ?? DEFAULT_PROVIDER) as Provider, process.env.JUDGE_MODEL ?? DEFAULT_MODEL, hooks);
}

/** Recommender LLM (engine judge for top-K configurations) per .env (RECOMMENDER_PROVIDER / RECOMMENDER_MODEL), default Surplus gpt-6-luna. */
export function recommenderLLM(hooks: ClientOptions = {}): LLM {
  return llmFor((process.env.RECOMMENDER_PROVIDER ?? DEFAULT_PROVIDER) as Provider, process.env.RECOMMENDER_MODEL ?? DEFAULT_MODEL, hooks);
}
