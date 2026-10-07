// Run a pass-1 system prompt on items and score each item.
//
// Per-item score (what the optimizer maximises): 0.75 * expected accuracy under the soft label
// (yes -> pGood, no -> 1 - pGood) + 0.25 * (1 - (match_probability - pGood)^2). A failed call scores 0.
// Expected accuracy against pGood is the accuracy averaged over the oracle's chemistry draws, so a
// prompt is not rewarded for matching one lucky draw.
import type { Item } from "./data.ts";
import { chatJson, pmap, type Budget } from "./llm.ts";

export interface ItemResult {
  id: string; verdict: "yes" | "no" | null; prob: number | null; reasoning: string; dealbreaker: boolean;
  reasoningFirst: boolean; error?: string; expAcc: number; brierSoft: number; score: number; cached: boolean;
}

const prob = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x) : x;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const v = n > 1 && n <= 100 ? n / 100 : n;
  return v < 0 || v > 1 ? undefined : v;
};

/** Same acceptance rules as parseScreenVerdict (judgeScreen.ts at HEAD), restated so the pilot does not import mid-edit code. */
function parse(o: any, attending: string[]) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
  const v = typeof o.verdict === "string" ? o.verdict.trim().toLowerCase() : o.verdict === true ? "yes" : o.verdict === false ? "no" : "";
  const verdict = v === "yes" || v === "propose" ? "yes" : v === "no" || v === "reject" ? "no" : null;
  const p = prob(o.match_probability);
  const errs: string[] = [];
  if (typeof o.reasoning !== "string" || !o.reasoning.trim()) errs.push("reasoning");
  if (!verdict) errs.push("verdict");
  if (p === undefined) errs.push("match_probability");
  if (typeof o.dealbreaker !== "boolean") errs.push("dealbreaker");
  for (const r of attending) if (prob(o.accept_probability?.[r]) === undefined) errs.push(`accept_probability.${r}`);
  if (errs.length) throw new Error(`schema: ${errs.join(", ")}`);
  const keys = Object.keys(o);
  return { verdict: verdict as "yes" | "no", p: p!, reasoning: String(o.reasoning), dealbreaker: o.dealbreaker as boolean, reasoningFirst: keys.indexOf("reasoning") >= 0 && keys.indexOf("reasoning") < keys.indexOf("verdict") };
}

export function scoreOf(it: Item, yes: boolean | null, p: number | null) {
  if (yes === null) return { expAcc: 0, brierSoft: 1, score: 0 };
  const expAcc = yes ? it.pGood : 1 - it.pGood;
  const brierSoft = ((p ?? (yes ? 1 : 0)) - it.pGood) ** 2;
  return { expAcc, brierSoft, score: 0.75 * expAcc + 0.25 * (1 - brierSoft) };
}

export async function evaluate(system: string, items: Item[], budget: Budget, concurrency = Number(process.env.PO_CONCURRENCY ?? 12), attemptBase = 0): Promise<ItemResult[]> {
  // attemptBase > 0 gives fresh samples of the same prompt (a different cache key), for run-to-run noise.
  return pmap(items, concurrency, async it => {
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await chatJson([{ role: "system", content: system }, { role: "user", content: it.user }], { attempt: attemptBase + attempt, budget, maxTokens: 4000 });
        const v = parse(r.json, it.attending);
        const yes = v.verdict === "yes" && !v.dealbreaker;
        return { id: it.id, verdict: yes ? "yes" : "no", prob: v.p, reasoning: v.reasoning, dealbreaker: v.dealbreaker, reasoningFirst: v.reasoningFirst, cached: r.cached, ...scoreOf(it, yes, v.p) } as ItemResult;
      } catch (e) {
        lastErr = String((e as Error).message ?? e).slice(0, 200);
        if (/spend cap/.test(lastErr)) break;
      }
    }
    return { id: it.id, verdict: null, prob: null, reasoning: "", dealbreaker: false, reasoningFirst: false, error: lastErr, cached: false, ...scoreOf(it, null, null) };
  });
}

export const meanOf = (rs: { score: number }[]) => (rs.length ? rs.reduce((s, r) => s + r.score, 0) / rs.length : 0);
