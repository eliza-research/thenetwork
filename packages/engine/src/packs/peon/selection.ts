// Congestion control for peon.biz (AppPack.selection.adjust), on top of the core greedy selection.
// Reciprocal and congestion-aware job recommendation (ReCon, RecSys 2023; LinkedIn, RecSys 2017):
// a popular job should not soak up every strong candidate while other jobs get none.
//   - per job: a weekly slate cap that scales with open headcount, minus intros still waiting for
//     the employer's review; past the cap the adjusted value is -Infinity, so the core greedy skips it;
//   - per candidate: at most CANDIDATE_WEEKLY roles a week (also the member budget);
//   - a spreading penalty as a job's slate fills, a lift for under-applied jobs (small hard-filtered
//     pool, few applications so far; Horton 2017) and for candidates who have had no intro yet.
import type { MemberId } from "@thenetwork/core";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { poolSize } from "./generators.ts";
import { historyOf, sides, type JobProfile } from "./profile.ts";

export const CONGESTION = {
  /**
   * Slate per job per week, in candidate YESES: min(slateMax, slateBase + slatePerOpening x openings)
   * (domain research B4: a slate of 3-5 who said yes). Probes per job = the yeses still needed
   * (minus applications waiting for review) / expectedYes.
   */
  slateBase: 2, slatePerOpening: 1, slateMax: 5, expectedYes: 0.45,
  candidateWeekly: 3,
  /** Penalty per unit of slate fill (0..1). */
  spread: 0.06,
  /** Lift for jobs with a small pool (pool <= underPool) and few applications per opening. */
  underLift: 0.08, underPool: 12,
  /** Lift for candidates with no intro so far. */
  newCandidateLift: 0.04,
  /** Employer responsiveness learned from the Network's log (Beta prior answered:ghosted = 2:0.5); value x estimate^respPower. */
  respPower: 1,
};

/** P(the employer answers an application), from applications they answered vs let expire. */
export function responsiveness(w: World, j: JobProfile): number {
  const h = historyOf(w, j.id);
  return (h.answered + 2) / (h.answered + h.ghosted + 2.5);
}

export function slateCap(w: World, j: JobProfile): number {
  const C = CONGESTION;
  const target = Math.min(C.slateMax, C.slateBase + C.slatePerOpening * Math.max(0, j.openings));
  // Applications the employer has not reviewed yet use up the slate (no pile-ups, no ghosted queues).
  const room = Math.max(0, target - historyOf(w, j.id).pendingReview);
  return Math.ceil(room / C.expectedYes);
}

export function underApplied(w: World, j: JobProfile): number {
  const C = CONGESTION;
  const pool = poolSize(w, j.id);
  const smallPool = Math.max(0, 1 - pool / C.underPool);
  const apps = historyOf(w, j.id).applications28 / Math.max(1, j.openings);
  const fewApps = Math.max(0, 1 - apps / 4);
  return Math.max(smallPool, 0.5 * fewApps);
}

export function peonAdjust(w: World, c: Candidate, value: number, times: (id: MemberId) => number): number {
  const s = sides(w, c.participants);
  if (!s) return value;
  const C = CONGESTION;
  const cap = slateCap(w, s.job);
  const t = times(s.job.id);
  if (t >= cap) return -Infinity;
  if (times(s.cand.id) >= C.candidateWeekly) return -Infinity;
  let v = value * responsiveness(w, s.job) ** C.respPower - C.spread * (t / Math.max(1, cap));
  v += C.underLift * underApplied(w, s.job);
  if (historyOf(w, s.cand.id).intros === 0) v += C.newCandidateLift;
  return v;
}
