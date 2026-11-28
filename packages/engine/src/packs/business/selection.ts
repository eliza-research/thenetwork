// The peon.biz pack refusal for selection (peonAllows): a job seat takes at most its slate a run, a
// candidate at most the lane's weekly capacity. The generic greedy order (pair value) does the
// ranking; this only says no. Reciprocal, congestion-aware hiring (ReCon, RecSys 2023): a popular
// job must not soak up every strong candidate while other jobs get none.
import { DAY, type MemberId } from "@thenetwork/core";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { capSlate, peonProbationRemaining } from "../../../../core/src/generated/peonCapacity.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { historyOf, jobs, sides, worldScratch, type JobProfile } from "./profile.ts";
import { seatOwnerOf } from "./seats.ts";

/**
 * Slate per job per week, in candidate yeses: min(max, base + perOpening x openings) (domain research
 * B4: a slate of 3-5 who said yes); probes = the yeses still needed / the expected yes share.
 * Deadline pacing (tuned on seeds 1-12, docs/results/2026-10-08-peon-pack.md, iteration 3): within
 * `pacingWeeks` of a stated fill-by date the slate grows up to (1 + pacingSlate)x and its maximum by
 * up to pacingExtraMax. Probation (domain research B2, per-employer rate limits): until the company
 * has answered an application, at most `probationProbes` probes a week across its open seats
 * (`probationUrgentProbes` for a role with urgency >= urgentMinUrgency).
 * EngineConfig has no pack slot, so these values are part of PEON_PACK_VERSION (index.ts).
 */
export const SLATE = Object.freeze({
  base: 2, perOpening: 1, max: 5, expectedYesPercent: 45,
  pacingWeeks: 8, pacingSlate: 1, pacingExtraMax: 4,
  probationProbes: 3, probationUrgentProbes: 10, urgentMinUrgency: 3,
});

/** Has the company answered an application (yes or no)? Cached per World. */
function companyTrusted(w: World, j: JobProfile): boolean {
  const trusted = worldScratch(w, "companyTrusted", () => new Set(jobs(w).filter(x => x.company && historyOf(w, x.id).answered > 0).map(x => x.company!)));
  return !!j.company && trusted.has(j.company);
}
function probationGroupOf(w: World, job: JobProfile): string {
  if (job.verified && job.company) return `company:${job.company}`;
  const seat = w.get(job.id)?.m;
  return `owner:${(seat && seatOwnerOf(seat)) ?? job.id}`;
}

function companyBudget(w: World, job: JobProfile) {
  const budgets = worldScratch(w, "companyProbationBudget", () => {
    const result = new Map<string, { openSeats: MemberId[]; sent: number }>();
    for (const seat of jobs(w)) {
      const key = probationGroupOf(w, seat);
      const budget = result.get(key) ?? { openSeats: [], sent: 0 };
      if (seat.open) budget.openSeats.push(seat.id);
      budget.sent += w.get(seat.id)?.recentProactive ?? 0;
      result.set(key, budget);
    }
    return result;
  });
  return budgets.get(probationGroupOf(w, job))!;
}

/** How close a role is to its stated fill-by date (0 = far or no date, 1 = at the date). */
function closeness(w: World, j: JobProfile): number {
  if (j.fillBy === undefined) return 0;
  const weeksLeft = (j.fillBy - w.now) / (7 * DAY);
  return Math.max(0, Math.min(1, 1 - weeksLeft / SLATE.pacingWeeks));
}

export function slateCap(w: World, j: JobProfile, reservedFor?: (id: MemberId) => number): number {
  const cl = closeness(w, j);
  const target = Math.min(SLATE.max + SLATE.pacingExtraMax * cl, (SLATE.base + SLATE.perOpening * Math.max(0, j.openings)) * (1 + SLATE.pacingSlate * cl));
  // Applications the employer has not reviewed yet use up the slate (no pile-ups, no ghosted queues).
  const room = Math.max(0, target - historyOf(w, j.id).pendingReview);
  const planned = Math.ceil(room * 100 / SLATE.expectedYesPercent);
  // spec/peonCapacity.md, "The next slate stays within remaining openings"
  const fullCap = j.seatCap === undefined ? planned : capSlate(planned, j.seatCap);
  const seatReserved = reservedFor?.(j.id) ?? 0;
  const cap = Math.max(0, fullCap - seatReserved);
  if (companyTrusted(w, j)) return cap;
  const probation = j.verified && j.urgency >= SLATE.urgentMinUrgency ? SLATE.probationUrgentProbes : SLATE.probationProbes;
  const { openSeats, sent } = companyBudget(w, j);
  const share = Math.ceil(probation / Math.max(1, openSeats.length));
  const seatRemaining = peonProbationRemaining(share, w.get(j.id)?.recentProactive ?? 0, seatReserved);
  const reserved = reservedFor ? openSeats.reduce((count, id) => count + reservedFor(id), 0) : 0;
  return Math.min(cap, seatRemaining, peonProbationRemaining(probation, sent, reserved));
}

/**
 * THE peon refusal hook: may the run reserve `c` given what it already reserved for each member?
 * Every selection phase must honor it (spec/selectionRun.md, packAllows).
 */
export function peonAllows(w: World, c: Candidate, timesSelectedInRun: (id: MemberId) => number): boolean {
  if (c.lane === "Cofounder") return c.participants.every(id =>
    (w.get(id)?.recentProactive ?? Infinity) + timesSelectedInRun(id) < laneLimits("Cofounder").weeklyCapacity);
  const s = sides(w, c.participants);
  if (!s || timesSelectedInRun(s.cand.id) >= laneLimits("Hire").weeklyCapacity) return false;
  return slateCap(w, s.job, timesSelectedInRun) > 0;
}
export const businessAllows = peonAllows;
