// PASS 1: the screen (PRD 33.6: "a cheap model pre-screens"). One call per candidate on the
// "public" view (judgeContext.ts buildPublicView: shareable facets, matchable facets marked
// do-not-quote, active intents, presence, stated age, participation state, stated preferences,
// explicit edges; never agent_private / opportunity_specific facets, hidden truth, names or ids).
// The model writes a fact-citing explanation FIRST, then the dealbreaker check, the verdict, the
// confidence (match_probability), and only last a short member-facing "why" (shareable items only).
//
// pass1-screen-v3 (2026-10-07) won on the dev split but lost on the held-out test split
// (docs/results/2026-10-07-judge-v2.md); the engine ships v2. The v3 text is kept only for the
// evals' historical replay, in packages/evals/src/historicalPrompts.ts.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { attendingRefs, passMessages, ReplyFields, runPass, str, type CitedFact, type PassVerdict } from "./judgeCommon.ts";
import { buildPublicView, screenConfigOf, type PublicView } from "./packs/network/judgeContext.ts";
import type { Candidate } from "./types.ts";
import { judgePackOf } from "./pack.ts";
import { SCREEN_SYSTEM } from "./packs/network/prompts.ts";
import type { World } from "./world.ts";

// The Network's pass-1 prompt moved verbatim to packs/network/prompts.ts (networkPack.judge.screen).
export { SCREEN_PROMPT_VERSION, SCREEN_SYSTEM } from "./packs/network/prompts.ts";

/** Messages for pass 1. Takes ONLY the public view (the refs map is dropped). */
export function screenMessages(view: PublicView, system: string = SCREEN_SYSTEM): ChatMessage[] {
  const { refs: _refs, ...visible } = view;
  return passMessages(system, visible);
}

export interface ScreenVerdict {
  pass: 1;
  reasoning: string;
  citedFacts: CitedFact[];
  dealbreaker: boolean;
  dealbreakerReason?: string;
  verdict: PassVerdict;
  matchProbability: number;
  /** Keyed by participant ref (P1, P2, ...). */
  acceptProbability: Record<string, number>;
  /** Member-facing text (shareable only); must still pass the leak gate before use. */
  memberWhy: string;
  /** The model wrote its explanation before its verdict (JSON key order). */
  reasoningFirst: boolean;
}

/** Validate a raw pass-1 reply. Throws on schema errors (counted as parse failures). */
export function parseScreenVerdict(raw: unknown, attending: string[]): ScreenVerdict {
  const f = new ReplyFields(raw, "not an object");
  const o = f.o;
  const reasoning = f.text("reasoning");
  const verdict = f.verdict(false);
  const mp = f.prob("match_probability");
  f.bool("dealbreaker");
  const acc: Record<string, number> = {};
  for (const r of attending) { const p = f.prob(`accept_probability.${r}`, o.accept_probability?.[r]); if (p !== undefined) acc[r] = p; }
  f.done("schema: ", ", ");
  return {
    pass: 1, reasoning, citedFacts: f.citedFacts(), dealbreaker: o.dealbreaker,
    dealbreakerReason: str(o.dealbreaker_reason, 300) || undefined, verdict: verdict!, matchProbability: mp!,
    acceptProbability: acc, memberWhy: str(o.member_why ?? o.why, 600),
    reasoningFirst: f.reasoningFirst(),
  };
}

/** Pass-1 decision: yes only if verdict is yes and there is no dealbreaker. */
export const screenDecision = (v: ScreenVerdict) => v.verdict === "yes" && !v.dealbreaker;

/**
 * The snapshot pass 1 reads (engine-pipeline-24): member ids canonical (aliases resolved, as the
 * World does) and only live intents (status active, inside their horizon), so the screen never
 * judges on expired wants or misses an aliased member's facts.
 */
export function screenSnapshot(w: World): World["input"] {
  const C = w.canonical, now = w.now;
  const inp = w.input;
  return {
    ...inp,
    facets: inp.facets.map(f => ({ ...f, memberId: C(f.memberId) })),
    intents: inp.intents.filter(i => i.status === "active" && i.createdAt + i.horizonDays * DAY > now).map(i => ({ ...i, memberId: C(i.memberId) })),
    presence: inp.presence.map(p => ({ ...p, memberId: C(p.memberId) })),
    edges: inp.edges.map(e => ({ ...e, from: C(e.from), to: C(e.to) })),
  };
}

export async function screenOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<{ verdict: ScreenVerdict; refs: Record<string, MemberId> }> {
  const view = buildPublicView(screenSnapshot(w), screenConfigOf(w, c));
  const attending = attendingRefs(view.refs, c);
  return { verdict: await runPass(llm, screenMessages(view, judgePackOf(w).screen!.system), raw => parseScreenVerdict(raw, attending), maxTokens), refs: view.refs };
}
