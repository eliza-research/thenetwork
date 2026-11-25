import {
  biasAnalysisGroupMinimum, biasGroupEligible, biasRateFor, biasRatingQuintile,
  biasRatioBelowThreshold, biasRatioFor, biasThresholdDenominator, biasThresholdNumerator,
} from "../../../../core/src/generated/weeklyBias.ts";
import type { DateStandingValidity } from "./standing.ts";

export interface MemberOutcome {
  group: string;
  memberMonths: number;
  proposals: number; dates: number; secondDates: number;
}
export type OutcomeMetric = "proposals" | "dates" | "secondDates";
interface GroupOutcome { n: number; memberMonths: number; rate: Record<OutcomeMetric, number>; ratio: Record<OutcomeMetric, number> }
export interface BiasReport {
  overall: Record<OutcomeMetric, number>;
  groups: Record<string, GroupOutcome>;
  min: Record<OutcomeMetric, { group: string; ratio: number }>;
  alerts: { group: string; metric: OutcomeMetric; ratio: number }[];
  dateStanding?: DateStandingValidity;
}
export const OUTCOME_METRICS: readonly OutcomeMetric[] = ["proposals", "dates", "secondDates"];
export const DEFAULT_BIAS_THRESHOLD = biasThresholdNumerator / biasThresholdDenominator;

export function biasMonitor(rows: Iterable<MemberOutcome>, o: { minN?: number; threshold?: number } = {}): BiasReport {
  const minN = o.minN ?? biasAnalysisGroupMinimum, threshold = o.threshold ?? DEFAULT_BIAS_THRESHOLD;
  const acc = new Map<string, { n: number; mm: number; proposals: number; dates: number; secondDates: number }>();
  const tot = { n: 0, mm: 0, proposals: 0, dates: 0, secondDates: 0 };
  for (const r of rows) {
    const g = acc.get(r.group) ?? { n: 0, mm: 0, proposals: 0, dates: 0, secondDates: 0 };
    for (const t of [g, tot]) { t.n++; t.mm += r.memberMonths; t.proposals += r.proposals; t.dates += r.dates; t.secondDates += r.secondDates; }
    acc.set(r.group, g);
  }
  const per = (t: typeof tot) => Object.fromEntries(OUTCOME_METRICS.map(m => [m, biasRateFor(!!t.mm, t[m] / t.mm)])) as Record<OutcomeMetric, number>;
  const overall = per(tot);
  const groups: Record<string, GroupOutcome> = {};
  for (const k of [...acc.keys()].sort()) {
    const g = acc.get(k)!, rate = per(g as typeof tot);
    groups[k] = { n: g.n, memberMonths: g.mm, rate, ratio: Object.fromEntries(OUTCOME_METRICS.map(m => [m, biasRatioFor(!!overall[m], rate[m] / overall[m])])) as Record<OutcomeMetric, number> };
  }
  const min = {} as BiasReport["min"];
  const alerts: BiasReport["alerts"] = [];
  for (const m of OUTCOME_METRICS) {
    const elig = Object.entries(groups).filter(([, g]) => biasGroupEligible(g.n, minN)).sort((x, y) => x[1].ratio[m] - y[1].ratio[m]);
    min[m] = elig.length ? { group: elig[0]![0], ratio: elig[0]![1].ratio[m] } : { group: "-", ratio: 1 };
    for (const [k, g] of elig) if (biasRatioBelowThreshold(g.ratio[m], threshold)) alerts.push({ group: k, metric: m, ratio: g.ratio[m] });
  }
  return { overall, groups, min, alerts };
}

export function ratingQuintiles(overall: ReadonlyMap<string, number>): Map<string, string> {
  const xs = [...overall.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  return new Map(xs.map(([id], i) => [id, `q${biasRatingQuintile(i, xs.length)}`]));
}
