// Minimal OpenAI-compatible client for Cerebras (qwen-3.8-27b is a reasoning model:
// leave room in max_tokens for hidden reasoning, and read message.content for the answer).
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface LLM {
  chat(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number; json?: boolean }): Promise<string>;
}
export class CerebrasLLM implements LLM {
  constructor(
    private apiKey = process.env.CEREBRAS_API_KEY ?? "",
    private model = process.env.CEREBRAS_MODEL ?? "qwen-3.8-27b",
    private baseUrl = process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1",
  ) { if (!this.apiKey) throw new Error("CEREBRAS_API_KEY missing (see .env.example)"); }
  async chat(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number; json?: boolean } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model, messages, max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.7,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue;
      }
      if (!res.ok) throw new Error(`Cerebras ${res.status}: ${await res.text()}`);
      const data: any = await res.json();
      const choice = data.choices?.[0];
      const content = (choice?.message?.content ?? "").trim();
      // Reasoning models can spend the whole budget thinking and return nothing usable.
      if ((!content || choice?.finish_reason === "length") && attempt < 2) {
        opts = { ...opts, maxTokens: Math.min((opts.maxTokens ?? 2048) * 2, 16384) };
        continue;
      }
      return content;
    }
  }
}
/** Parse a JSON object out of a model reply (tolerates code fences / prose). */
export function parseJson<T = any>(text: string): T {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) throw new Error(`no JSON in model output: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

/** OpenAI chat client (used for judges so the judge model family differs from the agent/engine model). */
export class OpenAILLM implements LLM {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY ?? "",
    private model = process.env.JUDGE_MODEL ?? "gpt-6-luna",
    private baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) { if (!this.apiKey) throw new Error("OPENAI_API_KEY missing (see .env.example)"); }
  async chat(messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number; json?: boolean } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model, messages,
          ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue;
      }
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      const data: any = await res.json();
      const choice = data.choices?.[0];
      const content = (choice?.message?.content ?? "").trim();
      if ((!content || choice?.finish_reason === "length") && attempt < 2) {
        opts = { ...opts, maxTokens: Math.min((opts.maxTokens ?? 4096) * 2, 32768) }; continue;
      }
      return content;
    }
  }
}

export type Provider = "cerebras" | "openai" | "surplus";

/** Any OpenAI-compatible provider by name. */
export function llmFor(provider: Provider, model: string): LLM {
  if (provider === "cerebras") return new CerebrasLLM(undefined, model);
  if (provider === "surplus")
    return new OpenAILLM(process.env.SURPLUS_API_KEY ?? "", model, process.env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai/v1");
  return new OpenAILLM(undefined, model);
}

/** Judge LLM per .env (JUDGE_PROVIDER / JUDGE_MODEL). */
export function judgeLLM(): LLM {
  return llmFor((process.env.JUDGE_PROVIDER ?? "surplus") as Provider, process.env.JUDGE_MODEL ?? "gpt-6.1-sol");
}

/** Recommender LLM (engine judge for top-K configurations) per .env (RECOMMENDER_PROVIDER / RECOMMENDER_MODEL). */
export function recommenderLLM(): LLM {
  return llmFor((process.env.RECOMMENDER_PROVIDER ?? "surplus") as Provider, process.env.RECOMMENDER_MODEL ?? "gpt-6.1-sol");
}
