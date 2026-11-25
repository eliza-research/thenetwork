// The weekly bias monitor of a network (critical path item 5; AGENTS.md decision 12; mvp-plan
// "Bias monitor by rating quintile and group"). Admin only, aggregates only.
//
// Once a week per network the service builds one outcome row per adult member over the last 28 days
// (proposals that reached them, dates held, second dates with the same person), groups members by
// the quintile of their photo rating ("unrated" without one), and runs the engine's biasMonitor. A
// group whose outcome rate is under 0.8x the overall rate raises an alert (the four-fifths rule). The
// report holds group counts and ratios only: no member id, no score.
import { ADULT_AGE, DAY, type MemberId } from "@thenetwork/core";
import {
  biasDateHeld, biasEveryMs, biasMemberEligible, biasOpportunityInWindow, biasOpportunityReached,
  biasPairMetAgain, biasProductionGroupMinimum, biasSinglePair, biasWindowMs,
} from "../../core/src/generated/weeklyBias.ts";
import { biasMonitor, DEFAULT_BIAS_THRESHOLD, ratingQuintiles, type BiasReport, type MemberOutcome } from "../../engine/src/packs/slop/biasMonitor.ts";
import { parseAppearance } from "../../engine/src/packs/slop/appearance.ts";
import type { DateStandingValidity } from "../../engine/src/packs/slop/standing.ts";

export const BIAS_WINDOW_MS = biasWindowMs;
export const BIAS_EVERY_MS = biasEveryMs;
export const BIAS_THRESHOLD = DEFAULT_BIAS_THRESHOLD;
/** The smallest group that can raise an alert. Smaller than the engine's 15: the NYC pilot is 40-75 adults. */
export const BIAS_MIN_N = biasProductionGroupMinimum;
const MONTH = 30.44 * DAY;

export interface BiasMember { id: MemberId; age: number | null; joinedAt: number | null; tags: readonly string[] }
export interface BiasOpp { participants: readonly MemberId[]; stage: string; createdAt: number; meetingAt?: number; closedFrom?: string }

/** One outcome row per adult member (18+) with at least one day in the window. */
export function biasRows(members: readonly BiasMember[], opps: readonly BiasOpp[], now: number, windowMs = BIAS_WINDOW_MS): MemberOutcome[] {
  const from = now - windowMs;
  const adults = members.filter(m => typeof m.age === "number" && m.joinedAt !== null
    && biasMemberEligible(m.age, ADULT_AGE, now - Math.max(m.joinedAt, from)));
  const overall = new Map<string, number>();
  for (const m of adults) { const a = parseAppearance(m.tags); if (a) overall.set(m.id, a.overall); }
  const quintile = ratingQuintiles(overall);
  // spec/weeklyBias.md, "Outcomes count only the opportunities in the observation window"
  // Reached: created in the window and past review (probed, scheduled, done, or closed after review).
  // Held: done with its meeting in the window, whenever the proposal was created.
  const reached = opps.filter(o => biasOpportunityInWindow(o.createdAt, from, now) && biasOpportunityReached(o.stage, o.closedFrom ?? ""));
  const held = opps.filter(o => biasDateHeld(o.stage, o.meetingAt !== undefined, o.meetingAt ?? 0, from, now));
  const pairDates = new Map<string, number>();
  for (const o of held) if (biasSinglePair(o.participants.length)) { const k = [...o.participants].sort().join("|"); pairDates.set(k, (pairDates.get(k) ?? 0) + 1); }
  return adults.map(m => ({
    group: quintile.get(m.id) ?? "unrated",
    memberMonths: (now - Math.max(m.joinedAt!, from)) / MONTH,
    proposals: reached.filter(o => o.participants.includes(m.id)).length,
    dates: held.filter(o => o.participants.includes(m.id)).length,
    secondDates: [...pairDates].filter(([k, n]) => biasPairMetAgain(n) && k.split("|").includes(m.id)).length,
  }));
}

export interface StoredBiasReport { network: string; app: string; at: number; members: number; report: BiasReport }

export function biasReport(network: string, app: string, members: readonly BiasMember[], opps: readonly BiasOpp[], now: number,
  o: { minN?: number; threshold?: number; dateStanding?: DateStandingValidity } = {}): StoredBiasReport {
  const rows = biasRows(members, opps, now);
  const report = biasMonitor(rows, { minN: o.minN ?? BIAS_MIN_N, threshold: o.threshold ?? BIAS_THRESHOLD });
  return { network, app, at: now, members: rows.length, report: o.dateStanding ? { ...report, dateStanding: o.dateStanding } : report };
}

export function biasAlerts(r: StoredBiasReport): string[] {
  const lines = r.report.alerts.map(a => `[alert] bias ${r.network}: group ${a.group} ${a.metric} at ${a.ratio.toFixed(2)}x the overall rate (under ${BIAS_THRESHOLD}x)`);
  const d = r.report.dateStanding;
  if (d && !d.predicts) lines.push(`[alert] bias ${r.network}: the Date lane does not use photo standing (the standing gap does not predict mutual yes; ${d.positives} positive, ${d.negatives} negative outcomes)`);
  return lines;
}
