// Hard filters (Section 33.5). Hard constraints are never traded for score (33.1): a candidate
// failing any of these is dropped before scoring, and the reason is counted in the run funnel.
import type { Category, MemberId } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { EngineConfig } from "./config.ts";
import { tokenize } from "./embed.ts";
import type { Candidate, Format, Role } from "./types.ts";
import { CONTRIBUTOR_ROLES } from "./types.ts";
import { pairKey, type World } from "./world.ts";

export type FilterReason =
  | "unknown_member" | "underage" | "safety_hold" | "state_paused" | "state_receiving_contributor"
  | "category_opt_out" | "romance_opt_out" | "only_when_asked" | "interruption_budget"
  | "contribution_budget" | "category_quota" | "category_cooldown" | "reliability_holdout"
  | "blocked" | "negative_feedback_cooldown" | "pair_cooldown" | "active_duplicate"
  | "romance_incompatible" | "dealbreaker" | "high_risk" | "home_entry_rule"
  | "no_presence_overlap" | "group_size" | "duplicate_participant";

export interface MemberCheck {
  category: Category; role: Role; format: Format; timeSensitive: boolean;
  /** Extra already-planned asks this run (load accounting inside the run). */
  extraProactive?: number; extraContribution?: number;
  /** Intent that the member themselves raised (for 'only when I ask'). */
  ownIntentCreatedAt?: number;
}

/**
 * Minors policy (founder decision 2026-10-05, PRD 17.4 as amended): members under 18 may join
 * but are NEVER connected to other people. This age is policy, not a tuning knob: config can
 * raise the bar (`ageMin`) but never lower it below 18. Missing / non-numeric ages fail closed.
 */
export const ADULT_AGE = 18;
export const isMinorAge = (age: unknown): boolean => !(typeof age === "number" && age >= ADULT_AGE);
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
  if (isMinorAge(m.age) || !(m.age >= cfg.ageMin)) return "underage";
  if (w.holds.has(id)) return "safety_hold";
  if (m.state === "paused") return "state_paused";
  if (m.state === "receiving" && CONTRIBUTOR_ROLES.has(c.role)) return "state_receiving_contributor";
  if (!m.prefs.categoriesOptIn.includes(c.category)) return "category_opt_out";
  if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
  const askedRecently = c.ownIntentCreatedAt !== undefined && w.now - c.ownIntentCreatedAt <= cfg.askedRecencyDays * DAY;
  if ((m.prefs.onlyWhenAsked || m.unansweredProactive >= 2) && !askedRecently) return "only_when_asked";
  const budget = cfg.budgets[m.state];
  if (mi.recentProactive + (c.extraProactive ?? 0) >= budget.limit) return "interruption_budget";
  if (CONTRIBUTOR_ROLES.has(c.role) && mi.recentContribution + (c.extraContribution ?? 0) >= cfg.contribution.limit) return "contribution_budget";
  const quota = w.quotas[id]?.[c.category];
  if (quota !== undefined && (mi.categoryCount30.get(c.category) ?? 0) >= quota) return "category_quota";
  const declinedAt = w.memberCategoryDeclines.get(id)?.get(c.category);
  if (declinedAt !== undefined && w.now - declinedAt < cfg.cooldowns.categoryDeclineDays * DAY) return "category_cooldown";
  const rel = w.reliability[id];
  if (rel && rel.noShows >= 2 && rel.completedSinceLastNoShow === 0 && (c.format !== "one_to_one" || c.timeSensitive)) return "reliability_holdout";
  return null;
}

/** Pair-level hard constraints. Completed / positive history never blocks (ME-005). */
export function pairReason(w: World, a: MemberId, b: MemberId, category: Category): FilterReason | null {
  const cfg = w.cfg;
  if (a === b) return "duplicate_participant";
  if (isMinor(w, a) || isMinor(w, b)) return "underage"; // minors are never paired with anyone
  const k = pairKey(a, b);
  if (w.blocked.has(k)) return "blocked";
  const neg = w.negativeFeedback.get(k);
  if (neg !== undefined && w.now - neg < cfg.cooldowns.negativeFeedbackDays * DAY) return "negative_feedback_cooldown";
  for (const r of w.pairInteractions.get(k) ?? []) {
    if ((r.outcome === "declined" || r.outcome === "expired" || r.outcome === "cancelled") && w.now - r.at < cfg.cooldowns.pairDeclinedDays * DAY) return "pair_cooldown";
  }
  if (w.activePairs.has(k)) return "active_duplicate";
  const ma = w.get(a), mb = w.get(b);
  if (!ma || !mb) return "unknown_member";
  if (category === "romance") {
    if (!ma.m.prefs.romanceOptIn || !mb.m.prefs.romanceOptIn) return "romance_incompatible";
    if (!romanceCompatible(ma, mb) || !romanceCompatible(mb, ma)) return "romance_incompatible";
  }
  if (ma.dealbreakers.some(d => mb.tags.has(d)) || mb.dealbreakers.some(d => ma.tags.has(d))) return "dealbreaker";
  return null;
}

function romanceCompatible(seeker: NonNullable<ReturnType<World["get"]>>, other: NonNullable<ReturnType<World["get"]>>): boolean {
  const r = seeker.romance;
  if (!r) return true; // opted in with no stated constraints
  if (other.m.age < r.ageMin || other.m.age > r.ageMax) return false;
  if (r.seeks.length && !r.seeks.some(s => other.romance?.is.includes(s))) return false;
  return true;
}

export function riskTerms(cfg: EngineConfig, text: string): string[] {
  const toks = new Set(tokenize(text.replace(/_/g, " ")).concat((text.toLowerCase().match(/[a-z_]+/g) ?? [])));
  return cfg.highRiskTerms.filter(t => toks.has(t));
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
  if (c.kind === "group" || c.kind === "newcomer_welcome") {
    if (c.participants.length < cfg.group.minSize || c.participants.length > cfg.group.maxSize) return "group_size";
  }
  if (riskTerms(cfg, c.riskText).length) return "high_risk";
  // Minors policy: no one under 18 in any role (participant, alternate, via/connector).
  if (involvesMinor(w, c)) return "underage";
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
  // F14: help that enters a home needs 2+ helpers or helpers who already met the requester.
  if (c.kind === "help" && isHomeEntry(cfg, c.riskText)) {
    const requester = c.participants[0]!;
    const helpers = c.participants.slice(1);
    const acquainted = helpers.every(h => w.edgeHas(requester, h, "met") || w.edgeHas(requester, h, "knows") || w.edgeHas(requester, h, "helped"));
    if (helpers.length < 2 && !acquainted) return "home_entry_rule";
    c.safetyClass = "medium";
  }
  // Presence / availability overlap in the opportunity window (ME-011).
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
