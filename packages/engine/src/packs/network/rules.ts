import { budgetReached, DAY, inCooldown, pairInteractionCooling } from "@thenetwork/core";
import { homeHelperSetAllowed } from "../../../../core/src/generated/boundedHelp.ts";
import { isHomeEntry, memberQualityBandOf, memberReliabilityTier, memberVampireTierOf, riskTerms } from "../../filters.ts";
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import { pairKey, type MemberIndex } from "../../world.ts";
import { cofounderMustHavesFit } from "./cofounderFacts.ts";

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
      return budgetReached(mi.recentProactive, c.extraProactive ?? 0, budget.limit) ? "interruption_budget" : null;
    },
  },
  { id: "contribution_budget", check: (w, _id, mi, c) => (CONTRIBUTOR_ROLES.has(c.role) && budgetReached(mi.recentContribution, c.extraContribution ?? 0, w.cfg.contribution.limit) ? "contribution_budget" : null) },
  {
    id: "category_quota", check: (w, id, mi, c) => {
      const quota = w.quotas[id]?.[c.category];
      return quota !== undefined && budgetReached(mi.categoryCount30.get(c.category) ?? 0, 0, quota) ? "category_quota" : null;
    },
  },
  {
    id: "category_cooldown", check: (w, id, _mi, c) => {
      const declinedAt = w.memberCategoryDeclines.get(id)?.get(c.category);
      return inCooldown(w.now, declinedAt !== undefined, declinedAt ?? 0, w.cfg.cooldowns.categoryDeclineDays * DAY) ? "category_cooldown" : null;
    },
  },
  {
    id: "reliability_holdout", check: (w, id) => {
      const tier = memberReliabilityTier(w, id);
      return tier === "RelCoolOff" || tier === "RelSuspended" ? "reliability_holdout" : null;
    },
  },
  { id: "quality_quarantine", check: (w, id) => (memberQualityBandOf(w, id) === "Q0Quarantine" ? "quality_quarantine" : null) },
  { id: "vampire_quarantine", check: (w, id) => (memberVampireTierOf(w, id) === "VampireQuarantined" ? "vampire_quarantine" : null) },
];

export function romanceCompatible(seeker: MemberIndex, other: MemberIndex): boolean {
  const r = seeker.romance;
  if (!r) return true;
  if (other.m.age < r.ageMin || other.m.age > r.ageMax) return false;
  if (r.seeks.length && !r.seeks.some(s => other.romance?.is.includes(s))) return false;
  return true;
}

export const NETWORK_PAIR_RULES: readonly PairRule[] = [
  {
    id: "negative_feedback_cooldown", check: (w, a, b) => {
      const neg = w.negativeFeedback.get(pairKey(a, b));
      return inCooldown(w.now, neg !== undefined, neg ?? 0, w.cfg.cooldowns.negativeFeedbackDays * DAY) ? "negative_feedback_cooldown" : null;
    },
  },
  {
    id: "pair_cooldown", check: (w, a, b) => {
      for (const r of w.pairInteractions.get(pairKey(a, b)) ?? []) {
        if (pairInteractionCooling(r.outcome, w.now, r.at, w.cfg.cooldowns.pairDeclinedDays * DAY)) return "pair_cooldown";
      }
      return null;
    },
  },
  { id: "active_duplicate", check: (w, a, b) => (w.activePairs.has(pairKey(a, b)) ? "active_duplicate" : null) },
  { id: "unknown_member", check: (_w, _a, _b, _lane, ma, mb) => (!ma || !mb ? "unknown_member" : null) },
  {
    id: "romance_incompatible", check: (w, _a, _b, lane, ma, mb) => {
      if (lane !== "romance") return null;
      if (!ma.m.prefs.romanceOptIn || !mb.m.prefs.romanceOptIn) return "romance_incompatible";
      if (w.cfg.romance.requireStatedPrefs && (!ma.romance?.seeks.length || !mb.romance?.seeks.length)) return "romance_incompatible";
      if (!romanceCompatible(ma, mb) || !romanceCompatible(mb, ma)) return "romance_incompatible";
      return null;
    },
  },
  { id: "dealbreaker", check: (_w, _a, _b, _lane, ma, mb) => (ma.dealbreakers.some(d => mb.tags.has(d)) || mb.dealbreakers.some(d => ma.tags.has(d)) ? "dealbreaker" : null) },
  { id: "cofounder_must_have", check: (w, a, b, _category, _ma, _mb, lane) => (lane === "Cofounder" && !cofounderMustHavesFit(w, a, b, "ntwrk") ? "cofounder_must_have" : null) },
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
  { id: "romance_group", check: (_w, c) => (c.category === "romance" && c.participants.length !== 2 ? "romance_group" : null) },
  { id: "high_risk", check: (w, c) => (c.riskFlags?.length || riskTerms(w.cfg, c.riskText).length ? "high_risk" : null) },
];

export const NETWORK_CANDIDATE_POST_RULES: readonly CandidateRule[] = [
  {
    id: "home_entry_rule", check: (w, c) => {
      if (c.kind === "help" && isHomeEntry(w.cfg, c.riskText)) {
        const requester = c.participants[0]!;
        const helpers = c.participants.slice(1);
        const helper = helpers[0];
        const knownSingleton = helpers.length === 1 && helper !== undefined
          && (w.edgeHas(requester, helper, "met") || w.edgeHas(requester, helper, "knows") || w.edgeHas(requester, helper, "helped"));
        const format = helpers.length === 1 ? "one_to_one" : "small_group";
        if (!homeHelperSetAllowed(helpers.length, knownSingleton)
          || c.participants.some(id => !w.get(id)?.m.prefs.formats.includes(format))) return "home_entry_rule";
        c.safetyClass = "medium";
      }
      return null;
    },
  },
];

export function networkHardGate(w: { get(id: string): MemberIndex | undefined }, c: { participants: string[]; category: string }): string | null {
  for (const id of c.participants) {
    const m = w.get(id)!.m;
    if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
    if (!m.prefs.categoriesOptIn.includes(c.category as never)) return "category_opt_out";
  }
  return null;
}
