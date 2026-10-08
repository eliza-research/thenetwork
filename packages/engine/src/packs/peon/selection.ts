// Congestion control for peon.biz (AppPack.selection.adjust), on top of the core greedy selection.
// Reciprocal and congestion-aware job recommendation (ReCon, RecSys 2023; LinkedIn, RecSys 2017):
// a popular job should not soak up every strong candidate while other jobs get none.
//   - per job: a weekly slate cap that scales with open headcount, minus intros still waiting for
//     the employer's review; past the cap the adjusted value is -Infinity, so the core greedy skips it;
//   - per candidate: at most CANDIDATE_WEEKLY roles a week (also the member budget);
//   - a spreading penalty as a job's slate fills, a lift for under-applied jobs (small hard-filtered
//     pool, few applications so far; Horton 2017) and for candidates who have had no intro yet.
import { DAY, type MemberId } from "@thenetwork/core";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { poolSize } from "./generators.ts";
import { daysOpen } from "./rules.ts";
import { historyOf, jobs, sides, worldScratch, type JobProfile } from "./profile.ts";

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
  /** Time pressure: lift by stated urgency (0 at 1, full at 3) and by weeks open (full at 6 weeks); roles close. */
  urgencyLift: 0, staleLift: 0,
  /**
   * Per-employer rate limit until the employer has a track record (domain research B2: "per-employer
   * rate limits"; a human verifies the first job): at most `probationProbes` probes a week, split
   * across the company's open seats, until the company has answered an application ("answered",
   * the default, selected on tuning seeds 1-8) or until its first REAL interview ("interview": an
   * interview record from one of its seats; a scam never interviews). Both held scam reach to <= 1
   * per seed on seeds 1-8; "interview" cost 1.6 more hires per seed (docs/results Iteration 2).
   */
  probationProbes: 3,
  probationUntil: "answered" as "interview" | "answered",
  /**
   * Deadline-aware pacing (iteration 3). closeness = 1 - weeks left before the stated fill-by date /
   * pacingWeeks, clamped to [0, 1] (0 with no stated date). A role close to its date gets a larger
   * slate (target yeses x (1 + pacingSlate x closeness), max raised by pacingExtraMax x closeness)
   * and is probed sooner (+pacingLift x closeness on the selection value, so it wins candidates'
   * weekly slots). Urgent roles (urgency >= urgentMinUrgency) from VERIFIED employers on probation
   * get `probationUrgentProbes` a week instead of `probationProbes`.
   */
  // Tuned on seeds 1-12 (docs/results/2026-10-08-peon-pack.md, Iteration 3): a window of 8 weeks
  // (pipelines take 2-3), slates up to 2x (+4 max) at the date; urgent verified roles 10 probes a
  // week on probation. The selection lift did not help and stays 0.
  pacingWeeks: 8, pacingSlate: 1, pacingExtraMax: 4, pacingLift: 0,
  probationUrgentProbes: 10, urgentMinUrgency: 3,
  /** Employer responsiveness learned from the Network's log (Beta prior answered:ghosted = 2:0.5); value x estimate^respPower. */
  respPower: 1,
};

/** Has the company passed probation (first real interview, or any answered application under the old rule)? Cached per World. */
export function companyTrusted(w: World, j: JobProfile): boolean {
  const ok = worldScratch(w, `companyTrusted:${CONGESTION.probationUntil}`, () => {
    const out = new Set<string>();
    const interviewed = new Set(w.feedback.map(f => f.from));
    for (const x of jobs(w)) {
      if (!x.company) continue;
      if (CONGESTION.probationUntil === "answered" ? historyOf(w, x.id).answered > 0 : interviewed.has(x.id)) out.add(x.company);
    }
    return out;
  });
  return !!j.company && ok.has(j.company);
}
/** Open seats per company (the probation budget is split across them). */
function seatsOf(w: World, company: string | undefined): number {
  const m = worldScratch(w, "seatsPerCompany", () => {
    const out = new Map<string, number>();
    for (const x of jobs(w)) if (x.company && x.open) out.set(x.company, (out.get(x.company) ?? 0) + 1);
    return out;
  });
  return company ? Math.max(1, m.get(company) ?? 1) : 1;
}

/** P(the employer answers an application), from applications they answered vs let expire. */
export function responsiveness(w: World, j: JobProfile): number {
  const h = historyOf(w, j.id);
  return (h.answered + 2) / (h.answered + h.ghosted + 2.5);
}

/** How close a role is to its stated fill-by date (0 = far or no date, 1 = at the date). */
export function closeness(w: World, j: JobProfile): number {
  if (j.fillBy === undefined) return 0;
  const weeksLeft = (j.fillBy - w.now) / (7 * DAY);
  return Math.max(0, Math.min(1, 1 - weeksLeft / CONGESTION.pacingWeeks));
}

export function slateCap(w: World, j: JobProfile): number {
  const C = CONGESTION;
  const cl = closeness(w, j);
  const target = Math.min(C.slateMax + C.pacingExtraMax * cl, (C.slateBase + C.slatePerOpening * Math.max(0, j.openings)) * (1 + C.pacingSlate * cl));
  // Applications the employer has not reviewed yet use up the slate (no pile-ups, no ghosted queues).
  const room = Math.max(0, target - historyOf(w, j.id).pendingReview);
  const cap = Math.ceil(room / C.expectedYes);
  if (companyTrusted(w, j)) return cap;
  const probation = j.verified && j.urgency >= C.urgentMinUrgency ? C.probationUrgentProbes : C.probationProbes;
  return Math.min(cap, Math.ceil(probation / seatsOf(w, j.company)));
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
  v += C.urgencyLift * Math.max(0, s.job.urgency - 1) / 2 + C.staleLift * Math.min(1, daysOpen(w, s.job) / 42);
  v += C.pacingLift * closeness(w, s.job);
  return v;
}
