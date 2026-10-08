// Hard filters (Section 33.5). Hard constraints are never traded for score (33.1): a candidate
// failing any of these is dropped before scoring, and the reason is counted in the run funnel.
import type { Category, MemberId } from "@thenetwork/core";
import { ADULT_AGE as CORE_ADULT_AGE, canBeMatched, DAY, HOUR } from "@thenetwork/core";
import type { EngineConfig } from "./config.ts";
import type { Candidate, Format, Role } from "./types.ts";
import { pairKey, type World } from "./world.ts";

/**
 * Funnel reasons. The core reasons (unknown_member, underage, safety_hold, state_paused, blocked,
 * duplicate_participant, no_presence_overlap) plus networkPack's; other packs' rules may return
 * their own reason strings (the `string & {}` arm keeps autocomplete for the known ones).
 */
export type FilterReason =
  | "unknown_member" | "underage" | "safety_hold" | "state_paused" | "state_receiving_contributor"
  | "category_opt_out" | "romance_opt_out" | "only_when_asked" | "interruption_budget"
  | "contribution_budget" | "category_quota" | "category_cooldown" | "reliability_holdout"
  | "blocked" | "negative_feedback_cooldown" | "pair_cooldown" | "active_duplicate"
  | "romance_incompatible" | "dealbreaker" | "high_risk" | "home_entry_rule"
  | "no_presence_overlap" | "group_size" | "duplicate_participant" | (string & {});

import type { MemberCheck } from "./pack.ts";
export type { MemberCheck };

/**
 * Minors policy (founder decisions 2026-10-05 and 2026-10-07; `packages/core/src/policy.ts`):
 * under-13s cannot join; members aged 13-17 may join but are NEVER matched or connected to other
 * people. This age is policy, not a tuning knob: config can raise the bar (`ageMin`) but never
 * lower it below 18. Missing / non-numeric ages fail closed.
 */
export const ADULT_AGE = CORE_ADULT_AGE;
export const isMinorAge = (age: unknown): boolean => !canBeMatched(age);
/** True if `id` is a known member under 18 (or with an unknown/invalid age). Unknown ids are not minors here. */
export function isMinor(w: World, id: MemberId): boolean {
  const mi = w.get(id);
  return !!mi && isMinorAge(mi.m.age);
}
/**
 * Every member a candidate touches in ANY role: participants, alternates (backfill), and the
 * warm-path intermediary (`via`). Used for the minors hard filter.
 */
export function involvedMembers(c: Pick<Candidate, "participants" | "alternates" | "via">): MemberId[] {
  return [...c.participants, ...(c.alternates ?? []), ...(c.via ? [c.via] : [])];
}
export function involvesMinor(w: World, c: Pick<Candidate, "participants" | "alternates" | "via">): boolean {
  return involvedMembers(c).some(id => isMinor(w, id));
}

/** Member-level hard constraints for taking part in a candidate with a given role. */
export function memberReason(w: World, id: MemberId, c: MemberCheck): FilterReason | null {
  const cfg = w.cfg;
  const mi = w.get(id);
  if (!mi) return "unknown_member";
  const m = mi.m;
  // Core prefix (cannot be overridden or reordered by a pack): minors / age floor, holds, pause.
  if (isMinorAge(m.age) || !(m.age >= cfg.ageMin) || !(m.age >= w.pack.eligibility.minMatchAge)) return "underage";
  if (w.holds.has(id)) return "safety_hold";
  if (m.state === "paused") return "state_paused";
  // Pack rules in order (networkPack: packs/network/rules.ts, the pre-refactor order).
  for (const r of w.pack.eligibility.memberRules) {
    const reason = r.check(w, id, mi, c);
    if (reason) return reason;
  }
  return null;
}

/** Pair-level hard constraints. Completed / positive history never blocks (ME-005). */
export function pairReason(w: World, a: MemberId, b: MemberId, category: Category): FilterReason | null {
  if (a === b) return "duplicate_participant";
  if (isMinor(w, a) || isMinor(w, b)) return "underage"; // minors are never paired with anyone
  // Core prefix: blocks win (either direction).
  if (w.blocked.has(pairKey(a, b))) return "blocked";
  const ma = w.get(a), mb = w.get(b);
  // Pack rules in order (networkPack: cooldowns, active duplicate, known members, romance, dealbreakers).
  for (const r of w.pack.eligibility.pairRules) {
    const reason = r.check(w, a, b, category, ma!, mb!);
    if (reason) return reason;
  }
  if (!ma || !mb) return "unknown_member";
  // Optional geo hard filter (radius packs: mutual radius). Absent for networkPack.
  return w.pack.geo.pairReason?.(w, a, b) ?? null;
}

const riskCache = new WeakMap<EngineConfig, RegExp[]>();
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function riskMatchers(cfg: EngineConfig): RegExp[] {
  let rs = riskCache.get(cfg);
  if (!rs) {
    rs = [
      // Whole words / phrases only (plural allowed; "-" or "_" may stand for a space).
      ...cfg.highRiskTerms.map(t => new RegExp(`\\b${escapeRe(t.toLowerCase().replace(/_/g, " ")).replace(/ /g, "[\\s-]+")}(s|es)?\\b`)),
      ...(cfg.highRiskPatterns ?? []).map(p => new RegExp(p)),
    ];
    riskCache.set(cfg, rs);
  }
  return rs;
}
/**
 * High-risk content in candidate text (F14/F15): the matched words or phrases, empty if none.
 * Whole-word terms plus context rules (see config.highRiskPatterns), so "parents with young
 * kids" or "lend a hand" pass while "babysit my kids" or "lend me cash" do not.
 */
export function riskTerms(cfg: EngineConfig, text: string): string[] {
  const norm = text.toLowerCase().replace(/_/g, " ").replace(/[\u2018\u2019]/g, "'");
  const out: string[] = [];
  for (const re of riskMatchers(cfg)) {
    const m = norm.match(re);
    if (m) out.push(m[0].trim());
  }
  return out;
}
export function isHomeEntry(cfg: EngineConfig, text: string): boolean {
  const low = ` ${text.toLowerCase()} `;
  return cfg.homeEntryTerms.some(t => low.includes(` ${t} `) || low.includes(` ${t}.`) || low.includes(` ${t},`));
}

export interface RunUsage { proactive: Map<MemberId, number>; contribution: Map<MemberId, number> }

/**
 * Full hard-filter check for a candidate configuration. Also resolves the city and window
 * (presence overlap). Returns the first failing reason or null.
 */
export function candidateReason(w: World, c: Candidate, usage?: RunUsage): FilterReason | null {
  const cfg = w.cfg;
  if (new Set(c.participants).size !== c.participants.length) return "duplicate_participant";
  // Pack rules that run before the core participant checks (networkPack: group_size, high_risk).
  for (const r of w.pack.eligibility.candidatePreRules) {
    const reason = r.check(w, c);
    if (reason) return reason;
  }
  // Minors policy: no one under 18 in any role (participant, alternate, via/connector).
  if (involvesMinor(w, c)) return "underage";
  // The warm-path intermediary is named to both sides and asked to vouch: never someone on a
  // safety hold, paused, or blocked by either participant.
  if (c.via) {
    const v = w.get(c.via);
    if (!v) return "unknown_member";
    if (w.holds.has(c.via)) return "safety_hold";
    if (v.m.state === "paused") return "state_paused";
    if (c.participants.some(id => w.blocked.has(pairKey(id, c.via!)))) return "blocked";
  }
  for (const id of c.participants) {
    const own = c.anchor?.type === "intent" ? w.intentById.get(c.anchor.id) : undefined;
    const r = memberReason(w, id, {
      category: c.category, role: c.roles[id] ?? "peer", format: c.format, timeSensitive: c.timeSensitive,
      extraProactive: usage?.proactive.get(id), extraContribution: usage?.contribution.get(id),
      ownIntentCreatedAt: own && own.memberId === id ? own.createdAt : undefined,
    });
    if (r) return r;
  }
  for (let i = 0; i < c.participants.length; i++) for (let j = i + 1; j < c.participants.length; j++) {
    const r = pairReason(w, c.participants[i]!, c.participants[j]!, c.category);
    if (r) return r;
  }
  // Pack rules after the member / pair checks (networkPack: the F14 home-entry rule).
  for (const r of w.pack.eligibility.candidatePostRules) {
    const reason = r.check(w, c);
    if (reason) return reason;
  }
  // Presence / availability overlap in the opportunity window (ME-011): the core geo filter.
  const start = c.fixedWindow?.start ?? w.now;
  const end = c.fixedWindow?.end ?? w.now + cfg.windowDays * DAY;
  if (end <= w.now) return "no_presence_overlap";
  const ov = w.overlap(c.participants, Math.max(start, w.now), end, c.preferredCity);
  if (!ov) return "no_presence_overlap";
  if (c.preferredCity && c.fixedWindow && ov.city !== c.preferredCity) return "no_presence_overlap";
  c.city = ov.city;
  const first = ov.intervals[0]!;
  c.window = c.fixedWindow ? { start: Math.max(c.fixedWindow.start, first[0]), end: Math.min(c.fixedWindow.end, first[1]) } : { start: first[0], end: first[1] };
  if (c.window.end - c.window.start < Math.min(cfg.minOverlapHours * HOUR, (end - start) * 0.99)) {
    // Fall back to the longest interval if the first is short.
    const longest = [...ov.intervals].sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0]!;
    c.window = { start: longest[0], end: longest[1] };
  }
  return null;
}

/**
 * Send-time re-check for invites, accepts and backfills (audit P1-5). Narrower than memberReason:
 * budgets, quotas and cooldowns were already applied when the opportunity was proposed and must
 * not cancel a live invite, but these always win at send time:
 *  - unknown member, under 18 (or unknown age), safety hold, paused;
 *  - opted out of proactive contact ("only when I ask" / two-unanswered) is NOT included: the
 *    member already has the invite; it is handled by outreach.ts on the next proactive message;
 *  - a block (either direction) with anyone else still in the opportunity.
 * `optedOut` lets the caller add channel-level opt-outs (STOP) that the World doesn't model.
 */
export function sendTimeReason(w: World, id: MemberId, others: MemberId[] = [], optedOut?: (id: MemberId) => boolean): FilterReason | "opted_out" | null {
  const mi = w.get(id);
  if (!mi) return "unknown_member";
  if (isMinorAge(mi.m.age)) return "underage";
  if (w.holds.has(id)) return "safety_hold";
  if (mi.m.state === "paused") return "state_paused";
  if (optedOut?.(id)) return "opted_out";
  for (const o of others) if (o !== id && w.blocked.has(pairKey(id, o))) return "blocked";
  return null;
}

/** An opportunity.ts `EligibilityCheck` over a World snapshot. */
export const eligibilityFor = (w: World, optedOut?: (id: MemberId) => boolean) =>
  (id: MemberId, others: MemberId[]): string | null => sendTimeReason(w, id, others, optedOut);
