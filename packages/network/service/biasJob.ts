// The weekly bias monitor on the live path (PRD 40.5, 37.3: "bias monitor by rating quintile and
// group: at least 0.85x; pause or roll back under 0.8x"). ADMIN ONLY, aggregates only.
//
// Once a week per slop network (the service's tick, by the runtime clock; staff can run it on demand
// through GET /bias), the job:
//  1. builds one MemberOutcome row per adult member from the network tables over the last 4 weeks:
//       proposals    exposure: opportunities that reached the member (anything past review);
//       dates        mutual yes: the date was booked (scheduled, held, or cancelled after booking);
//       secondDates  dates held: the member attended;
//     (the engine's biasMonitor names the three metrics; this job's labels are in the report);
//  2. groups them twice: by rating quintile (rated members only; the quintile, never the rating) and by
//     the self-reported group the member gave (romance:is:<gender>; never inferred from photos or names);
//  3. runs biasMonitor on each and takes the lowest ratio of any group with at least `minN` members;
//  4. stores the report (network.bias_reports, migration 0020) and one network.events row of type
//     'bias_report' with {ratio, min_group, action}; ops monitoring alerts on that event type;
//  5. under 0.8x it pauses slop matching through the matching switch (reason "bias monitor"); under
//     0.85x it only alerts. A person turns matching back on after a look.
// No member id, rating or score is in the report, the event or the log.
import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { biasMonitor, ratingQuintiles, type BiasReport, type MemberOutcome, type OutcomeMetric } from "@thenetwork/engine/src/packs/slop/biasMonitor.ts";
import { parseAppearance } from "@thenetwork/engine/src/packs/slop/appearance.ts";

export const BIAS_ALERT_RATIO = 0.85;
export const BIAS_PAUSE_RATIO = 0.8;
/** The job runs this often per network. */
export const BIAS_EVERY_MS = 7 * DAY;
/** The outcome window. */
export const BIAS_WINDOW_MS = 28 * DAY;
/** The smallest group the monitor judges (smaller groups are reported, never alerted on). */
export const BIAS_MIN_N = 15;
/** What the engine's metric names mean here. */
export const BIAS_METRIC_LABELS: Record<OutcomeMetric, string> = { proposals: "exposure", dates: "mutual_yes", secondDates: "dates_held" };
const MONTH_MS = 30.4375 * DAY;

export type BiasAction = "ok" | "alert" | "pause";
export const biasAction = (ratio: number): BiasAction => (ratio < BIAS_PAUSE_RATIO ? "pause" : ratio < BIAS_ALERT_RATIO ? "alert" : "ok");

/** Outcome rows by grouping: `quintile` (q1 = lowest rated) and `group` (self-reported). */
export interface Outcomes { quintile: MemberOutcome[]; group: MemberOutcome[] }

export interface BiasSummary {
  app: string; at: number; windowStart: number; windowEnd: number;
  ratio: number; minGroup: string; action: BiasAction;
  metrics: typeof BIAS_METRIC_LABELS;
  byQuintile: BiasReport; byGroup: BiasReport;
  members: { quintile: number; group: number };
}

/** The lowest ratio of any judged group in either report (1 when no group is large enough). */
export function summarize(app: string, o: Outcomes, at: number, windowStart: number, minN = BIAS_MIN_N): BiasSummary {
  const byQuintile = biasMonitor(o.quintile, { minN, threshold: BIAS_PAUSE_RATIO });
  const byGroup = biasMonitor(o.group, { minN, threshold: BIAS_PAUSE_RATIO });
  let ratio = 1, minGroup = "-";
  for (const [prefix, r] of [["quintile", byQuintile], ["group", byGroup]] as const) {
    for (const m of Object.values(r.min)) if (m.group !== "-" && m.ratio < ratio) { ratio = m.ratio; minGroup = `${prefix}:${m.group}`; }
  }
  ratio = Math.round(ratio * 1000) / 1000;
  return { app, at, windowStart, windowEnd: at, ratio, minGroup, action: biasAction(ratio), metrics: BIAS_METRIC_LABELS, byQuintile, byGroup, members: { quintile: o.quintile.length, group: o.group.length } };
}

type Row = Record<string, any>;

/**
 * The outcome rows of one app from the network tables (inside an app-scoped transaction). Adults
 * only (age 18+), members who joined before the window ends; member-months are the part of the
 * window they were members.
 */
export async function memberOutcomes(tx: SQL, app: string, from: number, to: number): Promise<Outcomes> {
  const members = await tx`select id, joined_at from network.members where app_id = ${app} and age >= 18
    and account_status in ('active', 'paused') and joined_at is not null and joined_at < ${new Date(to)}` as Row[];
  if (!members.length) return { quintile: [], group: [] };
  const facets = await tx`select member_id, tags from network.facets where app_id = ${app} and status <> 'rejected'
    and exists (select 1 from unnest(tags) t where t like 'appearance:%' or t like 'romance:is:%')` as Row[];
  const parts = await tx`select p.member_id, o.state, p.status from network.participations p
    join network.opportunities o on o.id = p.opportunity_id
    where p.app_id = ${app} and o.app_id = ${app} and p.role = 'participant' and o.created_at >= ${new Date(from)} and o.created_at < ${new Date(to)}` as Row[];
  const tags = new Map<string, string[]>();
  for (const f of facets) tags.set(f.member_id, [...(tags.get(f.member_id) ?? []), ...(f.tags as string[])]);
  const out = new Map<string, { proposals: number; dates: number; secondDates: number }>();
  for (const p of parts) {
    const x = out.get(p.member_id) ?? { proposals: 0, dates: 0, secondDates: 0 };
    // Exposure: past review, and the member was reached (not a never-sent or skipped item).
    if (p.state !== "IN_REVIEW" && !(p.state === "SKIPPED" && p.status === "pending")) x.proposals++;
    if (p.state === "SCHEDULED" || p.state === "COMPLETED" || p.state === "CANCELLED") x.dates++;
    if (p.state === "COMPLETED" && p.status === "attended") x.secondDates++;
    out.set(p.member_id, x);
  }
  const overall = new Map<string, number>();
  const rows = new Map<string, Omit<MemberOutcome, "group"> & { gender: string }>();
  for (const m of members) {
    const joined = new Date(m.joined_at).getTime();
    const mm = Math.max(0, to - Math.max(from, joined)) / MONTH_MS;
    if (!(mm > 0)) continue;
    const t = tags.get(m.id) ?? [];
    const a = parseAppearance(t);
    if (a) overall.set(m.id, a.overall);
    const gender = t.filter(x => x.startsWith("romance:is:")).at(-1)?.slice("romance:is:".length) ?? "unknown";
    rows.set(m.id, { memberMonths: mm, ...(out.get(m.id) ?? { proposals: 0, dates: 0, secondDates: 0 }), gender });
  }
  const q = ratingQuintiles(new Map([...overall].filter(([id]) => rows.has(id))));
  const strip = ({ gender: _g, ...r }: Omit<MemberOutcome, "group"> & { gender: string }) => r;
  return {
    quintile: [...q].map(([id, group]) => ({ group, ...strip(rows.get(id)!) })),
    group: [...rows.values()].map(r => ({ group: r.gender, ...strip(r) })),
  };
}

export interface BiasJobDeps {
  app: string;
  now: () => number;
  /** An app-scoped transaction (NetworkRuntime.scoped). */
  scoped<T>(fn: (tx: SQL) => Promise<T>): Promise<T>;
  /** Pause the app's matching through the matching switch (audited by the caller). */
  pause(reason: string): Promise<void>;
  /** Tests: outcome rows instead of the tables. */
  outcomes?: () => Promise<Outcomes>;
  minN?: number;
  log?: (s: string) => void;
}

/** The newest stored report's time for this app, or undefined. */
export async function lastBiasRun(d: Pick<BiasJobDeps, "app" | "scoped">): Promise<number | undefined> {
  const [r] = await d.scoped(tx => tx`select max(at) as at from network.bias_reports where app_id = ${d.app}`) as Row[];
  return r?.at ? new Date(r.at).getTime() : undefined;
}

/** Due when no report is stored yet or the newest is a week old. */
export async function biasDue(d: Pick<BiasJobDeps, "app" | "scoped" | "now">): Promise<boolean> {
  const last = await lastBiasRun(d);
  return last === undefined || d.now() - last >= BIAS_EVERY_MS;
}

/** One run: outcomes, the report, the stored row and event, and the pause under 0.8x. */
export async function runBiasJob(d: BiasJobDeps): Promise<BiasSummary> {
  const at = d.now(), from = at - BIAS_WINDOW_MS;
  const o = d.outcomes ? await d.outcomes() : await d.scoped(tx => memberOutcomes(tx, d.app, from, at));
  const s = summarize(d.app, o, at, from, d.minN ?? BIAS_MIN_N);
  const payload = { ratio: s.ratio, min_group: s.minGroup, action: s.action };
  await d.scoped(async tx => {
    await tx`insert into network.bias_reports (id, app_id, at, window_start, window_end, ratio, min_group, action, report)
      values (${`bias_${randomUUID()}`}, ${d.app}, ${new Date(at)}, ${new Date(from)}, ${new Date(at)}, ${s.ratio}, ${s.minGroup}, ${s.action}, ${s}::jsonb)`;
    await tx`insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
      values (${d.app}, ${new Date(at)}, 'engine', 'bias_monitor', 'bias_report', 'app', ${d.app}, ${payload}::jsonb)`;
  });
  d.log?.(`[bias] ${d.app}: ratio ${s.ratio} (${s.minGroup}), ${s.action}`);
  if (s.action === "pause") await d.pause("bias monitor");
  return s;
}
