// Bias audit for the Clef rating (P2; ADMIN ONLY, aggregates only). Pure.
//
// Input: rated members, each with an overall score (or photo ids to score with a weights file), an
// OPTIONAL self-reported demographic group (opt-in; absent = not reported, never inferred from photos
// or names) and, when the members have been matched, their outcomes (member-months, proposals, dates,
// second dates). Output:
//   scores    per group: n, mean, SD, p10 / p50 / p90, the standardised mean difference against everyone
//             else, and the selection ratio: the group's share of the TOP TWO rating quintiles over its
//             share of the population (the four-fifths rule on the rating itself);
//   outcomes  biasMonitor (biasMonitor.ts) by group and by rating quintile: rates per member-month and
//             their ratio to the overall rate;
//   flags     any group (n >= minN) with a selection ratio or an outcome ratio under `threshold`
//             (default 0.8), or a standardised mean difference under -0.5.
// Groups with fewer than `minN` members are reported as suppressed (count only), never broken out.
import { biasMonitor, OUTCOME_METRICS, ratingQuintiles, type BiasReport, type OutcomeMetric } from "../biasMonitor.ts";

export interface AuditMember {
  id: string;
  overall: number;
  /** Opt-in self-reported group; undefined = not reported. */
  group?: string;
  memberMonths?: number; proposals?: number; dates?: number; secondDates?: number;
}
export interface ScoreDist { n: number; mean: number; sd: number; p10: number; p50: number; p90: number; smd: number; topShare: number; selectionRatio: number }
export interface AuditReport {
  members: number; reportedGroup: number;
  overall: { mean: number; sd: number; p10: number; p50: number; p90: number };
  scores: Record<string, ScoreDist>;
  suppressed: Record<string, number>;
  /** Share of each rating quintile that reported a group, so an admin sees whether opt-in skews by rating. */
  reportingByQuintile: Record<string, number>;
  outcomes?: { byGroup?: BiasReport; byQuintile: BiasReport };
  flags: { kind: "selection" | "smd" | "outcome"; group: string; metric?: OutcomeMetric; value: number }[];
  minN: number; threshold: number;
}

const q = (xs: readonly number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))]! : 0);
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b), n = s.length, mean = n ? s.reduce((t, x) => t + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(s.reduce((t, x) => t + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd, p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) };
}

export function auditRatings(members: readonly AuditMember[], o: { minN?: number; threshold?: number } = {}): AuditReport {
  const minN = o.minN ?? 15, threshold = o.threshold ?? 0.8;
  const rated = members.filter(m => Number.isFinite(m.overall));
  const all = stats(rated.map(m => m.overall));
  const quint = ratingQuintiles(new Map(rated.map(m => [m.id, m.overall])));
  const top = new Set(rated.filter(m => ["q4", "q5"].includes(quint.get(m.id) ?? "")).map(m => m.id));
  const groups = new Map<string, AuditMember[]>();
  for (const m of rated) if (m.group) { const a = groups.get(m.group); if (a) a.push(m); else groups.set(m.group, [m]); }
  const reported = rated.filter(m => m.group);
  const topShareAll = reported.length ? reported.filter(m => top.has(m.id)).length / reported.length : 0;
  const scores: AuditReport["scores"] = {}, suppressed: AuditReport["suppressed"] = {};
  const flags: AuditReport["flags"] = [];
  for (const [g, ms] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ms.length < minN) { suppressed[g] = ms.length; continue; }
    const s = stats(ms.map(m => m.overall));
    const rest = stats(reported.filter(m => m.group !== g).map(m => m.overall));
    const pooled = Math.sqrt(((s.n - 1) * s.sd ** 2 + (rest.n - 1) * rest.sd ** 2) / Math.max(1, s.n + rest.n - 2)) || 1;
    const smd = rest.n ? (s.mean - rest.mean) / pooled : 0;
    const topShare = ms.filter(m => top.has(m.id)).length / ms.length;
    const selectionRatio = topShareAll ? topShare / topShareAll : 1;
    scores[g] = { ...s, smd, topShare, selectionRatio };
    if (selectionRatio < threshold) flags.push({ kind: "selection", group: g, value: selectionRatio });
    if (smd < -0.5) flags.push({ kind: "smd", group: g, value: smd });
  }
  const reportingByQuintile: Record<string, number> = {};
  for (const k of ["q1", "q2", "q3", "q4", "q5"]) {
    const inQ = rated.filter(m => quint.get(m.id) === k);
    reportingByQuintile[k] = inQ.length ? inQ.filter(m => m.group).length / inQ.length : 0;
  }
  let outcomes: AuditReport["outcomes"];
  const withOutcomes = rated.filter(m => (m.memberMonths ?? 0) > 0);
  if (withOutcomes.length) {
    const row = (m: AuditMember, group: string) => ({ group, memberMonths: m.memberMonths!, proposals: m.proposals ?? 0, dates: m.dates ?? 0, secondDates: m.secondDates ?? 0 });
    const byQuintile = biasMonitor(withOutcomes.map(m => row(m, quint.get(m.id)!)), { minN, threshold });
    const g = withOutcomes.filter(m => m.group && (groups.get(m.group)?.length ?? 0) >= minN);
    const byGroup = g.length ? biasMonitor(g.map(m => row(m, m.group!)), { minN, threshold }) : undefined;
    outcomes = { ...(byGroup ? { byGroup } : {}), byQuintile };
    for (const r of [byGroup, byQuintile]) for (const a of r?.alerts ?? []) flags.push({ kind: "outcome", group: a.group, metric: a.metric, value: a.ratio });
  }
  return { members: rated.length, reportedGroup: reported.length, overall: { mean: all.mean, sd: all.sd, p10: all.p10, p50: all.p50, p90: all.p90 }, scores, suppressed, reportingByQuintile, ...(outcomes ? { outcomes } : {}), flags, minN, threshold };
}

export function formatAudit(r: AuditReport): string {
  const L: string[] = [];
  const f2 = (x: number) => x.toFixed(2);
  L.push(`bias audit (admin only): ${r.members} rated members, ${r.reportedGroup} reported a group (opt-in); groups under n=${r.minN} suppressed; flag under ${r.threshold}x`);
  L.push(`overall score: mean ${f2(r.overall.mean)}, sd ${f2(r.overall.sd)}, p10/p50/p90 ${f2(r.overall.p10)}/${f2(r.overall.p50)}/${f2(r.overall.p90)}`);
  L.push(`share reporting a group by rating quintile: ${Object.entries(r.reportingByQuintile).map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`).join("  ")}`);
  L.push("");
  L.push("group                 n     mean    sd    p10    p50    p90    SMD    top-2-quintile share  selection ratio");
  for (const [g, s] of Object.entries(r.scores)) L.push(`${g.slice(0, 20).padEnd(20)} ${String(s.n).padStart(4)}  ${f2(s.mean).padStart(6)} ${f2(s.sd).padStart(5)} ${f2(s.p10).padStart(6)} ${f2(s.p50).padStart(6)} ${f2(s.p90).padStart(6)} ${f2(s.smd).padStart(6)}   ${(100 * s.topShare).toFixed(0).padStart(5)}%                ${f2(s.selectionRatio)}`);
  for (const [g, n] of Object.entries(r.suppressed)) L.push(`${g.slice(0, 20).padEnd(20)} suppressed (n=${n} < ${r.minN})`);
  const block = (title: string, b: BiasReport) => {
    L.push("");
    L.push(`${title}: ratio to the overall rate per member-month (${OUTCOME_METRICS.join(" / ")})`);
    for (const [g, x] of Object.entries(b.groups)) L.push(`  ${g.slice(0, 20).padEnd(20)} n=${String(x.n).padStart(4)}  ${OUTCOME_METRICS.map(m => f2(x.ratio[m])).join(" / ")}${x.n < r.minN ? "  (n < minN: not alerted)" : ""}`);
  };
  if (r.outcomes?.byGroup) block("outcomes by group", r.outcomes.byGroup);
  if (r.outcomes) block("outcomes by rating quintile (q1 = lowest)", r.outcomes.byQuintile);
  else L.push("\n(no outcomes in the input: score distributions only)");
  L.push("");
  L.push(r.flags.length ? `FLAGS (${r.flags.length}):` : "no flags");
  for (const x of r.flags) L.push(`  ${x.kind.padEnd(9)} ${x.group}${x.metric ? ` ${x.metric}` : ""}: ${f2(x.value)}${x.kind === "smd" ? " SD vs the other groups" : "x"}`);
  return L.join("\n");
}
