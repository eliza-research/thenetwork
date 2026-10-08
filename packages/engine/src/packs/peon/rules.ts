// peonPack hard filters (eligibility) and geo model. They run after the core prefix (minors,
// holds, pause, blocks) and before any scoring; they only ever remove. Order is the funnel order.
// Every rule is job-related (domain research B3 "Hard constraints") and reads profile.ts only.
import type { City, MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { CandidateRule, GeoModel, MemberRule, PairRule } from "../../pack.ts";
import { pairKey, type World } from "../../world.ts";
import type { Interval } from "../../interval.ts";
import { candidateOf, historyOf, jobOf, profileOf, sides, type CandidateProfile, type JobProfile } from "./profile.ts";

/** Simultaneous intros in flight per candidate (domain research B4: about 5). */
export const MAX_ACTIVE_INTROS = 5;

export const PEON_MEMBER_RULES: readonly MemberRule[] = [
  { id: "peon_not_onboarded", check: (w, id) => (profileOf(w, id) ? null : "peon_not_onboarded") },
  // Job seats.
  { id: "job_closed", check: (w, id) => { const j = jobOf(w, id); return j && !j.open ? "job_closed" : null; } },
  { id: "employer_unverified", check: (w, id) => { const j = jobOf(w, id); return j && !j.verified ? "employer_unverified" : null; } },
  { id: "no_pay_range", check: (w, id) => { const j = jobOf(w, id); return j && j.payMax === undefined ? "no_pay_range" : null; } },
  { id: "employer_scam_signal", check: (w, id) => { const j = jobOf(w, id); return j && j.scamCue ? "employer_scam_signal" : null; } },
  // Candidates.
  { id: "not_searching", check: (w, id) => { const c = candidateOf(w, id); return c && !c.searching ? "not_searching" : null; } },
  { id: "identity_signal", check: (w, id) => { const c = candidateOf(w, id); return c && c.fakeCue ? "identity_signal" : null; } },
  {
    id: "interruption_budget", check: (w, id, mi, c) => {
      if (!candidateOf(w, id)) return null; // job seats get a weekly slate, not interruptions (caps in selection.ts)
      const budget = w.cfg.budgets[mi.m.state];
      return mi.recentProactive + (c.extraProactive ?? 0) >= budget.limit ? "interruption_budget" : null;
    },
  },
  { id: "active_intro_cap", check: (w, id) => (candidateOf(w, id) && historyOf(w, id).inFlight >= MAX_ACTIVE_INTROS ? "active_intro_cap" : null) },
];

/** Work authorization: only the neutral yes/no questions are asked; sponsorship must be offered if needed. */
export function workAuthOk(c: CandidateProfile, j: JobProfile): boolean {
  if (c.auth === false) return false;
  if (c.needsSponsor && !j.sponsors) return false;
  return true;
}
/** Onsite / hybrid: same market and a site area the candidate said they will commute to. Remote: the candidate wants remote. */
export function locationOk(c: CandidateProfile, j: JobProfile): boolean {
  if (!j.mode) return false;
  if (j.mode === "remote") return c.modes.has("remote");
  if (!c.modes.has(j.mode)) return false;
  return c.market === j.market && !!j.area && c.areas.has(j.area);
}

export const PEON_PAIR_RULES: readonly PairRule[] = [
  { id: "not_candidate_job", check: (w, a, b) => (sides(w, [a, b]) ? null : "not_candidate_job") },
  {
    // Never re-introduce the same candidate and job (any earlier outcome), and never while one is in flight.
    id: "already_introduced", check: (w, a, b) => (w.pairInteractions.has(pairKey(a, b)) || w.activePairs.has(pairKey(a, b)) || w.recentPairs.has(pairKey(a, b)) ? "already_introduced" : null),
  },
  // Current-employer blocking: a candidate is never shown to a company they excluded.
  { id: "excluded_company", check: (w, a, b) => { const s = sides(w, [a, b])!; return s.job.company && s.cand.excluded.has(s.job.company) ? "excluded_company" : null; } },
  {
    id: "seniority_band", check: (w, a, b) => {
      const s = sides(w, [a, b])!;
      return s.cand.seniority === undefined || s.job.seniority === undefined || Math.abs(s.cand.seniority - s.job.seniority) > 1 ? "seniority_band" : null;
    },
  },
  // Pay: the job's range must reach the candidate's stated floor (pay transparency: every job has a range).
  { id: "pay_below_floor", check: (w, a, b) => { const s = sides(w, [a, b])!; return s.cand.floor !== undefined && (s.job.payMax ?? -1) < s.cand.floor ? "pay_below_floor" : null; } },
  { id: "work_authorization", check: (w, a, b) => { const s = sides(w, [a, b])!; return workAuthOk(s.cand, s.job) ? null : "work_authorization"; } },
  { id: "credential_required", check: (w, a, b) => { const s = sides(w, [a, b])!; return s.job.credRequired && !s.cand.creds.has(s.job.credRequired) ? "credential_required" : null; } },
];

/** Configuration rules: an intro is exactly one candidate and one job seat, and no `via`. */
export const PEON_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  { id: "intro_shape", check: (w, c) => (c.participants.length !== 2 || c.via || !sides(w, c.participants) ? "intro_shape" : null) },
];
export const PEON_CANDIDATE_POST_RULES: readonly CandidateRule[] = [];

/** Post-judge gate, pack part (the core gate already checked minors, holds and blocks). */
export function peonHardGate(w: World, c: { participants: MemberId[] }): string | null {
  const s = sides(w, c.participants);
  if (!s) return "intro_shape";
  if (!s.job.verified) return "employer_unverified";
  if (!s.job.open) return "job_closed";
  if (s.job.payMax === undefined) return "no_pay_range";
  return null;
}

// ---------------------------------------------------------------------------------------- geo
/** Markets a member can work in: candidates their home market; onsite / hybrid jobs their site market; remote jobs every run market. */
function marketsOf(w: World, id: MemberId): City[] {
  const mi = w.get(id);
  if (!mi) return [];
  const j = jobOf(w, id);
  if (j) return j.mode === "remote" ? [...w.cfg.cities] : [j.market ?? mi.m.homeCity];
  return [mi.m.homeCity];
}

/**
 * peon geo: a market model, not co-location. Interviews can be remote, so availability is the whole
 * window in every market the member can work in. The location hard filter (commute areas the
 * CANDIDATE set, remote / hybrid / onsite) is `pairReason`. Home zip is never read: it is a proxy.
 */
export const peonGeo: GeoModel = {
  kind: "multi_market",
  markets: cfg => cfg.cities,
  tz: (market, cfg) => cfg.timezones[market],
  location(w, id, start, end) {
    const out = new Map<City, Interval[]>();
    for (const m of marketsOf(w, id)) out.set(m, [[start, end]]);
    return out;
  },
  overlap(w, ids, start, end, preferred) {
    if (end <= start) return null;
    const sets = ids.map(id => new Set(marketsOf(w, id)));
    const common = w.cfg.cities.filter(c => sets.every(s => s.has(c)));
    if (!common.length) return null;
    // A candidate's own market first (ids order must not matter: pick by the candidate, not by position).
    const candMarket = ids.map(id => candidateOf(w, id)?.market).find(m => m && common.includes(m));
    const city = preferred && common.includes(preferred) ? preferred : candMarket ?? common[0]!;
    return { city, intervals: [[start, end]], hours: (end - start) / HOUR };
  },
  sharesArea: () => false,
  pairReason(w, a, b) {
    const s = sides(w, [a, b]);
    if (!s) return null;
    return locationOk(s.cand, s.job) ? null : "location_incompatible";
  },
};

/** Days a job has been open. */
export const daysOpen = (w: World, j: JobProfile) => (j.postedAt === undefined ? 0 : Math.max(0, (w.now - j.postedAt) / DAY));
