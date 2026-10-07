// PASS 3: deep review. Runs on candidates that survived passes 1-2 (in the engine) or on every
// item (in the evals, for comparison). Compared with passes 1-2 it sees MORE context (judgeContext.ts
// "private" visibility: every fact with basis, source, confidence and age; connected-source
// summaries; presence and schedule overlap; edges, mutual contacts and the warm path; recent
// proposals, declines and feedback; capacity and preferences; agent_private context for internal
// judgment only, canary tokens redacted), uses an explicit rubric with more criteria, and writes an
// evidence review, steelman FOR and AGAINST, rubric, synthesis and cited facts, THEN the verdict
// (yes / no / insufficient_information + the one question to ask), THEN the calibrated confidence,
// and LAST member-facing text (shareable facts only).
// Hard filters always win: this pass can only remove candidates, never add one, and `hardGate`
// re-checks minors, blocks, safety holds and opt-ins after the model (the model cannot override).
//
// pass3-deep-v3 (2026-10-07) did not beat v2 on the held-out test split
// (docs/results/2026-10-07-judge-v2.md); the engine ships v2. The v3 text is kept only for the
// evals' historical replay, in packages/evals/src/historicalPrompts.ts.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import { privateVocabulary } from "./explain.ts";
import { involvesMinor } from "./filters.ts";
import {
  attendingRefs, checkMemberFacing, CITATION_RULES, JUDGING_NOTES, passMessages, ReplyFields, runPass, STALE_DAYS, str,
  type CitedFact, type PassVerdict,
} from "./judgeCommon.ts";
import { buildPassContext, type DeepContext } from "./judgeContext.ts";
import type { Candidate } from "./types.ts";
import { pairKey, type World } from "./world.ts";

/** The engine's pass-3 prompt version (cache key). */
export const DEEP_PROMPT_VERSION = "pass3-deep-v2";

export const RUBRIC_KEYS = [
  "mutual_benefit", "reciprocity", "intent_timing", "logistics", "stage_fit", "values_energy", "novelty", "evidence_quality", "risk_safety",
] as const;
export type RubricKey = typeof RUBRIC_KEYS[number];

/** pass3-deep-v2: the engine's pass-3 system prompt. */
export const DEEP_SYSTEM = `You are the final reviewer (third pass) for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone opted in) dating. Earlier passes found this configuration plausible; your job is discernment: catch the ones that only look good, and do not guess when one question would settle it.
You get much richer context than earlier passes: every visible fact with its basis ("stated" = the member said it; "confirmed" = from a connected source and confirmed by the member; "observed" = taken from a connected source, unconfirmed; "inferred" = derived or guessed, can be wrong; "vouched" = an inviter said it), source, confidence and age in days (older_than_180_days marks facts older than ${STALE_DAYS} days, which may no longer be true); presence and schedule overlap; relationships, mutual contacts and the warm path; recent proposals, declines and feedback; each person's state, capacity and preferences; and private context.
Private context ("private_context_never_quote") may inform your judgment, but you must never mention, hint at or paraphrase it in member_why or question_to_ask. In your internal fields refer to it only generically (e.g. "a private boundary of P2 about venues").
Hard filters (age, blocks, opt-ins, safety holds) are enforced by code; you cannot override them. Most candidates are NOT good: be a skeptical friend who protects members' attention.
${JUDGING_NOTES}

Rubric (integers 1-5, higher is always better):
- mutual_benefit: 1 = nobody clearly gains; 3 = modest gains; 5 = every attending person gets something specific they want.
- reciprocity: 1 = one-sided (one gives, the other takes; someone may feel used); 5 = balanced, or the asymmetry is explicitly welcome (e.g. a stated offer to help or mentor).
- intent_timing: 1 = no live intent behind it, or vague / expiring; 5 = answers a specific, current intent within the window.
- logistics: 1 = cannot realistically meet (city, no overlap, travel beyond limits, quiet hours, trips); 5 = same area, ample overlap.
- stage_fit: career/life stage and seniority fit for THIS purpose; 3 if irrelevant or unknown.
- values_energy: values, energy, preferred formats and vibe signals (including private boundaries); 1 = clash, 5 = clearly compatible.
- novelty: 1 = redundant (already close, or recently proposed / declined together); 5 = a valuable new tie.
- evidence_quality: 1 = thin, stale or inferred-only evidence; 5 = several fresh facts that members stated or confirmed.
- risk_safety: 1 = serious concern (pressure, exploitation, safety, a violated boundary); 5 = no concern.

Write the JSON keys in EXACTLY this order (explanation first, verdict after, member-facing text last):
1. "evidence_review": which facts are strong (stated/confirmed, fresh) and which are thin, stale or inferred-only. ${CITATION_RULES}
2. "steelman_for": the strongest honest case FOR proposing it, citing facts.
3. "steelman_against": the strongest honest case AGAINST, citing facts.
4. "rubric": {"mutual_benefit":n,"reciprocity":n,"intent_timing":n,"logistics":n,"stage_fit":n,"values_energy":n,"novelty":n,"evidence_quality":n,"risk_safety":n}
5. "would_thank_us": for each ATTENDING ref, "yes", "no" or "unsure": would this person thank the Network for this intro afterwards?
6. "reasoning": 2-4 sentences weighing the case for against the case against, and deciding.
7. "cited_facts": at most 8: [{"ref":"P1","field":"facts[2]","fact":"..."}].
8. "verdict": "yes" (propose), "no", or "insufficient_information". Rules: say "yes" only if every attending person would plausibly thank us and nothing scores 1 on mutual_benefit, logistics or risk_safety. Use "insufficient_information" rarely (well under one candidate in ten): ONLY when the case for yes is strong AND one specific missing fact would flip it AND one short question to one member would get it; otherwise decide. Never use it for format or opt-in questions. Thin evidence that does not hinge on one fact means a lower match_probability, usually "no".
9. "question_to_ask": when the verdict is "insufficient_information", {"ref":"P1","question":"..."}: one short, friendly question to that member that would settle it, using no private context and nothing about the other people's do-not-quote facts; otherwise null.
10. "match_probability": your calibrated probability (0-1) that this is a genuinely good, mutually wanted opportunity. Calibrated means: of the configurations you give 0.7, about 7 in 10 should go well. Thin, stale or inferred-only evidence pulls it down.
11. "member_why": LAST. If the verdict is "yes", for each attending ref one or two warm sentences using ONLY facts with visibility "shareable" and the logistics; otherwise "" for each ref. No names, ids, ages, contact details, do-not-quote facts or private context.
Return ONLY the JSON object.`;

/** Pass-3 messages on the "private" context (pass3-deep-v2). */
export function buildDeepMessages(w: World, c: Candidate): { messages: ChatMessage[]; refs: Record<string, MemberId>; context: DeepContext } {
  const { context, refs } = buildPassContext(w, c, "private");
  return { refs, context: context as DeepContext, messages: passMessages(DEEP_SYSTEM, context) };
}

export interface DeepVerdict {
  pass: 3;
  evidenceReview: string; steelmanFor: string; steelmanAgainst: string;
  rubric: Record<RubricKey, number>;
  wouldThankUs: Record<string, "yes" | "no" | "unsure">;
  reasoning: string; citedFacts: CitedFact[];
  verdict: PassVerdict;
  question?: { ref: string; question: string };
  matchProbability: number;
  /** Raw member-facing text by ref. Use `gateMemberFacing` before showing any of it. */
  memberWhy: Record<string, string>;
  reasoningFirst: boolean;
}

/** Validate a raw pass-3 reply. Throws on schema errors (counted as parse failures). */
export function parseDeepVerdict(raw: unknown, attending: string[]): DeepVerdict {
  const f = new ReplyFields(raw, "not an object");
  const o = f.o;
  const steelmanFor = f.text("steelman_for"), steelmanAgainst = f.text("steelman_against"), reasoning = f.text("reasoning");
  const verdict = f.verdict(true);
  const mp = f.prob("match_probability");
  const rubric = {} as Record<RubricKey, number>;
  for (const k of RUBRIC_KEYS) { const v = f.score(o.rubric?.[k], `rubric.${k}`); if (v !== undefined) rubric[k] = Math.round(v); }
  f.done("schema: ", ", ");
  const thank: Record<string, "yes" | "no" | "unsure"> = {};
  for (const r of attending) {
    const t = String(o.would_thank_us?.[r] ?? "unsure").toLowerCase();
    thank[r] = t === "yes" || t === "no" ? t : "unsure";
  }
  const q = o.question_to_ask && typeof o.question_to_ask === "object" ? { ref: str(o.question_to_ask.ref, 12), question: str(o.question_to_ask.question, 400) } : undefined;
  const why: Record<string, string> = {};
  for (const r of attending) why[r] = typeof o.member_why === "object" && o.member_why ? str(o.member_why[r], 600) : "";
  return {
    pass: 3, evidenceReview: str(o.evidence_review), steelmanFor, steelmanAgainst, rubric, wouldThankUs: thank,
    reasoning, citedFacts: f.citedFacts(), verdict: verdict!,
    ...(q && q.question ? { question: q } : {}), matchProbability: mp!, memberWhy: why,
    reasoningFirst: f.reasoningFirst(["steelman_for", "steelman_against", "reasoning"]),
  };
}

/** Pass-3 decision: "yes" only. "insufficient_information" is an abstention (never a proposal). */
export const deepDecision = (v: DeepVerdict) => v.verdict === "yes";

/**
 * Hard gate applied AFTER any model verdict (the model can never override it): minors in any role,
 * blocks (incl. with the connector), safety holds, category and romance opt-ins of attending people.
 * Returns the first failing reason or null.
 */
export function hardGate(w: World, c: Pick<Candidate, "participants" | "via" | "category"> & { alternates?: MemberId[] }): string | null {
  if (involvesMinor(w, { participants: c.participants, alternates: c.alternates ?? [], via: c.via })) return "underage";
  const everyone = [...c.participants, ...(c.via ? [c.via] : [])];
  for (const id of everyone) if (!w.get(id)) return "unknown_member";
  for (const id of everyone) if (w.holds.has(id)) return "safety_hold";
  for (let i = 0; i < everyone.length; i++) for (let j = i + 1; j < everyone.length; j++) if (w.blocked.has(pairKey(everyone[i]!, everyone[j]!))) return "blocked";
  for (const id of c.participants) {
    const m = w.get(id)!.m;
    if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
    if (!m.prefs.categoriesOptIn.includes(c.category)) return "category_opt_out";
  }
  return null;
}

/**
 * Member-facing text from a deep verdict, keyed by member id, keeping only text that passes the
 * deterministic leak gate (canaries, words found only in non-shareable or private facets, contact
 * details). Rejected text is dropped (callers fall back to template explanations).
 */
export function gateMemberFacing(w: World, c: Candidate, v: DeepVerdict, refs: Record<string, MemberId>): { why: Record<MemberId, string>; rejected: { ref: string; reasons: string[] }[] } {
  const vocab = privateVocabulary(w, [...c.participants, ...(c.via ? [c.via] : [])]);
  const why: Record<MemberId, string> = {};
  const rejected: { ref: string; reasons: string[] }[] = [];
  if (v.verdict !== "yes") return { why, rejected };
  for (const [ref, text] of Object.entries(v.memberWhy)) {
    if (!text) continue;
    const chk = checkMemberFacing(text, vocab);
    if (chk.ok && refs[ref]) why[refs[ref]!] = text; else rejected.push({ ref, reasons: chk.reasons });
  }
  return { why, rejected };
}

export async function deepReviewOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<{ verdict: DeepVerdict; refs: Record<string, MemberId> }> {
  const { messages, refs } = buildDeepMessages(w, c);
  const attending = attendingRefs(refs, c);
  return { verdict: await runPass(llm, messages, raw => parseDeepVerdict(raw, attending), maxTokens), refs };
}
