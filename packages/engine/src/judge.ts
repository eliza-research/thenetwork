// PASS 2: the rubric judge for the top configurations (Section 33.6, 33.7). Receives scrubbed,
// scope-limited profiles (pseudonymous refs, no agent_private or opportunity_specific facets).
// Output order (judge-v2): a fact-citing internal explanation FIRST, then per-dimension scores
// with calibration anchors, the dealbreaker flag, the verdict, the confidence (match_probability,
// certainty), and LAST a short shareable "why" per participant (the only member-facing text,
// which explain.ts accepts only if it passes the leak checker). Verdicts are cached by participant
// profile revisions and expire (ME-008: no permanent zeros). Failures are never cached.
// Pass 1 (screen) is judgeScreen.ts; pass 3 (deep review) is judgeDeep.ts.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { parseJson } from "@thenetwork/core";
import { CITATION_RULES, JUDGING_NOTES, keyOrderOk, parseCitedFacts, parsePassVerdict, prob, str } from "./judgeCommon.ts";
import { sha256 } from "./rng.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import type { World } from "./world.ts";

export const JUDGE_PROMPT_VERSION = "judge-v2.1";

export class JudgeCache<V = JudgeVerdict> {
  private m = new Map<string, { verdict: V; at: number }>();
  constructor(public ttlMs: number) {}
  get(key: string, now: number): V | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttlMs || now < e.at) { this.m.delete(key); return undefined; }
    return e.verdict;
  }
  set(key: string, verdict: V, now: number) { this.m.set(key, { verdict, at: now }); }
  get size() { return this.m.size; }
  /** Drop every entry involving a member whose profile changed (keys also embed revisions). */
  clear() { this.m.clear(); }
}

export function judgeCacheKey(w: World, c: Candidate, version = JUDGE_PROMPT_VERSION): string {
  const parts = [...c.participants].sort().map(id => `${id}@${w.get(id)?.revision ?? "?"}`);
  return sha256(`${version}|${c.kind}|${c.category}|${c.anchor?.type}:${c.anchor?.id}|${parts.join(",")}`).slice(0, 24);
}

export const JUDGE_SYSTEM = `You are the matching judge for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when both opted in) dating.
You evaluate ONE proposed configuration of people. Be a thoughtful, skeptical friend: precision over volume. Most candidates should NOT be proposed.
${JUDGING_NOTES}

Think in this order and write the JSON keys in EXACTLY this order:
1. "reasoning": FIRST, a concrete explanation (3-6 sentences) of why these people would or would not be a good fit: what each participant specifically gains, what argues against it, and whether each would plausibly say yes. ${CITATION_RULES} This text is internal (reviewers only) and never shown to members, so it may refer to context_do_not_quote items.
2. "cited_facts": the facts you relied on, at most 6: [{"ref":"P1","field":"shareable[0]","fact":"..."}].
3. Dimension scores, each an integer 1-5, using these anchors:
- fit: 1 = no real connection to anyone's stated wants; 3 = plausible but generic; 5 = specific, clearly what they asked for.
- mutual_value: 1 = only one side gains; 3 = both gain something modest; 5 = everyone clearly gains.
- capacity_realism: 1 = asks far more than people can give; 5 = light, realistic ask.
- timing: 1 = bad timing / no window; 5 = natural timing.
- social_comfort: 1 = likely awkward or uncomfortable; 5 = easy and comfortable.
- red_flags: 1 = none; 3 = some concern; 5 = serious concern (safety, pressure, exploitation).
4. "dealbreaker": true only if something makes this configuration inappropriate regardless of score (e.g. a stated boundary is violated, unsafe setting, one side clearly would not want it); "dealbreaker_reason": short text or "".
5. "verdict": "yes" (propose it) or "no". It must follow from your reasoning and scores.
6. Confidence: "match_probability" = your calibrated probability (0-1) that this is a genuinely good, mutually wanted opportunity ("yes" normally >= 0.5); "certainty" = integer 1-5 (1 = guessing, 5 = very sure).
7. "why": LAST, for each participant ref, one or two warm sentences addressed to that participant explaining why they might enjoy this, using ONLY items listed under "shareable". Never mention or hint at anything listed under "context_do_not_quote". No names, no contact details. This is the only text members may see.
Return ONLY a JSON object: {"reasoning":string,"cited_facts":[...],"fit":n,"mutual_value":n,"capacity_realism":n,"timing":n,"social_comfort":n,"red_flags":n,"dealbreaker":bool,"dealbreaker_reason":string,"verdict":"yes"|"no","match_probability":number,"certainty":n,"why":{"P1":string,...}}`;

export function buildJudgeMessages(w: World, c: Candidate): { messages: ChatMessage[]; refs: Record<string, MemberId> } {
  const refs: Record<string, MemberId> = {};
  const people = c.participants.map((id, i) => {
    const ref = `P${i + 1}`;
    refs[ref] = id;
    const mi = w.get(id)!;
    return {
      ref, role: c.roles[id] ?? "peer", state: mi.m.state, preferred_formats: mi.m.prefs.formats,
      shareable: mi.share.filter(f => f.kind !== "boundary").map(f => `${f.kind}: ${f.value}`).slice(0, 8),
      context_do_not_quote: mi.match.filter(f => f.scope === "matchable").map(f => `${f.kind}: ${f.value}`).slice(0, 6),
      own_request: c.anchor?.type === "intent" && w.intentById.get(c.anchor.id)?.memberId === id
        ? `${w.intentById.get(c.anchor.id)!.objective}` : undefined,
    };
  });
  const user = {
    configuration: {
      kind: c.kind, category: c.category, format: c.format, objective: c.objective,
      window_hours: c.window ? Math.round((c.window.end - c.window.start) / 3_600_000) : undefined,
      safety_class: c.safetyClass, existing_warm_ties: c.participants.length > 1 ? countWarm(w, c.participants) : 0,
    },
    participants: people,
  };
  return { refs, messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: JSON.stringify(user) }] };
}

function countWarm(w: World, ids: MemberId[]) {
  let n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (w.isWarm(ids[i]!, ids[j]!)) n++;
  return n;
}

const DIMS = ["fit", "mutual_value", "capacity_realism", "timing", "social_comfort", "red_flags", "certainty"] as const;

/** Validate and normalise a raw judge reply. Throws with a list of schema errors. */
export function parseVerdict(raw: unknown, refs: Record<string, MemberId>): JudgeVerdict {
  const errors: string[] = [];
  const o = raw as Record<string, any>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("judge verdict: not an object");
  const n: Record<string, number> = {};
  for (const d of DIMS) {
    const v = Number(o[d]);
    if (!Number.isFinite(v) || v < 1 || v > 5) errors.push(`${d} must be a number 1-5 (got ${JSON.stringify(o[d])})`);
    else n[d] = (v - 1) / 4;
  }
  if (typeof o.dealbreaker !== "boolean") errors.push("dealbreaker must be boolean");
  const reasoning = str(o.reasoning);
  if (!reasoning) errors.push("reasoning must be a non-empty string (written before the verdict)");
  const verdict = parsePassVerdict(o.verdict, false) as "yes" | "no" | undefined;
  if (!verdict) errors.push(`verdict must be "yes" or "no" (got ${JSON.stringify(o.verdict)})`);
  const mp = prob(o.match_probability);
  if (mp === undefined) errors.push("match_probability must be a probability 0-1");
  const why: Record<MemberId, string> = {};
  const whyObj = o.why && typeof o.why === "object" && !Array.isArray(o.why) ? o.why as Record<string, unknown> : undefined;
  // A "no" verdict needs no member-facing text (it will never be shown).
  if (!whyObj && verdict !== "no") errors.push("why must be an object keyed by participant ref");
  for (const ref of Object.keys(refs)) {
    const t = whyObj?.[ref];
    if (typeof t === "string" && t.trim()) why[refs[ref]!] = t.trim().slice(0, 400);
    else if (whyObj && verdict !== "no") errors.push(`why.${ref} missing`);
  }
  if (errors.length) throw new Error(`judge verdict schema: ${errors.join("; ")}`);
  return {
    fit: n.fit!, mutualValue: n.mutual_value!, capacityRealism: n.capacity_realism!, timing: n.timing!,
    socialComfort: n.social_comfort!, redFlags: n.red_flags!, certainty: n.certainty!,
    dealbreaker: o.dealbreaker, dealbreakerReason: typeof o.dealbreaker_reason === "string" ? o.dealbreaker_reason : undefined, why,
    reasoning, citedFacts: parseCitedFacts(o.cited_facts), verdict, matchProbability: mp,
    reasoningFirst: keyOrderOk(o, ["reasoning"], "verdict"),
  };
}

export async function judgeOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<JudgeVerdict> {
  const { messages, refs } = buildJudgeMessages(w, c);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.chat(messages, { maxTokens, temperature: 0.2, json: true });
      return parseVerdict(parseJson(out), refs);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export interface JudgeRunStats { calls: number; cacheHits: number; failures: number }

/**
 * Run one judgment pass over candidates with caching and bounded concurrency (shared by all three
 * passes). Returns key -> verdict (null on failure). Failures are never cached (ME-008).
 */
export async function runCachedPass<V>(w: World, cands: Candidate[], version: string, cache: JudgeCache<V>, stats: JudgeRunStats,
  judge: (c: Candidate) => Promise<V>, log: { key: string; cacheKey: string; verdict: V | null; cached: boolean }[]): Promise<Map<string, V | null>> {
  const out = new Map<string, V | null>();
  const hits = new Set<string>();
  const queue = [...cands];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()!;
      const ck = judgeCacheKey(w, c, version);
      const hit = cache.get(ck, w.now);
      if (hit) { stats.cacheHits++; hits.add(c.key); out.set(c.key, hit); continue; }
      stats.calls++;
      try {
        const v = await judge(c);
        cache.set(ck, v, w.now);
        out.set(c.key, v);
      } catch {
        stats.failures++;
        out.set(c.key, null); // not cached: a noisy failure must not stick (ME-008)
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, w.cfg.judge.concurrency) }, worker));
  // Deterministic log order.
  for (const c of [...cands].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    log.push({ key: c.key, cacheKey: judgeCacheKey(w, c, version), verdict: out.get(c.key) ?? null, cached: hits.has(c.key) });
  }
  return out;
}

/** Pass 2 over candidates. Returns key -> verdict (null on failure). */
export async function judgeCandidates(w: World, cands: Candidate[], llm: LLM, cache: JudgeCache, stats: JudgeRunStats,
  log: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[]): Promise<Map<string, JudgeVerdict | null>> {
  return runCachedPass(w, cands, JUDGE_PROMPT_VERSION, cache, stats, c => judgeOne(w, c, llm, w.cfg.judge.maxTokens), log);
}
