// PASS 2: the rubric judge for the top configurations (Section 33.6, 33.7). Output order: a
// fact-citing internal explanation FIRST, then per-dimension scores with calibration anchors, the
// dealbreaker flag, the verdict, the confidence (match_probability, certainty), and LAST a short
// shareable "why" per participant (the only member-facing text, which explain.ts accepts only if
// it passes the leak checker). Verdicts are cached by participant profile revisions and expire
// (ME-008: no permanent zeros). Failures are never cached.
//
// Input (judgeContext.ts): "matchable" visibility = pass 3's context minus private context
// (judge-v3, the default, `judge.pass2Context = "deep"`), or the "compact" scrubbed profile
// (judge-v2.1, `pass2Context = "compact"`). judge-v3 beat judge-v2.1 on the held-out test split
// (docs/results/2026-10-07-judge-v2.md); v2.1 stays only because the config can still select it.
//
// Also here: the pass decisions and the pipeline decision the evals score (pass2Accepts,
// passOutcome, pipelineDecision), so the evals measure the engine's rules instead of copying them.
import type { ChatMessage, LLM, MemberId } from "@thenetwork/core";
import type { EngineConfig } from "./config.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { JudgeCache, passCacheKey, passMessages, ReplyFields, runCachedPass, runPass, type JudgeRunStats } from "./judgeCommon.ts";
import { judgePackOf } from "./pack.ts";
import { deepDecision, type DeepVerdict } from "./judgeDeep.ts";
import { screenDecision, type ScreenVerdict } from "./judgeScreen.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import { JUDGE_PROMPT_VERSION } from "./packs/network/prompts.ts";
import type { World } from "./world.ts";

// The Network's pass-2 prompts moved verbatim to packs/network/prompts.ts (networkPack.judge.rubric);
// re-exported so existing imports keep working. The engine reads the World's pack.
export { JUDGE_PROMPT_VERSION, JUDGE_PROMPT_VERSION_V3, JUDGE_SYSTEM, JUDGE_SYSTEM_V3 } from "./packs/network/prompts.ts";

export { JudgeCache, runCachedPass, type JudgeRunStats } from "./judgeCommon.ts";

export type JudgeVersion = "v2.1" | "v3";
/** Prompt version the engine uses for pass 2 under this config. */
export const judgeVersionOf = (w: World): JudgeVersion => (w.cfg.judge.pass2Context === "deep" ? "v3" : "v2.1");
/** The pack's pass-2 prompt for a version: "v3" reads the "matchable" context, "v2.1" the "compact" one. */
const rubricPass = (w: World, v: JudgeVersion) => judgePackOf(w).rubric[v === "v3" ? "matchable" : "compact"];

export function judgeCacheKey(w: World, c: Candidate, version = JUDGE_PROMPT_VERSION): string {
  return passCacheKey(w, c, version);
}

/** Pass-2 messages for the given prompt version (default: the engine config's choice). */
export function buildJudgeMessages(w: World, c: Candidate, version: JudgeVersion = judgeVersionOf(w)): { messages: ChatMessage[]; refs: Record<string, MemberId> } {
  const { context, refs } = judgePackOf(w).buildContext(w, c, version === "v3" ? "matchable" : "compact");
  return { refs, messages: passMessages(rubricPass(w, version).system, context) };
}

const DIMS = ["fit", "mutual_value", "capacity_realism", "timing", "social_comfort", "red_flags", "certainty"] as const;

/** Validate and normalise a raw judge reply. Throws with a list of schema errors. */
export function parseVerdict(raw: unknown, refs: Record<string, MemberId>): JudgeVerdict {
  const f = new ReplyFields(raw, "judge verdict: not an object");
  const o = f.o;
  const n: Record<string, number> = {};
  for (const d of DIMS) {
    const v = f.score(o[d], `${d} must be a number 1-5 (got ${JSON.stringify(o[d])})`);
    if (v !== undefined) n[d] = (v - 1) / 4;
  }
  f.bool("dealbreaker", "dealbreaker must be boolean");
  const reasoning = f.text("reasoning", "reasoning must be a non-empty string (written before the verdict)");
  const verdict = f.verdict(false, `verdict must be "yes" or "no" (got ${JSON.stringify(o.verdict)})`) as "yes" | "no" | undefined;
  const mp = f.prob("match_probability", o.match_probability, "match_probability must be a probability 0-1");
  const why: Record<MemberId, string> = {};
  const whyObj = o.why && typeof o.why === "object" && !Array.isArray(o.why) ? o.why as Record<string, unknown> : undefined;
  // A "no" verdict needs no member-facing text (it will never be shown).
  if (!whyObj && verdict !== "no") f.errs.push("why must be an object keyed by participant ref");
  for (const ref of Object.keys(refs)) {
    const t = whyObj?.[ref];
    if (typeof t === "string" && t.trim()) why[refs[ref]!] = t.trim().slice(0, 400);
    else if (whyObj && verdict !== "no") f.errs.push(`why.${ref} missing`);
  }
  f.done("judge verdict schema: ", "; ");
  return {
    fit: n.fit!, mutualValue: n.mutual_value!, capacityRealism: n.capacity_realism!, timing: n.timing!,
    socialComfort: n.social_comfort!, redFlags: n.red_flags!, certainty: n.certainty!,
    dealbreaker: o.dealbreaker, dealbreakerReason: typeof o.dealbreaker_reason === "string" ? o.dealbreaker_reason : undefined, why,
    reasoning, citedFacts: f.citedFacts(), verdict, matchProbability: mp,
    reasoningFirst: f.reasoningFirst(),
  };
}

export async function judgeOne(w: World, c: Candidate, llm: LLM, maxTokens: number): Promise<JudgeVerdict> {
  const { messages, refs } = buildJudgeMessages(w, c);
  return runPass(llm, messages, raw => parseVerdict(raw, refs), maxTokens, 0.2);
}

/** Pass 2 over candidates. Returns key -> verdict (null on failure). */
export async function judgeCandidates(w: World, cands: Candidate[], llm: LLM, cache: JudgeCache, stats: JudgeRunStats,
  log: { key: string; cacheKey: string; verdict: JudgeVerdict | null; cached: boolean }[]): Promise<Map<string, JudgeVerdict | null>> {
  return runCachedPass(w, cands, rubricPass(w, judgeVersionOf(w)).version, cache, stats, c => judgeOne(w, c, llm, w.cfg.judge.maxTokens), log);
}

// ---- decisions (engine rules, exported for the evals) ---------------------------------------------

/**
 * Pass 2 lets a configuration through: no dealbreaker, not a gated "no" (`judge.verdictGates`), and
 * every dimension at or above `floors.judgeDimension`. These are the judge checks of scoring.ts
 * floorViolation (which also applies the non-judge floors and the score threshold).
 */
export function pass2Accepts(v: JudgeVerdict, cfg: Pick<EngineConfig, "floors" | "judge"> = DEFAULT_CONFIG): boolean {
  if (v.dealbreaker) return false;
  if (v.verdict === "no" && cfg.judge.verdictGates) return false;
  return Math.min(v.fit, v.mutualValue, v.capacityRealism, v.timing, v.socialComfort) >= cfg.floors.judgeDimension;
}

export type PassName = "pass1" | "pass2" | "pass3";
export type PassOutcome = "yes" | "no" | "abstain";

/** One pass's decision as the engine applies it (pass 3 "insufficient_information" = abstain, never a proposal). */
export function passOutcome(pass: "pass1", v: ScreenVerdict): PassOutcome;
export function passOutcome(pass: "pass2", v: JudgeVerdict, cfg?: Pick<EngineConfig, "floors" | "judge">): PassOutcome;
export function passOutcome(pass: "pass3", v: DeepVerdict): PassOutcome;
export function passOutcome(pass: PassName, v: ScreenVerdict | JudgeVerdict | DeepVerdict, cfg?: Pick<EngineConfig, "floors" | "judge">): PassOutcome {
  if (pass === "pass1") return screenDecision(v as ScreenVerdict) ? "yes" : "no";
  if (pass === "pass2") return pass2Accepts(v as JudgeVerdict, cfg) ? "yes" : "no";
  const d = v as DeepVerdict;
  return d.verdict === "insufficient_information" ? "abstain" : deepDecision(d) ? "yes" : "no";
}

/**
 * The pipeline rule: a hard-gate reason rejects at once; then the passes in order, stopping at the
 * first outcome that is not "yes". A failed call (null) is skipped: it fails open to the previous
 * stage, as the engine does. Returns the decision, where it stopped and the passes reached.
 */
export function pipelineDecision<P extends string>(hardGate: string | null, stages: { pass: P; outcome: PassOutcome | null }[]):
  { decision: PassOutcome; stoppedAt: string; reached: P[] } {
  if (hardGate) return { decision: "no", stoppedAt: `hard_gate:${hardGate}`, reached: [] };
  const reached: P[] = [];
  for (const s of stages) {
    reached.push(s.pass);
    if (s.outcome === null) continue;
    if (s.outcome !== "yes") return { decision: s.outcome, stoppedAt: s.pass, reached };
  }
  return { decision: "yes", stoppedAt: "proposed", reached };
}
