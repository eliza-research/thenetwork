// peon.biz member-facing copy: the candidate-first probe, explanations, and the employer's slate.
// Criteria-based only: never a score, a rank or a percentile; never a candidate's name before the
// employer said yes; never anything sealed or a proxy. Every string still passes the core leak gate.
import type { MemberId } from "@thenetwork/core";
import type { Rng } from "../../rng.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { privateVocabulary } from "../../explain.ts";
import { checkMemberFacing } from "../../judgeCommon.ts";
import { mustChecks } from "./match.ts";
import { candidateOf, sides, type CandidateProfile, type JobProfile } from "./profile.ts";

/** Short words only (the leak gate ignores tokens under 4 letters), so it passes for any member. */
export const PEON_SAFE_FALLBACK = "A new job fit for you.";
const EMPLOYER_FALLBACK = "A new yes for your job.";
export const NEVER_ASKS = "We never ask for money, bank details or ID numbers.";
export const LANE_LABEL = { professional: "a job introduction" } as const;
export const LANE_ACTIVITY: Record<string, string> = { professional: "a role that fits what you asked for" };

const human = (s: string) => s.replace(/_/g, " ");
const pay = (j: JobProfile) => (j.payMin !== undefined && j.payMax !== undefined ? `$${j.payMin}k-$${j.payMax}k` : "pay range on request");
const where = (j: JobProfile) => (j.mode === "remote" ? "remote" : `${j.mode ?? "onsite"} in ${(j.area ?? j.market ?? "").replace(/_/g, " ")}`.trim());

/** The anonymous probe (AttentionPack.probeText). Candidate-first: the employer is never told who until the candidate opts in. */
export function peonProbeText(ctx: { contributor: boolean; when: string; othersCount: number }, activity: string): string {
  return `A verified employer is hiring for ${activity}. Want me to put you forward? They see only a summary you approve, never your name, until they say yes too. ${NEVER_ASKS}`;
}

/** Explanation lead bits (ExplainPack.leadBits): candidates hear about the job, employers get the must-have checklist. */
export function peonLeadBits(w: World, c: Candidate, me: MemberId): string[] | undefined {
  const s = sides(w, c.participants);
  if (!s) return undefined;
  // Fixed copy can collide with words in someone's private facets: each sentence must pass the
  // core leak gate on its own, and a sentence that does not is dropped (as buildProbe does).
  const vocab = privateVocabulary(w, c.participants);
  const keep = (xs: string[], fallback: string) => { const ok = xs.filter(x => checkMemberFacing(x, vocab).ok); return ok.length ? ok : [fallback]; };
  if (me === s.cand.id) return keep([`${s.job.title}: ${pay(s.job)}, ${where(s.job)}.`, "It matches the kind of work and pay you asked for.", NEVER_ASKS], PEON_SAFE_FALLBACK);
  return keep(summarySentences(s.cand, s.job), EMPLOYER_FALLBACK);
}

function summarySentences(cand: CandidateProfile, job: JobProfile): string[] {
  const checks = mustChecks(cand, job, true);
  const met = checks.filter(x => x.status === "met").length;
  const marks = checks.map(x => `${human(x.skill)} ${x.status === "met" ? "yes" : x.status === "partial" ? "partial" : "no"}`).join(", ");
  return [
    "A candidate who opted in.",
    `Meets ${met} of ${checks.length} must-haves (${marks}).`,
    "Within your pay range.",
    ...(cand.startWeeks !== undefined ? [`Can start in ${cand.startWeeks} week${cand.startWeeks === 1 ? "" : "s"}.`] : []),
  ];
}

/** Candidate-approved summary for the employer: must-have checkmarks, nothing identifying. */
export function candidateSummary(cand: CandidateProfile, job: JobProfile): string {
  return summarySentences(cand, job).join(" ");
}

export interface SlateEntry { candidate: MemberId; checks: { skill: string; status: "met" | "partial" | "missing" }[]; summary: string }
/**
 * The employer's weekly slate for one job: the candidates who opted in, in RANDOM order (seeded),
 * each with criteria checkmarks against the stated must-haves. Unranked and unscored: the human
 * chooses (domain research B4; NYC LL144 posture (a)).
 */
export function buildSlate(w: World, job: JobProfile, candidateIds: MemberId[], rng: Rng): SlateEntry[] {
  const out: SlateEntry[] = [];
  for (const id of rng.shuffle([...candidateIds].sort())) {
    const cand = candidateOf(w, id);
    if (!cand) continue;
    out.push({ candidate: id, checks: mustChecks(cand, job, true), summary: candidateSummary(cand, job) });
  }
  return out;
}

export const PEON_ASK_QUESTIONS: Record<string, string> = {
  no_structured_want: "What kind of work are you looking for next, and what's the lowest pay you'd take? I'll only suggest roles with a posted pay range.",
  few_facets: "Tell me two or three skills you'd want an employer to know about, with one example each.",
};
