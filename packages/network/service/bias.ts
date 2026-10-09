// The weekly bias monitor of a network (critical path item 5; AGENTS.md decision 12; mvp-plan
// "Bias monitor by rating quintile and group"). Admin only, aggregates only.
//
// Once a week per network the service builds one outcome row per adult member over the last 28 days
// (proposals that reached them, dates held, second dates with the same person), groups members by
// the quintile of their photo rating ("unrated" without one), and runs the engine's biasMonitor. A
// group whose outcome rate is under 0.8x the overall rate raises an alert (the four-fifths rule). The
// report holds group counts and ratios only: no member id, no score.
import { DAY, type MemberId } from "@thenetwork/core";
import { biasMonitor, ratingQuintiles, type BiasReport, type MemberOutcome } from "../../engine/src/packs/slop/biasMonitor.ts";
import { parseAppearance } from "../../engine/src/packs/slop/appearance.ts";

export const BIAS_WINDOW_MS = 28 * DAY;
export const BIAS_EVERY_MS = 7 * DAY;
export const BIAS_THRESHOLD = 0.8;
/** The smallest group that can raise an alert. Smaller than the engine's 15: the NYC pilot is 40-75 adults. */
export const BIAS_MIN_N = 8;
const MONTH = 30.44 * DAY;

export interface BiasMember { id: MemberId; age: number | null; joinedAt: number | null; tags: readonly string[] }
export interface BiasOpp { participants: readonly MemberId[]; stage: string; createdAt: number; meetingAt?: number; closedFrom?: string }

/** One outcome row per adult member (18+) with at least one day in the window. */
export function biasRows(members: readonly BiasMember[], opps: readonly BiasOpp[], now: number, windowMs = BIAS_WINDOW_MS): MemberOutcome[] {
  const from = now - windowMs;
  const adults = members.filter(m => typeof m.age === "number" && m.age >= 18 && m.joinedAt !== null && now - Math.max(m.joinedAt, from) >= DAY);
  const overall = new Map<string, number>();
  for (const m of adults) { const a = parseAppearance(m.tags); if (a) overall.set(m.id, a.overall); }
  const quintile = ratingQuintiles(overall);
  // Reached: past review (probed, scheduled, done, or closed after review). Held: done, meeting in the past.
  const recent = opps.filter(o => o.createdAt >= from && o.createdAt <= now);
  const reached = recent.filter(o => o.stage !== "review" && !(o.stage === "closed" && (o.closedFrom ?? "review") === "review"));
  const held = recent.filter(o => o.stage === "done" && o.meetingAt !== undefined && o.meetingAt <= now);
  const pairDates = new Map<string, number>();
  for (const o of held) if (o.participants.length === 2) { const k = [...o.participants].sort().join("|"); pairDates.set(k, (pairDates.get(k) ?? 0) + 1); }
  return adults.map(m => ({
    group: quintile.get(m.id) ?? "unrated",
    memberMonths: (now - Math.max(m.joinedAt!, from)) / MONTH,
    proposals: reached.filter(o => o.participants.includes(m.id)).length,
    dates: held.filter(o => o.participants.includes(m.id)).length,
    secondDates: [...pairDates].filter(([k, n]) => n >= 2 && k.split("|").includes(m.id)).length,
  }));
}

export interface StoredBiasReport { network: string; app: string; at: number; members: number; report: BiasReport }

/** The report for one network now. */
export function biasReport(network: string, app: string, members: readonly BiasMember[], opps: readonly BiasOpp[], now: number, o: { minN?: number; threshold?: number } = {}): StoredBiasReport {
  const rows = biasRows(members, opps, now);
  return { network, app, at: now, members: rows.length, report: biasMonitor(rows, { minN: o.minN ?? BIAS_MIN_N, threshold: o.threshold ?? BIAS_THRESHOLD }) };
}

/** The alert lines for a report (empty when every group is at 0.8x or more). */
export const biasAlerts = (r: StoredBiasReport) =>
  r.report.alerts.map(a => `[alert] bias ${r.network}: group ${a.group} ${a.metric} at ${a.ratio.toFixed(2)}x the overall rate (under ${BIAS_THRESHOLD}x)`);
