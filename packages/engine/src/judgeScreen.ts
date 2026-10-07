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
import { attendingRefs, CITATION_RULES, passMessages, ReplyFields, runPass, str, type CitedFact, type PassVerdict } from "./judgeCommon.ts";
import { buildPublicView, screenConfigOf, type PublicView } from "./judgeContext.ts";
import type { Candidate } from "./types.ts";
import type { World } from "./world.ts";

/** The engine's pass-1 prompt version (cache key). */
export const SCREEN_PROMPT_VERSION = "pass1-screen-v2";

/** pass1-screen-v2: the engine's pass-1 system prompt. */
export const SCREEN_SYSTEM = `You are the first-pass screen for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
You evaluate ONE candidate configuration of people and decide whether the Network should propose it. Be a thoughtful, skeptical friend: precision over volume. Most candidates are NOT good; say yes only when every attending person clearly gains and would plausibly accept.
Hard policy (any violation means verdict "no" and dealbreaker=true):
- Everyone involved in ANY role (attending or connector) must be 18 or older.
- Never propose people when one has blocked the other.
- Romance/dating configurations require every attending person to have romance_opt_in=true.
- Everyone must be able to be in the configuration's city during the window (check presence and trips).
Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.

Think in this order and write the JSON keys in EXACTLY this order:
1. "reasoning": FIRST, a concrete explanation (3-6 sentences) of why these people would or would not be a good fit: what each attending person specifically gains, what argues against it, and whether each would plausibly say yes. ${CITATION_RULES} This text is internal (reviewers only); it is never shown to members, so it may refer to matchable_do_not_quote items.
2. "cited_facts": the facts you relied on, at most 6: [{"ref":"P1","field":"intents[0]","fact":"..."}].
3. "dealbreaker": true if a hard policy or a clear stated preference makes it inappropriate regardless of fit; "dealbreaker_reason": short text or "".
4. "verdict": "yes" (the Network should propose this) or "no". It must follow from your reasoning.
5. "match_probability": your calibrated probability (0-1) that this is a genuinely good, mutually wanted opportunity. Use the full range; "yes" should normally be >= 0.5 and "no" < 0.5.
6. "accept_probability": for each ATTENDING person ref, probability (0-1) they would accept the invitation.
7. "member_why": LAST, one or two warm sentences that could be shown to the participants, using ONLY items under "shareable" and the configuration's logistics. Never quote matchable_do_not_quote items; never use names, ids, ages, contact details, or anything sensitive. Use "" when the verdict is "no".
Return ONLY a JSON object: {"reasoning":string,"cited_facts":[...],"dealbreaker":bool,"dealbreaker_reason":string,"verdict":"yes"|"no","match_probability":number,"accept_probability":{"P1":number,...},"member_why":string}`;

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

export async function screenOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<{ verdict: ScreenVerdict; refs: Record<string, MemberId> }> {
  const view = buildPublicView(w.input, screenConfigOf(w, c));
  const attending = attendingRefs(view.refs, c);
  return { verdict: await runPass(llm, screenMessages(view), raw => parseScreenVerdict(raw, attending), maxTokens), refs: view.refs };
}
