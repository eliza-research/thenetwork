// The weekly bias monitor of a network (critical path item 5; AGENTS.md decision 12; mvp-plan
// "Bias monitor by rating quintile and group"). Admin only, aggregates only.
//
// Once a week per network the service builds one outcome row per adult member over the last 28 days
// (proposals that reached them, dates held, second dates with the same person), groups members by
// the quintile of their photo rating ("unrated" without one), and runs the engine's biasMonitor. A
// group whose outcome rate is under 0.8x the overall rate raises an alert (the four-fifths rule). The
// report holds group counts and ratios only: no member id, no score.
import { DAY, type MemberId } from "@thenetwork/core";
import { biasMonitor, OUTCOME_METRICS, ratingQuintiles, type BiasReport, type MemberOutcome } from "../../engine/src/packs/slop/biasMonitor.ts";
import { parseAppearance } from "../../engine/src/packs/slop/appearance.ts";

export const BIAS_WINDOW_MS = 28 * DAY;
export const BIAS_EVERY_MS = 7 * DAY;
export const BIAS_THRESHOLD = 0.8;
/** The smallest group that can raise an alert. Smaller than the engine's 15: the NYC pilot is 40-75 adults. */
export const BIAS_MIN_N = 8;
const MONTH = 30.44 * DAY;

export interface BiasMember { id: MemberId; age: number | null; joinedAt: number | null; tags: readonly string[] }
export interface BiasOpp {
  createdAt: number;
  /** The members a probe or a reveal reached (a probe waiting for its turn or its send window has reached nobody). */
  contacted: ReadonlySet<MemberId>;
  /** The booked members that attendance found present, once it is resolved (none before). */
  attended?: readonly MemberId[];
}

/** One outcome row per adult member (18+) with at least one day in the window. */
export function biasRows(members: readonly BiasMember[], opps: readonly BiasOpp[], now: number, windowMs = BIAS_WINDOW_MS): MemberOutcome[] {
  const from = now - windowMs;
  const adults = members.filter(m => typeof m.age === "number" && m.age >= 18 && m.joinedAt !== null && now - Math.max(m.joinedAt, from) >= DAY);
  const overall = new Map<string, number>();
  for (const m of adults) { const a = parseAppearance(m.tags); if (a) overall.set(m.id, a.overall); }
  const quintile = ratingQuintiles(overall);
  // Reached: a probe or a reveal went out to the member (SD-450). Held: attendance found the member and
  // someone else there; a booked date that one side missed or ghosted is not a date held (SD-451).
  const recent = opps.filter(o => o.createdAt >= from && o.createdAt <= now);
  const pair = (o: BiasOpp) => [...o.attended!].sort().join("|");
  const held = recent.filter(o => (o.attended?.length ?? 0) >= 2);
  // A second date: a pair with a date held in the window and two or more held dates in all, so a first
  // date from before the window still counts (SD-454).
  const inWindow = new Set(held.filter(o => o.attended!.length === 2).map(pair));
  const pairDates = new Map<string, number>();
  for (const o of opps) if (o.createdAt <= now && o.attended?.length === 2 && inWindow.has(pair(o))) pairDates.set(pair(o), (pairDates.get(pair(o)) ?? 0) + 1);
  return adults.map(m => ({
    group: quintile.get(m.id) ?? "unrated",
    memberMonths: (now - Math.max(m.joinedAt!, from)) / MONTH,
    proposals: recent.filter(o => o.contacted.has(m.id)).length,
    dates: held.filter(o => o.attended!.includes(m.id)).length,
    secondDates: [...pairDates].filter(([k, n]) => n >= 2 && k.split("|").includes(m.id)).length,
  }));
}

export interface StoredBiasReport { network: string; app: string; at: number; members: number; report: BiasReport }

/** The report for one network now. */
export function biasReport(network: string, app: string, members: readonly BiasMember[], opps: readonly BiasOpp[], now: number, o: { minN?: number; threshold?: number } = {}): StoredBiasReport {
  const rows = biasRows(members, opps, now);
  return { network, app, at: now, members: rows.length, report: biasMonitor(rows, { minN: o.minN ?? BIAS_MIN_N, threshold: o.threshold ?? BIAS_THRESHOLD }) };
}

/**
 * A report that can compare no group (SD-237): fewer than two groups of BIAS_MIN_N or more adults (the
 * rater is off, or the pilot is too small for its quintiles), or no outcome of any kind (every ratio is
 * then 1). It has no alerts, but it is not a pass: the 0.8x rule could not be checked.
 */
export const biasBlind = (r: BiasReport) =>
  Object.values(r.groups).filter(g => g.n >= BIAS_MIN_N).length < 2 || OUTCOME_METRICS.every(m => !r.overall[m]);

/** The alert lines for a report (empty when every group is at 0.8x or more). */
export const biasAlerts = (r: StoredBiasReport) =>
  r.report.alerts.map(a => `[alert] bias ${r.network}: group ${a.group} ${a.metric} at ${a.ratio.toFixed(2)}x the overall rate (under ${BIAS_THRESHOLD}x)`);
