// Ongoing bias monitor for appearance-aware matching (iteration 4). ADMIN ONLY, aggregates only.
//
// For each group, outcome rates per member-month (proposals, dates, second dates) and their ratio to
// the overall rate; a ratio under `threshold` (default 0.8, the four-fifths rule) for a group with at
// least `minN` members raises an alert. Groups come from consented, self-reported demographics or an
// external audit sample, never inferred from photos or names; the monitor also accepts internal
// groupings such as the rating quintile (to check that low-rated members are not starved of dates).
// Iteration 3 showed a biased rater moves match QUALITY (second dates) before it moves volume
// (dates), so the second-date ratio is the one to watch. Nothing here is member-facing.

export interface MemberOutcome {
  group: string;
  /** Member-months observed (weeks / 4.345 for a full-window member). */
  memberMonths: number;
  proposals: number; dates: number; secondDates: number;
}
export type OutcomeMetric = "proposals" | "dates" | "secondDates";
export interface GroupOutcome { n: number; memberMonths: number; rate: Record<OutcomeMetric, number>; ratio: Record<OutcomeMetric, number> }
export interface BiasReport {
  overall: Record<OutcomeMetric, number>;
  groups: Record<string, GroupOutcome>;
  /** The lowest ratio per metric among groups with n >= minN. */
  min: Record<OutcomeMetric, { group: string; ratio: number }>;
  alerts: { group: string; metric: OutcomeMetric; ratio: number }[];
}
export const OUTCOME_METRICS: readonly OutcomeMetric[] = ["proposals", "dates", "secondDates"];

export function biasMonitor(rows: Iterable<MemberOutcome>, o: { minN?: number; threshold?: number } = {}): BiasReport {
  const minN = o.minN ?? 15, threshold = o.threshold ?? 0.8;
  const acc = new Map<string, { n: number; mm: number; proposals: number; dates: number; secondDates: number }>();
  const tot = { n: 0, mm: 0, proposals: 0, dates: 0, secondDates: 0 };
  for (const r of rows) {
    const g = acc.get(r.group) ?? { n: 0, mm: 0, proposals: 0, dates: 0, secondDates: 0 };
    for (const t of [g, tot]) { t.n++; t.mm += r.memberMonths; t.proposals += r.proposals; t.dates += r.dates; t.secondDates += r.secondDates; }
    acc.set(r.group, g);
  }
  const per = (t: typeof tot) => Object.fromEntries(OUTCOME_METRICS.map(m => [m, t.mm ? t[m] / t.mm : 0])) as Record<OutcomeMetric, number>;
  const overall = per(tot);
  const groups: Record<string, GroupOutcome> = {};
  for (const k of [...acc.keys()].sort()) {
    const g = acc.get(k)!, rate = per(g as typeof tot);
    groups[k] = { n: g.n, memberMonths: g.mm, rate, ratio: Object.fromEntries(OUTCOME_METRICS.map(m => [m, overall[m] ? rate[m] / overall[m] : 1])) as Record<OutcomeMetric, number> };
  }
  const min = {} as BiasReport["min"];
  const alerts: BiasReport["alerts"] = [];
  for (const m of OUTCOME_METRICS) {
    const elig = Object.entries(groups).filter(([, g]) => g.n >= minN).sort((x, y) => x[1].ratio[m] - y[1].ratio[m]);
    min[m] = elig.length ? { group: elig[0]![0], ratio: elig[0]![1].ratio[m] } : { group: "-", ratio: 1 };
    for (const [k, g] of elig) if (g.ratio[m] < threshold) alerts.push({ group: k, metric: m, ratio: g.ratio[m] });
  }
  return { overall, groups, min, alerts };
}

/** Quintile of the overall rating (1 = lowest), for the internal "are low-rated members starved?" check. */
export function ratingQuintiles(overall: ReadonlyMap<string, number>): Map<string, string> {
  const xs = [...overall.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  return new Map(xs.map(([id], i) => [id, `q${1 + Math.floor((5 * i) / Math.max(1, xs.length))}`]));
}
