// Optional LLM judge for the top configurations (Section 33.6, 33.7). Receives scrubbed,
// scope-limited profiles (pseudonymous refs, no agent_private or opportunity_specific facets),
// returns per-dimension scores with calibration anchors, a separate dealbreaker flag, and a short
// shareable "why" per participant. Verdicts are cached by participant profile revisions and expire
// (ME-008: no permanent zeros). Failures are never cached.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { parseJson } from "@thenetwork/core";
import { sha256 } from "./rng.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import type { World } from "./world.ts";

export const JUDGE_PROMPT_VERSION = "judge-v1";

export class JudgeCache {
  private m = new Map<string, { verdict: JudgeVerdict; at: number }>();
  constructor(public ttlMs: number) {}
  get(key: string, now: number): JudgeVerdict | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttlMs || now < e.at) { this.m.delete(key); return undefined; }
    return e.verdict;
  }
  set(key: string, verdict: JudgeVerdict, now: number) { this.m.set(key, { verdict, at: now }); }
  get size() { return this.m.size; }
  /** Drop every entry involving a member whose profile changed (keys also embed revisions). */
  clear() { this.m.clear(); }
}

export function judgeCacheKey(w: World, c: Candidate): string {
  const parts = [...c.participants].sort().map(id => `${id}@${w.get(id)?.revision ?? "?"}`);
  return sha256(`${JUDGE_PROMPT_VERSION}|${c.kind}|${c.category}|${c.anchor?.type}:${c.anchor?.id}|${parts.join(",")}`).slice(0, 24);
}

const SYSTEM = `You are the matching judge for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when both opted in) dating.
You evaluate ONE proposed configuration of people. Be a thoughtful, skeptical friend: precision over volume.
Score each dimension as an integer 1-5 using these anchors:
- fit: 1 = no real connection to anyone's stated wants; 3 = plausible but generic; 5 = specific, clearly what they asked for.
- mutual_value: 1 = only one side gains; 3 = both gain something modest; 5 = everyone clearly gains.
- capacity_realism: 1 = asks far more than people can give; 5 = light, realistic ask.
- timing: 1 = bad timing / no window; 5 = natural timing.
- social_comfort: 1 = likely awkward or uncomfortable; 5 = easy and comfortable.
- red_flags: 1 = none; 3 = some concern; 5 = serious concern (safety, pressure, exploitation).
- certainty: 1 = guessing; 5 = very sure.
Set "dealbreaker": true only if something makes this configuration inappropriate regardless of score (e.g. a stated boundary is violated, unsafe setting, one side clearly would not want it).
For each participant ref, write "why": one or two warm sentences addressed to that participant explaining why they might enjoy this, using ONLY items listed under "shareable". Never mention or hint at anything listed under "context_do_not_quote". No names, no contact details.
Return ONLY a JSON object: {"fit":n,"mutual_value":n,"capacity_realism":n,"timing":n,"social_comfort":n,"red_flags":n,"certainty":n,"dealbreaker":bool,"dealbreaker_reason":string,"why":{"P1":string,...}}`;

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
  return { refs, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(user) }] };
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
  const why: Record<MemberId, string> = {};
  if (!o.why || typeof o.why !== "object") errors.push("why must be an object keyed by participant ref");
  else for (const ref of Object.keys(refs)) {
    if (typeof o.why[ref] !== "string" || !o.why[ref].trim()) errors.push(`why.${ref} missing`);
    else why[refs[ref]!] = String(o.why[ref]).trim().slice(0, 400);
  }
  if (errors.length) throw new Error(`judge verdict schema: ${errors.join("; ")}`);
  return {
    fit: n.fit!, mutualValue: n.mutual_value!, capacityRealism: n.capacity_realism!, timing: n.timing!,
    socialComfort: n.social_comfort!, redFlags: n.red_flags!, certainty: n.certainty!,
    dealbreaker: o.dealbreaker, dealbreakerReason: typeof o.dealbreaker_reason === "string" ? o.dealbreaker_reason : undefined, why,
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

/** Judge candidates with caching and bounded concurrency. Returns key -> verdict (null on failure). */
export async function judgeCandidates(w: World, cands: Candidate[], llm: LLM, cache: JudgeCache, stats: JudgeRunStats,
  log: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[]): Promise<Map<string, JudgeVerdict | null>> {
  const out = new Map<string, JudgeVerdict | null>();
  const queue = [...cands];
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()!;
      const ck = judgeCacheKey(w, c);
      const hit = cache.get(ck, w.now);
      if (hit) { stats.cacheHits++; out.set(c.key, hit); continue; }
      stats.calls++;
      try {
        const v = await judgeOne(w, c, llm, w.cfg.judge.maxTokens);
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
    const ck = judgeCacheKey(w, c);
    log.push({ key: c.key, cacheKey: ck, verdict: out.get(c.key) ?? null, cached: false });
  }
  return out;
}
