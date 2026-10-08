// OPTIONAL persona prose: replace the template bio with a short LLM-written one via defaultLLM()
// (gpt-6-luna). The world never needs it: everything runs on templates, and prose changes no
// number in the oracle or the harness (bios are not read by the oracle). Responses are cached on
// disk by prompt hash, and a spend guard stops the pass before it exceeds `maxSpendUsd`.
// Hidden truth stays out of the prompt except what the member would say about themselves; the
// canary and adversary label are never sent.
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultLLM, tryChatJson, type LLM, type ResponseInfo } from "@thenetwork/core";
import { INTERESTS } from "@thenetwork/sim/src/taxonomy.ts";
import { zipInfo } from "./geo.ts";
import type { SlopPersona } from "./persona.ts";

export interface ProseOptions {
  llm?: LLM; cacheDir?: string; maxSpendUsd?: number; concurrency?: number;
  /** Only the first `limit` personas (smoke runs). */
  limit?: number;
}
export interface ProseResult { personas: SlopPersona[]; calls: number; cacheHits: number; failures: number; spendUsd: number }

export const DEFAULT_PROSE_CACHE = "runs/worlds/slop-prose-cache";

export function prosePrompt(p: SlopPersona): string {
  const S = p.stated, label = (t: string) => INTERESTS.find(i => i.tag === t)?.label ?? t;
  return `Write a dating-profile bio for a synthetic test persona of a dating service that works over iMessage.
Facts (stay consistent; add nothing sensitive):
- First name: ${p.name.split(" ")[0]}; age: ${S.claimedAge}; job: ${S.occupation}; neighborhood: ${zipInfo.get(S.homeZip)?.area}
- Into: ${S.interests.map(label).join(", ")}
- Favorite first dates: ${S.activities.join(", ").replace(/_/g, " ")}
- Looking for: ${S.goal.replace("_", "-")}
Return ONLY JSON: {"bio": "2-3 sentences, first person, specific and a little playful"}
No phone numbers, emails, addresses, social handles, or health, money or religion details.`;
}

export async function enrichSlopProse(personas: SlopPersona[], o: ProseOptions = {}): Promise<ProseResult> {
  const dir = o.cacheDir ?? DEFAULT_PROSE_CACHE;
  mkdirSync(dir, { recursive: true });
  let spendMicro = 0, calls = 0, cacheHits = 0, failures = 0;
  const maxMicro = (o.maxSpendUsd ?? 2) * 1e6;
  const llm = o.llm ?? defaultLLM({ onResponse: (r: ResponseInfo) => { spendMicro += r.costMicro; } });
  const out = [...personas];
  const todo = out.map((p, i) => [p, i] as const).slice(0, o.limit ?? out.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 4, todo.length) }, async () => {
    while (next < todo.length) {
      const [p, i] = todo[next++]!;
      const prompt = prosePrompt(p);
      const file = join(dir, `${createHash("sha256").update(prompt).digest("hex").slice(0, 32)}.json`);
      let bio: string | undefined;
      if (existsSync(file)) { bio = JSON.parse(readFileSync(file, "utf8")).bio; cacheHits++; }
      else {
        const r = await tryChatJson(llm, [{ role: "user", content: prompt }], raw => {
          const b = String((raw as { bio?: unknown })?.bio ?? "").trim();
          if (!b) throw new Error("empty bio");
          return b;
        }, { attempts: 2, maxTokens: 2000, beforeAttempt: () => { if (spendMicro >= maxMicro) throw new Error("prose spend cap reached"); } });
        calls++;
        if (r.ok) { bio = r.value; writeFileSync(file, JSON.stringify({ bio, model: "defaultLLM" })); } else failures++;
      }
      if (bio && !bio.includes(p.hidden.canary)) out[i] = { ...p, enriched: true, stated: { ...p.stated, bio } };
    }
  }));
  return { personas: out, calls, cacheHits, failures, spendUsd: spendMicro / 1e6 };
}
