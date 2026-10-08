// peon.biz metrics from a run (hidden truth allowed: this is the evaluator).
// Per-candidate rates use REAL candidates: adults who are not fake and joined during the run.
import type { MemberId } from "@thenetwork/core";
import { gini } from "@thenetwork/engine/src/policy.ts";
import { sealedGroups } from "./persona.ts";
import type { Flow, PeonRunResult } from "./world.ts";

/**
 * Selection-rate stages for the four-fifths check (29 CFR 1607.4(D); NYC LL144 style). Each stage
 * is "reached / pool" per sealed group:
 *   offered|assessed   the matching tool's own decision: candidates it scored for a job (after the
 *                      hard filters) who got at least one intro. AUTOMATED: the gate.
 *   offered|active     every real candidate in the run (includes those with no compatible job).
 *   applied|offered    the candidate's own choice.
 *   employer_yes|reviewed, offer|interviewed   human decisions (where a discriminatory employer acts).
 *   hired|active       the end-to-end outcome.
 */
export const STAGES = ["offered|assessed", "offered|active", "applied|offered", "employer_yes|reviewed", "offer|interviewed", "hired|active"] as const;
export type Stage = typeof STAGES[number];
export const AUTOMATED_STAGES: readonly Stage[] = ["offered|assessed"];
export const MIN_GROUP = 30;

export interface ImpactTable {
  /** stage -> attr -> group -> counts and rate. */
  rates: Record<string, Record<string, Record<string, { n: number; selected: number; rate: number }>>>;
  /** stage -> attr -> min/max rate over groups with n >= MIN_GROUP. */
  ratio: Record<string, Record<string, number>>;
  minAutomated: number; minHuman: number;
}

export interface PeonMetrics {
  intros: number; probesDelivered: number; dropped: Record<string, number>;
  replyRate: number; applyRate: number; qualifiedIntros: number; qualifiedShare: number;
  reviewed: number; employerYesRate: number; interviews: number; offers: number; offerRatePerInterview: number;
  accepts: number; acceptRate: number; hires: number; interviewsPerHire: number;
  openings: number; fillRate: number; medianTimeToFill: number; meanTimeToFill: number;
  retention90: number; qualityOfHire: number;
  congestion: { giniApplicationsPerJob: number; zeroIntroCandidateShare: number; top10JobShareOfApplications: number; giniIntrosPerCandidate: number; expiredApplications: number };
  underApplied: { jobs: number; hires: number; jobsFilled: number; openingsFilledShare: number };
  safety: {
    minorsMatched: number; minorsProposed: number; scamIntros: number; scamReach: number; unverifiedIntros: number; noRangeIntros: number;
    fakeReachedEmployer: number; fakeHires: number;
  };
  discrimination: { employers: number; detected: number; falseFlags: number; requests: number; requestsApplied: number };
  impact: ImpactTable;
}

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function peonMetrics(r: PeonRunResult, o: { requestsApplied?: number } = {}): PeonMetrics {
  const { world, flows, hires } = r;
  const { oracle, pop } = world;
  const delivered = flows.filter(f => f.delivered);
  const dropped: Record<string, number> = {};
  for (const f of flows) if (f.dropped) dropped[f.dropped] = (dropped[f.dropped] ?? 0) + 1;
  const replied = delivered.filter(f => f.replied), applied = delivered.filter(f => f.yes);
  const reviewed = delivered.filter(f => f.reviewed), empYes = reviewed.filter(f => f.employerYes);
  const interviews = delivered.filter(f => f.interviewed), offers = delivered.filter(f => f.offered), accepts = delivered.filter(f => f.accepted);
  const real = pop.candidates.filter(c => !c.truth.isMinor && !c.truth.fake && c.joinWeek < world.weeks);
  const realIds = new Set(real.map(c => c.id));
  const jobsReal = pop.jobs.filter(j => j.hidden.real && j.postedWeek < world.weeks);
  const openings = jobsReal.reduce((s, j) => s + j.openings, 0);
  // Congestion.
  const appsPerJob = new Map<MemberId, number>(jobsReal.map(j => [j.id, 0]));
  for (const f of applied) if (appsPerJob.has(f.job)) appsPerJob.set(f.job, appsPerJob.get(f.job)! + 1);
  const apps = [...appsPerJob.values()];
  const totalApps = apps.reduce((a, b) => a + b, 0);
  const topN = Math.max(1, Math.ceil(apps.length * 0.1));
  const introsPerCand = new Map<MemberId, number>(real.map(c => [c.id, 0]));
  for (const f of delivered) if (introsPerCand.has(f.cand)) introsPerCand.set(f.cand, introsPerCand.get(f.cand)! + 1);
  // Under-applied jobs.
  const ua = jobsReal.filter(j => world.underApplied.has(j.id));
  const uaHires = hires.filter(h => h.underApplied);
  // Discriminatory employers and the audit.
  const discCos = pop.companies.filter(c => c.adversary === "discriminatory");
  const flagged = new Set(r.audits.flat().map(f => f.company));
  return {
    intros: flows.length, probesDelivered: delivered.length, dropped,
    replyRate: div(replied.length, delivered.length), applyRate: div(applied.length, replied.length),
    qualifiedIntros: delivered.filter(f => f.qualified).length, qualifiedShare: div(delivered.filter(f => f.qualified).length, delivered.length),
    reviewed: reviewed.length, employerYesRate: div(empYes.length, reviewed.length),
    interviews: interviews.length, offers: offers.length, offerRatePerInterview: div(offers.length, interviews.length),
    accepts: accepts.length, acceptRate: div(accepts.length, offers.length), hires: hires.length, interviewsPerHire: div(interviews.length, hires.length),
    openings, fillRate: div(hires.filter(h => oracle.job.get(h.job)!.hidden.real).length, openings),
    medianTimeToFill: median(hires.map(h => h.timeToFill)), meanTimeToFill: div(hires.reduce((s, h) => s + h.timeToFill, 0), hires.length),
    retention90: div(hires.filter(h => h.retained).length, hires.length), qualityOfHire: div(hires.reduce((s, h) => s + h.qoh, 0), hires.length),
    congestion: {
      giniApplicationsPerJob: gini(apps), zeroIntroCandidateShare: div([...introsPerCand.values()].filter(x => x === 0).length, introsPerCand.size),
      top10JobShareOfApplications: div([...apps].sort((a, b) => b - a).slice(0, topN).reduce((a, b) => a + b, 0), totalApps),
      giniIntrosPerCandidate: gini([...introsPerCand.values()]), expiredApplications: applied.filter(f => f.expired).length,
    },
    underApplied: {
      jobs: ua.length, hires: uaHires.length, jobsFilled: new Set(uaHires.map(h => h.job)).size,
      openingsFilledShare: div(uaHires.length, ua.reduce((s, j) => s + j.openings, 0)),
    },
    safety: {
      minorsMatched: flows.filter(f => f.minor).length, minorsProposed: flows.filter(f => f.minor).length,
      scamIntros: delivered.filter(f => f.scam).length,
      scamReach: new Set(delivered.filter(f => f.scamContact && realIds.has(f.cand)).map(f => f.cand)).size,
      unverifiedIntros: delivered.filter(f => f.unverified).length, noRangeIntros: delivered.filter(f => f.noRange).length,
      fakeReachedEmployer: delivered.filter(f => f.fake && f.reviewed).length, fakeHires: hires.filter(h => oracle.cand.get(h.cand)!.truth.fake).length,
    },
    discrimination: {
      employers: discCos.length, detected: discCos.filter(c => flagged.has(c.id)).length,
      falseFlags: [...flagged].filter(id => oracle.company.get(id)?.adversary !== "discriminatory").length,
      requests: discCos.filter(c => c.discriminatoryRequest).length, requestsApplied: o.requestsApplied ?? 0,
    },
    impact: impactTable(r, real.map(c => c.id)),
  };
}

/** Selection rates by sealed group per stage, and four-fifths impact ratios. */
export function impactTable(r: PeonRunResult, ids: MemberId[]): ImpactTable {
  const { oracle } = r.world;
  type Ev = "offered" | "applied" | "reviewed" | "employer_yes" | "interviewed" | "offer" | "hired";
  const reached = new Map<MemberId, Set<Ev>>(ids.map(id => [id, new Set()]));
  const mark = (id: MemberId, s: Ev) => reached.get(id)?.add(s);
  for (const f of r.flows) {
    if (!f.delivered) continue;
    mark(f.cand, "offered");
    if (f.yes) mark(f.cand, "applied");
    if (f.reviewed) mark(f.cand, "reviewed");
    if (f.employerYes) mark(f.cand, "employer_yes");
    if (f.interviewed) mark(f.cand, "interviewed");
    if (f.offered) mark(f.cand, "offer");
  }
  for (const h of r.hires) mark(h.cand, "hired");
  const def: Record<Stage, { pool: (id: MemberId) => boolean; ev: Ev }> = {
    "offered|assessed": { pool: id => r.assessed.has(id), ev: "offered" },
    "offered|active": { pool: () => true, ev: "offered" },
    "applied|offered": { pool: id => reached.get(id)!.has("offered"), ev: "applied" },
    "employer_yes|reviewed": { pool: id => reached.get(id)!.has("reviewed"), ev: "employer_yes" },
    "offer|interviewed": { pool: id => reached.get(id)!.has("interviewed"), ev: "offer" },
    "hired|active": { pool: () => true, ev: "hired" },
  };
  const rates: ImpactTable["rates"] = {}, ratio: ImpactTable["ratio"] = {};
  for (const stage of STAGES) {
    rates[stage] = {}; ratio[stage] = {};
    const { pool, ev } = def[stage];
    for (const id of ids) {
      if (!pool(id)) continue;
      for (const [attr, value] of Object.entries(sealedGroups(oracle.sealed(id)!))) {
        const g = ((rates[stage]![attr] ??= {})[value] ??= { n: 0, selected: 0, rate: 0 });
        g.n++; if (reached.get(id)!.has(ev)) g.selected++;
      }
    }
    for (const [attr, groups] of Object.entries(rates[stage]!)) {
      for (const g of Object.values(groups)) g.rate = div(g.selected, g.n);
      ratio[stage]![attr] = ratioOf(groups);
    }
  }
  const minOver = (stages: readonly Stage[]) => Math.min(...stages.flatMap(s => Object.values(ratio[s]!)));
  return { rates, ratio, minAutomated: minOver(AUTOMATED_STAGES), minHuman: minOver(STAGES.filter(s => !AUTOMATED_STAGES.includes(s))) };
}

/** min / max selection rate over groups with n >= MIN_GROUP (1 when fewer than two such groups). */
export function ratioOf(groups: Record<string, { n: number; selected: number }>): number {
  const rs = Object.values(groups).filter(g => g.n >= MIN_GROUP).map(g => g.selected / g.n);
  return rs.length >= 2 && Math.max(...rs) > 0 ? Math.min(...rs) / Math.max(...rs) : 1;
}

/** Pool impact tables over seeds (sum the counts, then take ratios). */
export function poolImpact(ts: ImpactTable[]): ImpactTable {
  const rates: ImpactTable["rates"] = {}, ratio: ImpactTable["ratio"] = {};
  for (const stage of STAGES) {
    rates[stage] = {}; ratio[stage] = {};
    for (const t of ts) for (const [attr, groups] of Object.entries(t.rates[stage] ?? {})) for (const [v, g] of Object.entries(groups)) {
      const x = ((rates[stage]![attr] ??= {})[v] ??= { n: 0, selected: 0, rate: 0 });
      x.n += g.n; x.selected += g.selected;
    }
    for (const [attr, groups] of Object.entries(rates[stage]!)) {
      for (const g of Object.values(groups)) g.rate = div(g.selected, g.n);
      // Pooled over seeds: a group needs MIN_GROUP per seed on average.
      const k = ts.length;
      const big = Object.fromEntries(Object.entries(groups).filter(([, g]) => g.n >= MIN_GROUP * k));
      ratio[stage]![attr] = ratioOf(Object.fromEntries(Object.entries(big).map(([kk, g]) => [kk, { n: MIN_GROUP, selected: (g.selected / g.n) * MIN_GROUP }])));
    }
  }
  const minOver = (stages: readonly Stage[]) => Math.min(...stages.flatMap(s => Object.values(ratio[s]!)));
  return { rates, ratio, minAutomated: minOver(AUTOMATED_STAGES), minHuman: minOver(STAGES.filter(s => !AUTOMATED_STAGES.includes(s))) };
}
