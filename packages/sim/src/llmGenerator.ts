// LLM-enriched persona generator: starts from the deterministic generator (so hidden truth
// stays structured and oracle-scorable) and asks the default LLM (defaultLLM()) for a realistic public bio and
// voice sample consistent with that truth. Private disclosures never enter public fields.
import { chatJson, type LLM } from "@thenetwork/core";
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
  const j = await chatJson(llm, [{ role: "user", content: prompt }], anyJson<{ bio?: string; voiceSample?: string; occupation?: string }>, { attempts: 3, maxTokens: 4000, temperature: 0.9, grow: SIM_JSON_GROW });
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
 * Retry budget for the simulator's JSON calls (core chatJson): a reasoning model occasionally spends
 * its whole budget thinking (empty or truncated content), so each retry gets 1.5x the budget, up to 8000.
 */
export const SIM_JSON_GROW = (maxTokens: number) => Math.min(8000, Math.round(maxTokens * 1.5));
/** Any JSON value (the callers validate the fields they read). */
export const anyJson = <T>(raw: unknown) => raw as T;
