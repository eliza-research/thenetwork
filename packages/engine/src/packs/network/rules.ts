// The Network's hard-filter rules (networkPack.eligibility), moved verbatim from filters.ts.
// ORDER IS PART OF THE CONTRACT (byte-identity rule 3): the funnel counts the FIRST failing reason.
// The core runs its own prefix first (filters.ts: unknown_member, underage, safety_hold, state_paused;
// pairs: duplicate_participant, underage, blocked; configurations: duplicate_participant, then these
// pre-rules, then minors / via / member / pair, then these post-rules, then the geo overlap).
import { DAY } from "@thenetwork/core";
import { isHomeEntry, riskTerms } from "../../filters.ts";
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import { pairKey, type MemberIndex } from "../../world.ts";

export const NETWORK_MEMBER_RULES: readonly MemberRule[] = [
  { id: "state_receiving_contributor", check: (_w, _id, mi, c) => (mi.m.state === "receiving" && CONTRIBUTOR_ROLES.has(c.role) ? "state_receiving_contributor" : null) },
  { id: "category_opt_out", check: (_w, _id, mi, c) => (!mi.m.prefs.categoriesOptIn.includes(c.category) ? "category_opt_out" : null) },
  { id: "romance_opt_out", check: (_w, _id, mi, c) => (c.category === "romance" && !mi.m.prefs.romanceOptIn ? "romance_opt_out" : null) },
  {
    id: "only_when_asked", check: (w, _id, mi, c) => {
      const askedRecently = c.ownIntentCreatedAt !== undefined && w.now - c.ownIntentCreatedAt <= w.cfg.askedRecencyDays * DAY;
      return (mi.m.prefs.onlyWhenAsked || mi.m.unansweredProactive >= 2) && !askedRecently ? "only_when_asked" : null;
    },
  },
  {
    id: "interruption_budget", check: (w, _id, mi, c) => {
      const budget = w.cfg.budgets[mi.m.state];
      return mi.recentProactive + (c.extraProactive ?? 0) >= budget.limit ? "interruption_budget" : null;
    },
  },
  { id: "contribution_budget", check: (w, _id, mi, c) => (CONTRIBUTOR_ROLES.has(c.role) && mi.recentContribution + (c.extraContribution ?? 0) >= w.cfg.contribution.limit ? "contribution_budget" : null) },
  {
    id: "category_quota", check: (w, id, mi, c) => {
      const quota = w.quotas[id]?.[c.category];
      return quota !== undefined && (mi.categoryCount30.get(c.category) ?? 0) >= quota ? "category_quota" : null;
    },
  },
  {
    id: "category_cooldown", check: (w, id, _mi, c) => {
      const declinedAt = w.memberCategoryDeclines.get(id)?.get(c.category);
      return declinedAt !== undefined && w.now - declinedAt < w.cfg.cooldowns.categoryDeclineDays * DAY ? "category_cooldown" : null;
    },
  },
  {
    id: "reliability_holdout", check: (w, id, _mi, c) => {
      const rel = w.reliability[id];
      return rel && rel.noShows >= 2 && rel.completedSinceLastNoShow === 0 && (c.format !== "one_to_one" || c.timeSensitive) ? "reliability_holdout" : null;
    },
  },
];

/** Romance: each side's stated orientation / age range admits the other (unchanged from filters.ts). */
export function romanceCompatible(seeker: MemberIndex, other: MemberIndex): boolean {
  const r = seeker.romance;
  if (!r) return true; // opted in with no stated constraints
  if (other.m.age < r.ageMin || other.m.age > r.ageMax) return false;
  if (r.seeks.length && !r.seeks.some(s => other.romance?.is.includes(s))) return false;
  return true;
}

export const NETWORK_PAIR_RULES: readonly PairRule[] = [
  {
    id: "negative_feedback_cooldown", check: (w, a, b) => {
      const neg = w.negativeFeedback.get(pairKey(a, b));
      return neg !== undefined && w.now - neg < w.cfg.cooldowns.negativeFeedbackDays * DAY ? "negative_feedback_cooldown" : null;
    },
  },
  {
    id: "pair_cooldown", check: (w, a, b) => {
      for (const r of w.pairInteractions.get(pairKey(a, b)) ?? []) {
        if ((r.outcome === "declined" || r.outcome === "expired" || r.outcome === "cancelled") && w.now - r.at < w.cfg.cooldowns.pairDeclinedDays * DAY) return "pair_cooldown";
      }
      return null;
    },
  },
  { id: "active_duplicate", check: (w, a, b) => (w.activePairs.has(pairKey(a, b)) ? "active_duplicate" : null) },
  { id: "unknown_member", check: (_w, _a, _b, _lane, ma, mb) => (!ma || !mb ? "unknown_member" : null) },
  {
    id: "romance_incompatible", check: (_w, _a, _b, lane, ma, mb) => {
      if (lane !== "romance") return null;
      if (!ma.m.prefs.romanceOptIn || !mb.m.prefs.romanceOptIn) return "romance_incompatible";
      if (!romanceCompatible(ma, mb) || !romanceCompatible(mb, ma)) return "romance_incompatible";
      return null;
    },
  },
  { id: "dealbreaker", check: (_w, _a, _b, _lane, ma, mb) => (ma.dealbreakers.some(d => mb.tags.has(d)) || mb.dealbreakers.some(d => ma.tags.has(d)) ? "dealbreaker" : null) },
];

export const NETWORK_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  {
    id: "group_size", check: (w, c) => {
      if (c.kind === "group" || c.kind === "newcomer_welcome") {
        if (c.participants.length < w.cfg.group.minSize || c.participants.length > w.cfg.group.maxSize) return "group_size";
      }
      return null;
    },
  },
  { id: "high_risk", check: (w, c) => (c.riskFlags?.length || riskTerms(w.cfg, c.riskText).length ? "high_risk" : null) },
];

export const NETWORK_CANDIDATE_POST_RULES: readonly CandidateRule[] = [
  {
    // F14: help that enters a home needs 2+ helpers or helpers who already met the requester.
    id: "home_entry_rule", check: (w, c) => {
      if (c.kind === "help" && isHomeEntry(w.cfg, c.riskText)) {
        const requester = c.participants[0]!;
        const helpers = c.participants.slice(1);
        const acquainted = helpers.every(h => w.edgeHas(requester, h, "met") || w.edgeHas(requester, h, "knows") || w.edgeHas(requester, h, "helped"));
        if (helpers.length < 2 && !acquainted) return "home_entry_rule";
        c.safetyClass = "medium";
      }
      return null;
    },
  },
];

/** Pass-3 hard gate, pack part (was judgeDeep.ts hardGate after the core checks). */
export function networkHardGate(w: { get(id: string): MemberIndex | undefined }, c: { participants: string[]; category: string }): string | null {
  for (const id of c.participants) {
    const m = w.get(id)!.m;
    if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
    if (!m.prefs.categoriesOptIn.includes(c.category as never)) return "category_opt_out";
  }
  return null;
}
