// LLM-enriched persona generator: starts from the deterministic generator (so hidden truth
// stays structured and oracle-scorable) and asks Cerebras for a realistic public bio and
// voice sample consistent with that truth. Private disclosures never enter public fields.
import { parseJson, type ChatMessage, type LLM } from "@thenetwork/core";
import { generatePersonas, type GeneratorOptions } from "./generator.ts";
import type { Persona } from "./persona.ts";
import { INTERESTS, SKILLS } from "./taxonomy.ts";

const label = (t: string) => INTERESTS.find(i => i.tag === t)?.label ?? t;

export async function enrichPersona(p: Persona, llm: LLM): Promise<Persona> {
  const h = p.hidden;
  const prompt = `Create realistic texture for a synthetic test persona of a social app in ${p.homeCity === "sf" ? "San Francisco" : "New York City"}.
Facts (must stay consistent):
- Name: ${p.name}; age they state: ${p.public.claimedAge}; gender: ${p.gender}; neighborhood: ${p.routine.homeArea}
- Life situation archetype: ${p.archetype.replace("_", " ")}
- Interests they talk about: ${p.public.statedInterests.map(label).join(", ")}
- Skills: ${p.public.statedSkills.map(s => SKILLS.find(x => x.tag === s)?.label ?? s).join(", ") || "none notable"}
- Wants: ${p.public.statedIntents.map(i => i.text).join("; ") || "nothing specific"}
- Texting style: ${h.style}; verbosity ${Math.round(h.verbosity * 100)}%
Return ONLY JSON: {"bio": "2-3 sentence third-person bio with a concrete, specific detail or two (job, a favorite spot)", "voiceSample": "one example text message they'd send, in their style", "occupation": "short job title"}
Do not include phone numbers, emails, addresses, or health/financial/relationship-status details.`;
  const j = await chatJson<{ bio?: string; voiceSample?: string; occupation?: string }>(llm, [{ role: "user", content: prompt }], { maxTokens: 4000, temperature: 0.9 });
  const scrub = (s: string | undefined) => {
    let t = String(s ?? "").trim();
    if (h.privateDisclosure) t = t.split(h.privateDisclosure.canary).join("");
    return t;
  };
  const bio = scrub(j.bio) || p.public.bio;
  return {
    ...p,
    enriched: true,
    public: { ...p.public, bio, voiceSample: scrub(j.voiceSample) || p.public.voiceSample },
  };
}

/** Generate `n` personas deterministically, then enrich them via the LLM (bounded concurrency). */
export async function generateLLMPersonas(opts: GeneratorOptions & { llm: LLM; concurrency?: number }): Promise<Persona[]> {
  const base = generatePersonas(opts);
  return mapLimit(base, opts.concurrency ?? 4, p => enrichPersona(p, opts.llm).catch(() => p));
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

/**
 * JSON chat with retries: qwen-3.8-27b is a reasoning model and occasionally spends its
 * whole budget thinking (empty or truncated content), so retry with a larger budget.
 */
export async function chatJson<T>(llm: LLM, messages: ChatMessage[], opts: { maxTokens?: number; temperature?: number; retries?: number } = {}): Promise<T> {
  let lastErr: unknown;
  let maxTokens = opts.maxTokens ?? 3000;
  for (let i = 0; i <= (opts.retries ?? 2); i++) {
    try {
      return parseJson<T>(await llm.chat(messages, { maxTokens, temperature: opts.temperature, json: true }));
    } catch (e) { lastErr = e; maxTokens = Math.min(8000, Math.round(maxTokens * 1.5)); }
  }
  throw lastErr;
}
