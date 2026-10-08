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
  attendingRefs, checkMemberFacing, passMessages, ReplyFields, runPass, str,
  type CitedFact, type PassVerdict,
} from "./judgeCommon.ts";
import type { DeepContext } from "./packs/network/judgeContext.ts";
import type { Candidate } from "./types.ts";
import { judgePackOf } from "./pack.ts";
import { pairKey, type World } from "./world.ts";

// The Network's pass-3 prompt moved verbatim to packs/network/prompts.ts (networkPack.judge.deep).
export { DEEP_PROMPT_VERSION, DEEP_SYSTEM } from "./packs/network/prompts.ts";

export const RUBRIC_KEYS = [
  "mutual_benefit", "reciprocity", "intent_timing", "logistics", "stage_fit", "values_energy", "novelty", "evidence_quality", "risk_safety",
] as const;
export type RubricKey = typeof RUBRIC_KEYS[number];

/** Pass-3 messages on the "private" context (pass3-deep-v2). */
export function buildDeepMessages(w: World, c: Candidate): { messages: ChatMessage[]; refs: Record<string, MemberId>; context: DeepContext } {
  const jp = judgePackOf(w);
  const { context, refs } = jp.buildContext(w, c, "private");
  return { refs, context: context as DeepContext, messages: passMessages(jp.deep!.system, context) };
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
  // Pack part (after the core gate above; a pack can only add reasons). networkPack: romance and category opt-ins.
  return judgePackOf(w).hardGate?.(w, c) ?? null;
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
