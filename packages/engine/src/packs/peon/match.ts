// Reciprocal, two-sided asymmetric match scoring for peon.biz (job-related criteria only).
//   need(job <- candidate): the employer's must-haves are floors; evidence-weighted skill coverage,
//     nice-to-haves and seniority fit (skills x seniority x logistics; O*NET / ESCO style skills).
//   want(candidate <- job): pay headroom over the candidate's stated floor, role-family preference,
//     work-mode preference and seniority (growth) fit.
// Inputs are profile.ts fields only, so nothing here can see a sealed attribute or a proxy.
import type { CandidateProfile, JobProfile } from "./profile.ts";

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));

/**
 * Expected true level from a claim. Self-reported skill levels run high (about 30% of claims are
 * overstated by a level or more in the world's model, as in hiring research on resume inflation),
 * so an unverified claim is discounted; demonstrated (portfolio, reference) and interview-verified
 * levels are taken as they are.
 */
export const MATCH_TUNING = { claimDiscount: 0.4, mustFloor: 0.55 };
export function effectiveLevel(c: CandidateProfile, skill: string): number {
  const s = c.skills.get(skill);
  if (!s) return 0;
  return s.evidence === "claimed" ? Math.max(0, s.level - MATCH_TUNING.claimDiscount) : s.level;
}

/** Per must-have: met (effective level >= min), partial (within one level) or missing. */
export function mustChecks(c: CandidateProfile, j: JobProfile, claimedOnly = false): { skill: string; status: "met" | "partial" | "missing" }[] {
  return j.must.map(m => {
    const lvl = claimedOnly ? (c.skills.get(m.skill)?.level ?? 0) : effectiveLevel(c, m.skill);
    return { skill: m.skill, status: lvl >= m.min ? "met" as const : lvl >= m.min - 1 && lvl > 0 ? "partial" as const : "missing" as const };
  });
}

export interface PairScore {
  /** Employer side (job needs). */
  need: number;
  /** Candidate side (candidate wants). */
  want: number;
  /** Must-have coverage in [0, 1]; < MATCH_TUNING.mustFloor = not proposed. */
  coverage: number;
}
/** Must-have coverage below this is never proposed (the employer's floors). */
export const mustFloor = () => MATCH_TUNING.mustFloor;

export function pairScore(c: CandidateProfile, j: JobProfile): PairScore {
  // Must-haves: shortfall of the evidence-weighted level below the minimum, in levels.
  let cov = 0;
  for (const m of j.must) cov += clamp(1 - Math.max(0, m.min - effectiveLevel(c, m.skill)) / 2);
  const coverage = j.must.length ? cov / j.must.length : 0.5;
  const nice = j.nice.length ? j.nice.filter(s => effectiveLevel(c, s) >= 2).length / j.nice.length : 0;
  const dSen = c.seniority !== undefined && j.seniority !== undefined ? j.seniority - c.seniority : 0;
  const senNeed = 1 - 0.35 * Math.abs(dSen);
  const need = clamp(0.65 * coverage ** 1.5 + 0.1 * nice + 0.25 * senNeed);

  // Candidate side.
  const pay = c.floor !== undefined && j.payMax !== undefined ? clamp(0.5 + (j.payMax - c.floor) / (0.4 * Math.max(20, c.floor))) : 0.5;
  const famIdx = j.family ? c.families.indexOf(j.family) : -1;
  // Role family is career-intent fit (soft, domain research B3): an adjacent role the skills fit still counts.
  const fam = famIdx === 0 ? 1 : famIdx > 0 ? 0.8 : 0.25;
  const modePref = j.mode && c.modes.has(j.mode) ? (j.mode === "remote" ? 1 : j.mode === "hybrid" ? 0.95 : 0.85) : 0.4;
  const senWant = dSen === 0 ? 1 : dSen === 1 ? 0.9 : dSen === -1 ? 0.6 : 0.3;
  const want = clamp(0.4 * pay + 0.25 * fam + 0.2 * modePref + 0.15 * senWant);
  return { need, want, coverage };
}
